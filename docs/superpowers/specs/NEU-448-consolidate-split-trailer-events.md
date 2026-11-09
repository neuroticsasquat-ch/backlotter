# NEU-448 — Consolidate split trailer events

**Ticket:** [NEU-448](https://linear.app/neuroticsasquatch/issue/NEU-448/bug-same-trailer-event-split-across-multiple-events) — *Bug: Same trailer event split across multiple events*
**Project:** backlotter: Maintenance
**Layer:** CLUSTER (`src/upmovies/link/cluster.py`)
**Date:** 2026-07-01
**Related:** NEU-449 (Done — stale-stage gate), NEU-450 (shared grouping/dedup theme), NEU-372 (attach-window fix, merged), NEU-367 (`_visible_events` hides `other`)

## Problem

The clusterer produces multiple `trailer` events for a single trailer rollout. The Fantastic Four / Doomsday film showed **4 separate `TRAILER` events** for one first-trailer rollout — Jun 27 "expected to arrive soon", Jun 28 "surfaced online", Jun 29 "first full trailer released", Jul 1 "first trailer released" — plus a separate `FIRST LOOK` for Doctor Doom's armor.

**Expected:** same-beat trailer stories consolidate into one event; anticipatory "expected soon" coverage is not a released-trailer event.

### Reframing against current `main`

The original triage comment named two root causes. The first is **already fixed**:

- **Root cause #1 (attach window) — RESOLVED by NEU-372.** `build_cluster_request` (`cluster.py:262`) now shows the model the film's **25 most-recent events by `occurred_at`, age-independent** (`LINK_CLUSTER_ATTACH_LIMIT=25`, no `updated_at` cutoff). The earlier trailer event *is* already in the candidate set. The real remaining failure is that the LLM is shown the existing trailer event but still spawns a new one — a precision/determinism problem, not a window problem.
- **Root cause #2 (event-type precision) — still open.** "Expected to arrive soon" was typed `trailer` despite the prompt already restricting `trailer` to a released video.

So two gaps remain, both fixable **entirely within `cluster.py` + `config.py`** — no schema change, no Stage-1 linker change.

## Design

### Component 1 — Deterministic windowed dedup guardrail (gap A)

In `apply_cluster_decisions`, intercept the **new-event** branch (`cluster.py:399`). When the model emits a *new* event of a singular visual-reveal type (`trailer` or `first_look`) and the film already has an event of that **same type** whose `occurred_at` is within a recency window, **force-attach** the group's stories to that existing event instead of creating a duplicate — mirroring the existing-attach path (set `event.updated_at = now`, add `EventStory` rows, count as clustered not created).

- **Merge-target search order:** (1) events created earlier in *this same apply pass* (tracked in a `dict[str, Event]` keyed by type), then (2) `plan.existing_events`. First same-type match within the window wins. Tracking in-pass creations handles a single LLM response that splits one rollout into 2+ new groups.
- **Window test:** candidate event `occurred_at.date() >= as_of_date - timedelta(days=window)`, where `as_of_date = plan.run_date or now.date()` (already computed at `cluster.py:383`). A genuinely-new trailer months later falls outside the window → still gets its own event.
- **Types covered:** module constant `_SINGULAR_BEAT_TYPES = {"trailer", "first_look"}` only. Casting / release_date / production milestones are untouched — they can legitimately repeat close in time.
- **Ordering:** the guardrail runs *after* the existing `off_topic`, `is_stale_stage`, and invalid-type guards, so a merged story can never resurrect a dropped or stale beat.

### Component 2 — Cluster prompt strengthening (gap B + reinforce A)

Two edits to `_INSTRUCTIONS` (`cluster.py:75`):

1. **Anticipation → `other`.** Sharpen the `trailer` definition: a trailer requires a video the audience can watch **now**; coverage that a trailer is *coming / expected / teased / dropping soon* with no watchable video yet is **`other`**, not `trailer`. NEU-367's `_visible_events()` already hides `other` from every public surface, so it disappears from the feed with no Stage-1 change and no hard drop.
2. **Reinforce same-beat consolidation.** One line making explicit that a single trailer / first-look rollout reported across several days by many outlets is **one** event — attach to the existing one rather than opening a new beat. (Belt-and-suspenders with Component 1, which already guarantees this deterministically.)

### Component 3 — Config knob

New field in `config.py`:

```python
link_singular_dedup_days: int = Field(default=14, alias="LINK_SINGULAR_DEDUP_DAYS")
```

14 days comfortably covers a multi-day rollout (this bug spanned 5) while keeping distinct later trailers separate. Threaded exactly like `unresolved_tier`:

- `run_link_ingest` → `_cluster_stage_sequential` / `_cluster_stage_batched` → `apply_cluster_decisions(..., dedup_days=...)`
- `routers/ingest_admin.py::_background_link` passes `settings.link_singular_dedup_days`
- `apply_cluster_decisions` gets a defaulted param (`dedup_days: int = 14`) so existing unit tests that call it directly stay valid.

## Acceptance criteria

- The 3 real trailer stories collapse into **one** `trailer` event.
- The Doctor-Doom `first_look` stays a separate event (different type).
- The "expected to arrive soon" anticipation story is typed **`other`** (hidden from the public surface), not `trailer`.
- A genuinely-distinct trailer event dated outside the dedup window still forms its own event.

## Testing (TDD)

**Unit tests (no LLM) on `apply_cluster_decisions`** — the guardrail's core:

- new `trailer` event + existing `trailer` within window → **merged** (0 new events, stories attach, `updated_at` bumped).
- new `trailer` event + existing `trailer` **outside** window → **separate** event created.
- new `first_look` behaves identically.
- `casting` / `release_date` duplicates within the window are **NOT** merged (regression guard for the type-only rule).
- two new `trailer` groups in one response → collapse to one event (in-pass tracking).

**Regression fixture** — the 5 NEU-448 stories (3 real trailer + 1 anticipation + 1 Doctor-Doom first-look): assert the 3 trailers collapse to one `trailer` event, the first_look stays separate, and anticipation lands as `other`.

Cluster integration tests are scoped to their directory (`tests/integration/link/`) per the known single-file async-loop pytest quirk.

## Scope / non-goals

- **No self-heal.** Clustering is idempotent (never re-touches already-clustered stories), so this fix prevents *future* splits only; the 4 already-recorded events won't merge without a manual re-cluster of that film's stories.
- No DB migration, no DTO / frontend change, no Stage-1 linker change.
- Anticipation is typed `other` (hidden), **not** `off_topic` / hard-dropped — the stories remain available to attach once the real trailer drops.
