"""Overload under a burst (NEU-2271, NEU-2285, ADR-0028): public reads hand their connection
back as soon as the service returns, a pool checkout timeout answers 503 with `Retry-After`
instead of a 500 after the wait, and past the in-flight cap a request is shed with the same 503
before it does any work."""

import asyncio
import logging
import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest
import sentry_sdk
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from upmovies import main, overload
from upmovies.config import get_settings
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
    monkeypatch.setattr(overload, "_last_capture", {})

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


@dataclass
class Capped:
    client: AsyncClient
    sessions_opened: list[int]
    release: Callable[[], Awaitable[None]]


@pytest.fixture
async def capped(test_engine, session_factory, monkeypatch) -> AsyncIterator[Capped]:  # noqa: ARG001
    """The real app stack, built with `MAX_IN_FLIGHT_REQUESTS=1` and one request held open
    inside it: its session dependency waits on an event, so it occupies the only slot."""
    # `get_settings` is cached, so an env var would never reach it; hand `create_app` a copy.
    capped_settings = get_settings().model_copy(update={"max_in_flight_requests": 1})
    monkeypatch.setattr(main, "get_settings", lambda: capped_settings)
    # `create_app`'s logging setup is `basicConfig(force=True)`, which would detach `caplog`.
    monkeypatch.setattr(main, "configure_logging", lambda _level: None)
    monkeypatch.setattr(main, "init_sentry", lambda *_a, **_k: None)
    # Every test here sheds, so keep the throttle and the SDK out of process-wide state.
    monkeypatch.setattr(overload, "_last_capture", {})
    monkeypatch.setattr(sentry_sdk, "capture_message", MagicMock())
    capped_app = main.create_app()

    entered, release = asyncio.Event(), asyncio.Event()
    sessions_opened: list[int] = []

    async def held_session() -> AsyncIterator[AsyncSession]:
        sessions_opened.append(1)
        if len(sessions_opened) == 1:
            entered.set()
            await release.wait()
        async with session_factory() as s:
            yield s

    capped_app.dependency_overrides[get_session] = held_session
    async with AsyncClient(transport=ASGITransport(app=capped_app), base_url="https://test") as c:
        held = asyncio.create_task(c.get("/people/525"))
        await asyncio.wait_for(entered.wait(), timeout=5)

        async def release_held() -> None:
            release.set()
            await held

        try:
            yield Capped(c, sessions_opened, release_held)
        finally:
            await release_held()


async def test_past_the_cap_a_request_is_shed_with_503_before_touching_the_db(capped, test_engine):
    origin = get_settings().cors_allowed_origins[0]
    # The engine the overridden session dependency checks out from.
    pool_before = test_engine.pool.status()

    r = await capped.client.get("/people/525", headers={"Origin": origin})

    assert r.status_code == 503
    assert r.json() == {"detail": "overloaded", "retry_after": 5}
    assert r.headers["Retry-After"] == "5"
    # Inside CORS, so a browser can read the 503 as overload rather than a network error.
    assert r.headers["access-control-allow-origin"] == origin
    # Shed before routing: the session dependency ran once, for the held request only.
    assert capped.sessions_opened == [1]
    assert test_engine.pool.status() == pool_before

    # The slot comes back once the held request finishes: the next one reaches the route,
    # which 404s because no person 525 exists.
    await capped.release()
    assert (await capped.client.get("/people/525")).status_code == 404


async def test_healthz_answers_while_the_cap_is_reached(capped):
    r = await capped.client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_a_shed_request_logs_and_reports_once_under_its_own_fingerprint(
    capped, monkeypatch, caplog
):
    scopes: list[tuple[list[str] | None, dict]] = []

    def record_scope(*_args, **_kwargs) -> None:
        scope = sentry_sdk.get_current_scope()
        scopes.append((scope._fingerprint, dict(scope._extras)))

    capture = MagicMock(side_effect=record_scope)
    monkeypatch.setattr(sentry_sdk, "capture_message", capture)
    # A pool-exhaustion event just went out: the cap's own event is throttled separately.
    monkeypatch.setattr(overload, "_last_capture", {"db-pool-exhausted": time.monotonic()})

    with caplog.at_level(logging.WARNING, logger=overload.__name__):
        first = await capped.client.get("/people/525")
        second = await capped.client.get("/people/525/events")

    assert (first.status_code, second.status_code) == (503, 503)
    warnings = [rec for rec in caplog.records if rec.name == overload.__name__]
    assert len(warnings) == 2
    assert all(rec.levelno == logging.WARNING for rec in warnings)
    assert "/people/525" in warnings[0].getMessage()

    # Two sheds inside a minute: one Bugsink event, under the cap's fingerprint.
    capture.assert_called_once_with("In-flight request cap reached", level="warning")
    [(fingerprint, extras)] = scopes
    assert fingerprint == ["in-flight-cap"]
    assert extras == {"path": "/people/525", "in_flight": 1, "limit": 1}
