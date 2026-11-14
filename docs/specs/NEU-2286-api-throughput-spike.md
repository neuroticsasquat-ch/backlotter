# NEU-2286 — Spike: what limits the API's throughput on person pages under a crawl

**Ticket:** NEU-2286 · **Builds on:** NEU-2271 (`NEU-2271-db-pool-fail-fast.md`), NEU-2285
(`NEU-2285-in-flight-cap.md`) · **ADR:** `../adr/0028-overload-sheds-in-one-process.md` ·
**Earlier measurements:** `../measurements/2026-11-10-neu-2271-pool-baseline.md`,
`../measurements/2026-11-10-neu-2271-burst.md`

A measurement ticket. Its output is a measurement doc, a recommended `MAX_IN_FLIGHT_REQUESTS`
and follow-up tickets. **No file under `src/` changes.**

## Problem

On 2026-11-13 at ~10:44 UTC a crawl put the API's one uvicorn process so far behind that
`/healthz` missed the Docker health check and Traefik took the container out of rotation
(NEU-2285 has the evidence). A person read costs ~50–150 ms of server time unloaded, so one
process should serve well over 10 requests a second. We don't know what the real ceiling is or
what sets it, so the in-flight cap (default 60) is a guess and ADR-0028's "stay on one process?"
question has no data behind it.

**The gap to explain is between local and prod, not between theory and practice.** The local
dev stack already served ~100 successful requests a second at 100 in flight
(`2026-11-10-neu-2271-burst.md`). Prod's access log showed 679 requests in three minutes,
roughly 4–14 a second, and collapsed. Local differed from prod in several ways at once: no
`opentelemetry-instrument` wrapper, no Sentry DSN, stale data, no gzip negotiated, a different
host and Postgres. The ticket's plan (reproduce locally, prod optional) assumed local would
reproduce the collapse. The one local run we have says the dev stack does not.

**A first reading that must be reconciled.** SigNoz holds the incident's traces. Root spans for
`upcoming-movies-backend`, counted while planning (2026-11-13):

| Minute (UTC) | Spans | Root spans |
|---|---|---|
| 10:42 | 994 | 66 |
| 10:43 | 6,221 | 555 |
| 10:44 | 27,214 | 1,807 |
| 10:45 | 32,176 | 2,163 |
| 10:46 | 1,010 | 64 |

That is ~30–36 root spans a second at the peak, against 679 access-log lines for the whole
window. Either most root spans are not requests (connection or pool spans outside a request,
for instance), or the process handled far more requests than the access log suggested. The
spike's first job is to say which, because it decides whether the incident was low throughput
or simply more arrivals than we thought.

## Decisions

**D-2286.1 — Prod's own records first, then the local bench.** This reorders the ticket's
steps. Before any local work, read what SigNoz recorded for 2026-11-13 10:42–10:48 UTC and for
a quiet comparison window the same day (09:42–09:48 UTC), and answer:

1. **Arrivals and completions.** Requests per second by route and status, from server spans.
   Reconcile with the 679 access-log lines and the table above.
2. **Where a request's time went.** For `/people/{ref}` and `/people/{ref}/events` server spans:
   duration p50/p95 per 10 s, and the summed duration of their DB child spans. Report the share
   of request time inside DB spans and outside them, against the quiet window.
3. **The database.** Per-statement DB span p50/p95, burst against quiet. Note that both the
   SQLAlchemy and the asyncpg instrumentation are installed, so a query may appear twice.
4. **CPU.** Backend container, Postgres container (`mqxxit45ifsivt17b5rl5d2s`) and host CPU and
   load across the window, from the collector's `docker_stats` and `hostmetrics` metrics, at
   whatever resolution they were scraped.
5. **What else was running.** Any other container whose CPU rose in the window, and any
   `ingest` run that overlapped it (scheduled tasks run inside the backend container).
6. **`/healthz`.** Its server spans' timestamps and durations; gaps are the loop's stalls.
7. **The refs.** The distinct person refs requested in the window, saved as
   `docs/measurements/2026-11-13-neu-2286-incident-refs.csv`, and the per-second arrival counts,
   saved beside it as `…-incident-arrivals.csv`. The bench replays both.

Step 1 ends with a one-line verdict, one of: **loop-bound** (request time far above DB time,
backend near one full core), **database-bound** (DB spans stretched, Postgres CPU high),
**host-bound** (the host's CPU taken by something else), or **arrival-bound** (the process kept
a healthy rate and was simply sent more than it can serve). The verdict steers the rest
(D-2286.7).

SigNoz keeps traces and logs 15 days, so these records expire on **2026-11-28**. The
measurement doc must carry the extracted numbers, not pointers to SigNoz.

*Rejected: local first, as ticketed.* The risk is a day spent proving the laptop is fast.

**D-2286.2 — Read SigNoz through ClickHouse over SSH, read-only.** Verified working on
2026-11-13, no password needed:

```bash
ssh music-box-dancer 'docker exec -i clickhouse-b144lcfm2xe4mxo73dg7b8z9 \
  clickhouse-client --readonly 1 --multiquery' < query.sql
```

Tables: `signoz_traces.distributed_signoz_index_v3` (spans; `serviceName`, `name`,
`duration_nano`, `parent_span_id`, `timestamp`), `signoz_logs.distributed_logs_v2` (container
stdout, including the replaced container's access log), `signoz_metrics.distributed_samples_v4`
with `distributed_time_series_v4` (host and container metrics). Always pass `--readonly 1`.
Every query that produced a number goes in the measurement doc's appendix. Prod Postgres, where
needed, is read with `docker exec mqxxit45ifsivt17b5rl5d2s psql -U postgres -d postgres -tAc`,
SELECT only. Never print a container's environment; read single non-secret variables by name.
If the permission classifier starts refusing the ClickHouse route, fall back to the SigNoz UI
(`https://signoz.tail1afe5a.ts.net`) through the user's browser.

**D-2286.3 — A committed bench stack that runs the prod image.** Follow-up fixes need the same
before/after run, so the harness ships in this ticket's PR.

- `docker-compose.bench.yml`, a standalone compose file (its own project name,
  `upmovies-bench`), on the external `proxy` network so it reaches `tbc_postgresql_db`. No
  Traefik labels, no published port.
- **`bench-api`**: built from the Dockerfile's `prod` target, unmodified, running as its
  non-root user. Command: the prod `CMD` without `alembic upgrade head` (the bench must never
  migrate the shared local database). `BENCH_OTEL=0` selects the same command without the
  `opentelemetry-instrument` wrapper. Health check copied from `docker-compose.prod.yml`, so a
  run can show Docker marking the container unhealthy. Environment: `DATABASE_URL` at the local
  `upmovies` database, placeholder secrets as in `docker-compose.yml`, `LOG_LEVEL=INFO`, and
  every `OTEL_*` and `RATE_LIMIT_*` variable set as prod has it. Read prod's by name
  (`docker exec <backend> printenv OTEL_TRACES_SAMPLER` and so on), with
  `OTEL_EXPORTER_OTLP_ENDPOINT` pointed at `bench-otel` and `deployment.environment=bench`.
  No CPU limit, as prod.
- **`bench-otel`**: an OpenTelemetry collector with an OTLP/HTTP receiver and a discard
  exporter, so the exporter thread does real work and nothing reaches prod's SigNoz.
- **`bench-sink`**: any endpoint that answers 200 to a POST, as the Sentry DSN's host, so the
  SDK runs as in prod and nothing reaches Bugsink.
- **`bench-pyspy`**: `python:3.13-slim` with `py-spy` installed, `pid: "service:bench-api"`,
  `cap_add: [SYS_PTRACE]`, run on demand. The profiled image stays byte-for-byte the prod one.
  If attaching across the shared PID namespace fails, fall back to a `bench` Dockerfile stage
  (`FROM prod` plus `py-spy`) that launches uvicorn under `py-spy record --`, and say so in the
  doc. `py-spy` is not added to `pyproject.toml`.
- **Tasks**, in the root `Taskfile.yml`: `bench:up`, `bench:down`, `bench:load -- <args>` (runs
  the load script in the dev container against `http://bench-api:8000`), `bench:profile --
  <seconds>`, `bench:cpu` (D-2286.4). Add them to the command table in `CLAUDE.md`.
- Profiles and raw results go to `bench-out/`, gitignored.
- **Data:** `task db:refresh` (content only) immediately before measuring. Record the dump's
  date and row counts for `catalog.person`, `catalog.film_credit` and `news.event` in the doc.

*Rejected: reusing the dev container* (it is the dev image: dev dependencies, root, a bind
mount), and *a throwaway stack* (each follow-up would rebuild it by hand).

**D-2286.4 — The cap is sized from a `/healthz` latency curve, scaled to prod.** The incident's
failure was the probe missing its 2 s deadline, so the probe is what the cap is measured
against.

- During every load step the script probes `GET /healthz` once a second on its own connection
  with a 2 s timeout, and records each latency and each miss.
- **Criterion:** the recommended cap is the largest in-flight count at which the worst probe,
  multiplied by the scale factor, stays **under 1 s** (half the Docker check's deadline).
- **Scale factor:** `scripts/bench_cpu.py`, a ~5 s single-core benchmark with no database or
  network (JSON encoding, gzip at level 6 and a pure-Python loop over a synthetic payload;
  stdlib and pydantic only), run in `bench-api` and in the prod container. Factor = prod time ÷
  bench time. **The prod run is the user's**, outside 10:15–10:50 UTC:
  `ssh music-box-dancer 'docker exec -i <backend container> python -' < scripts/bench_cpu.py`.
- State in the doc that linear scaling by a CPU ratio is an approximation. The next crawl
  burst is the confirmation, which is already a manual step on NEU-2285.
- The doc gives the recommended value with its reasoning, including how it sits against the
  pool's 30 connections (D-2285.2's argument for 60).

*Rejected: load-testing on the prod host* (a load test against prod Postgres), and *the local
number as-is* (a guess with a method attached).

**D-2286.5 — Two load shapes, from one script.** Extend `scripts/bench_public_burst.py`; keep
its existing arguments working.

- New arguments: `--refs-file` (the incident refs; no database access needed), `--endpoint
  {detail,events,mixed}`, `--duration` (run for a time instead of a count), `--warmup`,
  `--accept-encoding`, `--healthz` (the 1 Hz probe), `--rate` and `--arrivals-file` (open
  loop), `--out` (JSON results). If prod runs with `RATE_LIMIT_PUBLIC_ENABLED=true`, also
  `--origin-secret` with a rotating `X-Backlotter-Client-IP`, so the limiter sees a spread of
  visitors as it did in the crawl.
- **Closed loop** (a fixed number in flight): steps **1, 10, 30, 60, 120**, each 60 s after a
  10 s warm-up, twice, for `/people/{ref}` and `/people/{ref}/events` separately.
  `MAX_IN_FLIGHT_REQUESTS=1000` so the cap doesn't mask saturation. Add steps around the knee
  if the curve needs them. Record per step: requests per second, p50/p95, statuses, the worst
  probe and missed probes, and CPU for `bench-api` and for Postgres. CPU is the cgroup
  `cpu.stat` `usage_usec` delta over the step divided by wall time (cores used), not a sampled
  percentage.
- **Process saturation** is the smallest step at which requests per second stops rising (under
  5% gain over the previous step). The profile and the A/B run there.
- **Open loop** (arrivals at a rate, whatever came back): one replay of the incident's
  per-second arrivals and route mix from D-2286.1, with the cap at its default of 60. Report
  statuses, probe latency and misses, and whether Docker marked `bench-api` unhealthy. If it
  holds, repeat at twice the rate. Then once more with the cap at the recommended value.

**D-2286.6 — Profile, then A/B from outside the app.**

- **Profile:** `py-spy record --format raw` for 60 s at process saturation, mixed endpoints,
  prod-like configuration. A small `scripts/bench_profile_breakdown.py` assigns each sample of
  the **event-loop thread** to a component by the deepest classified frame: gzip
  (`starlette/middleware/gzip`, `gzip`, `zlib`), OTel (`opentelemetry/`), Sentry
  (`sentry_sdk/`), database client (`sqlalchemy/`, `asyncpg/`), serialization (`pydantic`,
  `fastapi/encoders`, `json`), our code (`upmovies/`), server and loop (`uvicorn/`,
  `starlette/`, `asyncio/`, `logging/`), other. The doc names the top three with their shares.
  A second run with `--gil` reports how much GIL time the other threads take (the OTel batch
  exporter, the Sentry transport), since they stall the loop without appearing on it. Keep one
  flame graph in `bench-out/` and attach it to the PR, not the repo.
- **A/B**, at process saturation, mixed endpoints, twice each, reporting requests per second
  and worst probe latency against the baseline:

  | Run | How it is toggled |
  |---|---|
  | Baseline (as prod) | `Accept-Encoding: gzip`, OTel wrapper on, `SENTRY_DSN` set |
  | Gzip off | `--accept-encoding identity` |
  | OTel off | `BENCH_OTEL=0` |
  | Sentry off | `SENTRY_DSN` unset |
  | All three off | the three together |
  | OTel narrowed | `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=…`, one instrumentation at a time, only if "OTel off" moves throughput by more than 10% |

  Anything else the profile ranks in its top three gets an A/B too if it can be toggled from
  outside; if it can't, the doc says so and the follow-up ticket carries it.
- **Asserted, not measured:** that the frontend Worker's `fetch` asks for gzip (workerd's
  default). If gzip moves throughput by more than 10%, verifying that header is part of the
  follow-up.

*Rejected: new settings such as `GZIP_ENABLED`* (product code in a measurement ticket, and half
a fix), and *uncommitted patches to `main.py`* (not reproducible). The cost is that Sentry is
all-or-nothing: `traces_sample_rate` is hardcoded in `telemetry.py`.

**D-2286.7 — Follow the evidence, inside the same timebox.** If D-2286.1's verdict is
**database-bound**, the closed-loop steps and the healthz curve still run (they size the cap
either way), but the profile and A/B effort moves to the queries: which statements stretch
under concurrency, `pg_stat_statements` if it is installed, and read-only `EXPLAIN (ANALYZE,
BUFFERS)` on prod for the statements behind `get_person_detail` and `get_entity_events`, for
three of the incident's heaviest refs, off-peak. The doc's top three costs are then shares of
request time, not event-loop time, and it says why. **Host-bound** or **arrival-bound**: the
doc records the finding first; the bench still runs to give the ceiling and the cap. The
ticket's checklist items that the verdict makes moot are marked "not applicable" with the
reason, not silently dropped.

**D-2286.8 — Prod profiling is a follow-up, not a step.** The ticket's optional `py-spy dump`
in prod needs `py-spy` in the prod image and `SYS_PTRACE` on the prod service: a compose change
and a redeploy. If SigNoz and the bench together don't explain the incident, the doc says so
plainly and a follow-up ticket designs prod profiling.

**D-2286.9 — The recommendation lands as a comment and, if it isn't 60, a ticket.** The value
and its reasoning go in a comment on NEU-2285. If it differs from 60, a follow-up ticket
changes the default in `config.py` with its spec and ADR-0028 note. This PR does not change
the default, and nobody sets the variable in Coolify meanwhile: the code default, the NEU-2285
spec and prod stay in step.

**D-2286.10 — One working day, and a stop rule.** Priority if time runs short: prod records
(D-2286.1) → closed-loop steps with the healthz curve → profile → A/B → open-loop replay. At
the end of the day the doc is written from what exists. Anything not reached is listed as "not
measured" with a follow-up ticket; nothing is filled in by estimate.

## Deliverables

1. `docs/measurements/<date>-neu-2286-api-throughput.md`, dated the day of the bench runs, in
   the style of the two NEU-2271 docs. Sections: the incident re-read from SigNoz, with the
   verdict; method, data set and date; the closed-loop table for each endpoint; the healthz
   curve, scale factor and recommended cap; the profile breakdown; the A/B table; the open-loop
   replay; what was not measured; reproducing; the queries used.
2. The two incident CSVs beside it (person refs are public page slugs; no IPs or headers).
3. `docker-compose.bench.yml`, the `bench:*` tasks, the extended `bench_public_burst.py`,
   `scripts/bench_cpu.py`, `scripts/bench_profile_breakdown.py`, the `bench-out/` gitignore
   entry, and the `CLAUDE.md` table rows.
4. A comment on NEU-2285 with the recommended `MAX_IN_FLIGHT_REQUESTS` and reasoning.
5. Follow-up tickets in *bl: Maintenance*, related to NEU-2286, one per fix worth doing, each
   in the Problem / Solution / Definition of done format with its evidence line citing the
   measurement doc. Or one sentence in the doc that none is worth doing. ADR-0028's question
   (a shared rate-limit store, then workers) gets an explicit answer either way.

## Acceptance criteria

- [ ] The doc reconciles the 679 access-log lines with the trace counts above and states the
  D-2286.1 verdict, with CPU for the backend, Postgres and the host across the window.
- [ ] The doc records requests per second, p50/p95 and CPU at each closed-loop step for both
  person endpoints, with method, data set (refresh date, row counts) and date.
- [ ] The doc has the healthz curve, the prod-to-bench scale factor and how it was measured,
  and a recommended `MAX_IN_FLIGHT_REQUESTS` derived by D-2286.4's criterion.
- [ ] The doc has a profile breakdown at process saturation naming the top three costs with
  their share of event-loop time (or of request time, under D-2286.7), and the GIL share of
  the non-loop threads.
- [ ] The doc gives the A/B result for gzip, OTel and Sentry, each against the baseline.
- [ ] The doc reports the open-loop replay: statuses, probe misses, and whether Docker marked
  the container unhealthy, at the default cap and at the recommended one.
- [ ] `task bench:up`, then the doc's Reproducing commands, run from a clean checkout.
- [ ] NEU-2285 has the recommendation as a comment.
- [ ] Follow-up tickets are filed and linked, or the doc says plainly that none is needed.
- [ ] `git diff main -- src/` is empty.
- [ ] `task format`, then `task test && task lint && task typecheck`, pass. The frontend is
  untouched.

## Out of scope

- **Any fix.** Dropping gzip, trimming instrumentation, query changes, a new cap default: each
  is its own ticket (D-2286.9).
- **Prod profiling** and any change to the prod image or compose file (D-2286.8).
- **More uvicorn workers or a shared rate-limit store.** The doc answers whether ADR-0028
  should be revisited; it doesn't revisit it.
- **Cloudflare bot and rate-limit rules,** and the frontend.
- **Other routes.** Companies, collections, the feed and the calendar are measured only if the
  incident's own records show them carrying a real share of the load.

## Notes for the implementer

- "Process saturation" here is ADR-0028's sense. `CONTEXT.md` uses "saturation" for the
  retrieval cap; don't shorten the term in the doc. Nothing in this ticket adds a glossary term
  or an ADR.
- The prod host throttles rapid SSH handshakes. Batch queries into one `--multiquery` call per
  connection, and after a failure wait rather than retry in a loop.
- Scripts are outside ruff's and pyright's configured scope (`src`, `tests`), but keep them to
  the same style.
- Never start a bench run while the test suite is running: both use the shared local Postgres.
- Commit as `chore(api): … (NEU-2286)`; the ticket's `spike` is not a Conventional Commits
  type, and `chore` keeps it out of the release notes.
