# NEU-449 — Stop old casting news resurfacing as a new event

- **Ticket:** [NEU-449](https://linear.app/neuroticsasquatch/issue/NEU-449) — "Bug: old casting news resurfaced as new event"
- **Project:** backlotter: Maintenance
- **Related:** NEU-457 (run-date threading — **Done**, enabler), NEU-448 (event grouping/dedup)
- **Date:** 2026-07-01

## Problem

A HOLA article — "Kim Kardashian's son Psalm debut as an actor in upcoming *Angry Birds Movie 3*" — re-circulated **old** casting news and the pipeline minted it as a **new `CASTING` event** on the run date. Expected: re-circulated old casting does not create a new event.

### Root cause

Confirmed as a **staleness** problem, not a dedup problem:

- No prior `CASTING` event existed in the DB for that film (the original casting predates tracking / was never ingested), so there is **nothing to dedup against** — a same-type guardrail would not fire.
- The **LINK recency gate** (`pipeline.py:309`, `cutoff = now − recency_days`) keys on `coalesce(published_at, fetched_at)`. A resurfaced article carries a **fresh publication date**, so it passes the gate and enters the pipeline.
- Detecting "old news" cannot rely on any date field — the article does not state when the original casting happened. The distinguishing signals are (a) the story's **framing** (a soft human-interest / celebrity-family "milestone" recirculation with no new trade-confirmed development), and (b) for an adjacent class, the **film's own timeline** (a film already released should not receive fresh early-production beats).

*Angry Birds Movie 3* is an **upcoming** film (future release date), so a purely timeline-based check does **not** catch this exact repro — only the semantic signal does. The timeline check hardens the adjacent "beat on an already-released film" class.

## Solution

Two complementary guards, each placed at the layer that already owns the relevant decision.

### 1. LINK — semantic recirculation guard (primary; catches the exact repro)

**File:** `src/upmovies/link/linker.py` — prompt text only (`_INSTRUCTIONS`).

Refine the `not-news` / `downstream` definition so the classifier treats a re-report of an already-established beat as not-news:

> A story that re-reports an already-known casting/role (or other prior beat) through a milestone, "debut", celebrity-family, or human-interest angle — adding **no new trade-confirmed development** — is **not-news** (category `downstream`). A fresh publication date does not make it new; use `as_of_date` to reason about recency.

**No code-path change required.** `_NOT_NEWS_CATEGORIES` already contains `"downstream"`, and `apply_link_decisions` already routes a `not-news` decision to `link_status="rejected"` with `link_note="not-news:downstream"`. The story never links, so it never reaches CLUSTER and never mints an event.

### 2. CLUSTER — deterministic timeline backstop (adjacent class)

**File:** `src/upmovies/link/cluster.py`.

Extend the existing `is_stale_stage` (NEU-444) to also drop early-production beats when the film is already out by the run date:

```python
def is_stale_stage(
    event_type: str,
    film_status: str | None,
    release_date: date | None,
    as_of_date: date,
) -> bool:
    ...
```

Stale when `event_type in _STALE_EVENT_TYPES` (`announced / casting / production_start / production_wrap`) **and** either:
- `film_status in _WRAPPED_STATUSES` (`Post Production`, `Released`) — existing condition; **or**
- `release_date is not None and release_date < as_of_date` — the film has already been released by the run date, even if the TMDB `status` string lags.

**Threading.** `is_stale_stage` now needs `release_date` and `as_of_date`:
- Add `film_release_date: date | None` and `run_date: date` to `ClusterPlan`.
- Populate both in `build_cluster_request` (it already receives `run_date`; load `film.release_date` alongside `film.status`).
- `apply_cluster_decisions` passes `plan.film_release_date` and `plan.run_date` into `is_stale_stage`.

Rejected stories keep the current behavior exactly: `link_status="rejected"`, `film_id=None`, `link_confidence=None`, `link_note="stale-stage:{etype}"`, counted in `stories_rejected`. No event is created.

## Testing

### CLUSTER (real regression tests)

- Unit tests on the pure `is_stale_stage`:
  - past `release_date` (`< as_of_date`) + early-production beat → `True`
  - future / `None` `release_date`, non-wrapped status → `False`
  - existing status path (`Post Production` / `Released`) → unchanged `True`
  - non-early-production event types → `False` regardless of dates
- Integration test on `apply_cluster_decisions`: a `casting` group for a film whose `release_date` is in the past is rejected with `link_note="stale-stage:casting"` and mints **no** `Event`.

### LINK (golden eval)

- Add a labeled Psalm-style recirculation item to `tests/fixtures/link/validation_set.json`:
  - `relation="about"`, `expected_film_tmdb_id=<Angry Birds Movie 3>`, `is_production_news=False`, `exclusion_category="downstream"`.
- Run `scripts/validate_linking.py` against the real model to confirm the item is now correctly excluded **and** existing precision/recall/F1 do not regress. Record the before/after numbers in this spec / the PR.

### Full suite

`task test`, `task lint`, `task typecheck` all green before the PR.

## Acceptance criteria

- A re-circulated old casting story does not mint a new event (caught at LINK as `not-news:downstream`).
- A casting/announced/production_start/production_wrap beat for a film whose `release_date` is already past is dropped at CLUSTER as `stale-stage`.
- Regression coverage added at both layers (CLUSTER unit + integration tests; LINK labeled validation fixture).
- No regression in the linking validation metrics.

## Out of scope

- Dedup against existing same-type events (no prior event exists in this case; deferred — relates to NEU-448).
- Extracting the original event date from article bodies.
- Changes to the LINK recency gate (`recency_days`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
