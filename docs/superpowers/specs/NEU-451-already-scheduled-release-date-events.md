# NEU-451 — Stop already-scheduled films getting spurious release-date events

- **Ticket:** [NEU-451](https://linear.app/neuroticsasquatch/issue/NEU-451) — "Bug: Film already scheduled for release in two days incorrectly given release day event"
- **Project:** backlotter: Maintenance
- **Related:** NEU-457 (run-date threading — **Done**, enabler; `as_of_date` already in all three prompts), NEU-449 (old casting resurfacing — same two-layer shape, template), NEU-453 (trailer vs. release-date tense; uses `off_topic` as a CLUSTER drop backstop)
- **Date:** 2026-07-01

## Problem

*Alpha* (Alia Bhatt) is already dated **Jul 10 2026** in the catalog. The pipeline minted a new `release_date` event ("scheduled to release in July 2026") from **three weekly-release-calendar listicles** — Esquire India, Filmibeat "This Week's OTT & Movie Releases", MSN "Upcoming July 2026 releases". **None of them announces a release date**; each is a calendar listicle where the tracked film is one entry among many. Expected: such listicles do not mint an event, and a film's already-known release date is not re-announced.

### Root cause

Two co-causes, one per layer:

- **LINK** classified the listicles as `about` → a production beat, instead of `not-news` / `roundup`. The `roundup` not-news category already exists and already names "everything we know so far" roundups and aggregators, but it does not reliably catch **periodic release-calendar listicles** (a multi-film list where the tracked film appears as one row). These slip through as `about`.
- **CLUSTER** then minted a `release_date` event from a non-announcement — it has no notion that the film's release date is already known, so a story merely restating it reads as a fresh beat.

The `as_of_date` temporal anchor is already present in both prompts (NEU-457 threaded `run_date` into LINK/CLUSTER/SUMMARIZE and left the behavioral reasoning to the downstream tickets — its spec explicitly defers "CLUSTER already-scheduled / release-day reasoning — NEU-451" to here). So this ticket is **behavioral prompt-wording plus one small payload addition** — no new date plumbing.

## Solution

Two complementary guards, each at the layer that owns the decision (mirrors NEU-449). One backend PR. No migration, no DTO/public-shape change, no frontend change.

### 1. LINK — strengthen roundup / listicle detection (primary; catches the exact repro)

**File:** `src/upmovies/link/linker.py` — `_INSTRUCTIONS` text only.

Extend the `roundup` not-news definition to explicitly cover periodic release-calendar listicles:

> A periodic release-calendar listicle — "This Week's / This Month's (OTT &) movie releases", "Upcoming <month> releases", or any multi-film list where the tracked film appears as **one entry among many** — is not-news (category `roundup`), **even when it states a release date**. A calendar listicle restating a film's scheduled date is not a release-date announcement. Use `as_of_date`: a date the film already holds, at or near today, is not a new development.

**No code-path change required.** `"roundup"` is already in `_NOT_NEWS_CATEGORIES`, and `apply_link_decisions` already routes a `not-news` / `roundup` decision to `link_status="rejected"` with `link_note="not-news:roundup"`. The story never links, so it never reaches CLUSTER and never mints an event. This alone kills the *Alpha* repro.

### 2. CLUSTER — already-scheduled backstop (defense-in-depth)

**Files:** `src/upmovies/link/cluster.py` (+ the `scripts/validate_clustering.py` harness call site).

The film's exact known release date is not currently in the CLUSTER prompt (only its **year**, via `film_year`). Add it so the model can recognize a restatement, and add a wording line.

**Payload addition:**

- `assemble_cluster_payload(..., film_release_date: date | None)` — render the `film` object as `{"title", "year", "release_date": <ISO YYYY-MM-DD or null>}`.
- `build_cluster_request` already loads `film.release_date` (it derives `film_year` from it and already stores it on `ClusterPlan.film_release_date` from NEU-449). Pass `film.release_date` through to `assemble_cluster_payload`.
- The CLUSTER system block is a plain (non-cached) block, so adding a user-payload field has no cache implications.

**Wording line** (`_INSTRUCTIONS`):

> A `release_date` event requires a story announcing a **new or changed** release date. A story that merely restates the film's already-known `release_date` (given in the payload), or lists it in a calendar / roundup context, is **not** a new `release_date` beat. When a story's only "release date" content is a restatement of the known date, put it in its own group with `"type": "off_topic"` and `"confidence": null` so it is dropped rather than recorded.

**Drop mechanism — reuse `off_topic`.** Decided: the model routes a restatement to the existing `off_topic` chute. `apply_cluster_decisions` already handles `off_topic` groups: `link_status="rejected"`, `film_id=None`, `link_confidence=None`, `link_note="off-topic"`, counted in `stories_rejected`, no event created. This matches how NEU-453 uses `off_topic` as a semantic drop backstop and requires **no new code path** in `apply_cluster_decisions`. (The `off-topic` note is slightly generic for triage, but a dedicated note was judged not worth the extra code/test for a backstop that should rarely fire once LINK catches these.)

This backstop is **semantic** (model-driven). There is no deterministic date comparison: events store no date value, and the repro's date (Jul 10) is in the *future*, so the existing `is_stale_stage` past-date check (`release_date < as_of_date`) does not fire. Deterministic date extraction is explicitly out of scope (see below).

## Testing

### LINK (golden eval)

- Add the three *Alpha* listicles as labeled items to `tests/fixtures/link/validation_set.json`:
  - `relation="about"` target = *Alpha*'s roster film, `is_production_news=False`, `exclusion_category="roundup"`.
- Run `scripts/validate_linking.py` against the real model to confirm the items are now excluded **and** existing precision / recall / F1 do not regress. Record before/after numbers in this spec / the PR.
- Unit assertion (`tests/unit/link/test_linker.py`): the new roundup/listicle wording is present in `_INSTRUCTIONS`.

### CLUSTER

- Unit test (`tests/unit/link/test_cluster_pure.py`): `assemble_cluster_payload` renders `film.release_date` as an ISO string (and `null` when the film has no release date). Assert the new wording line is present in `_INSTRUCTIONS`.
- Thread-through: `build_cluster_request` passes `film.release_date` into the payload (light assertion on the built user message).
- Behavioral (restatement → dropped as `off_topic`) is verified via the `scripts/validate_clustering.py` eval harness, since it is model-driven; add a restatement case to the harness fixtures if one is not already representative.

### Full suite

`task test`, `task lint`, `task typecheck` all green (`task format` applied) before the PR.

## Acceptance criteria

- The three *Alpha* weekly-release-calendar listicles classify as `not-news` / `roundup` at LINK and mint no event (exact repro fixed).
- A `release_date` group that merely restates a film's already-known `release_date` is dropped at CLUSTER as `off_topic` (no event created).
- The film's known `release_date` is present in the CLUSTER user payload.
- Regression coverage added at both layers (LINK labeled validation fixture + wording unit assertion; CLUSTER payload/wording unit tests + harness case).
- No regression in the linking validation metrics.

## Out of scope

- Deterministic date extraction / an event-date field so CLUSTER can compare dates programmatically (overlaps NEU-448 dedup; the guard here is semantic).
- Dedup against existing same-type `release_date` events (NEU-448).
- Changes to the LINK recency gate (`recency_days`) or to `is_stale_stage`.
- Any migration, DTO / public-shape change, or frontend change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
