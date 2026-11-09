# NEU-446 — Region-tag release_date events; quiet non-primary-country dates

**Ticket:** [NEU-446](https://linear.app/neuroticsasquatch/issue/NEU-446) — Bug: Release dates for individual countries for movies that already have a release date wrongly categorized as release date announcement
**Project:** backlotter: Maintenance
**Repo:** `upcoming-movies-backend` (single PR, backend-only)
**Date:** 2026-06-30

## Problem

A news story reporting a **country-specific** release date for a film that already has a
release date is surfaced as a full `release_date` news beat on the film page.

Concrete case from the ticket:
- Film: *Moana* (2026) — already has a release date in the catalog.
- Story (Mashable): "July 2026 movie releases **in India**…".
- Extracted event: `[Release date]` "The film is scheduled for release in India in July 2026."

This produces a noisy `release_date` event in the film's news feed. A secondary country's
regional release date is not a meaningful release-date beat for this tracker's audience.

### Root cause

The clustering LLM step (`src/upmovies/link/cluster.py`) classifies any release-date mention
as a `release_date` event. It has **no notion of which country** the date applies to, and the
public film service (`src/upmovies/public/service.py`) surfaces **all** `release_date` events
in the news feed with no region filter. (`release_date` events are also deliberately exempt
from the stale-stage drop, so nothing else filters them.)

The structured `release_dates` block on the film page (from TMDB's `FilmReleaseDate`, already
filtered to US + origin country) is a **separate** concern and is not affected by this bug.

## Decisions

Resolved during brainstorming:

1. **Keep the type, tag the region.** The event stays typed `release_date`; we attach an
   optional region tag and decide surfacing from it. (Not: reclassify to `other`, drop the
   event, or change frontend rendering.)
2. **Surfacing rule is purely region-based.** A `release_date` event is surfaced only when its
   region is `NULL` (global/unspecified) **or** is in the primary set `{US} ∪ film.origin_country`.
   Any other country is quieted, regardless of whether the film already has a date. This applies
   to **every public surface that renders an event** — the film detail page **and** the
   site-wide news feed (plus the sitemap's event-derived `lastmod`) — via one shared predicate.
3. **Detection happens in the existing clustering LLM pass** (no extra LLM call, no rule-based
   country parsing).
4. **Forward-only — no backfill.** Existing events keep `region = NULL` and stay surfaced;
   the live Moana/India beat persists until it ages out naturally.

## Acceptance criteria

- `news.event` has a nullable `region` column holding an ISO 3166-1 alpha-2 code, or `NULL`.
- New `release_date` events created by clustering carry the country the story's date applies
  to (e.g. India → `IN`), or `NULL` for a worldwide/unspecified date.
- Non-`release_date` events always have `region = NULL`, even if the model returns a value.
- The public film news feed omits a `release_date` event when
  `region IS NOT NULL AND region NOT IN ({US} ∪ {origin_country[0]})`.
- `release_date` events with `region IS NULL` or `region` in the primary set are surfaced.
- Non-`release_date` event types are never filtered by this rule.
- Existing rows are unaffected (column nullable, no backfill).

## Design

### Data model — `src/upmovies/news/models.py`

Add to `Event`:

```python
region: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Alembic migration: add the column nullable, no server default, no data backfill. Only
meaningful for `release_date` rows; `NULL` everywhere else. (Follow the repo flow: add the
model column first so tests get it via `create_all`, then `task makemigration`, review, migrate.)

### Classifier — `src/upmovies/link/cluster.py`

**Prompt (`_INSTRUCTIONS`).** Extend the new-event output schema with a `"region"` field.
Instruct, for `release_date` events only: set `"region"` to the ISO 3166-1 alpha-2 code of the
country the date applies to (India → `"IN"`); use `null` when the date is worldwide/global or
no country is stated; use `null` for all non-`release_date` event types. Update the JSON
contract line accordingly.

**`ClusterGroup`.** Add `region: str | None`.

**`parse_cluster_groups`.** Read `group.get("region")`; keep it only when it matches
`^[A-Za-z]{2}$`, upper-cased; otherwise `None`. Fail-open: an invalid or full-name value
becomes `None` (the event then surfaces — never crashes the parse).

**`apply_cluster_decisions`.** When creating a new `Event`, set
`region = group.region if etype == "release_date" else None`. The `existing`-attach branch does
not touch region (region belongs to the originating beat). Both the synchronous
(`cluster_film_events`) and Batch-API (`build_cluster_batch_request`) paths route through
`apply_cluster_decisions`, so both are covered by this single change.

### Surfacing — `src/upmovies/public/service.py`

Add a region-aware SQL predicate next to the existing `_visible_events()` type filter, requiring
that `Film` is in the query:

```python
def _region_visible() -> ColumnElement[bool]:
    return or_(
        Event.event_type != "release_date",
        Event.region.is_(None),
        Event.region == "US",
        Event.region == any_(Film.origin_country),
    )
```

Apply it (alongside `_visible_events()`) to every read that surfaces individual events:
- `get_film_detail` — add `.join(Film, Film.id == Event.film_id)` and `_region_visible()` to the
  events query.
- `get_feed` (both the count and the rows query) and `get_feed_grouped` — already join `Film`;
  add `_region_visible()` to their `.where(...)`.
- `get_sitemap_films` — already joins `Film`; add `_region_visible()`.

`region = ANY(NULL)` evaluates to NULL → false, so a film with no `origin_country` still surfaces
only `US`/global release_date events. `EventOut`/`FeedItem` DTOs are unchanged — quieted events
are simply not selected. **No frontend change.** The film index/arc-stage query (which derives
`arc_stage` from all event types, not individual beats) is intentionally left untouched.

## Testing (TDD)

- `parse_cluster_groups`: extracts a valid alpha-2 region and upper-cases it; maps
  missing / invalid / full-country-name values to `None`.
- `apply_cluster_decisions`: persists `region` on a `release_date` event; forces `None` on a
  non-`release_date` event even when the model returns a region; `existing`-attach leaves
  region untouched.
- `public/service.py`: a foreign-country `release_date` event is omitted from **both** the film
  detail page and the site-wide feed (Moana/India case); `region = NULL` is surfaced; `US` /
  origin-country regions are surfaced; other event types are never filtered; a film with no
  `origin_country` still surfaces `US`/global but omits foreign release_date events.
- Migration: column is nullable; pre-existing rows read back `NULL`.

Before claiming done: `task test`, `task lint`, `task typecheck` green; `task format` applied;
`alembic upgrade head` clean against a fresh DB.

## Out of scope

- Backfilling region onto existing events.
- Any new event type or confidence value.
- Frontend / DTO changes.
- The structured TMDB `release_dates` block (already region-filtered; unrelated).
