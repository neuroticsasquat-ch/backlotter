# Harden Stage-2 Clustering: compact story refs, configurable max_tokens, dedup — Design

- **Date:** 2026-06-23
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-backend` — `link` pipeline (`cluster.py`, `pipeline.py`, `config.py`, `routers/ingest_admin.py`)
- **Linear:** NEU-365 (one PR, backend) · project *Movies: Content Quality* · milestone *MVP Quality Bar* · priority High
- **Related:** NEU-298 (Stage-2 batched clustering — established the shared build/apply split this builds on) · NEU-372 (widen cross-day attach horizon — token-budget-aware, depends on the headroom this buys)

## Problem

Surfaced during a bulk re-link of the existing corpus (reset `linked`→`pending`, widened `LINK_RECENCY_DAYS`, re-ran `link`): **6 films failed Stage-2 clustering and produced 0 events** — silently absent from the public feed and film pages. Two distinct failure modes, both in `src/upmovies/link/cluster.py`.

### Failure mode 1 — truncated cluster JSON (the main one)

`apply_cluster_decisions` parses the model response with `json.loads(_extract_json_object(raw))` (`cluster.py:200`) and raises `JSONDecodeError` (`Unterminated string` / `Expecting ',' delimiter`) when the response is cut off. The Sonnet cluster response is capped at `_MAX_TOKENS = 1500` (`cluster.py:33`), and the **output schema must echo every new story's full UUID** (~40 tokens each). A film with many recent stories overflows the output budget → truncated JSON → the whole film is skipped:

| Film | Unclustered stories |
| -- | -- |
| Klara and the Sun | 108 |
| Not Alone | 87 |
| Love and War | 61 |
| Welcome to the Jungle | 61 |
| Spider-Man: Brand New Day | 55 |

The truncation is **deterministic** — the same response is produced every run, so there is no self-healing today. The asymmetry is the whole problem: existing events are already referenced by 1-based **positional index** (`"existing": 2`), but new stories are echoed as UUIDs. The UUID echo is the entire output-token sink.

### Failure mode 2 — duplicate `(event_id, story_id)` insert

One 2-story film (Descendants: Wicked Wonderland) hit `asyncpg UniqueViolationError` on `event_story_pkey` during the apply flush (`cluster.py:233`). `EventStory` has a **composite primary key `(event_id, story_id)`** (`news/models.py:104-108`) plus a separate `uq_event_story_story_id` unique on `story_id`. The pkey violation pins the cause: a story reference **duplicated within a single group's `stories` array** is inserted twice. The cross-group guard (`sid not in assigned`, `cluster.py:207`) does not catch it because `assigned` is only populated *after* the per-group list is built — so intra-group duplicates pass through.

### Impact

High-volume marquee titles — exactly the films a user most wants — get **no events**. In steady-state daily runs the per-film per-window story count is small, so truncation is rare; but any big news day or backfill triggers it, and there is no retry or fallback today.

## What this changes

Four changes. Three are local to `link/cluster.py`; the fourth — configurable `max_tokens` — adds a config setting threaded through the pipeline to reach it. Both the **sequential** (`cluster_film_events`) and **batched** (`build_cluster_batch_request` → `apply_cluster_decisions`) paths share `build_cluster_request`/`apply_cluster_decisions`, so every fix is **structural across both paths** — the NEU-298 parity property (sequential outcomes == batched outcomes) is preserved by construction, not by test coincidence.

1. **Compact integer story references** — fixes truncation by replacing the per-story UUID echo with a 1-based index, symmetric with how existing events are already referenced.
2. **Configurable `max_tokens`** — raises the default cap to 4096 and exposes it as a setting; belt-and-suspenders headroom for extreme volumes.
3. **Order-preserving dedup** — drops intra-group (and cross-group) duplicate story references before insert, fixing the `event_story_pkey` violation at the source.
4. **Graceful parse-failure handling** — an unparseable response logs a warning and leaves the film unclustered (retried next run) instead of risking an uncaught raise.

### Out of scope

- **Chunking a film's story set** across multiple cluster calls. Compact indices keep even a 300-story film's output well under 4096 tokens, so chunking's orchestration/merge complexity (later chunks can't see events earlier chunks just created) is unnecessary. Deferred unless a real film ever exceeds the budget.
- **An LLM retry on parse failure.** Truncation is fixed structurally; a deterministic-truncation retry would re-fail identically. The graceful skip is the only safety net.
- **Existing-event attach horizon** — that is NEU-372's concern (existing events are *input* tokens, orthogonal to this *output* truncation fix). See Coordination below.
- **Clustering quality / prompt tuning** beyond the schema change. The grouping/classification instructions are unchanged except for the story-reference format.
- **DB migration, new env beyond the one `max_tokens` knob, FE** — none.

## Key decision — index stories the way events are already indexed

The Stage-2 output already references existing events by their **1-based position** in the ordered list sent in the request, and `ClusterPlan` already carries the ordered IDs needed to map those positions back deterministically (`existing_event_ids`, `unclustered_story_ids`). We extend the identical discipline to new stories: send each new story with a 1-based index `n`, have the model return `n` values in each group's `"stories"` array, and map `n` → `plan.unclustered_story_ids[n-1]` in apply.

Because `plan.unclustered_story_ids` is the canonical, full-length, never-reordered list captured at build time, the index→story_id mapping is fully deterministic and immune to any row-set drift across the batch poll window — exactly the property NEU-298 relied on for events. This is the natural, minimal contract change: it removes the only UUID echo in the output and makes story-referencing consistent with event-referencing.

## Architecture

### `link/cluster.py`

**`_INSTRUCTIONS` (prompt) — output schema change.** New stories are presented with an integer id `n`; the output `"stories"` array contains those integers, not UUIDs. The schema stays:

```
{"events": [{"existing": <existing event number or null>, "type": <type or null>,
  "confidence": "confirmed" | "rumored" | null, "stories": [<n>, ...]}]}
```

Make explicit that `"existing"` indexes the existing events list and `"stories"` indexes the new stories list — separate namespaces in separate fields, no collision. "Every new story's `n` must appear in exactly one group" replaces the UUID wording.

**`build_cluster_request`.** Emit `new_stories` as `[{"n": i, "title": …, "summary": …}, …]` with `i` 1-based over `unclustered` (the same list whose IDs become `plan.unclustered_story_ids`, so position and index agree). `ClusterPlan` is unchanged in shape — `unclustered_story_ids` is now load-bearing as the index key. Replace the hardcoded `_MAX_TOKENS` with a `max_tokens` parameter (see Configurable max_tokens).

**`apply_cluster_decisions`.** Re-load the plan's stories and build `by_id = {s.id: s}`. Resolve each group's references against the **canonical plan order**, not a re-derived list:

```
story_ids = plan.unclustered_story_ids          # n -> story_ids[n-1]
group_sids: list[UUID] = []
for n in (group.get("stories") or []):
    if not isinstance(n, int) or not (1 <= n <= len(story_ids)):
        continue
    sid = story_ids[n - 1]
    if sid not in by_id or sid in assigned or sid in group_sids:
        continue                                # vanished row / cross-group / intra-group dupe
    group_sids.append(sid)
```

`sid in group_sids` is the **intra-group dedup** (failure mode 2 fix); `sid in assigned` keeps the existing cross-group guard. Mapping through `story_ids` (always full length) rather than a filtered list means a (pathological) vanished row skips that one membership without shifting any other index. Downstream is unchanged: `occurred_at = min(published_at or fetched_at)` over the resolved stories, validate `type`/`confidence` for new events, attach via `EventStory`, each story assigned once, accurate `events_created`/`stories_clustered` counts.

**Parse-failure guard.** Wrap the JSON parse:

```
try:
    data = json.loads(_extract_json_object(raw))
except JSONDecodeError:
    log.warning("cluster: unparseable response for film %s", plan.film_id)
    return ClusterResult(0, 0)
```

The film's stories stay `pending` (idempotent build filters `~clustered`) and are retried next run. **Decision:** this returns `(0, 0)` rather than raising, so it does **not** increment the run's `failed` counter — the failure is visible at WARNING level in logs only. Accepted because the structural fix makes this path near-unreachable, the stories self-heal on the next run, and a stack trace for a benign-and-rare parse hiccup is not warranted.

**`max_tokens` parameter.** `cluster_film_events` and `build_cluster_batch_request` take a `max_tokens` kwarg (module default `_DEFAULT_MAX_TOKENS = 4096`, replacing the `_MAX_TOKENS = 1500` constant) and pass it to `client.complete(max_tokens=…)` / `BatchRequest(max_tokens=…)` respectively. The default keeps existing direct-call tests working without threading the kwarg everywhere.

### `config.py`

Add, alongside the other `link_*` settings:

```
link_cluster_max_tokens: int = Field(default=4096, alias="LINK_CLUSTER_MAX_TOKENS")
```

### `link/pipeline.py`

Thread a `cluster_max_tokens: int` kwarg from `run_link_ingest` into `_cluster_stage_sequential` and `_cluster_stage_batched`, which pass it to `cluster_film_events` / `build_cluster_batch_request`. Mirrors how `model`/`recency_days` already flow — no new pattern.

### `routers/ingest_admin.py`

The `run_link_ingest(...)` call (`ingest_admin.py:87`) passes `cluster_max_tokens=settings.link_cluster_max_tokens`, alongside the existing `cluster_model=` / `recency_days=` / `use_batches=` args.

## Coordination with related tickets

- **NEU-298 (batched Stage-2).** Its parity acceptance test and canned per-film JSON fixtures reference stories by UUID. Those fixtures must be **updated to the integer-index format**; the parity property itself is preserved structurally (both paths still call the same `apply_cluster_decisions`).
- **NEU-372 (widen attach horizon).** Existing events are *input* tokens, referenced by index (cheap in output), so widening their lookback is orthogonal to this *output* truncation fix. **NEU-365 should land first** to give NEU-372 its token headroom; NEU-372 will not need to revisit the output schema, only keep its existing-event count token-budget-aware on the input side.

## Testing (TDD; integration `session` fixture against the test DB; fakes only — no live API)

Extends `tests/integration/link/test_cluster.py` and `tests/integration/link/test_pipeline.py`.

- **`build_cluster_request`:** `new_stories` carry 1-based `n` in `unclustered` order; `ClusterPlan.unclustered_story_ids` matches that order (so `n` indexes it correctly).
- **`apply_cluster_decisions` against canned integer-index JSON:** creates new events; attaches to an existing event by index; maps each `n` → the plan's story; skips out-of-range / non-int `n`; skips a group with invalid `type`/`confidence`; computes `occurred_at = min(published_at or fetched_at)`.
- **Failure-mode-2 regression:** a group whose `stories` array contains a duplicate index (`[2, 2]`) inserts that `(event_id, story_id)` **once** — no `event_story_pkey` violation; `stories_clustered` counts it once.
- **Parse-failure:** unparseable `raw` → returns `ClusterResult(0, 0)`, creates no rows, raises nothing, logs a warning.
- **`max_tokens` flow:** the settings value reaches both `BatchRequest.max_tokens` (batched) and `client.complete(max_tokens=…)` (sequential).
- **NEU-298 parity:** update the existing parity test + fixtures to integer-index JSON; assert `_cluster_stage_sequential` and `_cluster_stage_batched` still produce identical `Event` + `EventStory` rows.
- **Regression:** existing `cluster_film_events` tests pass after the refactor.

`task format` first; `task test` / `task lint` / `task typecheck` all green. Commit normally — pre-commit hooks delegate into the container (no `--no-verify`).

## Files touched (one backend PR, branch `tom/neu-365-backend-harden-stage-2-clustering-cluster-json-truncates-on`)

- `src/upmovies/link/cluster.py` — compact integer story contract (`_INSTRUCTIONS`, `build_cluster_request`, `apply_cluster_decisions`); `max_tokens` parameter replacing `_MAX_TOKENS`; intra-group dedup; parse-failure guard.
- `src/upmovies/config.py` — `link_cluster_max_tokens`.
- `src/upmovies/link/pipeline.py` — thread `cluster_max_tokens` through both cluster stages.
- `src/upmovies/routers/ingest_admin.py` — pass `settings.link_cluster_max_tokens`.
- `tests/integration/link/test_cluster.py`, `tests/integration/link/test_pipeline.py` — new tests; fixtures updated to integer-index JSON.

No config migration, DB migration, or FE changes.

## Delivery

One backend PR on the ticket's branch. Implement in a Sonnet/high session per the model/effort workflow; this Opus session produced the design only. Run the full local CI (`task test` / `task lint` / `task typecheck`, `task format` first) before pushing.
