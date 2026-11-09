# NEU-364 — Per-film-per-day grouping mode for the public feed (design)

- **Ticket:** [NEU-364](https://linear.app/neuroticsasquatch/issue/NEU-364) `[backend]` — Per-film-per-day grouping mode for the public feed
- **Project / milestone:** Movies: Content Quality · MVP Quality Bar
- **Parent story:** [NEU-363](https://linear.app/neuroticsasquatch/issue/NEU-363) (Home feed shows one card per film per day)
- **Blocks:** [NEU-362](https://linear.app/neuroticsasquatch/issue/NEU-362) `[frontend]` (renders the grouped cards)
- **Date:** 2026-06-23
- **Repo:** `upcoming-movies-backend`
- **Branch:** `tom/neu-364-backend-per-film-per-day-grouping-mode-for-the-public-feed`
- **Scope:** one backend PR, no DB migration.

## Problem

The public `/feed` (`public/service.py` → `get_feed`) returns one item **per event**. A film
with many events in a day produces many feed rows and dominates the home feed. The home feed
needs one record per **(film, day)** so it reads as "which films have news", with a click-through
to each film's timeline.

The frontend consumer (NEU-362) wants a deliberately minimal card: film title + poster, the day's
most-significant event type (or "N updates"), and a link to `/film/{slug}`. No summary or source
citations are needed on the grouped card.

## Decisions (Tom approved)

1. **New endpoint, not a mode.** A dedicated `GET /feed/grouped` with its own DTO, rather than a
   `?groupBy=` param on `/feed`. Keeps the per-event `/feed` untouched and avoids a union
   `response_model`; matches the codebase's one-purpose-per-function style.
2. **Day = UTC date of `event.created_at`** (the "updated today" / ingest axis). Consistent with
   `/feed`'s `created_at desc` ordering and the already-merged frontend `groupByDay` helper, which
   buckets on `created_at`. (Not `occurred_at` — that would diverge from the per-event feed and the
   shipped FE grouping.)
3. **SQL grouping + a pure significance ranker.** One grouped SQL query does the (film, day)
   bucketing, count, and pagination at the DB (like `get_feed`); a pure Python helper picks the
   day's most-significant event type from the set of types in the group, reusing `arc.py`'s
   ordering so there is no divergent ranking.
4. **Minimal payload.** No `summary`, no `sources`, no `confidence` on the grouped item — a
   (film, day) group has no single confidence, and the consumer card doesn't need the rest. Easy
   to extend later.
5. **No DB migration, no change to `/feed`, no extra recency filter** (the ingest pipeline already
   prunes to recency windows upstream).

## Contract

New route in `routers/public.py`, alongside the existing public routes:

```
GET /feed/grouped?limit=50&offset=0
```

- `limit`: `Query(default=50, ge=1, le=100)` — same bounds as `/feed`/`/films`.
- `offset`: `Query(default=0, ge=0)`.

New DTOs in `public/dto.py`:

```python
class FeedDayItem(BaseModel):
    film_slug: str
    film_title: str
    poster_path: str | None
    day: date              # UTC calendar date → serializes as "2026-06-23"
    top_event_type: str    # raw event_type (e.g. "release_date"); FE reuses labels.ts
    event_count: int       # number of summarized events for that (film, day)


class FeedDayResponse(BaseModel):
    items: list[FeedDayItem]
    total: int             # number of (film, day) groups
    limit: int
    offset: int
```

`day` is a `date` (not a datetime): it serializes to `"YYYY-MM-DD"`, which the FE can group on
directly with its existing UTC day-heading helpers.

## Grouping semantics

- **One row per (film, day)**, where `day = date(timezone('UTC', event.created_at))`.
- **Inclusion rule identical to `get_feed`:** a group counts only events that have an
  `event_summary` (`INNER JOIN news.event_summary`) and whose film has `slug IS NOT NULL`.
  `event_count` is the number of those summarized events on that day.
- **`top_event_type`** = the day's most-significant event type, by the existing arc ordering.
- A film with summarized events on two different UTC days → **two rows**.
- A film with no summarized events on a given day → **absent** for that day.

### Most-significant event type (significance ranking)

Reuses `public/arc.py`'s existing ordering — no new ranking. The event-type ranks, derived from
`_EVENT_STAGE` → `_RANK`:

```
announced < casting < production_start < production_wrap < release_date < trailer
```

`other` has no arc stage, so it ranks **below `announced`** (lowest). The day's `top_event_type`
is the highest-ranked type present. An `other`-only day yields `top_event_type == "other"`. Each
non-`other` event_type maps to a distinct rank, so the result is deterministic; ties are only
possible among multiple `other` events (all collapse to `"other"`).

## Ordering & pagination

```
ORDER BY day DESC, last_created_at DESC, film.slug ASC
```

- `day DESC` — newest day first.
- `last_created_at DESC` (= `max(event.created_at)` within the group) — within a day, the film
  whose most recent event landed latest floats up.
- `film.slug ASC` — deterministic final tiebreak.

`limit`/`offset` paginate over the (film, day) rows in SQL. `total` is the number of (film, day)
groups — `COUNT(*)` over the grouped query without limit/offset.

## Implementation

All Postgres-specific SQL is acceptable: tests run against real Postgres (`TEST_DATABASE_URL`,
`pgcrypto`/`citext`) and prod is Postgres.

### `public/arc.py` — add a pure ranker

```python
def most_significant_event_type(event_types: Iterable[str]) -> str:
    """Return the most-significant event_type from a non-empty group, reusing the arc ordering.
    event_types not in _EVENT_STAGE (i.e. 'other') rank below 'announced'."""
```

Implementation: rank each type as `_RANK[_EVENT_STAGE[t]]` when mapped, else `-1`; return the
`event_type` with the maximum rank. Returns a raw `event_type` value (e.g. `"release_date"`), not
an arc stage. (Assumes a non-empty input — the service only calls it for non-empty groups.)

### `public/service.py` — add `get_feed_grouped`

```python
async def get_feed_grouped(session, *, limit: int, offset: int) -> FeedDayResponse: ...
```

Grouped query (one statement; `day_col = func.date(func.timezone("UTC", Event.created_at))`):

```sql
SELECT f.slug, f.title, f.poster_path,
       date(timezone('UTC', e.created_at))   AS day,
       count(*)                              AS event_count,
       array_agg(DISTINCT e.event_type)      AS event_types,
       max(e.created_at)                     AS last_created_at
FROM news.event e
JOIN news.event_summary es ON es.event_id = e.id
JOIN catalog.film f        ON f.id = e.film_id
WHERE f.slug IS NOT NULL
GROUP BY f.id, f.slug, f.title, f.poster_path, date(timezone('UTC', e.created_at))
ORDER BY day DESC, last_created_at DESC, f.slug ASC
LIMIT :limit OFFSET :offset
```

For each row, `top_event_type = most_significant_event_type(row.event_types)`. `array_agg`
returns a Python list (asyncpg), and the ranker is order-independent, so the unordered
`array_agg(DISTINCT …)` is fine.

`total`: `select(func.count()).select_from(<grouped subquery>)` — the same grouping without
`ORDER BY`/`LIMIT`/`OFFSET`.

### `routers/public.py` — add the route

```python
@router.get("/feed/grouped", response_model=FeedDayResponse)
async def get_feed_grouped(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> FeedDayResponse:
    return await service.get_feed_grouped(session, limit=limit, offset=offset)
```

## Tests

### Unit — `tests/unit/public/test_arc.py` (extend)

`most_significant_event_type`:
- full ordering (`trailer` beats `release_date` beats … beats `announced`);
- `other` ranks below `announced` (a `{announced, other}` set → `"announced"`);
- `other`-only set → `"other"`;
- single-element set → that element;
- mixed/duplicate sets resolve to the highest-ranked type.

### Integration — `tests/integration/routers/test_public_feed_grouped.py` (new)

- one row per (film, day); `event_count` and `top_event_type` correct for the day;
- same film with events on two different UTC days → two rows;
- newest-day-first ordering; within-day ordering by latest event time, slug tiebreak;
- pagination: `limit`/`offset` slice the (film, day) rows; `total` = group count;
- only summarized events counted (an event with no `event_summary` doesn't create/contribute to a
  group);
- films with `slug IS NULL` excluded;
- empty DB → `items == []`, `total == 0`;
- UTC day boundary: events at `23:59Z` and `00:01Z` the next day → two groups.

## Acceptance criteria mapping

| AC (from NEU-364) | Covered by |
| --- | --- |
| Endpoint returns one record per (film, day), newest day first, paginated by film-day | `GET /feed/grouped`; `ORDER BY day DESC, …`; SQL `LIMIT/OFFSET` over groups; `total` = group count |
| Most-significant event type and event count correct for the day | `most_significant_event_type` over `array_agg(DISTINCT event_type)`; `count(*)` = `event_count` |
| Reuses the existing event-type significance ordering (no divergent ranking) | Ranker built on `arc.py`'s `_EVENT_STAGE`/`_RANK` |
| Only films with ≥1 summarized event that day appear | `INNER JOIN news.event_summary` + `slug IS NOT NULL` |
| Unblocks NEU-362 (FE renders grouped cards) | `FeedDayItem` carries slug/title/poster/day/top_event_type/event_count |

## Non-goals

- No change to the per-event `GET /feed`.
- No DB migration (no schema change).
- No `summary`/`sources`/`confidence` on the grouped item.
- No recency filtering beyond what the ingest pipeline already applies.
- Frontend rendering is NEU-362.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
