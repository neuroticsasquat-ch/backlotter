# NEU-437 — Add thumbnail poster, director, first 3 stars, and genres to release calendar

**Ticket:** [NEU-437](https://linear.app/neuroticsasquatch/issue/NEU-437) · Project: backlotter: Maintenance · Label: backlotter
**Status of data:** All four fields already exist in the database and are actively ingested from TMDB. **No DB migrations are required.**

## Problem / Goal

The public release calendar (`GET /calendar`, rendered at `/calendar`) currently lists each upcoming film as a bare text link showing only **Title (year)**, grouped by release date and release type. Users can't tell films apart at a glance.

Enrich each calendar film row with:

- **Poster thumbnail** — already plumbed end-to-end (`poster_path` in DTO and FE type), just not rendered.
- **Director(s)** — not yet exposed by the calendar endpoint.
- **First 3 stars (cast)** — names only; not yet exposed.
- **Genres (up to 3)** — not yet exposed.

Lay these out as a **poster-left media row** that preserves the existing date-grouped list structure.

## Acceptance Criteria

- `GET /calendar` response items include `director`, `stars`, and `genres` (alongside the existing `poster_path`).
- The calendar page renders, for each film: poster thumbnail on the left; to its right — title (year) link, director line, stars line, genres line.
- Stars are capped at **3**, names only, ordered by billing (`credit_order`, then name).
- Genres are capped at **3**, ordered by name.
- Director shows all credited directors joined with `", "` (co-directors handled).
- Graceful omission when data is absent (see Edge Cases). The film row and its title link always render.
- Backend and frontend test suites are extended and pass; full local CI passes in both repos before each PR.

## Design

### Layout (frontend) — poster-left media row

```
DATE: Fri, Dec 18, 2026  (WIDE)
┌──────────────────────────────────────────────┐
│ ┌────┐  Dune: Part Three (2026)               │
│ │ ▥▥ │  Dir. Denis Villeneuve                  │
│ │ ▥▥ │  T. Chalamet · Zendaya · F. Pugh        │
│ └────┘  Sci-Fi · Adventure · Drama            │
└──────────────────────────────────────────────┘
```

Date-grouped sections and ordering are unchanged; only the per-film row component changes from a single text link to this media row.

### Backend — `upcoming-movies-backend`

**DTO** (`src/upmovies/public/dto.py`, `CalendarItem`) — add three fields:

| Field | Type | Meaning |
|-------|------|---------|
| `director` | `str \| None` | Credited director(s): `credit_type='crew'`, `department='Directing'`, `job='Director'`, ordered by `credit_order`, joined with `", "`. `None` when no director. |
| `stars` | `list[str]` | First 3 cast names: `credit_type='cast'`, ordered by `credit_order` (nulls last) then `name`. Empty list when none. |
| `genres` | `list[str]` | Up to 3 genre names ordered by name. Empty list when none. |

`poster_path` already exists in the DTO — no change.

**Service** (`src/upmovies/public/service.py`, `get_calendar()`):

- Pagination remains by **distinct release dates**; the existing query, joins, grouping, and ordering (release_date ASC, release_type DESC, popularity DESC, slug ASC) are preserved.
- Populate the three new fields **without multiplying calendar rows**, using correlated `array_agg` subqueries — the same approach already used in `get_feed_grouped` (`service.py` ~line 575) — with `LIMIT`/slice to cap stars and genres at 3.
  - Director: aggregate director names (ordered by `credit_order`) and join in the DTO mapping, or aggregate to an array and join with `", "`.
  - Stars: top-3 cast names by `credit_order`.
  - Genres: up to 3 genre names by name.
- Reference implementations for the underlying joins already exist in `get_film_detail` (cast/crew at ~411–440; genres at ~353–364).

### Frontend — `upcoming-movies-frontend`

**Types** (`src/api/types.ts`, `CalendarItem`) — add:

```ts
director: string | null;
stars: string[];
genres: string[];
```

**Component** (`src/components/calendar/CalendarFilmRow.tsx`) — rewrite as the poster-left media row:

- Poster thumbnail via the existing helper `posterUrl(poster_path, "w92")` (`src/lib/poster.ts`).
- Right column: title (year) link (existing behavior), then `Dir. {director}`, then `stars.join(" · ")`, then `genres.join(" · ")`.
- Reuse existing styling conventions; keep the zebra/row separation behavior from the current list.

No new fetching or routing changes — the calendar still fetches via `getCalendar()` (`src/api/public.ts`) hitting `GET /calendar`.

### Edge Cases (graceful omission)

- **No poster** (`poster_path` null): render a neutral placeholder box so the row stays aligned; do not break layout.
- **No director**: omit the `Dir.` line entirely.
- **No stars** (empty list): omit the stars line.
- **No genres** (empty list): omit the genres line.
- Title link always renders regardless of missing metadata.

## Testing

**Backend** — extend `tests/integration/routers/test_public_calendar.py`:
- Director present (single + co-directors joined), stars capped at 3 in billing order, genres capped at 3.
- No-data cases: film with no director / no cast / no genres yields `null` / `[]` respectively, and the calendar row count is unaffected (no row multiplication).

**Frontend** — extend `src/components/calendar/CalendarFilmRow.test.tsx`:
- Renders poster (and placeholder when `poster_path` is null), director line, stars line, genres line.
- Omits each line when its data is absent; title link always present.

**CI gate:** run the full local pipeline in each repo before pushing (BE: alembic heads + pytest; FE: `tsc -b` + eslint + vitest).

## Linear Work Breakdown

Split NEU-437 into two sub-issues (1 ticket = 1 PR), assignee Tom, "Story" label on NEU-437 as the parent:

1. **Backend** — add `director`/`stars`/`genres` to `CalendarItem` DTO + `get_calendar()` query + tests.
2. **Frontend** — add fields to `CalendarItem` type + rewrite `CalendarFilmRow` as poster-left media row + tests. **Blocked by** the backend ticket.

## Out of Scope

- No DB schema or migration changes.
- No changes to calendar pagination, date grouping, ordering, or scoping rules.
- No name-+-character display for stars (names only).
- No changes to other surfaces (film detail, feed, search).
