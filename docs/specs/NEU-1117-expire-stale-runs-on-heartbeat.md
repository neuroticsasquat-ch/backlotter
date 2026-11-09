# NEU-1117 — Expire stale ingest runs on a heartbeat, not on `started_at`

**Ticket:** [NEU-1117](https://linear.app/neuroticsasquatch/issue/NEU-1117/backend-expire-stale-ingest-runs-on-last-progress-at-not-started-at)
**Repo:** `upcoming-movies-backend`
**Base branch:** `release/v0.3.0`
**Project:** backlotter: Undated Film Discovery

## What to build and why

`mark_stale_runs_cancelled` cancels any `ingest_run` still `running` whose **`started_at`**
predates a single global window. That question — "how long ago did this start?" — cannot
distinguish a run orphaned by a crash from one that is legitimately still working, and the sweep
broke the assumption that it could. `INGEST_STALE_RUN_MINUTES=15` was sized for a chain of
stages measured in minutes; a first sweep runs for hours.

On 2026-08-11, during the directors-tranche flip, Coolify's default 30-minute scheduled-task
timeout killed the first post-flip sweep mid-enumerate and left a phantom `running` row. Raising
the window to `720` in prod stopped restarts from cancelling a live multi-hour sweep — and made
every orphan linger twelve hours instead. That row was cancelled by hand. One number keyed on
`started_at` is wrong for one of the two run shapes no matter which value it holds.

Replace the question with **"when was this run last known to be alive?"**, and make the column
that answers it tell the truth.

### The rule

A `running` row expires when

```
COALESCE(last_progress_at, started_at) < now() - INGEST_STALE_RUN_MINUTES
```

`last_progress_at` changes meaning: it no longer records *when the run last produced something*
but *when the run was last known alive*. That redefinition is the point of the ticket — it is
what lets one tight window serve both a 4-minute feeds pass and a 6-hour sweep.

### Why the column needs a heartbeat first

`last_progress_at` is written only by `record_progress`, and the sweep's enumerate phase has
**two** stretches that call it on no successful path:

- `_collect_attachments` (`ingest/sweep/enumerate_phase.py`) issues one
  `/person/{id}/movie_credits` per seed person — ~1,446 today at the directors tranche, ~7,519
  at full ramp — and records nothing on success. At TMDB's 40 req / 10 s cap
  (`config.py:27`) that is 30–70 minutes of silence.
- `_judge_candidates` records only on **admission**. A pass where every tranche flag is closed —
  which is exactly what M2 shipped, and what a future tranche pause returns to — or where the
  corroboration threshold rejects everything, is silent through the judging loop as well.

So `last_progress_at` stays `NULL` through precisely the longest stretch of the longest run, and
a naive `COALESCE(last_progress_at, started_at)` reproduces the current bug exactly.

### Why the window alone was never the fix

`mark_stale_runs_cancelled` has exactly one call site: the FastAPI **lifespan**
(`main.py:64`), which under Coolify means *on deploy*. The sweep runs in a different process
(`python -m upmovies.pipeline_run sweep`), so the canceller never sees a run its own process
owns — and cancelling a row does not stop the process that owns it. The incident's phantom row
survived because nothing swept it, not because the window was long. Tightening 720 → 30 changes
nothing on its own if nothing restarts for a week.

## Scope

### 1. A shared, time-throttled heartbeat

Add a `Heartbeat` to `ingest/sweep/phase.py`, alongside `AbortGuard` and `owned_session` — the
same reason those live there applies: it is a phase contract, and one copy is what stops three
definitions of "alive" drifting apart.

- Constructed from `(session_factory, run_id, interval_seconds)`; default interval **60 s**.
- A `tick()` (or equivalent) that loops call **every item, regardless of outcome**, and that
  writes at most once per interval. Its own short-lived session and commit, like `AbortGuard`.
- The write touches `last_progress_at` only — it is not a counter update, and must not be
  routed through `record_progress`, whose name would then be a lie. Add a narrow
  `touch_run(session, run_id)` to `ingest/runs.py` for it.
- Cadence is expressed in **time**, not in items, because the staleness window it feeds is a
  time window and the two must be reasoned about together. A count-based throttle (e.g.
  reusing `log_every=250`) means the guarantee in minutes depends on how fast that particular
  loop happens to run — 250 people is ~60 s, 250 event rows is a blink — and one slow item
  breaks it outright.

**Invariant this establishes:** a live sweep is never quiet for longer than the interval.

### 2. Every sweep per-item loop ticks it

Both enumerate loops (`_collect_attachments`, `_judge_candidates`), `run_sweep_refresh`, and the
three event phases (`field_events`, `credit_events`, `release_events`). Per item, on every
path — admitted, skipped, withheld, failed.

Other pipelines are **not** touched. `tmdb`, `feeds` and `synthesize` already record per item and
`link` per batch; their worst legitimate gap between writes is one retrying LLM batch — minutes,
not tens of minutes. Pushing the heartbeat into them would buy uniformity and nothing else.

### 3. Expire on the coalesced timestamp

`mark_stale_runs_cancelled` filters on `COALESCE(last_progress_at, started_at) < cutoff` instead
of `started_at < cutoff`. Its cancellation `error` string should name the reason in the new
terms (no progress for N minutes), since `/admin/runs` is the surface the incident was diagnosed
from.

### 4. `INGEST_STALE_RUN_MINUTES` default 15 → 30

Roughly 5× the worst legitimate gap anywhere in the system and 30× the heartbeat interval:
comfortable slack without being a second long floor in disguise. The name does not change.

### 5. A second call site: `pipeline_run.main`

Every scheduled task — `daily`, `hourly`, `sweep` — runs the cleanup before opening its own run.
The hourly task alone means an orphan is cleared within the hour rather than at the next deploy,
which is the half of the incident the window never addressed.

Safe now, and only now, because expiry is heartbeat-based: a concurrently live run of another
kind is heartbeating (sweep) or recording per item (everything else) and will not be touched,
and a row created seconds earlier coalesces to a fresh `started_at`. Run the cleanup **before**
`create_run` regardless, so the ordering is not load-bearing on that argument.

### 6. Prod rollout (operator action, post-merge)

Prod pins `INGEST_STALE_RUN_MINUTES=720` in Coolify, so merging alone leaves the fix inert.
After deploy:

1. Remove the `INGEST_STALE_RUN_MINUTES` override in Coolify (or set it to `30`).
2. `docker compose up -d --force-recreate` the backend — a running container holds the env it
   was created with — and `printenv` to confirm rather than reading the compose file.
3. Update `docs/deploy/v0.3.0-release-runbook.md`: §3 (env), the
   one-line ledger, and the "Last updated" line. That runbook is the only record of prod's
   manual state.

Consistent with the project's standing rule that flag flips are operator actions, not merges
(M4 shared contracts).

## Explicitly out of scope

- **`finalize_run` keeps overwriting a `cancelled` row.** A run wrongly cancelled while alive
  writes its real terminal status and its detail line over the cancel when it finishes. This is
  **self-healing and deliberate**, not a race to be closed: gating finalize on
  `status = 'running'` would turn a false positive into permanent misinformation and discard
  every counter the run reported. Document the reasoning at `finalize_run`; change nothing.
- **The Coolify scheduled-task timeout (`36000`).** Independent of this ticket and still
  provisional pending real first-run timings.
- **Per-kind staleness windows.** Considered and rejected: it keeps a global-number knob that is
  still wrong for a sweep that dies at minute five, and re-admits a milder version of the bug
  being closed here.
- **Surfacing `last_progress_at` on `/admin/runs`.** It is on `RunOut` and in the frontend's
  `types.ts`, but nothing renders it. The semantic change is backend-only; no frontend work.

## Acceptance criteria

1. A run whose `last_progress_at` is recent survives a `started_at` far outside the window.
2. A run whose `last_progress_at` is older than the window is cancelled.
3. A run with `last_progress_at IS NULL` falls back to `started_at`, and **is** cancelled when
   that is old. Asserted explicitly — this is the case that caused the incident.
4. An enumerate pass that admits nothing (all tranches closed) still advances
   `last_progress_at`.
5. The heartbeat's throttle suppresses a second write inside the interval, and permits one
   after it.
6. `pipeline_run.main` runs the cleanup for every mode, before opening its own run.
7. `INGEST_STALE_RUN_MINUTES` defaults to `30` (`tests/unit/test_config.py` asserts the
   default).
8. `task test`, `task lint`, `task typecheck` green.

## Tests

TDD, failing test first. Integration tests against the `session` fixture in
`tests/integration/ingest/test_runs.py` for the expiry rule (criteria 1–3) and the new
`touch_run`. Sweep-phase tests cover the heartbeat: that a loop admitting nothing still ticks
(criterion 4) and that the throttle holds (criterion 5) — the latter by driving the interval
rather than sleeping.

## Docs to update in the same change

- **`CONTEXT.md`** — new term **Heartbeat** in *Pipeline shape*, defining `last_progress_at` as
  "last known alive" and naming what to avoid (*progress*, *keepalive*, *liveness probe*).
- **ADR-0003** — the sentence "The startup stale-run canceller (`main.py` lifespan) still bounds
  any run orphaned by a mid-run deploy" is no longer accurate: it is not startup-only and not
  keyed on `started_at`. Amend in place.

## Related

- NEU-1079 (Done) — the sweep entrypoint and schedule slot whose first prod run produced the
  incident.
- ADR-0003 — ingestion scheduling; owns the stale-run canceller's rationale.
- `docs/deploy/v0.3.0-release-runbook.md` — prod's manual state.
