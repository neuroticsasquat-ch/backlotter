# NEU-286 — Stop processing released films (freeze + surface, no new linking/events/spend)

**Ticket:** NEU-286 · **Project:** backlotter: Ingestion & Feeds · **Priority:** Low
**Repo:** `upcoming-movies-backend` · **Date:** 2026-07-02

## Problem

Once a film has released (or is canceled), it should be **frozen**: keep its last
pre-release state forever, stop spending any tokens / API calls on it, and never link new
stories or create new events for it. It must remain **surfaceable via search and direct
URL** — we stop *processing* it, we do not hide it.

Today the read side already behaves correctly, but three processing paths keep spending on
released films:

1. **Per-film news fetch (biggest drain):** `news/fetcher.py:_film_titles` (`:127`) selects
   *all* film titles with no filter and runs a Google News search per title every cycle.
2. **Linking roster:** `link/roster.py:build_roster` (`:56`) is `select(Film)` with no
   `WHERE`, so incoming stories can still link to released films → LLM spend.
3. **Clustering:** only partially guarded — `is_stale_stage` (`link/cluster.py:51-69`) drops
   early-stage beats (casting/announced/production) for released films, but
   trailer / first_look / release_date events are still created.

### Why status alone is insufficient (lifecycle finding)

Existing films' TMDB metadata (including `status`) is refreshed **only** when discovery
returns them (`ingest/tmdb/service.py:55-122` → `upsert_film`). Discovery is
forward-looking only (`primary_release_date.gte = today`, `TMDB_RELEASE_WINDOW_PAST_DAYS=0`),
and there is **no separate refresh cron**. So once a film's `release_date` passes, nothing
re-fetches it and its `status` freezes at whatever it was on the last pre-release capture —
often, but not reliably, `"Released"`. A film that froze at `"Post Production"` would slip
past a pure-status gate and keep costing tokens forever. The deterministic signal that a
film has left the window is `release_date < today`.

> Note: using `release_date` here does **not** violate the locked "status = TMDB-only"
> decision — that decision governs *arc-stage inference from news events*, not gating on
> release dates.

## Goal / acceptance criteria

- **A1.** Inactive films receive **no** per-film Google News search (`_film_titles` excludes
  them).
- **A2.** Inactive films are **not** valid linking targets (`build_roster` excludes them), so
  no new `news.story` link and no new `news.event` can attach to them.
- **A3.** Read paths are unchanged: an inactive film with visible events remains returned by
  `/films/search` and fetchable via `/films/{slug}`. `/calendar` continues to exclude
  past-dated films (already the case).
- **A4.** No backfill, purge, or metadata refresh of existing released films. Forward-looking
  behaviour only; existing rows/links/events are left frozen as-is.

## Design

### "Active film" predicate (shared, NULL-safe)

New canonical helper in `catalog/queries.py`, used by both gates so the definition lives in
exactly one place:

```python
from datetime import date
from sqlalchemy import ColumnElement, and_, or_
from upmovies.catalog.models import Film


def active_film_clause(
    *, today: date, excluded_statuses: frozenset[str]
) -> ColumnElement[bool]:
    """A film is INACTIVE when release_date < today OR status ∈ excluded_statuses.
    This returns the negation (the still-in-play set) for use in a WHERE clause.

    NULL guards: an undated film (release_date IS NULL) is still in play; a film with
    status IS NULL is not terminal. Without them, SQL's `NULL NOT IN (...)` → NULL would
    wrongly drop those rows.
    """
    return and_(
        or_(Film.release_date.is_(None), Film.release_date >= today),
        or_(Film.status.is_(None), Film.status.not_in(excluded_statuses)),
    )
```

- `excluded_statuses` is supplied by callers as `settings.tmdb_excluded_statuses`
  (`{"Released", "Canceled"}`, `config.py:88`) — reusing discovery's terminal-status set
  keeps a single source of truth.
- `today` is passed in (callers compute `datetime.now(UTC).date()`) so the predicate is
  deterministic and injectable in tests.

### Gate 1 — per-film news fetch

`news/fetcher.py:_film_titles` adds the clause to its query:

```python
select(Film.title)
.where(active_film_clause(today=today, excluded_statuses=settings.tmdb_excluded_statuses))
.order_by(Film.title)
```

`_film_titles` reads `settings` and computes `today` locally. Effect: no per-film Google
News search runs for inactive films — the bulk of the ongoing spend, removed upstream.

### Gate 2 — linking roster

`link/roster.py:build_roster` adds the same clause to its `select(Film)` query. Inactive
films drop out of the candidate roster, so a story cannot attach to them and no new event
forms. **Clustering needs no change** — it only runs on films that received newly-linked
stories, which can no longer happen for inactive films. The genre subquery is left as-is
(keyed by `film_id`; any extra rows are harmless lookups).

### Consequences (deliberate)

- A story genuinely about a released film that still gets ingested via general trade feeds is
  link-processed once, finds no roster match, and is rejected / left unlinked — the correct
  outcome. This is a one-time link attempt per such story, not a recurring per-film search.
  The plan must confirm that a story which fails to match is **not** re-processed on
  subsequent link runs (i.e. it leaves the pending set), so there's no retry loop.
- Read endpoints are untouched; `/calendar` already filters `release_date >= today`.

## Testing

- **Predicate** (`active_film_clause`) against the test DB, covering:
  - future-dated + normal status → **active** (included)
  - past-dated (any status) → **inactive** (excluded)
  - undated + `Released` → **inactive** (excluded via status)
  - undated + `NULL` status → **active** (included)
  - `Canceled` + future date → **inactive** (excluded via status)
- **Integration:** `_film_titles` and `build_roster` each exclude seeded inactive films and
  include seeded active ones.
- Update any existing `_film_titles` / `build_roster` tests that assume all films are
  returned.

## Files

- `catalog/queries.py` — **new**, exports `active_film_clause`.
- `news/fetcher.py` — apply clause in `_film_titles`.
- `link/roster.py` — apply clause in `build_roster`.
- Tests under `tests/` for the predicate + both gates.

## Out of scope

Metadata refresh / re-enrichment of released films, pruning or archival of old rows, and any
"released film still gets legit news (box office, awards)" handling. We deliberately freeze
and stop.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
