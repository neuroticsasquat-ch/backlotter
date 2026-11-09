# Full TMDB Capture + Normalization + Global Ingest — Design

- **Date:** 2026-06-19
- **Status:** Approved (pending implementation)
- **Component:** `upcoming-movies-backend` — `catalog` schema + TMDB discover ingestion
- **Builds on:** [2026-06-19-prerelease-ingestion-filter-design.md](2026-06-19-prerelease-ingestion-filter-design.md)

## Problem

The TMDB `/movie/{id}` details endpoint returns a rich object (genres, production
companies/countries, spoken languages, collection membership, budget/revenue, runtime,
vote stats, taglines, and more), but `catalog.film` persists only a thin subset
(`tmdb_id`, `imdb_id`, `title`, `original_title`, `release_date`, `status`, `overview`,
`poster_path`). Everything else is discarded at parse time.

We want to:

1. **Capture the full TMDB object** on ingestion, with the relationally-meaningful
   sub-objects normalized into their own tables.
2. **Drop the en/US-only discovery filter** so the tracker covers films in any language
   and origin country.

No new TMDB traffic is required: the ingestion already fetches `/movie/{id}` per
candidate, so this is a schema + parsing + storage change, not an API-volume change.

Nothing consumes `catalog.film` yet (no film API endpoint, no frontend reads), so the
schema can be reshaped freely.

## Decisions

| Question | Decision |
|---|---|
| Normalization depth | **Full** — genre, production_company, production_country, spoken_language all get reference + join tables; collection is a film FK. |
| Raw-payload hedge | **Yes** — `catalog.film.tmdb_raw` JSONB stores the verbatim `/movie/{id}` response. |
| Popularity floor after dropping en/US | **Keep 1.0** — a TMDB probe (below) showed the global corpus stays ~296 candidates/run. |
| Reference-table keys | **Natural keys** — TMDB ids / ISO codes as PKs. `film` keeps its uuid surrogate. |
| Filter-removal config knobs | **Removed entirely** (not kept as toggleable/empty-disables). |
| Linear scope | One backend ticket → one PR (filter-removal rides along; not split out). |

## Schema (`catalog`)

### `catalog.film` — extended

Keeps the uuid surrogate PK + unique `tmdb_id` (the "spine" seam downstream projects
extend). New columns:

| Column | Type | TMDB source |
|---|---|---|
| `adult` | Boolean | `adult` |
| `backdrop_path` | Text | `backdrop_path` |
| `budget` | BigInteger | `budget` |
| `homepage` | Text | `homepage` |
| `original_language` | Text | `original_language` (ISO 639-1) |
| `popularity` | Double precision | `popularity` |
| `revenue` | BigInteger | `revenue` |
| `runtime` | Integer | `runtime` |
| `tagline` | Text | `tagline` |
| `video` | Boolean | `video` |
| `vote_average` | Double precision | `vote_average` |
| `vote_count` | Integer | `vote_count` |
| `origin_country` | Text[] | `origin_country` (ISO 3166-1 list) |
| `collection_id` | Integer, FK → `catalog.collection.id`, nullable | `belongs_to_collection.id` |
| `tmdb_raw` | JSONB | full `/movie/{id}` payload, verbatim |

All new columns are nullable (TMDB omits fields freely; `belongs_to_collection` is often
absent). Existing columns are unchanged.

### Reference tables (natural keys)

TMDB ids and ISO codes are stable, so they serve as PKs directly — making each upsert a
single `ON CONFLICT (pk) DO UPDATE`.

- `catalog.genre` — `id` (PK, TMDB genre id), `name`
- `catalog.production_company` — `id` (PK), `name`, `logo_path` (nullable), `origin_country` (nullable)
- `catalog.production_country` — `iso_3166_1` (PK), `name`
- `catalog.spoken_language` — `iso_639_1` (PK), `english_name`, `name`
- `catalog.collection` — `id` (PK), `name`, `poster_path` (nullable), `backdrop_path` (nullable)

### Join tables

Composite PK; `film_id` → `catalog.film.id` `ON DELETE CASCADE`.

- `catalog.film_genre` — (`film_id`, `genre_id` → `genre.id`)
- `catalog.film_production_company` — (`film_id`, `company_id` → `production_company.id`)
- `catalog.film_production_country` — (`film_id`, `iso_3166_1` → `production_country.iso_3166_1`)
- `catalog.film_spoken_language` — (`film_id`, `iso_639_1` → `spoken_language.iso_639_1`)

## DTOs & TMDB client (`ingest/tmdb/schemas.py`, `client.py`)

New nested models (all with `extra="ignore"`):

- `TMDBGenre(id, name)`
- `TMDBProductionCompany(id, name, logo_path, origin_country)`
- `TMDBProductionCountry(iso_3166_1, name)`
- `TMDBSpokenLanguage(iso_639_1, english_name, name)`
- `TMDBCollection(id, name, poster_path, backdrop_path)`

`TMDBMovieDetails` gains: `adult`, `backdrop_path`, `budget`, `homepage`, `revenue`,
`runtime`, `tagline`, `video`, `vote_average`, `vote_count`, `origin_country: list[str]`,
`genres: list[TMDBGenre]`, `production_companies: list[TMDBProductionCompany]`,
`production_countries: list[TMDBProductionCountry]`,
`spoken_languages: list[TMDBSpokenLanguage]`,
`belongs_to_collection: TMDBCollection | None`. All nullable/defaulted.

**Raw hedge.** `tmdb_raw` must hold the *original* `resp.json()` — not `model_dump()`,
which would drop unmodeled keys and defeat the hedge. Add a non-parsed
`tmdb_raw: dict[str, Any]` field to `TMDBMovieDetails` and set it post-validation in
`movie_details`:

```python
data = resp.json()
details = TMDBMovieDetails.model_validate(data)
details.tmdb_raw = data
return details
```

The client's "methods return typed DTOs" contract holds — callers still receive one
object.

## Upsert orchestration (`ingest/tmdb/upsert.py`)

`upsert_film` becomes a small orchestration, all within the caller's session/transaction
(ownership contract unchanged — the service still commits once per film, so one film's
failure never corrupts another):

1. If `belongs_to_collection` present → upsert `catalog.collection` (`ON CONFLICT (id) DO UPDATE`).
2. Upsert `catalog.film` (`ON CONFLICT (tmdb_id) DO UPDATE`) with all scalars,
   `collection_id`, and `tmdb_raw`; bump `updated_at`. Use `RETURNING id` to get the film
   uuid for the join rows.
3. Upsert each referenced `genre` / `production_company` / `production_country` /
   `spoken_language` (`ON CONFLICT (pk) DO UPDATE` — names/logos can drift).
4. **Rebuild joins (delete-and-reinsert):** `DELETE FROM <join> WHERE film_id = :id`, then
   bulk-insert the current set, for each of the four join tables. This correctly handles a
   film gaining or dropping a genre/company/etc. between runs; diffing buys nothing here.

## Drop the en/US filter (`ingest/tmdb/service.py`)

Remove `region` and `with_original_language` from the discover call, and remove the
`region` / `original_language` parameters from `_discover_candidate_ids` and
`run_tmdb_ingest`. Remove the corresponding wiring in
`routers/ingest_admin.py::_background_tmdb`.

**Release-date semantics note:** `region` previously scoped `primary_release_date.gte/lte`
to US releases. Without it, the window filters on the film's *primary* (earliest global)
release date — the correct behavior for a global tracker.

## Config (`config.py`)

- Retire `tmdb_region` (`TMDB_REGION`) and `tmdb_original_language`
  (`TMDB_ORIGINAL_LANGUAGE`) — removed entirely, not kept as toggleable knobs (YAGNI).
- `tmdb_min_popularity` stays at **1.0** (probe-confirmed for the global corpus).
- `tmdb_excluded_statuses` (`Released,Canceled`) unchanged.

## Migration

One additive Alembic migration under `catalog`: the new `film` columns, 5 reference
tables, 4 join tables. Per the repo flow: add the models first (tests pick them up via
`create_all`), then `task makemigration -- "..."`, review the generated file, `task
migrate`. No data migration — dev `catalog.film` is truncated and re-ingested afterward.

## Testing (TDD, respx)

- **schemas:** parse the full Star Wars sample payload → nested models populate;
  `tmdb_raw` retains keys we don't model.
- **upsert:** a film with genres/companies/countries/languages/collection creates the
  reference + join rows, sets `collection_id` and `tmdb_raw`; re-upsert with a changed
  genre set removes stale joins and adds new ones; a collection-less film leaves
  `collection_id` NULL.
- **service:** respx assertion that the discover request carries **no** `region` /
  `with_original_language` params.
- **fixtures:** extend `tests/fixtures/tmdb.py::make_details` with the nested arrays and
  new scalars.

All of `task test`, `task lint`, `task typecheck` green before done (run `task format`).

## Dev data refresh

After the code change and migration: `TRUNCATE catalog.film CASCADE` (the join tables
cascade) and re-ingest → a clean global, fully-captured corpus (~230 pre-release films
expected) replacing the current data.

## Out of scope

- Any film-serving API endpoint or frontend consumption of the new fields.
- Credits/cast/crew, videos, images (`append_to_response`) — not in the base payload.
- Path B from the prerelease spec (undated / just-announced films).
- Pruning, archiving, or refreshing films after they release.

## Supporting data (probed 2026-06-19)

Candidate counts = films above the popularity floor in the future-date window
(today → today+1095d), sorted `popularity.desc`. These are per-run detail-fetches; the
stored corpus is ~79% of this after the Released/Canceled status filter (per the
prerelease spec's ratio).

| popularity floor | en/US candidates | **global** candidates |
|---|---|---|
| ≥ 1 | 195 | **296** |
| ≥ 2 | 82 | 108 |
| ≥ 5 | 35 | 41 |
| ≥ 10 | 17 | 18 |

Unfiltered window totals: en/US 1,228 vs. global 2,904. The en/US figures match the
prerelease spec's table exactly (methodology confirmed). Dropping the en/US filter adds
~100 candidates at floor 1.0 — the popularity gate absorbs almost all of the doubled
window.
