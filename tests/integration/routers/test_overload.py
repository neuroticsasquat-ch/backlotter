"""Overload under a burst (NEU-2271, ADR-0028): public reads hand their connection back as soon
as the service returns, and a pool checkout timeout answers 503 with `Retry-After` instead of
a 500 after the wait."""

import logging
import os
import time
from collections.abc import AsyncIterator
from unittest.mock import MagicMock

import pytest
import sentry_sdk
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from upmovies import overload
from upmovies.deps import get_session
from upmovies.main import app

POOL_TIMEOUT = 0.5


async def test_person_routes_release_their_connection_before_returning(
    client, session_factory, make_person
):
    """The override hands out a session and never closes it, as `get_session` would after the
    response. Whatever state the handler left it in is what a burst would see: a session
    still in a transaction is a connection still checked out."""
    await make_person(id=525, name="Christopher Nolan")
    kept: list[AsyncSession] = []

    async def kept_session() -> AsyncIterator[AsyncSession]:
        s = session_factory()
        kept.append(s)
        yield s

    app.dependency_overrides[get_session] = kept_session
    try:
        assert (await client.get("/people/525")).status_code == 200
        assert (await client.get("/people/525/events")).status_code == 200
        # Read before the `finally` closes them, which would make the answer False regardless.
        in_transaction = [s.in_transaction() for s in kept]
    finally:
        app.dependency_overrides.pop(get_session, None)
        for s in kept:
            await s.close()

    assert in_transaction == [False, False]


@pytest.fixture
async def exhausted_client(test_engine) -> AsyncIterator[AsyncClient]:  # noqa: ARG001
    """A client whose sessions come from a one-connection pool, with that connection held."""
    tiny = create_async_engine(
        os.environ["TEST_DATABASE_URL"], pool_size=1, max_overflow=0, pool_timeout=POOL_TIMEOUT
    )
    maker = async_sessionmaker(tiny, expire_on_commit=False)

    async def tiny_session() -> AsyncIterator[AsyncSession]:
        async with maker() as s:
            yield s

    app.dependency_overrides[get_session] = tiny_session
    try:
        async with tiny.connect():
            async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:
                yield c
    finally:
        app.dependency_overrides.pop(get_session, None)
        await tiny.dispose()


async def test_an_exhausted_pool_answers_503_fast_and_reports_once(
    exhausted_client, monkeypatch, caplog
):
    scopes: list[tuple[list[str] | None, dict]] = []

    def record_scope(*_args, **_kwargs) -> None:
        # What the event would carry: the scope current at the call.
        scope = sentry_sdk.get_current_scope()
        scopes.append((scope._fingerprint, dict(scope._extras)))

    capture = MagicMock(side_effect=record_scope)
    monkeypatch.setattr(sentry_sdk, "capture_message", capture)
    monkeypatch.setattr(overload, "_last_capture", None)

    with caplog.at_level(logging.WARNING, logger=overload.__name__):
        started = time.perf_counter()
        r = await exhausted_client.get("/people/525")
        elapsed = time.perf_counter() - started
        again = await exhausted_client.get("/people/525/events")

    assert r.status_code == 503
    assert r.json() == {"detail": "overloaded", "retry_after": 5}
    assert r.headers["Retry-After"] == "5"
    assert elapsed < POOL_TIMEOUT + 1
    assert again.status_code == 503

    warnings = [rec for rec in caplog.records if rec.name == overload.__name__]
    assert len(warnings) == 2
    assert all(rec.levelno == logging.WARNING for rec in warnings)
    assert "/people/525" in warnings[0].getMessage()

    # Two 503s inside a minute: one Bugsink event, not two.
    capture.assert_called_once_with("DB connection pool exhausted", level="warning")
    # One fingerprint, so every burst groups into the same Bugsink issue.
    [(fingerprint, extras)] = scopes
    assert fingerprint == ["db-pool-exhausted"]
    assert extras["path"] == "/people/525"
    assert "pool_status" in extras
