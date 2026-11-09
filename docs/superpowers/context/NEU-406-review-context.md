# NEU-406 — Review context bundle

> Stable intent only (Linear ticket + hierarchy + spec/plan). The PR diff and comment thread are
> fetched live each round — never cached here.

## Linear ticket

- **ID / title:** NEU-406 — `[backend]` Ingest alternative_titles + wire into search + DTO
- **State:** In Review
- **Project / milestone:** Movies: MVP Launch Polish · M5 — Comprehensive film page
- **Description (intent):** Ingest TMDB `/movie/{id}/alternative_titles` — schema + fetch (via shared
  `append_to_response`) + additive migration — extend `GET /films/search` to also match alternate
  titles, and expose notable alt-titles on the film-detail DTO. Extends NEU-402's shared
  `append_to_response` fetch; the search extension rebases onto merged NEU-400.

## Linear hierarchy & relations

- **Parent story:** NEU-391 — *Alternate titles improve search and show on the film page* (In Progress).
  Acceptance: searching an alternate/foreign title returns the film; the film page shows an
  "Also known as" line where alternate titles exist.
- **Milestone:** Comprehensive film page (M5).
- **Blocked by:** NEU-400 — `[backend] GET /films/search?q=` endpoint (the search seam this extends).
- **Blocks:** NEU-407 — `[frontend]` "Also known as" line on the film page (consumes this DTO).
- **Related:** NEU-388 — *Find a film by title*.
- **Sibling M5 backend tickets sharing the plumbing:** NEU-402 (credits), NEU-404 (release dates) — all
  widen the same `append_to_response`, `TMDBMovieDetails`, `upsert_film`, `FilmDetailResponse`,
  `get_film_detail`; each adds its own additive migration off the same head.

## Acceptance criteria (ticket + milestone #3/#4/#5)

1. Ingest fetches alt-titles via `append_to_response` on the existing `/movie/{id}` call — **no extra
   HTTP request** (respx asserts one request carrying the param incl. `alternative_titles`) — and
   populates `catalog.film_alternative_title` with per-country, typed rows.
2. Upsert is **idempotent** (delete-and-reinsert per film): re-ingest yields the same row set; churn is
   reflected; a film without alt-titles is a no-op; rows cascade-delete with the film.
3. `GET /films/search` matches **alternate titles** in addition to primary/original title, returning
   each film **once**, with **primary-title hits ranked ahead** of alt-title-only hits, and the same
   visibility rule + envelope as NEU-400 (a hidden/slug-less film matching only via an alt-title stays
   excluded). Same normalization/escaping as the primary match, OR-ed into NEU-400's `_title_match`
   seam — no new route/DTO/caller change.
4. `GET /films/{slug}` exposes notable `alternative_titles` (distinct strings differing from
   `title`/`original_title`, ordered, capped); empty → `[]`.
5. **Additive** Alembic migration creates `catalog.film_alternative_title` + index(es), chains
   single-headed off the then-current head, **no data step**; per-film TMDB volume unchanged (1 req).
6. `task test` / `task lint` / `task typecheck` green; existing ingest, upsert, NEU-396, NEU-400 search,
   and public-films tests still pass unchanged.

## Schema (from spec/plan)

`catalog.film_alternative_title` — rebuilt per film:

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | BigInteger identity PK | no | surrogate (no natural uniqueness) |
| `film_id` | UUID FK → `catalog.film.id` ON DELETE CASCADE | no | per-film owner |
| `iso_3166_1` | Text | yes | country code; **plain text, no FK** |
| `title` | Text | no | the alternate title string |
| `title_type` | Text | yes | `titles[].type`, e.g. "working title", "AKA" |

- Indexes: `ix_catalog_film_alt_title_film` on `film_id` (always). A `title` search index **only if it
  mirrors NEU-400's merged strategy** — as designed NEU-400 uses plain `ILIKE '%q%'` substring (no
  title index, ~230-film corpus), so a `film_id` index only is expected.
- Country is plain `Text` (no FK to `production_country`) by design — alt-title countries routinely
  include codes a film never lists as a production country.

## Fetch / DTO / upsert intent

- **Client:** widen (don't clobber) `append_to_response` on `movie_details` to **include**
  `alternative_titles` alongside any sibling's `credits`/`release_dates`. One request; appended block
  also lands verbatim in `tmdb_raw`.
- **DTOs (`extra="ignore"`):** `TMDBAlternativeTitle(iso_3166_1, title, type)`,
  `TMDBAlternativeTitles(titles: list[...])`; `TMDBMovieDetails.alternative_titles: ... | None = None`.
- **Upsert:** guarded `_upsert_alternative_titles` — no-op when absent; `DELETE WHERE film_id` + bulk
  insert one row per title; caller owns the transaction (one commit/film).

## Search extension intent

- OR a **correlated `EXISTS`** over `film_alternative_title.title` into NEU-400's `_title_match` seam,
  using the **same** `_escape_like`-escaped `ILIKE` pattern. `EXISTS` returns each film once (de-dup, no
  DISTINCT/row multiplication).
- **Ranking:** add a **leading** order-by tiebreak — primary/original-title match sorts ahead of
  alt-title-only — **before** NEU-400's `release_date desc nulls last, id asc`. Don't disturb
  `get_film_index`. Short-circuit / `MIN_QUERY_LEN` / envelope / visibility predicate stay NEU-400's.

## DTO exposure intent

- `FilmDetailResponse.alternative_titles: list[str] = []` (additive; don't reorder existing fields).
- `get_film_detail`: scoped `select(FilmAlternativeTitle.title).where(film_id == film.id)`, dedup +
  exclude titles equal (case-insensitive) to `film.title`/`film.original_title`, deterministic order
  (alphabetical case-insensitive), cap to a notable handful (≈8). Empty → `[]`, never `null`. No
  `relationship()` on `Film`. Route unchanged.

## Migration intent

- One additive migration: `create_table('film_alternative_title', …, schema='catalog')` + index(es),
  **no data step**, `down_revision` = then-current single head. Backfill is re-ingest, not SQL.

## Key files expected to be touched

`catalog/models.py`, `ingest/tmdb/schemas.py`, `ingest/tmdb/client.py`, `ingest/tmdb/upsert.py`,
`public/service.py`, `public/dto.py`, a new `migrations/versions/<rev>_*.py`, and tests
(`tests/fixtures/tmdb.py`, `tests/fixtures/public.py`, `tests/unit/ingest/tmdb/test_client.py`,
`test_schemas.py`, `tests/integration/ingest/tmdb/test_upsert.py`,
`tests/integration/routers/test_public_films.py`). NEU-400's search seam is reference-only
(confirm merged; do not re-implement).
