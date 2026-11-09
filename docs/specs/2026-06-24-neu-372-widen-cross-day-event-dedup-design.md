# NEU-372 — Widen cross-day event dedup so re-reported beats attach instead of duplicating

- **Ticket:** [NEU-372](https://linear.app/neuroticsasquatch/issue/NEU-372)
- **Date:** 2026-06-24
- **Repo:** `upcoming-movies-backend`
- **Status:** Design approved — ready for implementation plan
- **Relates to:** NEU-365 (Stage-2 prompt token budget, done), NEU-361 (display-only source cap, done)

## Problem

A story ingested today that re-reports a beat already logged **more than `LINK_RECENCY_DAYS` (4) days ago**
spawns a **new duplicate event** instead of attaching to the existing one.

`build_cluster_request` (`src/upmovies/link/cluster.py`) only shows the model existing events with
`Event.updated_at >= now - recency_days`, where `recency_days` is `LINK_RECENCY_DAYS` (4). Older events are
therefore never offered as attach candidates, so the model has no choice but to create a new event for a
re-reported beat.

Within the 4-day window this already works correctly — the cluster prompt instructs the model to attach a
story to an existing event when it continues a logged beat, and those events are in the payload. The gap is
purely **beyond** the window.

### Root cause

The single `recency_days` knob governs **two** independent concerns:

1. **Story-recency window** — which pending stories are recent enough to link/cluster
   (`run_link_ingest`, `pipeline.py` story cutoff). This should stay tied to `LINK_RECENCY_DAYS`.
2. **Existing-event attach lookback** — how far back to look for events a new story might continue
   (`build_cluster_request`). This is what needs to widen.

The fix decouples (2) from (1).

## Desired behaviour

A re-reported beat whose existing event was last touched more than `LINK_RECENCY_DAYS` ago **attaches to that
event** instead of creating a duplicate. Steady-state within-window behaviour is unchanged.

## Decisions

1. **Attach lookback = most-recent-N events, age-independent, count-capped.** Drop the `updated_at` date cutoff
   in `build_cluster_request` entirely. Offer the film's **N most-recent events by `occurred_at`**, regardless
   of age, capped at N. A film almost never has more than N lifetime events, so the common case sees its full
   history; the cap only bites pathological marquee titles and keeps the prompt bounded (token-budget-aware,
   per the ticket). Chosen over a new `CLUSTER_ATTACH_DAYS` time window because a day-based window leaves the
   event *count* unbounded — the exact prompt-bloat failure mode NEU-365 fixed.

2. **N is configurable, default 25**, via a new `LINK_CLUSTER_ATTACH_LIMIT` setting (matches the existing
   `link_*` config pattern). 25 comfortably exceeds the lifetime distinct-event count of essentially every
   film while bounding the outliers.

3. **Cap each existing event to its 3 most-recent headlines in the prompt.** Today `build_cluster_request`
   dumps *every* headline of each event into `existing_payload` with no limit. With the old 4-day window that
   is usually 0–2 events so it is cheap, but once we widen to N events — and because `event_story` membership
   is unbounded (a single event can have 100+ stories) — that headline list becomes the real token sink. Three
   recent headlines give the model enough signal to recognise a continued beat. The cap is a hardcoded module
   constant (`_HEADLINES_PER_EVENT = 3`), not its own config knob.

4. **`occurred_at` is never moved on attach.** The apply path already only sets `event.updated_at = now`
   (`cluster.py:240`); `occurred_at` stays the original beat date, keeping the film timeline correct. No code
   change — a regression test pins the invariant.

## Out of scope / explicitly unchanged

- **Story-recency window (`LINK_RECENCY_DAYS`)** — untouched; still selects which pending stories link/cluster.
- **`event_story` membership** stays unbounded. NEU-361's "3" is a display-only source cap in
  `public/service.py` and is unaffected.
- **NEU-365 output truncation (`max_tokens`)** — unaffected. This change grows only the *input* prompt, now
  bounded by `N events × 3 headlines`; the response schema and `max_tokens` are untouched.
- **Trade-off:** a film with more than N lifetime events drops its *oldest* beats (e.g. the original
  announcement) from the prompt. Those are the least likely to be actively re-reported in daily ingest, and
  `LINK_CLUSTER_ATTACH_LIMIT` is the escape hatch if a title needs more.

## Implementation outline

### `src/upmovies/config.py`
Add:
```python
link_cluster_attach_limit: int = Field(default=25, alias="LINK_CLUSTER_ATTACH_LIMIT")
```

### `src/upmovies/link/cluster.py`
- `build_cluster_request`: replace the `recency_days: int` parameter with `attach_limit: int` (the function
  used `recency_days` *only* for the event cutoff). Replace the existing-events query — remove the
  `cutoff`/`timedelta`/`updated_at` filter and select the most-recent N:
  ```python
  select(Event)
      .where(Event.film_id == film_id)
      .order_by(Event.occurred_at.desc(), Event.id.desc())
      .limit(attach_limit)
  ```
  Then reverse the result list (oldest → newest) so the prompt presents events ascending and the 1-based
  positional indices stay stable between the prompt and `apply_cluster_decisions`. `plan.existing_event_ids`
  is built from the same reversed list, so prompt index and apply index remain aligned.
- Per-event headline query: add ordering + a cap (new module constant `_HEADLINES_PER_EVENT = 3`):
  ```python
  select(Story.title)
      .join(EventStory, EventStory.story_id == Story.id)
      .where(EventStory.event_id == event.id)
      .order_by(func.coalesce(Story.published_at, Story.fetched_at).desc())
      .limit(_HEADLINES_PER_EVENT)
  ```
  (`coalesce(published_at, fetched_at)` mirrors the `occurred_at` logic already used in the apply path.)
- `build_cluster_batch_request` and `cluster_film_events`: replace their `recency_days` parameter with
  `attach_limit` and pass it through to `build_cluster_request`.

### `src/upmovies/link/pipeline.py`
- `_cluster_stage_sequential` and `_cluster_stage_batched`: replace the `recency_days` parameter with
  `attach_limit`, passing it to `cluster_film_events` / `build_cluster_batch_request`.
- `run_link_ingest`: **keep** `recency_days` (still drives the story cutoff), **add** an `attach_limit: int`
  parameter, and pass `attach_limit` (not `recency_days`) into the cluster stages.

### `src/upmovies/routers/ingest_admin.py`
- In `_background_link`, pass `attach_limit=settings.link_cluster_attach_limit` into `run_link_ingest`.

## Testing (TDD — write the failing test first)

Unit (`build_cluster_request`):
- An event with `updated_at` older than `LINK_RECENCY_DAYS` (previously excluded) **is** included when it is
  within the most-recent-N set.
- A film with more than N events surfaces only the N most-recent (by `occurred_at`), presented in ascending
  order, with positional indices aligned to `plan.existing_event_ids`.
- An event with more than 3 attached stories contributes at most 3 headlines, most-recent first.

Integration (`session` fixture, real DB):
- A re-report story for a film whose only event is older than the window **attaches** — event count stays 1,
  the existing event's `occurred_at` is unchanged, its `updated_at` is bumped, and no duplicate event is
  created.

All of `task test`, `task lint`, `task typecheck` must be green (run `task format` first).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
