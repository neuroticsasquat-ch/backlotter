# M2 — Polish existing pages (milestone design)

- **Project / milestone:** Movies: MVP Launch Polish · **M2 — Polish existing pages**
- **Date:** 2026-06-25
- **Repos:** `upcoming-movies-backend`, `upcoming-movies-frontend`
- **Stories & tickets:**
  - Story [NEU-386](https://linear.app/neuroticsasquatch/issue/NEU-386) — *Event dates are consistent between the home feed and film pages*
    - [NEU-394](https://linear.app/neuroticsasquatch/issue/NEU-394) `[backend]` — `get_film_detail` orders + exposes events by `created_at`
    - [NEU-395](https://linear.app/neuroticsasquatch/issue/NEU-395) `[frontend]` — film timeline groups/labels/orders by `created_at` (blocked by NEU-394)
  - Story [NEU-387](https://linear.app/neuroticsasquatch/issue/NEU-387) — *Film page shows all known basic info*
    - [NEU-396](https://linear.app/neuroticsasquatch/issue/NEU-396) `[backend]` — film-detail DTO/service exposes already-captured film metadata
    - [NEU-397](https://linear.app/neuroticsasquatch/issue/NEU-397) `[frontend]` — render a core-info section on `/film/{slug}` (blocked by NEU-396)
- **Scope shape:** four PRs — one per ticket, branch per ticket (Linear-provided). The two FE tickets each wait on their BE ticket's merged DTO.

## Purpose & scope

The two already-shipped public pages — the grouped home feed (`/`) and the film page
(`/film/{slug}`) — are functional but have two rough edges this milestone smooths:

1. **The two surfaces disagree on an event's date.** The home feed orders and day-groups events by
   `news.event.created_at` (the ingest/"updated-on" axis); the film page orders and groups by
   `news.event.occurred_at` (the beat's editorial date). The same event can therefore appear under
   different days on the feed vs. the film page, which is confusing when a user clicks through from
   one to the other. **Story NEU-386** makes `created_at` the single display-date basis everywhere,
   so the film page matches the feed.
2. **The film page is information-thin.** `catalog.film` already persists a rich TMDB record
   (overview, tagline, runtime, genres, rating, backdrop, language, production companies, collection,
   full `tmdb_raw`), but the film-detail DTO surfaces only `slug/title/release_date/release_year/
   poster_path/arc_stage` + the event log. **Story NEU-387** widens the DTO to the already-captured
   basics and renders a clean core-info section — **no new ingestion, no migration**.

In scope: `public/service.py`, `public/dto.py`, and their tests (backend); the film route +
timeline + `FilmDetail` type + a new/extended core-info section and their tests (frontend).
Out of scope: see the final section.

## Architecture & approach

### Story NEU-386 — make `created_at` the single display date

#### NEU-394 `[backend]` — `get_film_detail` orders + exposes events by `created_at`

`get_film_detail` (`src/upmovies/public/service.py`) currently:

- orders the summarized-events query by **`Event.occurred_at.asc(), Event.id.asc()`**
  (service.py ~line 111), and
- builds each `EventOut` with **`occurred_at=event.occurred_at`** (~line 133).

Both switch to `created_at`:

- **Order:** `.order_by(Event.created_at.asc(), Event.id.asc())` — same ascending shape the FE
  timeline already relies on (it reverses to newest-first), just on the `created_at` axis. This now
  matches the feed (`get_feed` orders `Event.created_at.desc()`; `get_feed_grouped` buckets on
  `date(timezone('UTC', Event.created_at))`).
- **DTO field:** `EventOut` (`public/dto.py`) **renames `occurred_at: datetime` → `created_at:
  datetime`** and the service sets `created_at=event.created_at`. `EventOut` is consumed only by the
  film-detail response, so this is a contained rename; the per-event `FeedItem` (which already
  carries *both* `occurred_at` and `created_at`) is untouched.

**Why rename rather than add a second field:** the explicit goal of NEU-386 is that the two surfaces
can no longer disagree. `occurred_at` has no remaining consumer on the film page after the switch
(the FE used it only for grouping, ordering, the `<time>` label, and the meta "latest summary"
pick — all moving to `created_at` in NEU-395). Keeping a now-unused `occurred_at` on `EventOut`
would invite the FE to accidentally reintroduce the divergence. The column stays on the `Event`
model (the feed still exposes it on `FeedItem`); only the *film-detail event DTO* drops it.

Integration tests (`tests/integration/routers/test_public_films.py`): the existing detail tests set
`occurred_at` per event and assert chronological ordering by it; they must be reworked to drive
ordering via `created_at` and assert the response key is `created_at`. Note `add_event` defaults
`created_at` to `now()` (server default) unless set, so tests that need a deterministic order must
pass explicit `created_at` values (confirm the `add_event` fixture accepts/forwards `created_at`;
extend it if not). Keep the unrelated assertions (summary, sources cap, outlet label,
`other`-exclusion, summary-less omission) intact.

#### NEU-395 `[frontend]` — timeline groups/labels/orders by `created_at`

Driven entirely by the renamed DTO field. Touch points:

- **`src/api/types.ts`** — `FilmEvent.occurred_at: string` → `created_at: string`.
- **`src/lib/feed-groups.ts`** — `groupEventsByDay` buckets on `dayKey(event.occurred_at)` →
  `dayKey(event.created_at)`. Update the docstring that says "ascending by `occurred_at` (the order
  `GET /films/{slug}` returns)" to reference `created_at`. (The reverse-a-copy → bucket-adjacent
  algorithm is unchanged and still deterministic for SSR.)
- **`src/components/film/EventTimeline.tsx`** — the React `key` `${event.event_type}-${event.occurred_at}-${i}`
  → `${event.event_type}-${event.created_at}-${i}`.
- **`src/components/film/EventCard.tsx`** — the `<time dateTime={event.occurred_at}>` /
  `formatEventDate(event.occurred_at)` → `event.created_at`.
- **`src/routes/film.tsx`** — the `meta()` "latest summary" pick sorts `film.events` by
  `occurred_at` to grab the newest summary for the description; switch the sort key to `created_at`
  (and update the inline comment). This keeps the meta description aligned with what the timeline
  now shows as "newest".
- **Tests** — `EventTimeline.test.tsx` (the `makeEvent` factory + per-test overrides use
  `occurred_at`), `EventCard.test.tsx`, and `film.test.tsx` switch their fixtures/assertions to
  `created_at`. Behavior (newest-day-first grouping, within-day newest-first, day headings) is
  unchanged — only the field name moves.

No visual change ships here: same grouping algorithm, same headings, same card. The only
observable difference is *which* timestamp drives the day a given event lands under — now identical
to the feed.

### Story NEU-387 — surface the already-captured film basics

#### NEU-396 `[backend]` — widen the film-detail DTO + service

`catalog.film` already holds everything below (verified in `catalog/models.py`); the ingest upsert
(`ingest/tmdb/upsert.py`) already populates the genre/company/collection join + reference tables
(rebuilt per ingest). **No migration, no ingestion change** — this ticket is purely read-path.

Add to **`FilmDetailResponse`** (`public/dto.py`), every field nullable / empty-defaulted so the FE
can omit cleanly:

| DTO field | Source | Notes |
| --- | --- | --- |
| `overview: str \| None` | `Film.overview` | TMDB synopsis |
| `tagline: str \| None` | `Film.tagline` | short marketing line |
| `runtime: int \| None` | `Film.runtime` | minutes; FE formats `2h 15m` |
| `genres: list[str]` | `Genre.name` via `FilmGenre` | empty list when none |
| `vote_average: float \| None` | `Film.vote_average` | TMDB 0–10 rating |
| `vote_count: int \| None` | `Film.vote_count` | gates rating display (0 ⇒ unrated) |
| `original_language: str \| None` | `Film.original_language` | ISO-639-1 code |
| `backdrop_path: str \| None` | `Film.backdrop_path` | TMDB image path (FE builds the URL) |
| `production_companies: list[str]` | `ProductionCompany.name` via `FilmProductionCompany` | empty list when none |
| `collection: CollectionOut \| None` | `Collection` via `Film.collection_id` | new nested DTO: `{ name: str }` (optionally `poster_path`) |

`release_date`/`release_year`/`poster_path`/`arc_stage`/`events` stay as-is. A small nested
`CollectionOut(BaseModel)` carries the collection name (the franchise label, e.g. "The Lord of the
Rings Collection").

**How the joins are loaded (service `get_film_detail`):** there are **no ORM `relationship()`s** on
`Film` — the model declares FK columns and standalone association tables only, and the whole service
already reads via explicit `select(...)` statements. Stay consistent: after fetching the `Film` row,
add a few small scoped `select`s keyed by `film.id`:

```python
genres = (await session.execute(
    select(Genre.name)
    .join(FilmGenre, FilmGenre.genre_id == Genre.id)
    .where(FilmGenre.film_id == film.id)
    .order_by(Genre.name.asc())
)).scalars().all()

companies = (await session.execute(
    select(ProductionCompany.name)
    .join(FilmProductionCompany, FilmProductionCompany.company_id == ProductionCompany.id)
    .where(FilmProductionCompany.film_id == film.id)
    .order_by(ProductionCompany.name.asc())
)).scalars().all()

collection = None
if film.collection_id is not None:
    collection = (await session.execute(
        select(Collection).where(Collection.id == film.collection_id)
    )).scalar_one_or_none()
```

These run once per film-detail request (the page is one film), so the extra round-trips are cheap;
no batching like `_event_types_by_film` is needed. Order genres/companies by name for a stable,
deterministic payload (SSR/snapshot-friendly). The scalar `Film` fields (`overview`, `tagline`,
`runtime`, `vote_average`, `vote_count`, `original_language`, `backdrop_path`) are already on the
fetched row — just pass them through to the DTO.

Integration tests: extend `test_public_films.py` to assert the new fields round-trip (genres/company
ordering, collection present vs. `None`, rating fields, and that a film with none of the optional
metadata returns nulls/empty lists rather than erroring). The `make_film` fixture will likely need
to accept the new columns + helpers to attach genres/companies/a collection; extend it minimally.

#### NEU-397 `[frontend]` — render a core-info section, omitting nulls

- **`src/api/types.ts`** — extend `FilmDetail` to mirror the new DTO (`overview`, `tagline`,
  `runtime`, `genres: string[]`, `vote_average`, `vote_count`, `original_language`,
  `backdrop_path`, `production_companies: string[]`, `collection: { name: string } | null`).
- **Rendering** — add a focused core-info block (either extend `FilmHeader.tsx` or add a sibling,
  e.g. `FilmMeta.tsx`, rendered from `film.tsx` between the header and the timeline). It surfaces:
  tagline (italic, under the title), a meta line (release date · runtime · genres ·
  original-language), the rating (`vote_average` shown only when `vote_count` is non-null and `> 0`
  — TMDB returns `0.0 / 0` for unrated upcoming films, so guard on `vote_count`), production
  companies, and collection. The overview paragraph renders below. **Every field is null-/empty-
  guarded** (the existing `{film.release_year && …}` pattern in `FilmHeader`): a film missing a
  field simply omits that line — no empty labels, no `null`, no dangling separators. Reuse
  `posterUrl`-style helpers for the backdrop if it's shown.
- **Tests** — a component test covering: all-fields-present renders each line; missing fields are
  omitted (no label, no separator); `vote_count === 0` hides the rating. The existing
  `FilmHeader.test.tsx` and `film.test.tsx` extend rather than rewrite.

Keep it visually simple — a clean typographic info block, not a redesign. Day grouping, the arc
stepper, the timeline, and SSR determinism are untouched.

## Cross-cutting decisions

- **`created_at` is the single display-date basis.** Both public surfaces order/group/label events
  by `news.event.created_at`. `occurred_at` stays in the schema and on the per-event `FeedItem`
  DTO, but the *film-detail event DTO* (`EventOut`) and the *film-page FE* no longer reference it.
- **No migrations, no ingestion changes.** Every new DTO field reads a column or join table that
  ingest already populates. M2 is read-path only.
- **Graceful null-omission is the contract.** New metadata fields are nullable / empty-list on the
  DTO and individually omitted on the FE. A sparse film (early announcement with only a title)
  renders cleanly. Rating is gated on `vote_count > 0`, not on `vote_average`, to avoid showing a
  `0.0` for unrated upcoming films.
- **Stay with explicit `select` joins.** No `relationship()` is added to `Film`; the metadata joins
  follow the service's existing explicit-query style (and the established `nulls_last`/`order_by`
  determinism), keeping payloads stable for SSR and snapshots.
- **Don't regress what already shipped.** NEU-369 (home-feed row density) and NEU-371 (film-timeline
  day grouping) are live; the grouping algorithm, SSR determinism (no `Date.now()`, reverse-a-copy
  bucketing), and existing tests must keep passing. FE changes are a field rename + an additive
  section, not a behavior change to grouping or SSR. Run the full local CI gate before pushing each
  PR (BE: `task test`/`lint`/`typecheck` + `alembic heads`; FE: `tsc -b` + eslint@0-warnings +
  vitest).
- **PR sequencing.** NEU-394 → NEU-395 and NEU-396 → NEU-397 (each FE ticket consumes its BE
  ticket's merged DTO). The two stories are independent and can land in either order.

## Milestone acceptance

1. **Date consistency (NEU-386):** for any event, the day it appears under on `/film/{slug}` equals
   the day it appears under on `/` — both derived from `created_at`. The film-detail response
   exposes the event's display date as `created_at` (no `occurred_at` on `EventOut`); the timeline,
   event card `<time>`, and the page meta "latest summary" pick all key off `created_at`.
2. **Richer film page (NEU-387):** the film-detail DTO exposes overview, tagline, runtime, genres,
   rating (`vote_average`/`vote_count`), original language, backdrop, production companies, and
   collection from already-captured data; `/film/{slug}` renders a clean core-info section that
   omits every field the film lacks.
3. **No migration ran and no ingestion code changed** — confirmed by diff (BE changes confined to
   `public/service.py`, `public/dto.py`, and tests).
4. All backend (`task test`/`lint`/`typecheck`) and frontend (`tsc -b` + eslint + vitest) checks are
   green; the NEU-369/NEU-371 grouping + SSR tests still pass unchanged.

## Out of scope

- **NEU-369 (home-feed row density) and NEU-371 (film-timeline day grouping) are already shipped** —
  not re-specced or re-touched here beyond not regressing them.
- **No new ingestion / TMDB capture / migration.** Everything M2 surfaces is already persisted.
- **No visual redesign.** A clean additive info block and a field rename — not a re-layout of the
  feed or film page, no new poster/backdrop hero treatment beyond optionally surfacing the existing
  `backdrop_path`.
- **No change to the per-event `/feed` or grouped `/feed/grouped` DTOs/queries**, and no new public
  endpoints. `FeedItem` keeps both `occurred_at` and `created_at`.
- **No new collection/franchise navigation, cast/crew, or production-detail pages** — only the
  flat basics already on `catalog.film` and its existing join tables.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
</content>
</invoke>
