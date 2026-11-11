# NEU-2271 — Public reads fail fast under a burst instead of queueing 30 s for a connection

**Ticket:** NEU-2271 · **Related:** NEU-2270 (the same crawl, frontend half) · **ADR:**
`../adr/0028-overload-sheds-in-one-process.md` · **Measurements:**
`../measurements/2026-11-10-neu-2271-pool-baseline.md`

## Problem

On 2026-11-09 and 2026-11-10 at about 10:25 UTC a crawler (Lightpanda, now blocked at Cloudflare)
loaded ~240 entity pages in three minutes from 458 IPs. The API's pool (SQLAlchemy defaults: 5 +
10 overflow, 30 s checkout timeout) ran dry: 484 requests waited 30 s and failed as 500s
(`UPCOMING-MOVIES-BACKEND-4`), and any real visitor in those minutes queued behind them.

The queries are not slow. Unloaded, a person read costs ~50–150 ms of server time. The cause is
**how long connections stay checked out**: prod is one uvicorn process, and a request's session
holds its connection from its first query until the request ends. A saturated process keeps
connections out long after their queries finish. The per-IP rate limiter cannot help against 458
IPs. Blocking one user agent stops this crawler, not the next one, nor a real traffic spike.

## Decisions

**D-2271.1 — One process; shed load, don't add workers.** See ADR-0028. The in-process rate
limiter and per-process lifespan work make workers unsafe today.

**D-2271.2 — Public read routes release their connection as soon as the service returns.**
Every route in `src/upmovies/routers/public.py` that takes a session ends the session's
transaction after its service call and before returning. The connection goes back to the pool
before FastAPI builds and sends the response. The services already return Pydantic response
models (`PersonDetailResponse`, `EntityEventsResponse`, …), not live ORM objects, so nothing reads
the database after the release. Do it with one small helper in the router, e.g.
`await _release(session)` wrapping `session.close()`, rather than a new dependency. The release
point is mid-handler, which a dependency's teardown cannot reach. `get_session` stays as it is
for every other router.

**D-2271.3 — The pool is explicit and configured.** Three settings in `config.py`, following the
existing `Field(default=…, alias=…)` pattern, passed to `create_async_engine` in `db.py`:

| Setting | Env var | Default |
|---|---|---|
| `db_pool_size` | `DB_POOL_SIZE` | `10` |
| `db_max_overflow` | `DB_MAX_OVERFLOW` | `20` |
| `db_pool_timeout` | `DB_POOL_TIMEOUT` | `3.0` (seconds) |

Why these: Postgres is dedicated to BackLotter with `max_connections` = 100 and ~5 in use at
rest. The scheduled `pipeline_run` tasks import the same `db.py` engine and environment, so the
caps apply per process. 30 for the API plus two tasks at their cap is 90, still under 100, and
the tasks are sequential and rarely open more than a couple. Pool sizes are caps, not
reservations: overflow connections open on demand and close on return. A 3 s checkout wait is
about 20× the query time, and short enough that a request which can't get a connection fails
fast. Prod uses the defaults; nothing needs setting in Coolify unless measurement says otherwise.

**D-2271.4 — Pool exhaustion answers 503 with `Retry-After`.** `create_app` registers a handler
for `sqlalchemy.exc.TimeoutError`, next to the `RateLimited` handler and shaped like it:

```json
HTTP 503, Retry-After: 5
{"detail": "overloaded", "retry_after": 5}
```

`Retry-After` is a module constant, 5 s. It applies on every route, not only public ones: pool
exhaustion anywhere is overload, never a request fault. Scheduled tasks are unaffected; they
serve no HTTP. If one ever exhausts its own pool, it now fails after 3 s instead of 30.

**D-2271.5 — Overload stays visible in Bugsink as one warning issue.** A handled 503 is not an
unhandled exception, so Sentry no longer records it. `telemetry.py` sets
`LoggingIntegration(event_level=None)`, so log lines never become events either. The handler
therefore:

- logs a warning for every 503 (path and `engine.pool.status()`);
- sends at most **one event per 60 s per process**:
  `sentry_sdk.capture_message("DB connection pool exhausted", level="warning")` with fingerprint
  `["db-pool-exhausted"]` and the path and pool status as extras. The cap is a module-level
  monotonic timestamp.

The result is one grouped Bugsink issue. Bugsink alerts on a new issue or a regression, not on
every event, so a burst produces one alert and a handful of events, not hundreds.

**D-2271.6 — A burst script proves it, before and after.** Add `scripts/bench_public_burst.py`,
dev-only, run in the container (`task shell`, then `python scripts/bench_public_burst.py …`), in
the style of `scripts/bench_follows.py`:

- It reads up to N live person refs from the local database through `SessionLocal`, read-only.
- It fires `--requests` GETs at `/people/{ref}` and `/people/{ref}/events`, alternating, against
  the local API (`http://localhost:8000`) with `--concurrency` in flight, using `httpx.AsyncClient`.
- It reports status counts, p50/p95/max latency, and the slowest 503 if there were any.

Run it on `main` before the change and on the branch after, with the same arguments; suggested
`--requests 600 --concurrency 100`. Record both runs in
`docs/measurements/<date>-neu-2271-burst.md`. The local stack is not prod: it runs
`uvicorn --reload` against local data. The comparison between the two runs is what counts, not
the absolute numbers.

## Acceptance criteria

- [ ] `db.py` builds the engine from `db_pool_size`, `db_max_overflow` and `db_pool_timeout`, with
  defaults 10 / 20 / 3.0 and env aliases as in D-2271.3.
- [ ] Every session-taking route in `routers/public.py` returns its connection before it returns.
  A test calls `GET /people/{ref}` and `GET /people/{ref}/events` and asserts the session they
  used reports `in_transaction() is False` once the handler returns, e.g. via a `get_session`
  override that keeps the session for inspection.
- [ ] An integration test builds an app whose engine has `pool_size=1`, `max_overflow=0` and a
  short timeout, and holds that one connection. `GET /people/{ref}` then returns **503** with body
  `{"detail": "overloaded", "retry_after": 5}` and header `Retry-After: 5`, within the timeout
  plus 1 s.
- [ ] The same test asserts a warning was logged, and that a second 503 within 60 s does not call
  `capture_message` again (Sentry client mocked).
- [ ] `docs/measurements/<date>-neu-2271-burst.md` records the before and after runs of
  `bench_public_burst.py` with identical arguments. After: **zero 500s**; every 503 answers in
  under `db_pool_timeout` + 1 s; successful requests per second at least the before run's.
- [ ] `task format`, then `task test && task lint && task typecheck`, pass.
- [ ] Two follow-up tickets are filed and linked to NEU-2271:
  1. Edge caching of public entity pages. It must vary on `timeline_hint` (ADR-0026).
  2. The frontend renders an API 503 as a "busy, try again" page that honours `Retry-After`, and
     doesn't report it to Bugsink as an error. Today `api/public.ts` throws on any non-404.

## Out of scope

- **More uvicorn workers.** See ADR-0028. Revisit only with a shared rate-limit store.
- **Edge caching** and **frontend 503 handling.** These are the follow-ups above.
- **Query tuning.** Measured fast unloaded (~50–150 ms). If the burst script shows one route far
  slower than the rest, file it rather than widen this PR.
- **The Cloudflare WAF rule.** Already in place, a dashboard change.
- **`get_session` for non-public routers.** Authenticated and admin traffic was not part of the
  incident, and their handlers may read after the service returns.

## Known consequence

Until the frontend follow-up lands, a burst that reaches the API produces fast 503s. Each one
becomes an SSR loader error: reported to the `upcoming-movies-frontend` Bugsink project and
rendered as the 500 page. Visitors still see an error page during a burst, but after about 3 s
rather than 30, and the backend no longer piles up.

*Update (NEU-2273):* the frontend follow-up has landed. The loaders now render an overload 503 as
a "busy, try again" page, served as a 503 with the API's `Retry-After`, and report nothing. The
"reported to Bugsink" half above was never true: loader errors went unreported until that ticket
added `handleError` to `entry.server.tsx`.
