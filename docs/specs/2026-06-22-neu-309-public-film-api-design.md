# Public film index/detail API + sitemap — Design

- **Date:** 2026-06-22
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-backend` — new `public` package (DTOs, arc logic, read service, sitemap) + `routers/public.py`; one new config setting. No schema changes.
- **Linear:** NEU-309 (one PR, backend) · project *Movies: Synthesis & Update Log* · milestone *M3 — Per-movie update log*
- **Parent story:** NEU-301 (*Story: Per-movie chronological update log*)
- **Blocked by (both Done):** NEU-308 (`catalog.film.slug` + backfill) · NEU-303 (`news.event_summary` schema + migration)
- **Blocks:** NEU-310 (*[frontend] SSR film update-log page*)
- **Design-of-record:** [2026-06-22-synthesis-update-log-design.md](2026-06-22-synthesis-update-log-design.md) §"Public read API (unauthenticated)". This document is the per-ticket implementation design for the M3 public read deliverable.

## What this is

The first **unauthenticated** read surface in the product — the per-movie update log's data API plus
the discovery sitemap. Every existing router is auth/admin-gated; this establishes the public
no-auth router pattern in `main.py`.

Three endpoints, all read-only, no writes, no auth:

- `GET /films` — paginated index of films that have something to show (powers the sitemap and the
  discovery substrate).
- `GET /films/{slug}` — a film's detail + its chronological update log (summarized events with their
  sources) + the derived current arc stage.
- `GET /sitemap.xml` — the public film URLs + the feed root.

NEU-309 ships **only** these read endpoints, their DTOs, the arc-derivation logic, the sitemap
renderer, and one config setting. It adds **no** schema, **no** writes, and **no** frontend.

### Out of scope

- The global `GET /feed` "updated today" API → **NEU-311**.
- All frontend (SSR `/film/{slug}` page, API client) → **NEU-310**.
- Summary generation (M1, done) and slug generation/backfill (NEU-308, done).
- Any auth, write, or admin path; any change to the `catalog`/`news` schema.

## Decisions

| Question | Decision |
|---|---|
| Which films are publicly visible in the index + sitemap | **Only films with ≥1 event that has a summary** (`news.event_summary`). A film with nothing summarized is not in the index and not in the sitemap. |
| `GET /films/{slug}` for a film that exists but has no summarized events | **200** with the film + derived arc stage + an **empty** `events` array. (Detail is intentionally more permissive than the index — the arc still derives from `film.status`.) |
| `GET /films/{slug}` for an unknown slug | **404**. |
| Arc-stage derivation | **`film.status` baseline, advanced by the furthest-along event type present**, taking the max over a linear arc, using **all** events (summarized or not). See §"Arc-stage derivation". |
| Pagination | **offset/limit envelope with `total`** — `{items, total, limit, offset}`. |
| `poster_path` | Exposed **raw** (the TMDB path); the frontend composes the image URL. The API does not own TMDB's image base. |
| `event_type` / `confidence` | Passed through **raw** (`confirmed`/`rumored`; the 7 event-type values). Raw `film.status` is **not** exposed — `arc_stage` is the product value. |
| Sitemap base URL | New config setting `public_base_url` (env `PUBLIC_BASE_URL`); required for absolute sitemap URLs. |

## Module layout

A dedicated `public` package keeps the cross-schema read surface in one place and keeps the arc
logic pure and independently testable. The router stays thin.

```
src/upmovies/
  routers/public.py     # APIRouter (no auth, no router-level dependencies); thin — calls service, returns DTOs
  public/
    __init__.py
    dto.py              # Pydantic v2 response models (ConfigDict(from_attributes=True) where applicable)
    arc.py              # PURE arc-stage derivation — no DB; unit-tested in isolation
    service.py          # async read queries: index page + total, detail, sitemap rows
    sitemap.py          # render sitemap XML from service rows
```

Registered in `main.py` via `app.include_router(public.router)`, alongside the existing includes.
The router declares **no** `dependencies=[...]`, so it is unauthenticated. CORS already permits GET.

## Endpoints & DTOs

### `GET /films`

Query params: `limit` (default 50, `ge=1 le=100`), `offset` (default 0, `ge=0`) — validated via
FastAPI `Query(...)`.

Inclusion: only films where an event with a summary exists.
Ordering: `release_date DESC NULLS LAST, id ASC` (stable for offset paging; soonest/most-relevant
first).

```jsonc
// FilmIndexResponse
{
  "items": [
    {
      "slug": "the-odyssey-2026",
      "title": "The Odyssey",
      "release_year": 2026,      // from release_date.year, null if no release_date
      "poster_path": "/abc.jpg", // raw TMDB path, nullable
      "arc_stage": "shooting"
    }
  ],
  "total": 312,                  // count of films matching the inclusion rule
  "limit": 50,
  "offset": 0
}
```

### `GET /films/{slug}`

```jsonc
// FilmDetailResponse
{
  "slug": "the-odyssey-2026",
  "title": "The Odyssey",
  "release_date": "2026-07-17",  // full date, nullable
  "release_year": 2026,          // nullable
  "poster_path": "/abc.jpg",     // nullable
  "arc_stage": "trailer",
  "events": [                     // only events WITH a summary; [] when none
    {
      "event_type": "casting",    // raw, one of the 7 values
      "confidence": "confirmed",  // raw: confirmed | rumored
      "occurred_at": "2025-03-01T00:00:00Z",
      "summary": "…neutral 2–3 sentence paraphrase…",
      "sources": [
        {
          "url": "https://…",
          "source": "Deadline",
          "title": "…",
          "published_at": "2025-03-01T12:00:00Z"  // nullable
        }
      ]
    }
  ]
}
```

- Events: only those with a summary (`news.event_summary`); ordered `occurred_at ASC` (chronological),
  `id` tiebreak. Each event's `sources` come from `event_story → story` (`url`, `source`, `title`,
  `published_at`).
- Unknown slug → **404** (`HTTPException(404)`). Existing film with no summarized events → **200**
  with `"events": []` and the arc derived from `film.status`.

### `GET /sitemap.xml`

- `Content-Type: application/xml`; a standard sitemap `<urlset>`.
- URLs (the **frontend** paths, not API paths):
  - the feed root: `{public_base_url}/`
  - one `{public_base_url}/film/{slug}` per indexed film (same inclusion rule as `GET /films`).
    Note the FE page is `/film/{slug}` (singular), distinct from the API `/films/{slug}`.
- `<lastmod>` per film = the film's most recent **summarized** event's `created_at` (fallback
  `film.updated_at`).
- `public_base_url` comes from config (env `PUBLIC_BASE_URL`); a dev-sensible default is provided and
  documented. ("+ the feed" in the ticket = the root `/`; the feed *API* itself is NEU-311.)

## Arc-stage derivation (`public/arc.py`, pure)

Linear order (rank ascending):

```
announced < cast < shooting < wrapped < dated < trailer < released
```

```
baseline(film.status):
  "Rumored" | "Planned"   -> announced
  "In Production"         -> shooting
  "Post Production"       -> wrapped
  "Released"              -> released
  anything else / null    -> announced   # safe floor

event_stage(event_type):
  announced         -> announced
  casting           -> cast
  production_start  -> shooting
  production_wrap   -> wrapped
  release_date      -> dated
  trailer           -> trailer
  other             -> (no contribution)

arc_stage = stage with max rank among:
  baseline(film.status), and event_stage(t) for every event type t present on the film
```

Uses **all** of a film's events (summarized or not), so the arc is a stable progress indicator
independent of which events have summaries. The function is pure over `(status, [event_types])`.

## Queries (avoiding N+1)

- **Index:** one query for the paginated film page (filtered by `EXISTS` a summarized event, ordered,
  `limit`/`offset`); a `COUNT(*)` over the same filter for `total`; one grouped query fetching the
  event types per film-id on the page (`array_agg`/distinct) → arc computed in Python. Flat in page
  size (~3 queries/page).
- **Detail:** film-by-slug; summarized events joined to their stories (ordered `occurred_at`); the set
  of all event types for the film (for the arc). Arc computed in Python.
- **Sitemap:** the indexed films (slug + lastmod source) in one query; render XML.

## Error handling

- Unknown slug → `404`.
- Out-of-range `limit`/`offset` → `422` via `Query` bounds.
- No auth, so no `401`/`403` paths.

## Testing (TDD; mirrors `tests/integration/routers/` + `tests/unit/`)

- **Unit — `public/arc.py`:** every `film.status` baseline; each event-type advance; max-combine
  (e.g. `Planned` + `trailer` event → `trailer`); no-events → baseline; `other` contributes nothing;
  unknown/null status → `announced` floor.
- **Integration — endpoints** (`AsyncClient` + `ASGITransport`, real test DB; fixtures build
  film → event → event_story → story → event_summary):
  - index: envelope shape, ordering, inclusion rule (summary-less films excluded), pagination
    (`limit`/`offset`/`total`).
  - detail: shape, chronological ordering, slug resolution, **404** unknown slug, summary-less event
    omission, empty-log film → 200 with `events: []` + correct arc.
  - sitemap: valid XML, lists exactly the indexed `/film/{slug}` URLs + the root, correct `lastmod`.
- **Gates:** `task test` / `task lint` / `task typecheck` green (`task format` first). Pre-commit
  hooks delegate into Docker — commit normally with the container up.

## Acceptance-criteria mapping (NEU-309)

| Ticket AC | Where covered |
|---|---|
| Public no-auth router registered in `main.py` | §"Module layout" |
| `GET /films` paginated index (slug, title, year, poster, arc stage); powers sitemap | §"`GET /films`" |
| `GET /films/{slug}` detail + chronological events (type, confidence, occurred_at, summary, sources) + derived arc; 404 unknown slug | §"`GET /films/{slug}`", §"Arc-stage derivation" |
| `GET /sitemap.xml` — film URLs + feed | §"`GET /sitemap.xml`" |
| Summary-less events omitted | §"`GET /films/{slug}`", §"Decisions" |
| Typed Pydantic DTOs; read-only | §"Endpoints & DTOs" |
| Tests: shape + ordering; slug + 404; summary-less omission; arc derivation; sitemap lists slugs | §"Testing" |
| `task test` / `lint` / `typecheck` green | §"Testing" |
