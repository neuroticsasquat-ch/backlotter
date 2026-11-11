"""Pool exhaustion answers 503, not 500 (NEU-2271, D-2271.4/5, ADR-0028).

A request that cannot check a connection out of the pool within `DB_POOL_TIMEOUT` raises
`sqlalchemy.exc.TimeoutError`. Left alone that is a 500 after the wait, which reads as a server
fault and, with SQLAlchemy's 30 s default, held the frontend Worker's request open for the
whole of it. It is overload: the client did nothing wrong and can retry. So the app answers
**503 with `Retry-After`**, on every route, shaped like the rate limiter's 429.

A handled 503 never reaches Sentry as an exception, and a log line never becomes an event
either, so overload would vanish from Bugsink. The handler therefore logs a warning for every
503 and sends at most one warning event per `CAPTURE_INTERVAL_SECONDS` per process, all under
one fingerprint: a burst is one Bugsink issue and a handful of events, not hundreds.
"""

import logging
import time

import sentry_sdk
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import TimeoutError as PoolTimeout

from upmovies.db import engine

log = logging.getLogger(__name__)

RETRY_AFTER_SECONDS = 5
"""What the 503 tells the client to wait: a little longer than the pool's 3 s checkout timeout,
so a retry doesn't land on the same queue, and short enough for a visitor to sit through."""

CAPTURE_INTERVAL_SECONDS = 60.0
"""At most one Bugsink event per this many seconds per process."""

FINGERPRINT = ["db-pool-exhausted"]

_last_capture: float | None = None
"""`time.monotonic()` of the last event sent, process-wide. `None` until the first."""


def _should_capture(now: float) -> bool:
    global _last_capture
    if _last_capture is not None and now - _last_capture < CAPTURE_INTERVAL_SECONDS:
        return False
    _last_capture = now
    return True


async def pool_exhausted_handler(request: Request, exc: Exception) -> JSONResponse:
    """The 503. Registered on the app in `create_app`, next to the rate limiter's 429.

    Typed against bare `Exception` because that is the signature Starlette's handler registry
    expects, as `rate_limited_handler` is."""
    assert isinstance(exc, PoolTimeout)
    path = request.url.path
    pool_status = engine.pool.status()
    log.warning("db pool exhausted, answering 503: path=%s %s (%s)", path, pool_status, exc)
    if _should_capture(time.monotonic()):
        with sentry_sdk.new_scope() as scope:
            scope.fingerprint = FINGERPRINT
            scope.set_extra("path", path)
            scope.set_extra("pool_status", pool_status)
            scope.set_extra("error", str(exc))
            sentry_sdk.capture_message("DB connection pool exhausted", level="warning")
    return JSONResponse(
        status_code=503,
        content={"detail": "overloaded", "retry_after": RETRY_AFTER_SECONDS},
        headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
    )
