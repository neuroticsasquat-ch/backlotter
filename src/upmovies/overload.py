"""Overload answers 503, not 500 or a hung event loop (NEU-2271, NEU-2285, ADR-0028).

Two ways in, one answer: **503 `overloaded` with `Retry-After`**, the body the frontend renders
as its busy page.

- **Pool exhaustion** (NEU-2271, D-2271.4/5). A request that cannot check a connection out of
  the pool within `DB_POOL_TIMEOUT` raises `sqlalchemy.exc.TimeoutError`. Left alone that is a
  500 after the wait, which reads as a server fault. It is overload: the client did nothing
  wrong and can retry. `pool_exhausted_handler` answers it on every route.
- **The in-flight cap** (NEU-2285). The pool timeout fires only after a request has waited 3 s,
  and nothing bounded how many requests the one process accepted. Under a big enough burst the
  event loop fell so far behind that `/healthz` missed the Docker health check, and Traefik took
  the container out of rotation. `InFlightCap` sheds every request past
  `MAX_IN_FLIGHT_REQUESTS` before it does any work, so the loop stays short enough to answer.

A handled 503 never reaches Sentry as an exception, and a log line never becomes an event
either, so overload would vanish from Bugsink. Both paths therefore log a warning for every 503
and send at most one warning event per `CAPTURE_INTERVAL_SECONDS` per process, each under its
own fingerprint: a burst is one Bugsink issue per cause and a handful of events, not hundreds.
"""

import logging
import time

import sentry_sdk
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import TimeoutError as PoolTimeout
from starlette.types import ASGIApp, Receive, Scope, Send

from upmovies.db import engine

log = logging.getLogger(__name__)

RETRY_AFTER_SECONDS = 5
"""What the 503 tells the client to wait: a little longer than the pool's 3 s checkout timeout,
so a retry doesn't land on the same queue, and short enough for a visitor to sit through."""

CAPTURE_INTERVAL_SECONDS = 60.0
"""At most one Bugsink event per this many seconds per process, per fingerprint."""

FINGERPRINT = ["db-pool-exhausted"]
IN_FLIGHT_CAP_FINGERPRINT = ["in-flight-cap"]

EXEMPT_PATHS = frozenset({"/healthz"})
"""Never counted and never shed: the liveness probe does no work, and answering it is the point
of the cap."""

_last_capture: dict[str, float] = {}
"""`time.monotonic()` of the last event sent per fingerprint, process-wide. Keyed so the cap
and the pool each get their own event in a burst that trips both."""


def _should_capture(key: str, now: float) -> bool:
    last = _last_capture.get(key)
    if last is not None and now - last < CAPTURE_INTERVAL_SECONDS:
        return False
    _last_capture[key] = now
    return True


def _overloaded_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": "overloaded", "retry_after": RETRY_AFTER_SECONDS},
        headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
    )


def _capture(fingerprint: list[str], message: str, **extras: object) -> None:
    if not _should_capture(fingerprint[0], time.monotonic()):
        return
    with sentry_sdk.new_scope() as scope:
        scope.fingerprint = fingerprint
        for name, value in extras.items():
            scope.set_extra(name, value)
        sentry_sdk.capture_message(message, level="warning")


async def pool_exhausted_handler(request: Request, exc: Exception) -> JSONResponse:
    """The 503. Registered on the app in `create_app`, next to the rate limiter's 429.

    Typed against bare `Exception` because that is the signature Starlette's handler registry
    expects, as `rate_limited_handler` is."""
    assert isinstance(exc, PoolTimeout)
    path = request.url.path
    pool_status = engine.pool.status()
    log.warning("db pool exhausted, answering 503: path=%s %s (%s)", path, pool_status, exc)
    _capture(
        FINGERPRINT,
        "DB connection pool exhausted",
        path=path,
        pool_status=pool_status,
        error=str(exc),
    )
    return _overloaded_response()


class InFlightCap:
    """Pure ASGI middleware that admits at most `limit` requests at once and answers the rest
    with the overload 503 straight away, before routing, dependencies or the database.

    Pure ASGI rather than `BaseHTTPMiddleware`, which runs the app in a separate task and
    buffers through a stream: overhead on every admitted request, for nothing here.

    The count needs no lock: the check and the increment run with no `await` between them, on
    the process's one event loop. A request leaves the count when the app returns, which is
    after its response has been sent.

    Registered inside `CORSMiddleware`, so a shed 503 carries the CORS headers a browser
    needs to read it as overload rather than a network error."""

    def __init__(self, app: ASGIApp, limit: int) -> None:
        self.app = app
        self.limit = limit
        self.in_flight = 0

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return
        if self.in_flight >= self.limit:
            await self._shed(scope, receive, send)
            return
        self.in_flight += 1
        try:
            await self.app(scope, receive, send)
        finally:
            self.in_flight -= 1

    async def _shed(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope["path"]
        log.warning(
            "in-flight cap reached, answering 503: path=%s in_flight=%d limit=%d",
            path,
            self.in_flight,
            self.limit,
        )
        _capture(
            IN_FLIGHT_CAP_FINGERPRINT,
            "In-flight request cap reached",
            path=path,
            in_flight=self.in_flight,
            limit=self.limit,
        )
        await _overloaded_response()(scope, receive, send)
