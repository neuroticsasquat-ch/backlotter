# Stage-2 Clustering via Batches API — Design

- **Date:** 2026-06-22
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-backend` — `link` pipeline (`cluster.py`, `pipeline.py`)
- **Linear:** NEU-298 (one PR, backend) · parent NEU-290 · project *Movies: Ingestion & Feeds* · milestone *Batches API link-cost optimization*
- **Blocked by:** NEU-297 (measure batch vs sequential+caching; flip default) — ✅ done (PR #28). The measurement landed in favour of batches (**19.8% cheaper**), so `link_use_batches` now defaults `True` (`config.py:36`). Also builds on NEU-296 (Stage-1 batched path, PR #27) and NEU-295 (`AnthropicClient` batch surface, PR #26).
- **Design-of-record:** [2026-06-20-ingestion-cadence-recency-architecture-design.md](2026-06-20-ingestion-cadence-recency-architecture-design.md) §"Batches API cost optimization" — the Stage-2 extension bullet. This document is the per-ticket implementation design for that follow-on deliverable.

## What this is

Stage-2 clustering (Sonnet, per-film) is the last part of the daily link pass still running
sequentially after Stage-1 was moved to the Message Batches API. The per-film cluster calls are
mutually independent, so they can run as **one batch** — but only *after* Stage-1 results are
committed, because Stage 2 reads `linked` stories. This ticket extends the existing
`link_use_batches` flag to Stage-2 so the daily pass becomes:

```
batch Stage 1 → await → commit  →  select films → batch Stage 2 → await → commit
```

The flag already reaches `run_link_ingest` (`use_batches`, wired from `settings.link_use_batches`
in `ingest_admin.py:95`); today it only selects the Stage-1 path. We extend the same selection to
Stage 2.

The success criterion is **parity**: batched Stage-2 must produce the *same* event/cluster outcomes
as the sequential path on a fixed mocked set. The design achieves parity **structurally** — both
paths call one shared apply function — rather than relying on the test alone to catch divergence.

### Out of scope

- **The Stage-2 LLM contract.** Existing events stay referenced by **positional index**
  (`"existing": 2` → the 2nd event in the list sent). No prompt or output-schema change — changing
  it would risk diverging the two paths' outcomes, which is exactly what the ticket forbids.
- **Clustering quality / prompt tuning** — unchanged.
- **Cost re-measurement** — NEU-297 settled the flip; this ticket assumes batches are the default.
- **New config / env / migration / FE** — none required.
- **Stage-1** — already batched (NEU-296); untouched here beyond reading its committed results.

## Key decision — deterministic apply via a build-time plan

The Stage-2 LLM output references existing events by their **1-based position** in the ordered list
sent in the request (ordered `(occurred_at, id)`, windowed by `recency_days`). In the sequential
path, build and apply share one in-memory list, so index → event always lines up. In a batched path
the build-phase session must close **before** the (minutes-long) batch poll — so the apply phase has
to reconstruct *the exact same ordered event list* to map indices correctly.

**Decision:** the build phase returns, alongside the request, a small **`ClusterPlan`** that captures
the ordered existing-event IDs and the unclustered story IDs. The apply phase re-loads exactly those
rows **by ID, in that order** — fully deterministic and immune to the poll-window time drift that a
re-derived `updated_at >= cutoff` query could suffer at the recency boundary. The plan is tiny (two
UUID lists per film), so carrying it across the poll is cheap. This mirrors Stage-1's discipline of
dropping ORM rows before the poll and re-querying fresh in apply.

A direct consequence: because the plan fully specifies apply's inputs, **both** Stage-2 paths can call
the *same* `apply_cluster_decisions`. Identical outcomes become structural, not coincidental.

## Architecture — mirror the Stage-1 split

Stage-1 cleanly separates a pure **build** half (`linker.build_link_request` /
`build_batch_request`) from a pure **apply** half (`linker.apply_link_decisions`), with
`_link_stage_sequential` / `_link_stage_batched` in `pipeline.py` selected by `use_batches`. Stage-2
currently interleaves *reads → `complete()` → writes* in one function (`cluster_film_events`). We
refactor it the same way.

### `link/cluster.py` — shared build/apply

- **`ClusterPlan`** (new `@dataclass`): `film_id: UUID`, `existing_event_ids: list[UUID]` (in the
  exact `(occurred_at, id)` order presented to the LLM), `unclustered_story_ids: list[UUID]`.
- **`build_cluster_request(session, *, film_id, recency_days) -> tuple[list[dict], list[dict], ClusterPlan] | None`**
  Does every read currently inside `cluster_film_events`: load the `Film`; load unclustered
  `linked` stories for the film; load recent existing events (`updated_at >= cutoff`,
  `order_by(occurred_at, id)`) and each one's story headlines; build the `system`
  (`cached_system_block(_INSTRUCTIONS)`) + `user` payload (film / existing_events / new_stories).
  Returns `None` when the film is missing or has no unclustered stories. Parallels
  `linker.build_link_request`.
- **`apply_cluster_decisions(session, *, plan, raw) -> ClusterResult`**
  Re-loads events by `plan.existing_event_ids` (in order → positional index maps correctly) and
  stories by `plan.unclustered_story_ids`, parses the JSON (reusing `_extract_json_object`), then
  runs the existing create-event / attach-to-existing logic (current `cluster.py` lines 161–194)
  unchanged: validate `type`/`confidence` for new events, `occurred_at = min(published_at or
  fetched_at)`, attach via `EventStory`, each story assigned exactly once. Parallels
  `linker.apply_link_decisions`.
- **`cluster_film_events(...)`** stays the public sequential entry point, now a thin composition:
  `build → (None ⇒ empty result) → complete() → apply`. Existing signature and behaviour preserved,
  so current callers/tests keep working.

### `link/pipeline.py` — dual Stage-2 stage functions

The distinct-film selection (current lines 190–208) stays in `run_link_ingest`; the resulting
`film_ids` list is passed into the chosen stage.

- **`_cluster_stage_sequential(*, session_factory, client, run_id, model, film_ids, recency_days)`**
  Today's per-film loop: open a session, `cluster_film_events`, commit; on error
  `record_progress(failed_delta=1)`. Returns `(events_created, stories_clustered)`.
- **`_cluster_stage_batched(*, session_factory, client, run_id, model, film_ids, recency_days)`**
  1. **Build phase** — one read-only session: for each `film_id`, `build_cluster_request`; for the
     non-`None` results, wrap `(system, messages)` into
     `BatchRequest(custom_id=str(film_id), model, system, messages, max_tokens=_MAX_TOKENS)` and
     keep its `ClusterPlan`. Drop ORM rows before polling.
  2. If no requests → return `(0, 0)`.
  3. **Submit** — `client.complete_batch(requests)` (default poll 15s / timeout 3600s). On
     whole-batch submit/poll failure → `record_progress(failed_delta=len(film_ids))`, return
     `(0, 0)` (all films left unclustered, retried next run).
  4. **Apply phase** — per film: open a fresh session, look up the result by `custom_id`; if
     missing / `not ok` / un-parseable → `record_progress(failed_delta=1)` (isolated); else
     `apply_cluster_decisions(s, plan=plan, raw=result.text)` + commit; accumulate counts.
- **Selection** in `run_link_ingest`:
  `cluster_stage = _cluster_stage_batched if use_batches else _cluster_stage_sequential`.

`custom_id = str(film_id)` is the stable per-film key (Stage-1 used the chunk index; the film UUID is
the natural key here, and each film appears once).

## Sequencing, idempotency & failure isolation

- **Sequencing.** Stage-2 already begins only after Stage-1 has fully committed (it reads `linked`
  rows). The batched Stage-2 is a *separate* batch submitted after Stage-1's batch is awaited and
  committed — satisfying the design-of-record's `S1 → commit → S2 → commit` ordering. The daily run
  now performs **two** sequential batch awaits; both sit well inside the ~60-min budget (NEU-297
  measured Stage-1 at 77–396s; Stage-2 payloads are smaller and fewer tokens).
- **Idempotency.** The build phase filters `~clustered`, so re-runs never re-submit already-clustered
  stories; the unique `EventStory.story_id` constraint is the ultimate backstop. A film whose result
  is missing/errored simply stays unclustered and is picked up on the next daily run. Identical to
  the sequential path's guarantees.
- **Failure isolation.** Mirrors Stage-1 batched: a whole-batch submit failure fails all films and
  rolls nothing forward; a single film's errored/missing/bad-JSON result fails only that film. One
  film never rolls back another (per-film sessions/commits).

## Testing (TDD; fakes only — no live API, per repo convention)

These extend the existing **`tests/integration/link/test_cluster.py`** and
**`tests/integration/link/test_pipeline.py`** — `build_cluster_request` / `apply_cluster_decisions`
both take the session and read/write the DB, so they exercise the test `session` fixture (the repo's
integration convention) rather than living under `tests/unit/`.

- **`build_cluster_request`**: returns `None` when the film has no unclustered stories (and when the
  film is missing); builds the expected payload (film, existing events in order with their
  headlines, new stories); the `ClusterPlan` carries the ordered event IDs and the unclustered story
  IDs.
- **`apply_cluster_decisions`**: against canned raw JSON — creates new events; attaches to an existing
  event by index *via the plan's ordered IDs*; skips a group with invalid `type`/`confidence`;
  assigns each story exactly once; computes `occurred_at = min(published_at or fetched_at)`.
- **Parity acceptance test (the ticket's core requirement):** seed identical DB state, run
  `_cluster_stage_sequential` and `_cluster_stage_batched` against fakes that return the *same*
  canned per-film JSON, and assert **identical `Event` + `EventStory` rows** (counts and contents).
- **Batched failure isolation:** one film's batch result errored/missing → that film counted failed,
  its stories remain unclustered, other films still cluster successfully.
- **Regression:** existing `cluster_film_events` tests still pass after the refactor (sequential
  behaviour preserved).
- `task format` first; `task test` / `task lint` / `task typecheck` green. Commit normally — the
  pre-commit hooks delegate into the container (no `--no-verify`).

## Files touched

**This PR (backend):**

- `src/upmovies/link/cluster.py` — add `ClusterPlan`, `build_cluster_request`,
  `apply_cluster_decisions`; refactor `cluster_film_events` to compose them.
- `src/upmovies/link/pipeline.py` — extract `_cluster_stage_sequential` /
  `_cluster_stage_batched`; select on `use_batches`.
- `tests/integration/link/test_cluster.py` (and `tests/integration/link/test_pipeline.py` as
  needed) — build/apply tests, the parity acceptance test, and the failure-isolation test.

No config, migration, env, or FE changes.

## Delivery

One backend PR on the ticket's branch
(`tom/neu-298-be-stage-2-clustering-via-batches-api`). Implement in a Sonnet/high session per the
model/effort workflow; this Opus session produced the design only. Ship via `/t:ship` against the
release branch.
