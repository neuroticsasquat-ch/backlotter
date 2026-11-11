# NEU-2271 — DB pool baseline (prod, before the fix)

Taken 2026-11-11 ~03:10–03:40 UTC, all read-only, while planning NEU-2271. These are the numbers
the spec's pool sizing rests on (`../specs/NEU-2271-db-pool-fail-fast.md`).

## The incident

Bugsink `UPCOMING-MOVIES-BACKEND-4`, checked 2026-11-10: `TimeoutError: QueuePool limit of size 5
overflow 10 reached, connection timed out, timeout 30.00`, 484 events, release `fe29139`.

| Minute (UTC) | Timeouts |
|---|---|
| 2026-11-09 10:34 / 10:35 / 10:36 | 95 / 26 / 2 |
| 2026-11-10 10:24 / 10:25 / 10:26 | 45 / 238 / 78 |

By route: `/people/{ref}/events` 236, `/people/{ref}` 228, `/companies/{ref}` 10,
`/companies/{ref}/events` 6, `/collections/{ref}/events` 3. All 484 carry `X-Backlotter-Origin`
(SSR loader fetches from the frontend Worker) and name **458 distinct** `X-Backlotter-Client-IP`
values. The minutes match the Lightpanda crawl's frontend events (`UPCOMING-MOVIES-FRONTEND-3`,
NEU-2270). Lightpanda is blocked at Cloudflare since 2026-11-11.

## Postgres

Container `mqxxit45ifsivt17b5rl5d2s` (the backend's `DATABASE_URL` host), database `postgres`,
dedicated to BackLotter. Read by Tom with `psql` via `ssh music-box-dancer` (the permission
classifier blocks Claude's own prod `psql`).

- `max_connections` = **100**.
- At rest: the API held 5 (3 `idle`, 2 `idle in transaction`). A second look minutes later found
  no `idle in transaction` backends, so those two were in-flight work, not a leak.
- The other Postgres on the host (`hi99cy05kfbaxrdzn2nw94vg`, Postgres 18, `max_connections`
  100) holds `tvbf`, not BackLotter.

## Unloaded latency

20 sequential requests from a laptop (US East) to `https://api.backlotter.com`, 10 person refs
from the incident's events, each `/people/{ref}` and `/people/{ref}/events` once. All 200.

| | TTFB | TLS connect | TTFB − connect |
|---|---|---|---|
| Person endpoints | 0.37–0.51 s | 0.24–0.32 s | **0.12–0.26 s** |
| `/readyz` (no DB work), 3 runs | 0.35–0.39 s | 0.24 s | 0.11–0.15 s |

So a person read costs roughly 50–150 ms of server time over the network floor. Slow queries do
not explain 30 s pool waits; connections were held far longer than their queries.

## Process

- Prod runs one uvicorn process (`Dockerfile`, prod `CMD`: no `--workers`), so the API uses at
  most one core.
- Host `music-box-dancer`: 8 cores. The backend container has no CPU or memory limit; at rest it
  used 4% CPU and 304 MiB.
- `get_session` (`src/upmovies/deps.py`) is `async with SessionLocal()`. A session holds its
  connection from its first query until the request ends.
