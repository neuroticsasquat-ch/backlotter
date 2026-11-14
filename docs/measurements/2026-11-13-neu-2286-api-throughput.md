# NEU-2286 — What limits the API's throughput on person pages

Taken 2026-11-13 (US time). The prod records were read from SigNoz between ~22:30 and 23:40 UTC.
The bench runs ran 2026-11-13 23:45 UTC to 2026-11-14 ~02:00 UTC. Spec:
`../specs/NEU-2286-api-throughput-spike.md`. Builds on `2026-11-10-neu-2271-pool-baseline.md` and
`2026-11-10-neu-2271-burst.md`.

## Summary

- **Verdict: loop-bound.** During the 2026-11-13 burst the API's one process ran at one full
  core (1.01–1.04 cores) for two minutes. The app's Postgres used 0.27 cores, and the 8-core
  host was at most 5.3 cores busy. Every part of a request stretched about 10× together,
  including statements that cost Postgres nothing (`BEGIN;` went from 0.5 ms to 29 ms p50). That
  is time spent waiting for the event loop, not for the database.
- **The ceiling is ~40 requests a second in prod**, about 25 ms of CPU per person request. The
  process held that rate for 80 s. The access log's 679 lines undercount: uvicorn writes no line
  for a client that has already disconnected, and the traces show ~4,500 completed requests.
- **What the CPU goes on** (bench, at process saturation): SQLAlchemy is 64% of event-loop
  time, mostly *building* statements (constructing, cloning and annotating `select()` objects)
  rather than compiling or running them. Next come the server and framework at 10% and OTel at 8%.
  Turned off from outside, OTel costs 23% of throughput and Sentry 11.5% (together 39%, ~28% of
  the CPU). Gzip costs nothing measurable.
- **Why `/healthz` missed:** the backlog was not inside the app. A closed loop at any in-flight
  count up to 120 never pushed the probe past 0.5 s on the bench. The probe missed in prod because
  arrivals outran the process and queued *ahead of* the app, in the listen backlog, where the
  in-flight cap cannot see them. Replayed open-loop, the incident reproduces on the bench without
  the cap (Docker marked the container unhealthy for 71 s) and does not with it, at 1.4× the
  incident's admissions in prod terms.
- **Recommended `MAX_IN_FLIGHT_REQUESTS`: 30**, down from 60 (NEU-2291). This overrides the
  spec's D-2286.4 criterion, which by its letter gives 60 (§4). Throughput stops rising at about
  10 in flight, so the extra slots add only waiting. In the replay, 30 halved admitted latency
  and missed no probe, at the same throughput.

## 1. The incident, re-read from SigNoz

Read 2026-11-13 from SigNoz's ClickHouse (read-only; queries in the appendix). Burst window
10:42–10:48 UTC, quiet comparison window 09:42–09:48 UTC. The process is one instance throughout
(`service.instance.id` `4cafe494…`, build `1088f2f`). NEU-2285's cap was not yet deployed (it went
out at 17:05 UTC), so nothing limited admission except the pool.

### Arrivals and completions

Root spans are requests. Every root span in the window is a `Server` span for a route (`GET
/people/{ref}/events` 2,176, `GET /people/{ref}` 2,103, companies 344, films 49, collections 35,
`/feed/grouped` 6, `/readyz` 4, `/me` 2). None is a pool or connection span. `/healthz` has none,
because prod sets `OTEL_PYTHON_FASTAPI_EXCLUDED_URLS=health`.

| Minute (UTC) | Root spans, 200 | Root spans, 503 | p50 | p95 | Access-log lines | `/people` lines |
|---|---|---|---|---|---|---|
| 10:42 | 66 | — | 40 ms | 70 ms | 72 | 46 |
| 10:43 | 472 | 83 | 1,765 ms | 3,637 ms | 414 | 359 |
| 10:44 | 1,741 | 66 | 612 ms | 5,858 ms | 227 | 217 |
| 10:45 | 2,163 | — | 446 ms | 771 ms | 31 | 18 |
| 10:46 | 64 | — | 45 ms | 74 ms | 70 | 20 |

(The planning count in the spec, 27,214 and 32,176 spans for 10:44 and 10:45, is every span,
children included: about 17 per request.)

**The 679 lines, reconciled.** Over 10:43:30–10:46:30, the window the `docker logs` count came
from, SigNoz holds exactly **679** access lines (597 × 200, 82 × 503), and **4,532** root spans
(149 × 503). So 3,853 completed requests have no access line.

**The traces are right and the access log undercounts.** uvicorn writes its access line when the
response starts, and skips it when the client has already disconnected. In 10:45 the process
completed 2,163 requests and logged 31. By then Traefik had taken the container out of rotation
(below) and the clients had given up. The process went on serving requests whose callers were
gone. So the 679 lines are the requests answered while someone was still waiting, and the
incident was more arrivals than the log suggested, not low throughput alone.

Arrival times are not recorded anywhere. A server span starts when the app picks the request up,
not when it reached the host, and Traefik's access log is off. The admissions per second
(`2026-11-13-neu-2286-incident-arrivals.csv`, 4,512 between 10:43:30 and 10:46:10, peaking at
71/s at 10:44:02) are therefore a lower bound on arrivals.

Completions per 10 s, by span start:

| 10 s from | Requests | `/people` | 503 | | 10 s from | Requests | `/people` | 503 |
|---|---|---|---|---|---|---|---|---|
| 10:43:40 | 48 | 36 | 0 | | 10:45:00 | 405 | 388 | 0 |
| 10:43:50 | 466 | 437 | 83 | | 10:45:10 | 412 | 382 | 0 |
| 10:44:00 | 300 | 280 | 66 | | 10:45:20 | 391 | 351 | 0 |
| 10:44:10 | 184 | 168 | 0 | | 10:45:30 | 406 | 353 | 0 |
| 10:44:20 | 210 | 200 | 0 | | 10:45:40 | 420 | 376 | 0 |
| 10:44:30 | 343 | 332 | 0 | | 10:45:50 | 129 | 111 | 0 |
| 10:44:40 | 372 | 363 | 0 | | 10:46:00 | 20 | 6 | 0 |
| 10:44:50 | 398 | 388 | 0 | | | | | |

From 10:44:30 to 10:45:50 the process held **~40 requests a second** (37 of them person reads),
with no 503s. That is the ceiling. The 149 503s at the onset are pool timeouts: the pool was at
its 30 connections, and checkouts waited 3 s behind a loop that could not hand connections back.

Person requests per 10 s, by span start: server-side duration p50/p95, and the mean wire and
checkout time defined below.

| 10 s from | Requests | 503 | p50 | p95 | Wire (mean) | Checkout (mean) |
|---|---|---|---|---|---|---|
| 10:43:30 | 4 | 0 | 41 ms | 52 ms | 19 ms | 9 ms |
| 10:43:40 | 36 | 0 | 185 ms | 965 ms | 172 ms | 75 ms |
| 10:43:50 | 437 | 79 | 1915 ms | 4627 ms | 581 ms | 1091 ms |
| 10:44:00 | 280 | 59 | 5392 ms | 8657 ms | 948 ms | 1453 ms |
| 10:44:10 | 168 | 0 | 799 ms | 2615 ms | 390 ms | 182 ms |
| 10:44:20 | 200 | 0 | 967 ms | 1338 ms | 392 ms | 176 ms |
| 10:44:30 | 332 | 0 | 545 ms | 865 ms | 241 ms | 106 ms |
| 10:44:40 | 363 | 0 | 483 ms | 842 ms | 218 ms | 99 ms |
| 10:44:50 | 388 | 0 | 477 ms | 745 ms | 210 ms | 94 ms |
| 10:45:00 | 388 | 0 | 462 ms | 731 ms | 204 ms | 92 ms |
| 10:45:10 | 382 | 0 | 446 ms | 762 ms | 200 ms | 92 ms |
| 10:45:20 | 351 | 0 | 487 ms | 840 ms | 222 ms | 96 ms |
| 10:45:30 | 353 | 0 | 420 ms | 704 ms | 175 ms | 81 ms |
| 10:45:40 | 376 | 0 | 412 ms | 803 ms | 195 ms | 91 ms |
| 10:45:50 | 111 | 0 | 445 ms | 741 ms | 191 ms | 89 ms |
| 10:46:00 | 6 | 0 | 42 ms | 56 ms | 19 ms | 4 ms |


### Where a request's time went

Per person request (`/people/{ref}` and `/people/{ref}/events`), from its child spans. "Wire" is
the summed duration of the asyncpg spans, from sending a statement to the coroutine resuming with
its result, so it includes any wait for the loop. "Checkout" is SQLAlchemy's `connect` span: pool
wait plus the pre-ping.

| Window | Requests | Mean | Wire (asyncpg) | Checkout | Statements | Wire share |
|---|---|---|---|---|---|---|
| Quiet, 09:42–09:48 | 404 | 50 ms | 23 ms | 5 ms | 7.9 | 45% |
| Onset, 10:43:50–10:44:10 | 717 | 3,584 ms | 724 ms | 1,232 ms | 6.3 | 20% |
| Burst steady state, 10:44:30–10:45:50 | 2,933 | 505 ms | 208 ms | 94 ms | 7.9 | 41% |

In the steady state everything grew about 10×, and the share inside the database stayed where it
was. A slow database would grow the wire share; a saturated loop grows everything evenly. At the
onset, the checkout wait dominated: requests were queued for the pool.

Eight statements per request, and only about three of them are queries. With `pool_pre_ping=True`
every checkout runs `BEGIN; ; ROLLBACK;` before the request's own `BEGIN` … `ROLLBACK`. So five
round trips of every eight are transaction bookkeeping and the ping. Each is a loop round trip and
two spans (SQLAlchemy's and asyncpg's).

### The database

Per statement, asyncpg spans only. The SQLAlchemy span wraps the same statement, so counting both
would double it. Burst = 10:44:30–10:45:50.

| Statement | Quiet p50 / p95 | Burst p50 / p95 |
|---|---|---|
| `BEGIN;` | 0.5 / 6.5 ms | 28.7 / 69.0 ms |
| `;` (pre-ping) | 0.8 / 4.6 ms | 21.0 / 49.5 ms |
| `ROLLBACK;` | 0.4 / 2.6 ms | 21.1 / 48.6 ms |
| `SELECT EXISTS (… catalog.person …)` | 0.7 / 3.2 ms | 8.6 / 24.1 ms |
| `SELECT catalog.person.…` (detail) | 0.6 / 28.8 ms | 8.4 / 19.8 ms |
| `SELECT catalog.film.…` (credits) | 1.4 / 30.2 ms | 9.5 / 60.1 ms |
| `WITH governing AS (…)` (release dates) | 0.4 / 2.3 ms | 22.2 / 46.8 ms |
| `SELECT catalog.film.id, release_date …` | 0.3 / 22.8 ms | 19.7 / 48.6 ms |
| `SELECT news.event.…` (events page) | 8.1 / 14.7 ms | 42.1 / 83.5 ms |
| `SELECT news.event_story.…` | 0.9 / 6.0 ms | 14.9 / 48.1 ms |

The statements that cost Postgres nothing (`BEGIN;`, `;`, `ROLLBACK;`) stretched 26–57×, as
much as the cheap real queries (the release-date queries 55–66×). Postgres can't be what slowed
a no-op, and its CPU agrees.
`pg_stat_statements` is not installed in prod (extensions: `plpgsql`, `citext`, `pgcrypto`,
`pg_trgm`), so there is no server-side statement timing to compare.

### CPU

From the collector's `dockerstats` (cumulative CPU, scraped once a minute, so each value is the
average over the minute ending at that time) and `hostmetrics`. Host busy cores is
`system.cpu.time` in every state but idle and iowait, summed over the 8 CPUs (scraped at :50, two
seconds before the container metrics); iowait stayed at 0.01–0.03 cores.

| Minute ending (UTC) | Backend | App Postgres | Traefik | Bugsink | Bugsink's Postgres | Host busy cores (of 8) | Host load (1 min) |
|---|---|---|---|---|---|---|---|
| 10:42:52 | 0.06 | 0.01 | 0.02 | 0.02 | 0.01 | 0.82 | 1.22 |
| 10:43:52 | 0.10 | 0.03 | 0.29 | 0.02 | 0.01 | 0.92 | 0.76 |
| 10:44:52 | **1.01** | 0.27 | 1.97 | 0.46 | 0.47 | 5.31 | 7.24 |
| 10:45:52 | **1.04** | 0.27 | 0.03 | 0.52 | 0.66 | 3.27 | 4.83 |
| 10:46:52 | 0.08 | 0.02 | 0.02 | 0.31 | 0.21 | 1.52 | 2.67 |

The backend sat at one core, the most a single Python process's event loop can use, through both
minutes. It was not alone. In the minute ending 10:44:52 Traefik used ~2 cores, and the host was
5.3 cores busy of 8 with a load of 7.2. So the host was busy, but not saturated: 2.7 cores stood
idle, iowait was nil, and in the next minute, with the backend still at a full core, the host was
down to 3.3. A host-bound process would have slowed when the host did. This one held its one
core, and its ~40 requests a second, through both minutes.

### What else was running

- **Ingest:** nothing. The only `ingest.ingest_run` near the window was `digest`, 10:30:08–10:30:09.
- **Bugsink** and its Postgres rose to ~1.1 cores together, from 10:44 to 10:47. Its log shows
  the Worker's SDK (`sentry.javascript.cloudflare`) sending envelopes it then discards
  (`skipping non-supported envelope item: span`): the Worker's tracing, which samples 10% of
  requests. It cost Bugsink CPU, not the API. Follow-up NEU-2292.
- **Traefik** used ~2 cores in the minute ending 10:44:52, the minute it marked the backend
  unhealthy, with connections piling up.

### `/healthz`

From the access log, since the probe has no spans. Probes answered every ~10 s up to **10:43:45**,
then none until **10:45:18**: 93 s. Five then arrived together by 10:45:53, and normal service
resumed at 10:46:00. Docker's check (10 s interval, 2 s urlopen timeout, 3 retries) failed from
~10:43:55. That made the container unhealthy around 10:44:20, and Traefik removed it until the
first passing probe at 10:45:18.

During that gap the app was completing ~40 requests a second at a server-side p50 of ~450 ms. The
probe, which does no work, could not get an answer in 2 s. So the wait was not inside the app.
It was ahead of it: new connections queued in the listen backlog (uvicorn's default is 2048)
behind requests the loop had not yet read. A request's server span starts only once the app reads
it, so that queueing appears in no span.

### The refs

`2026-11-13-neu-2286-incident-refs.csv`: the 2,487 distinct person refs requested between 10:43:30
and 10:46:10, with how often each endpoint was asked for it. Nearly every ref was asked for once on
each endpoint (196 more than once): a crawl over distinct pages, which no cache in front of the API
would have absorbed. NEU-2272's edge cache stores the Worker's rendered page, not the API's
response, so it helps only on a second visit to the same page.

### Verdict

**Loop-bound**: request time far above database time, the backend at one full core, and the
app's Postgres at a quarter of one. Not **database-bound**: the database's share of request time
held steady while every no-op statement stretched. Not **host-bound**: the host had 2.7 idle cores
at its busiest minute, and the backend kept its full core and its rate as the host's load fell
(§1, CPU). It is also partly **arrival-bound**: at least 4,512 requests in under three minutes, at
a peak admission rate of 71/s, against a ceiling of ~40/s.

## 2. Method and data set

- **Bench stack:** `docker-compose.bench.yml`. `bench-api` is the Dockerfile's `prod` target,
  unmodified, running prod's `CMD` without `alembic upgrade head`. OTel and rate-limit settings are
  as prod has them, read by name from the prod container, with the OTLP endpoint pointed at a
  discarding collector (`bench-otel`) and Sentry's DSN at `bench-sink`. One uvicorn process, no
  CPU limit, as prod.
- **Host:** a 14-core Apple-silicon laptop, Docker Desktop (14 CPUs, 18.8 GB to the VM). The load
  generator ran in the dev backend container on the same VM, the database in the shared
  `tbc_postgresql_db`.
- **Data:** `task db:refresh` (content only) at 2026-11-13 23:40 UTC, immediately before the
  runs: `catalog.person` 179,502, `catalog.film_credit` 196,352, `news.event` 5,684 (newest
  2026-11-13 09:07 UTC). All 2,487 incident refs return 200.
- **Load:** `scripts/bench_public_burst.py` with the incident refs, signed as the Worker signs
  (`--origin-secret`, rotating over 1,000 client IPs) so the per-visitor limiter is exercised as
  in the crawl, `Accept-Encoding: gzip`, and a `/healthz` probe once a second on a fresh connection
  with a 2 s timeout.
- **Closed-loop steps:** 10 s warm-up, then 60 s measured, twice. OK/s counts only 200s that
  started and finished inside the measured 60 s. The cap was raised to 1000 so it couldn't mask
  process saturation.
- **CPU:** the cgroup's `cpu.stat` `usage_usec` delta over the whole step divided by wall time
  (cores used), for `bench-api` and for Postgres, and from the open-loop reruns on, for the load
  generator too. The warm-up is included, at the same load.
- **Probe misses:** a probe counts as missed when it gets no answer in 2 s. (A non-200 answer now
  counts too; none occurred in any run here.)
- **Drift:** run-to-run variation within a pair of runs is 1–4%, but the same configuration
  measured 25 minutes apart differed by up to 8% (79.0 / 82.8 against 87.8 / 87.8 req/s; the
  laptop's other containers and its thermals). The A/B therefore puts each toggle next to its own
  baseline (§6).

## 3. Closed loop

`/people/{ref}`:

| In flight | Run | OK/s | p50 | p95 | Statuses | Worst probe | Missed | bench-api cores | Postgres cores |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 133.3 | 7 ms | 11 ms | 8000 × 200 | 62 ms | 0 | 0.89 | 0.09 |
| 1 | 2 | 139.7 | 6 ms | 10 ms | 8379 × 200 | 13 ms | 0 | 0.88 | 0.09 |
| 10 | 1 | 154.6 | 62 ms | 84 ms | 9277 × 200 | 182 ms | 0 | 1.02 | 0.10 |
| 10 | 2 | 159.6 | 60 ms | 79 ms | 9577 × 200 | 90 ms | 0 | 1.02 | 0.10 |
| 30 | 1 | 158.0 | 183 ms | 259 ms | 9480 × 200 | 98 ms | 0 | 1.02 | 0.12 |
| 30 | 2 | 163.2 | 178 ms | 252 ms | 9789 × 200 | 114 ms | 0 | 1.01 | 0.12 |
| 60 | 1 | 154.9 | 373 ms | 480 ms | 9294 × 200 | 146 ms | 0 | 1.01 | 0.13 |
| 60 | 2 | 154.6 | 370 ms | 488 ms | 9274 × 200 | 172 ms | 0 | 1.01 | 0.12 |
| 120 | 1 | 145.8 | 471 ms | 2317 ms | 8745 × 200, 152 × 503 | 156 ms | 0 | 1.01 | 0.11 |
| 120 | 2 | 145.8 | 468 ms | 2303 ms | 8751 × 200, 161 × 503 | 198 ms | 0 | 1.02 | 0.11 |



`/people/{ref}/events?limit=20`:

| In flight | Run | OK/s | p50 | p95 | Statuses | Worst probe | Missed | bench-api cores | Postgres cores |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 53.5 | 16 ms | 25 ms | 3212 × 200 | 92 ms | 0 | 0.76 | 0.23 |
| 1 | 2 | 52.5 | 17 ms | 25 ms | 3149 × 200 | 95 ms | 0 | 0.77 | 0.23 |
| 10 | 1 | 65.5 | 131 ms | 280 ms | 3929 × 200 | 199 ms | 0 | 1.00 | 0.27 |
| 10 | 2 | 63.4 | 135 ms | 294 ms | 3806 × 200 | 184 ms | 0 | 1.01 | 0.27 |
| 30 | 1 | 61.9 | 510 ms | 606 ms | 3715 × 200 | 461 ms | 0 | 1.00 | 0.28 |
| 30 | 2 | 61.5 | 508 ms | 617 ms | 3693 × 200 | 243 ms | 0 | 1.00 | 0.28 |
| 60 | 1 | 61.4 | 938 ms | 1168 ms | 3686 × 200 | 379 ms | 0 | 1.01 | 0.29 |
| 60 | 2 | 61.4 | 932 ms | 1186 ms | 3683 × 200 | 333 ms | 0 | 1.01 | 0.29 |
| 120 | 1 | 58.9 | 1346 ms | 4015 ms | 3532 × 200, 303 × 503 | 343 ms | 0 | 1.01 | 0.26 |
| 120 | 2 | 57.4 | 1392 ms | 4040 ms | 3442 × 200, 286 × 503 | 462 ms | 0 | 1.00 | 0.26 |

- **Throughput stops rising at about 10 in flight.** OK/s rises 16–22% from 1 to 10, and by less
  than 5% after that (or falls). By the spec's rule, the smallest step with under 5% gain over the
  previous one, **process saturation is the 30 step**, and the profile and the A/B ran there. Past
  10, more in flight only adds latency: p50 grows in line with the in-flight count (Little's law
  at a fixed rate).
- **The bench ceiling is ~155–163 req/s for the detail endpoint and ~61–65 for events (10 to 60
  in flight), and ~85–90 mixed.** That is 6.3 ms and 15.7 ms of CPU per request on this machine.
  At 120 in flight, 200s fall to 146 and 57–59 a second, as pool timeouts take slots.
- **One request in flight already uses 0.77–0.89 cores.** A request's own CPU, not waiting on
  Postgres, is its cost. Postgres stays at 0.1–0.3 cores throughout.
- **At 120 in flight the pool sheds**: 152–161 detail and 286–303 events requests got 503s, the
  slowest after ~3.5–4.5 s (the 3 s checkout timeout plus the loop's own delay).
- **The probe never failed.** The worst probe at any step was 0.46 s. In a closed loop nothing
  queues ahead of the app, so the probe waits behind at most one pass of the loop. That is why
  the in-flight count alone does not predict the incident (§4).

## 4. The healthz curve, the scale factor and the cap

**The curve.** `/healthz` latency on the bench during the closed-loop steps, both runs pooled
(~142 probes per cell):

| In flight | Detail: median | Detail: worst | Events: median | Events: worst |
|---|---|---|---|---|
| 1 | 2 ms | 62 ms | 3 ms | 95 ms |
| 10 | 9 ms | 182 ms | 24 ms | 199 ms |
| 30 | 24 ms | 114 ms | 52 ms | 461 ms |
| 60 | 44 ms | 172 ms | 106 ms | 379 ms |
| 120 | 53 ms | 198 ms | 137 ms | 462 ms |

The median grows steadily with the number in flight. Each request holds the loop for a slice, and
a probe waits behind one pass over all of them. The worst probe is noisy, under 0.5 s everywhere.

**The scale factor: 2.2, from throughput.** At process saturation, with the same route mix
(person detail and events about half each), prod completed ~40 requests a second on one core
(§1, 10:44:30–10:45:50) and the bench 89.3 (§6 baselines). The bench does the same work 2.2× as
fast. This is the factor used here. It compares the real workload on both sides, the very
thing being scaled. It is not what D-2286.4 asked for ("prod time ÷ bench time" from
`bench_cpu.py`), and it stands in for that number until it exists. The recommendation below
does not hang on it: it compares two cap values at the same load on the same bench, and the
factor only converts the bench's latencies into prod's.

`scripts/bench_cpu.py`, the synthetic single-core benchmark, took **1.70 s** in `bench-api`
(1.701 and 1.710 s, two runs). **Its prod run is not measured yet.** The spec gives it to the user,
outside 10:15–10:50 UTC, and it is a manual step on this ticket. If it gives a factor far from 2.2,
the per-request costs in prod are not simply the bench's at a slower clock, which would itself be
worth knowing. Either way, linear scaling by a CPU ratio is an approximation. The next crawl burst
against the cap is the confirmation, already a manual step on NEU-2285.

**The criterion** (D-2286.4): the largest in-flight count at which the worst probe, ×2.2, stays
under 1 s.

| In flight | Worst probe, either endpoint | ×2.2 | Under 1 s? |
|---|---|---|---|
| 10 | 199 ms | 0.44 s | yes |
| 30 | 461 ms | 1.01 s | no, by 10 ms |
| 60 | 379 ms | 0.83 s | yes |
| 120 | 462 ms | 1.02 s | no |

**By its letter the criterion gives 60**: the largest step that passes, with 30 failing by 10 ms
on one probe. **This recommendation overrides it.** The worst probe barely moves between 30 and
120, so it doesn't rank in-flight counts at all: in a closed loop nothing queues ahead of the app,
and the probe was never in danger. The open-loop replay (§7) is the test that reproduces the
incident's failure, and it is where the two values differ.

**Recommended `MAX_IN_FLIGHT_REQUESTS`: 30**, down from 60, overriding D-2286.4's criterion:

- **Throughput stops rising at about 10 in flight.** Every slot past that adds waiting, not
  throughput (§3). At 30 an admitted request in prod waits about 30 ÷ 40/s ≈ 0.75 s at the
  ceiling; at 60, about 1.5 s.
- **The open-loop replay favours 30** (§7). At 1.4× the incident's admissions in prod terms, both
  values kept the container healthy. 30 had no missed probes in three runs and half the admitted
  latency; 60 missed six probes in one run, and its worst admitted request took 12 s.
- **By the criterion, neither value is clean in the open loop**, because the worst probe is a
  noisy tail. Scaled ×2.2, cap 30's worst probes were 3.1, 1.0 and 0.47 s, and cap 60's 0.68, 5.1
  and 1.1 s. 30 passes or sits at the line in two runs of three, 60 in one.
- **Against the pool's 30 connections** (D-2285.2's argument for 60): that argument was that
  public reads hand their connection back before the response is built, so up to a pool's worth
  more can be serializing or sending while the pool is busy. True, but those extra requests add
  no throughput once the loop is the limit, which it is from 10 in flight. At 30, admission
  equals the pool, so no admitted request can wait for a connection. The pool's own 503, which
  takes 3 s and more to arrive, can no longer happen: every overload answer becomes an immediate
  shed.
- **The risk is legitimate concurrency** above 30. Prod's normal load is about one request a
  second (§1, quiet window), and the slow routes (imports, admin triggers) are few. Not measured,
  but 30 leaves plenty of room.

Per D-2286.9 the default changes in its own ticket (NEU-2291), with its spec and an
ADR-0028 note. This PR changes nothing in `src/`, and the variable is not set in Coolify meanwhile.

## 5. Profile at process saturation

`py-spy record --rate 100 --nonblocking --threads --full-filenames` for 60 s on `bench-api`, at 30
in flight, mixed endpoints, prod-like configuration (83.2 req/s during the run). Then again with
`--gil`. Non-blocking sampling dropped ~35% of samples as unreadable stacks (2,068 errors against
3,924 samples) and garbled a handful of frame names. Those were excluded, which should not bias
the shares by component. `scripts/bench_profile_breakdown.py` assigns each event-loop sample to a
component by its deepest classified frame.

**Event-loop thread** (3,652 samples):

| Component | Share |
|---|---|
| Database client (SQLAlchemy 60%, asyncpg 4%) | **63.6%** |
| Server and framework (uvicorn, starlette, fastapi, asyncio, anyio, logging) | **10.4%** |
| OTel instrumentation | **7.9%** |
| Sentry | 6.5% |
| Loop native code (uvloop I/O, httptools parsing) | 3.7% |
| Our code (`upmovies/`) | 3.3% |
| Serialization (pydantic, `json`) | 2.8% |
| Other | 1.0% |
| Gzip | 0.9% |

The **top three are the database client (64%), the server and framework (10%) and OTel (8%).**

The database client's 64% is not queries. Split by the SQLAlchemy module the sample is in:

| Inside the database client | Share of the loop |
|---|---|
| Statement construction: building, cloning and annotating `select()`, `or_()`, `exists()` objects (`sqlalchemy/sql/`, other than the compiler and cache keys) | 32.4% |
| Cache-key generation (`sqlalchemy/sql/cache_key`), done on every execution to find the compiled form | 8.5% |
| `sqlalchemy/util`, `event`, `inspection` (attribute and event plumbing) | 9.7% |
| ORM (`sqlalchemy/orm`): entity loading, attribute access | 4.3% |
| asyncpg: protocol, sending and decoding rows | 3.9% |
| Compiler (`sqlalchemy/sql/compiler`) | 1.7% |
| Engine, dialect, pool | 2.7% |

SQLAlchemy caches compiled SQL, but the statement objects are rebuilt on every request, and
building them is the single largest cost the API has. The deepest frame of our own code above
those samples names where: `app/follow_queries.py` (`_card_names_person` 13%,
`_first_detachment_arm` 6%, `entity_event_ids` 2%, `_mentioning_pairs` 1%) and
`news/subject_key.py:sql_normalized_name` (5%), the follow-query machinery the events page
reuses to find a person's events. Another 26% has no frame of ours above it: it runs inside
SQLAlchemy's greenlet, where the stack starts mid-way, and is execution-time work (cache keys,
result processing, event dispatch).

**GIL, by thread** (`--gil`, 3,725 samples): the event loop held it for 93.0% of samples, OTel's
span exporter thread (`OtelBatchSpanRecordProcessor`) 4.8%, Sentry's transport 1.7%, the anyio
worker threads 0.6%. So the background threads take ~7% of the GIL from the loop. The anyio
threads exist because three of every public route's dependencies are plain `def` functions
(`get_settings`, `get_rate_limit_store` and the rate limiter's `dependency`), which FastAPI runs in
its threadpool: three thread hand-offs per request, cheap here (0.6%) but pure overhead.

A flame graph of this run is attached to the PR, not committed.

## 6. A/B

At process saturation: 30 in flight, mixed endpoints, 10 s warm-up and 60 s measured. Each
toggle ran between two baselines, in two rounds, so the laptop's drift (§2) cancels. The change
is against the mean of the baselines either side. Every run had all 200s and no missed probe.

| Run | How | Round 1 | Round 2 | Baselines either side | Change |
|---|---|---|---|---|---|
| Baseline (as prod) | gzip, OTel wrapper, `SENTRY_DSN` set | 88.0 / 89.5 / 89.2 | 86.9 / 90.5 / 91.9 | mean 89.3 req/s | — |
| Gzip off | `--accept-encoding identity` | 89.7 | 87.2 | 88.8, 88.7 | **−0.3%** (noise) |
| OTel off | `BENCH_OTEL=0` | 110.3 | 108.4 | 88.8, 88.7 | **+23%** |
| Sentry off | `BENCH_SENTRY_DSN=` | 99.5 | 101.7 | 89.4, 91.2 | **+11.5%** |
| All three off | the three together | 124.1 | 126.3 | 88.1, 91.9³ | **+39%** |

³ "All three off" ran last in each round, so its baselines are the one before it and, for round 1,
round 2's first (86.9); round 2's has a baseline on one side only (91.9). Gzip off ran
without a restart straight after a baseline, and is set between that baseline and the next.

The worst probe stayed between 0.08 and 0.34 s in every run, toggles or not.

In CPU per request (one core, so 1 ÷ throughput): 11.2 ms as prod runs, 9.1 ms without OTel,
10.0 ms without Sentry, 8.0 ms without all three. **OTel costs ~19% of the process's CPU and
Sentry ~10%**, together 28%. The profile's deepest-frame attribution put them at 8% and 6.5%.
Much of instrumentation's cost lands in frames that aren't its own: SQLAlchemy's event dispatch
(`sqlalchemy/event`, 3.2%), the ASGI middleware layers counted under the server, context
variables and the exporter threads' share of the GIL (§5). The A/B is the number to use.

**Sentry's cost with tracing at 10%.** `traces_sample_rate=0.1` is hardcoded in `telemetry.py`,
so this is Sentry as prod runs it. Its FastAPI and SQLAlchemy integrations wrap every request and
every statement whether or not the transaction is sampled, and prod's Bugsink discards
transactions anyway (§1, "What else was running"). Nothing here toggled Sentry's tracing apart from
its error reporting; that is the follow-up's first measurement.

**OTel narrowed**, one instrumentation off at a time (`OTEL_PYTHON_DISABLED_INSTRUMENTATIONS`),
since "OTel off" moved throughput by more than 10%. These four pairs ran before the interleaved
design and are compared with the baseline measured straight after them (87.8 / 87.8 req/s), so
read them to ±3%:

| Instrumentation off | Round 1 | Round 2 | Change |
|---|---|---|---|
| `asyncpg` | 94.3 | 96.0 | **+8%** |
| `sqlalchemy` | 93.7 | 90.4 | +5% |
| `fastapi` | 91.3 | 91.8 | +4% |
| `logging` | 90.3 | 87.9 | +1.5% (noise) |

They add up to about +18% of OTel's +23%. The rest is the SDK itself: the span exporter thread
(4.8% of the GIL), the metrics reader and context propagation. **`asyncpg` is the largest single
instrumentation, and it is the duplicate.** SQLAlchemy's instrumentation already traces every
statement, with the statement text, so every query is recorded twice (§1, "The database"). With
the pre-ping and transaction bookkeeping, asyncpg's instrumentation creates eight spans per person
request.

**Gzip is not a cost.** At level 6, the person and events payloads compress in well under a
millisecond (0.9% of the loop in the profile), so whether the Worker's `fetch` asks for gzip
(asserted, not measured: workerd's default) does not matter for throughput. The spec's follow-up
condition (more than 10%) isn't met.

The profile's top cost, statement construction, can't be toggled from outside the app. It is
carried by the follow-up ticket instead (§9).

## 7. Open-loop replay

The incident's per-second admissions (`2026-11-13-neu-2286-incident-arrivals.csv`, 4,512
requests over 155 s, peaking at 71/s) are sent on schedule, whatever comes back, like a crawl.
`--scale` multiplies them. The ~7% of the incident that went to companies, films and collections
is sent as person reads, so the total count is the incident's. Each run also probes `/healthz`
at 1 Hz from the load generator. Docker's own check inside `bench-api` (10 s interval, 2 s
timeout, 3 retries, as prod) is captured live from `docker events`.

The bench is 2.2× as fast as prod (§4), so ×1 here is a light load, and **×3 on the bench is
about 1.4× the incident's admissions in prod terms**. True arrivals were higher than admissions
(§1), by an unknown amount.

| Cap | Scale | Statuses | Admitted 200s: p50 / p95 / max | 503s: p50 / max | OK/s | Probes missed (of 155) | Worst probe | Docker |
|---|---|---|---|---|---|---|---|---|
| 60 | ×1 | 4,512 × 200 | 15 ms / 30 ms / 0.18 s | — | 29.1 | 0 | 0.06 s | healthy¹ |
| 60 | ×2 | 8,808 × 200, 216 × 503 | 26 ms / 0.65 s / 1.7 s | 71 ms / 0.68 s | 56.9 | 0 | 0.58 s | healthy¹ |
| 60 | ×3 | 9,935 × 200, 3,601 × 503 | 0.58 s / 0.80 s / 1.8 s | 49 ms / 0.96 s | 64.1 | 0 | 0.31 s | healthy¹ |
| 60 | ×3 | 9,866 × 200, 3,662 × 503, 8 client errors | 0.66 s / 3.55 s / 12.1 s | 53 ms / 5.5 s | 63.7 | 6 | 2.34 s | **healthy** |
| 60 | ×3 | 9,350 × 200, 4,186 × 503 | 0.64 s / 0.96 s / 4.5 s | 57 ms / 0.73 s | 60.4 | 0 | 0.51 s | **healthy** |
| 30 | ×3 | 10,176 × 200, 3,360 × 503 | 0.26 s / 0.51 s / 5.2 s | 30 ms / 4.5 s | 65.7 | 0 | 1.42 s | healthy¹ |
| 30 | ×3 | 9,822 × 200, 3,714 × 503 | 0.27 s / 0.46 s / 0.78 s | 27 ms / 0.44 s | 63.4 | 0 | 0.46 s | **healthy** |
| 30 | ×3 | 9,862 × 200, 3,674 × 503 | 0.27 s / 0.46 s / 0.59 s | 27 ms / 0.25 s | 63.6 | 0 | 0.21 s | **healthy** |
| none (1000) | ×3 | 12,941 × 200, 517 × 503, 78 client errors | 23 s / 117 s / 175 s | 8.8 s / 75 s | 56.2 | 75 of 231 | 10.4 s | not captured¹ |
| none (1000) | ×3 | 12,707 × 200, 725 × 503, 104 client errors | 14 s / 93 s / 135 s | 5.2 s / 60 s | 59.7 | 88 of 213 | 8.1 s | **unhealthy 71 s** |
| 60 | ×6 | 22,295 × 200, 4,652 × 503, 125 client errors | 204 s / 398 s / 478 s | 37 s / 463 s | 44.7 | 74 of 499 | 10.2 s | not captured¹, load generator not measured |
| 60 | ×6 | 11,621 × 200, 15,381 × 503, 70 client errors | 146 s / 248 s / 287 s | 54 s / 267 s | 38.0 | 80 of 307 | 9.0 s | **healthy**, load generator saturated² |

¹ Docker's health events were not captured in these runs: replaying them afterwards from `docker
events` failed, because Docker Desktop's event buffer is shorter than a run. `bench:load` now
captures them live (`scripts/bench_load.sh`). A container whose 1 Hz probe from outside never
missed can't have failed three consecutive in-container checks, so "healthy" there is an
inference, not a reading.

² The load generator, one Python process in the dev container, ran at 0.97 cores, and `bench-api`
averaged 0.52. At ×6 the client is the bottleneck. Its latencies and missed probes are its own
loop's, and Docker's in-container check, which doesn't go through it, never failed. The server at
×6 is not measured (§8).

What the replay shows:

- **Without a cap, the incident reproduces.** At ×3 with nothing limiting admission, as prod ran
  on 2026-11-13, Docker marked `bench-api` unhealthy for 71 s. The median request took 14–23 s,
  some 100+ s. Every 503 was a pool timeout, with a median of 5–9 s before it arrived. The
  process went on completing 56–60 requests a second, most of them for callers long gone.
- **With the cap, it doesn't.** At the same ×3 load, both 30 and 60 kept the container healthy
  in every run. Shed requests cost the loop almost nothing (a 503's median is 27–57 ms, client-side,
  queueing included), and the process served 60–66 requests a second, its ceiling.
- **30 beats 60 on every measure except one outlier probe.** The throughput is the same, because
  the process saturates at about 10 in flight whatever the cap. An admitted request waits half as
  long at 30: p50 0.27 s against 0.64 s, p95 0.46–0.51 s against 0.80–3.55 s. Probes missed: 0 in
  three runs at 30, against 6 in one of three at 60. One run at 30 had a single 1.42 s probe, and the
  same run's slowest admitted request (5.2 s) and slowest 503 (4.5 s) were the second-worst of the
  six; the other two runs at 30 were the best on every measure.

## 8. What this does not measure

- **`scripts/bench_cpu.py` in prod.** The spec gives that run to the user, outside the crawl
  window; it is a manual step on NEU-2286. The scale factor here (2.2) comes from throughput (§4).
- **The incident's true arrival rate.** Traefik's access log is off, and server spans start only
  once the app reads a request. The admissions CSV is a lower bound. Not ticketed; turning on
  Traefik's access log is a host-wide change for the ops repo.
- **The server beyond ×3 in the open loop.** At ×6 the load generator, one Python process,
  saturated first (0.97 cores). Testing a heavier crawl needs a load generator spread over several
  processes. Not ticketed: once the cap holds at ×3, the useful number is the ceiling, and that is
  what the in-process fixes move.
- **The pool's pre-ping and transaction round trips.** Five of a person request's eight
  statements are `BEGIN; ; ROLLBACK;` (the pre-ping) and the request's own `BEGIN` / `ROLLBACK`
  (§1). They can't be toggled from outside the app. In the profile, the ping's own frames are
  ~1% of the loop, and their spans are part of OTel's cost. Worth one bench run once NEU-2289 has
  removed the duplicate spans; not ticketed on its own.
- **Sentry's tracing apart from its error reporting.** The A/B toggled the whole SDK. NEU-2290's
  first step measures the split.
- **The gain from NEU-2288.** Statement construction's 32% share of the loop bounds what that
  change can win; the gain itself needs the change.
- **The threadpool hops.** Three sync dependencies per public request (§5) cost 0.6% of the GIL,
  too little to separate from noise. Not worth a ticket on its own.
- **Prod profiling** (D-2286.8): not needed. SigNoz and the bench together explain the incident.
  SigNoz shows the mechanism in prod: one core, every await stretched alike, the probe starved
  ahead of the app. The bench, the prod image, reproduced the failure itself, the same way (Docker
  unhealthy, admitted requests 14–23 s), once the cap was taken away. What a prod profile could
  add is whether prod spends its core in the same places as the bench. That is unmeasured: the
  2.2 factor is itself derived from the two throughputs, so it can't confirm it. If NEU-2288–2290
  move prod's ceiling much less than they move the bench's, that is when to design prod profiling.

## 9. Follow-ups

Filed in *bl: Maintenance*, related to NEU-2286:

| Ticket | What | Evidence here |
|---|---|---|
| NEU-2288 | Build the person-events statement once instead of on every request | §5: statement construction 32% of the loop, cache keys 8.5% |
| NEU-2289 | Drop the asyncpg OTel instrumentation, which traces every query a second time | §6: +8% |
| NEU-2290 | Turn off Sentry tracing in the API; Bugsink discards transactions | §6: Sentry +11.5% |
| NEU-2291 | Lower the `MAX_IN_FLIGHT_REQUESTS` default from 60 to 30 | §4, §7 |
| NEU-2292 | Stop the Worker's and browser's SDKs sending traces Bugsink discards | §1: Bugsink ~1.1 cores during the crawl |

Not filed: gzip (§6, no measurable cost), the threadpool hops, the pre-ping (§8).

**ADR-0028's question: stay on one process?** Its trigger is met: the process saturates at about
10 in flight, far below the cap, which ADR-0028 names as the point to revisit with a shared
rate-limit store and then workers. **The answer is yes, stay on one process for now, and revisit
after NEU-2288–2290.** Two reasons:

- The cap already prevents the failure the ADR was amended for. With it, the container stayed in
  rotation at 1.4× the incident's admissions (§7), serving its ceiling and shedding the rest
  cheaply.
- The ceiling has cheaper multipliers in-process. Instrumentation alone is +39% (§6), and
  statement construction is a third of what remains (§5). A shared store and workers would
  multiply a process that spends a third of its core building the same statements over and over.

Once those three land, re-run this bench (the Reproducing commands below, same arguments). If the
ceiling at that point is still under what crawls send, that is the measured case for the shared
store, then workers, on an 8-core host whose other seven cores sat largely idle on 2026-11-13.

## Reproducing

Prod records, read-only (SigNoz keeps traces and logs 15 days, so the 2026-11-13 window is gone
after 2026-11-28; the numbers above are the record):

```bash
ssh music-box-dancer 'docker exec -i clickhouse-b144lcfm2xe4mxo73dg7b8z9 \
  clickhouse-client --readonly 1 --multiquery' < query.sql
```

The bench:

```bash
task db:refresh                                # content only, from prod
MAX_IN_FLIGHT_REQUESTS=1000 task bench:up      # the prod image, cap out of the way
R=docs/measurements/2026-11-13-neu-2286-incident-refs.csv

# Closed-loop step: one endpoint, one in-flight count (repeat for 1 10 30 60 120, detail/events)
task bench:load -- --refs-file $R --endpoint detail --concurrency 30 --warmup 10 --duration 60 \
  --healthz --origin-secret bench-origin-secret --out bench-out/closed/detail-c30.json

# Profile at process saturation: start a mixed load, then profile it from a second shell
task bench:load -- --refs-file $R --endpoint mixed --concurrency 30 --warmup 10 --duration 150 \
  --healthz --origin-secret bench-origin-secret
task bench:profile -- 60          # event loop, by component
task bench:profile -- 60 --gil    # GIL-holding thread

# A/B: restart with a toggle, then the same mixed load at 30 in flight
BENCH_OTEL=0 MAX_IN_FLIGHT_REQUESTS=1000 task bench:up              # OTel off
BENCH_SENTRY_DSN= MAX_IN_FLIGHT_REQUESTS=1000 task bench:up         # Sentry off
task bench:load -- … --accept-encoding identity                      # gzip off
OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asyncpg MAX_IN_FLIGHT_REQUESTS=1000 task bench:up

# Open loop: the incident's admissions, scaled
task bench:up                                                        # the code's default cap
task bench:load -- --refs-file $R --arrivals-file docs/measurements/2026-11-13-neu-2286-incident-arrivals.csv \
  --scale 2 --healthz --origin-secret bench-origin-secret --timeout 60

# The scale factor: the bench, then prod (outside 10:15-10:50 UTC)
task bench:cpu
ssh music-box-dancer 'docker exec -i <backend container> python -' < scripts/bench_cpu.py
```

In zsh, keep arguments literal or in an array (`"${L[@]}"`); an unquoted `$L` is passed as one
argument.

## Appendix: the queries

**Root spans by minute and status, and child spans by name (§1, arrivals and completions)**

```sql
-- root spans per minute by status, burst window + quiet
SELECT toStartOfMinute(timestamp) m, response_status_code s, count() c, round(quantile(0.5)(duration_nano)/1e6) p50ms, round(quantile(0.95)(duration_nano)/1e6) p95ms, round(max(duration_nano)/1e6) maxms
FROM signoz_traces.distributed_signoz_index_v3
WHERE serviceName='upcoming-movies-backend' AND parent_span_id='' AND ((timestamp >= '2026-11-13 10:40:00' AND timestamp < '2026-11-13 10:50:00'))
GROUP BY m, s ORDER BY m, s FORMAT TSV;
SELECT '--- child span names (burst)';
SELECT name, kind_string, dbSystem, count() c, round(quantile(0.5)(duration_nano)/1e6,1) p50ms, round(quantile(0.95)(duration_nano)/1e6,1) p95ms
FROM signoz_traces.distributed_signoz_index_v3
WHERE serviceName='upcoming-movies-backend' AND parent_span_id!='' AND timestamp >= '2026-11-13 10:43:00' AND timestamp < '2026-11-13 10:47:00'
GROUP BY name, kind_string, dbSystem ORDER BY c DESC LIMIT 40 FORMAT TSV;
SELECT '--- resources';
SELECT resources_string, count() FROM signoz_traces.distributed_signoz_index_v3 WHERE serviceName='upcoming-movies-backend' AND parent_span_id='' AND timestamp >= '2026-11-13 10:30:00' AND timestamp < '2026-11-13 10:50:00' GROUP BY resources_string FORMAT TSV;
SELECT '--- logs columns';
SELECT name, type FROM system.columns WHERE database='signoz_logs' AND table='distributed_logs_v2' FORMAT TSV;
```

**Access-log lines against spans, and Bugsink's log volume (§1)**

```sql
SELECT toStartOfMinute(fromUnixTimestamp64Nano(toInt64(timestamp))) m, countIf(body LIKE '%HTTP/1.1"%') access, countIf(body LIKE '%GET /people%') people, countIf(body LIKE '%healthz%') healthz, countIf(severity_text IN ('WARNING','WARN')) warn, countIf(severity_text='ERROR') err, count() total
FROM signoz_logs.distributed_logs_v2 WHERE resources_string['container.name'] LIKE 'upmovies-backend%' AND timestamp >= toUnixTimestamp('2026-11-13 10:40:00')*1000000000 AND timestamp < toUnixTimestamp('2026-11-13 10:50:00')*1000000000 GROUP BY m ORDER BY m FORMAT TSV;
SELECT '--- sample backend lines';
SELECT fromUnixTimestamp64Nano(toInt64(timestamp)) t, severity_text, substring(body,1,250) FROM signoz_logs.distributed_logs_v2 WHERE resources_string['container.name'] LIKE 'upmovies-backend%' AND timestamp >= toUnixTimestamp('2026-11-13 10:44:00')*1000000000 AND timestamp < toUnixTimestamp('2026-11-13 10:44:01')*1000000000 ORDER BY t LIMIT 15 FORMAT TSV;
SELECT '--- bugsink by minute';
SELECT toStartOfMinute(fromUnixTimestamp64Nano(toInt64(timestamp))) m, count() FROM signoz_logs.distributed_logs_v2 WHERE resources_string['container.name'] LIKE 'bugsink%' AND timestamp >= toUnixTimestamp('2026-11-13 10:38:00')*1000000000 AND timestamp < toUnixTimestamp('2026-11-13 10:52:00')*1000000000 GROUP BY m ORDER BY m FORMAT TSV;
SELECT '--- bugsink sample';
SELECT substring(body,1,250) b, count() c FROM signoz_logs.distributed_logs_v2 WHERE resources_string['container.name'] LIKE 'bugsink%' AND timestamp >= toUnixTimestamp('2026-11-13 10:44:00')*1000000000 AND timestamp < toUnixTimestamp('2026-11-13 10:45:00')*1000000000 GROUP BY b ORDER BY c DESC LIMIT 8 FORMAT TSV;
```

**Per-request time breakdown, per 10 s, burst and quiet (§1, where a request's time went)**

```sql
-- per-request breakdown for /people routes: root duration, asyncpg wire time, sqlalchemy connect (checkout) time
WITH spans AS (
  SELECT trace_id, span_id, parent_span_id, name, duration_nano d, timestamp ts,
         has(mapKeys(attributes_string),'net.transport') is_apg, response_status_code st
  FROM signoz_traces.distributed_signoz_index_v3
  WHERE serviceName='upcoming-movies-backend'
    AND ((timestamp >= '2026-11-13 10:42:00' AND timestamp < '2026-11-13 10:48:00') OR (timestamp >= '2026-11-13 09:42:00' AND timestamp < '2026-11-13 09:48:00'))
),
per AS (
  SELECT trace_id,
    anyIf(name, parent_span_id='') route, anyIf(ts, parent_span_id='') start, anyIf(st, parent_span_id='') status,
    sumIf(d, parent_span_id='') root_d, sumIf(d, is_apg) apg_d, sumIf(d, name='connect') conn_d, countIf(is_apg) n_apg
  FROM spans GROUP BY trace_id
)
SELECT toStartOfInterval(start, INTERVAL 10 SECOND) b, count() n, countIf(status='503') n503,
  round(quantile(0.5)(root_d)/1e6) p50, round(quantile(0.95)(root_d)/1e6) p95,
  round(avg(root_d)/1e6) mean_ms, round(avg(apg_d)/1e6) apg_ms, round(avg(conn_d)/1e6) conn_ms,
  round(avg(n_apg),1) stmts, round(sum(apg_d)/sum(root_d),2) apg_share
FROM per WHERE route IN ('GET /people/{ref}','GET /people/{ref}/events')
GROUP BY b ORDER BY b FORMAT TSV;
```

**Container CPU in cores (§1, CPU)**

```sql
-- container CPU in cores: delta of cumulative usage.total (ns) between scrapes
WITH ts AS (
  SELECT DISTINCT fingerprint, JSONExtractString(labels,'container.name') cn
  FROM signoz_metrics.distributed_time_series_v4
  WHERE metric_name='container.cpu.usage.total' AND unix_milli >= toUnixTimestamp('2026-11-13 00:00:00')*1000
),
s AS (
  SELECT cn, unix_milli t, max(value) v FROM signoz_metrics.distributed_samples_v4 sm JOIN ts USING fingerprint
  WHERE sm.metric_name='container.cpu.usage.total' AND unix_milli >= toUnixTimestamp('2026-11-13 10:38:00')*1000 AND unix_milli < toUnixTimestamp('2026-11-13 10:52:00')*1000
  GROUP BY cn, t
),
d AS (
  SELECT cn, t, (v - lagInFrame(v) OVER (PARTITION BY cn ORDER BY t ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)) / 1e9 / ((t - lagInFrame(t) OVER (PARTITION BY cn ORDER BY t ROWS BETWEEN 1 PRECEDING AND CURRENT ROW))/1000) cores,
     t - lagInFrame(t) OVER (PARTITION BY cn ORDER BY t ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) dt
  FROM s
)
SELECT cn, groupArray(concat(formatDateTime(fromUnixTimestamp64Milli(t),'%H:%i:%S'),'=',toString(round(cores,2)))) FROM d WHERE dt > 0 AND dt < 600000 GROUP BY cn HAVING cn LIKE '%mqxxit45%' OR cn LIKE 'upmovies%' OR cn LIKE 'clickhouse%' OR cn LIKE 'signoz%' OR max(cores) > 0.15 ORDER BY cn FORMAT TSV;
```

**Host load (§1, CPU)**

```sql
SELECT formatDateTime(fromUnixTimestamp64Milli(unix_milli),'%H:%i:%S') t, round(value,2) FROM signoz_metrics.distributed_samples_v4 WHERE metric_name='system.cpu.load_average.1m' AND unix_milli >= toUnixTimestamp('2026-11-13 10:38:00')*1000 AND unix_milli < toUnixTimestamp('2026-11-13 10:52:00')*1000 ORDER BY unix_milli FORMAT TSV;
```

**Host busy cores, and the 679 access lines against the root spans over 10:43:30–10:46:30 (§1)**

```sql
-- host CPU: busy cores per minute from hostmetrics system.cpu.time (cumulative seconds per cpu and state)
WITH ts AS (
  SELECT DISTINCT fingerprint, JSONExtractString(labels,'cpu') cpu, JSONExtractString(labels,'state') state
  FROM signoz_metrics.distributed_time_series_v4 WHERE metric_name='system.cpu.time' AND unix_milli >= toUnixTimestamp('2026-11-13 00:00:00')*1000
),
s AS (
  SELECT cpu, state, unix_milli t, max(value) v FROM signoz_metrics.distributed_samples_v4 sm JOIN ts USING fingerprint
  WHERE sm.metric_name='system.cpu.time' AND unix_milli >= toUnixTimestamp('2026-11-13 10:40:00')*1000 AND unix_milli < toUnixTimestamp('2026-11-13 10:49:00')*1000
  GROUP BY cpu, state, t
),
d AS (
  SELECT cpu, state, t, (v - lagInFrame(v) OVER (PARTITION BY cpu, state ORDER BY t ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)) dv,
    (t - lagInFrame(t) OVER (PARTITION BY cpu, state ORDER BY t ROWS BETWEEN 1 PRECEDING AND CURRENT ROW))/1000 dt FROM s
)
SELECT formatDateTime(fromUnixTimestamp64Milli(t),'%H:%i:%S') m, round(sumIf(dv, state!='idle' AND state!='wait')/any(dt),2) busy_cores, round(sumIf(dv, state='wait')/any(dt),2) iowait_cores, round(sum(dv)/any(dt),1) total_cores
FROM d WHERE dt > 0 AND dt < 600 GROUP BY t ORDER BY t FORMAT TSV;
SELECT '--- access lines 10:43:30-10:46:30';
SELECT countIf(body LIKE '%HTTP/1.1"%') access, countIf(body LIKE '%HTTP/1.1" 200%') ok, countIf(body LIKE '%HTTP/1.1" 503%') s503
FROM signoz_logs.distributed_logs_v2 WHERE resources_string['container.name'] LIKE 'upmovies-backend%' AND timestamp >= toUnixTimestamp('2026-11-13 10:43:30')*1000000000 AND timestamp < toUnixTimestamp('2026-11-13 10:46:30')*1000000000 FORMAT TSV;
SELECT '--- root spans 10:43:30-10:46:30';
SELECT count(), countIf(response_status_code='503') FROM signoz_traces.distributed_signoz_index_v3 WHERE serviceName='upcoming-movies-backend' AND parent_span_id='' AND timestamp >= '2026-11-13 10:43:30' AND timestamp < '2026-11-13 10:46:30' FORMAT TSV;
```

**`/healthz` from the access log, `/readyz` spans, route mix and completions per 10 s (§1)**

```sql
SELECT formatDateTime(fromUnixTimestamp64Nano(toInt64(timestamp)),'%H:%i:%S') t, extract(body, '"GET (/healthz|/readyz)[^"]*" (\\d+)') FROM signoz_logs.distributed_logs_v2 WHERE resources_string['container.name'] LIKE 'upmovies-backend%' AND body LIKE '%"GET /healthz%' AND timestamp >= toUnixTimestamp('2026-11-13 10:42:00')*1000000000 AND timestamp < toUnixTimestamp('2026-11-13 10:48:00')*1000000000 ORDER BY timestamp FORMAT TSV;
SELECT '--- readyz spans';
SELECT timestamp, round(duration_nano/1e6) ms, response_status_code FROM signoz_traces.distributed_signoz_index_v3 WHERE serviceName='upcoming-movies-backend' AND name='GET /readyz' AND timestamp >= '2026-11-13 10:42:00' AND timestamp < '2026-11-13 10:48:00' FORMAT TSV;
SELECT '--- all routes per 10s (completions by span start)';
SELECT toStartOfInterval(timestamp, INTERVAL 10 SECOND) b, count() n, countIf(name LIKE 'GET /people%') people, countIf(name LIKE 'GET /companies%') comp, countIf(name LIKE 'GET /films%') films, countIf(name LIKE 'GET /collections%') coll, countIf(response_status_code='503') s503
FROM signoz_traces.distributed_signoz_index_v3 WHERE serviceName='upcoming-movies-backend' AND parent_span_id='' AND timestamp >= '2026-11-13 10:43:30' AND timestamp < '2026-11-13 10:46:10' GROUP BY b ORDER BY b FORMAT TSV;
SELECT '--- end-time completions per 10s';
SELECT toStartOfInterval(timestamp + toIntervalNanosecond(duration_nano), INTERVAL 10 SECOND) b, count() n FROM signoz_traces.distributed_signoz_index_v3 WHERE serviceName='upcoming-movies-backend' AND parent_span_id='' AND timestamp >= '2026-11-13 10:43:00' AND timestamp < '2026-11-13 10:46:30' GROUP BY b ORDER BY b FORMAT TSV;
```

**Per-statement latency, asyncpg spans, burst and quiet (§1, the database)**

```sql
SELECT if(timestamp < '2026-11-13 10:00:00','quiet','burst') w, substring(replaceRegexpAll(attributes_string['db.statement'],'\\s+',' '),1,70) st, count() n, round(quantile(0.5)(duration_nano)/1e6,1) p50, round(quantile(0.95)(duration_nano)/1e6,1) p95
FROM signoz_traces.distributed_signoz_index_v3
WHERE serviceName='upcoming-movies-backend' AND has(mapKeys(attributes_string),'net.transport')
  AND ((timestamp >= '2026-11-13 10:44:30' AND timestamp < '2026-11-13 10:45:50') OR (timestamp >= '2026-11-13 09:42:00' AND timestamp < '2026-11-13 09:48:00'))
GROUP BY w, st HAVING n > 20 ORDER BY st, w FORMAT TSV;
```

**The incident refs (`2026-11-13-neu-2286-incident-refs.csv`)**

```sql
SELECT extract(attributes_string['http.target'], '^/people/([^/?]+)') ref, countIf(name='GET /people/{ref}') detail, countIf(name='GET /people/{ref}/events') events
FROM signoz_traces.distributed_signoz_index_v3
WHERE serviceName='upcoming-movies-backend' AND parent_span_id='' AND name LIKE 'GET /people/%' AND timestamp >= '2026-11-13 10:43:30' AND timestamp < '2026-11-13 10:46:10'
GROUP BY ref ORDER BY ref FORMAT CSVWithNames;
```

**The per-second admissions (`2026-11-13-neu-2286-incident-arrivals.csv`)**

```sql
SELECT formatDateTime(toStartOfSecond(timestamp),'%Y-%m-%dT%H:%i:%SZ') second, countIf(name='GET /people/{ref}') people_detail, countIf(name='GET /people/{ref}/events') people_events, countIf(name NOT LIKE 'GET /people/%') other
FROM signoz_traces.distributed_signoz_index_v3
WHERE serviceName='upcoming-movies-backend' AND parent_span_id='' AND timestamp >= '2026-11-13 10:43:30' AND timestamp < '2026-11-13 10:46:10'
GROUP BY second ORDER BY second FORMAT CSVWithNames;
```

**Prod Postgres, read-only** (§1, what else was running; extensions)

```bash
docker exec mqxxit45ifsivt17b5rl5d2s psql -U postgres -d postgres -tAc "select id, kind, status, started_at, finished_at from ingest.ingest_run where started_at < '2026-11-13 10:50' and coalesce(finished_at, now()) > '2026-11-13 10:30' order by started_at"
docker exec mqxxit45ifsivt17b5rl5d2s psql -U postgres -d postgres -tAc "select extname from pg_extension"
```

**Prod settings**, read one variable at a time by name (never the whole environment): `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` (all `otlp`), `OTEL_PYTHON_FASTAPI_EXCLUDED_URLS` (`health`), `OTEL_EXPORTER_OTLP_PROTOCOL` (`http/protobuf`), `RATE_LIMIT_ENABLED` and `RATE_LIMIT_PUBLIC_ENABLED` (`true`), `RATE_LIMIT_PUBLIC` (`240/120`), `LOG_LEVEL` (`INFO`). Unset, so at their code defaults: `OTEL_TRACES_SAMPLER`, `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS`, `MAX_IN_FLIGHT_REQUESTS`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT`. `SENTRY_DSN` is set (length only checked).
