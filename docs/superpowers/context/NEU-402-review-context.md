# NEU-402 review context

> Stable intent bundle for `/reviewit`, `/addressit`, `/mergeit`. Reference context only — the PR diff and comment threads are fetched live each round, never cached here.

## Linear ticket

- **ID / title:** NEU-402 — `[backend]` Ingest TMDB credits (people/credits schema + DTO)
- **State:** In Review
- **Labels:** loop-ready, backend
- **Branch:** `tom/neu-402-backend-ingest-tmdb-credits-...` (PR uses `feat/NEU-402-ingest-tmdb-credits`)
- **Description:** Ingest TMDB credits per film — add `person` + `film_credit` schema (the long-reserved "people, credits" seam in `catalog/models.py`), fetch via the TMDB client (`append_to_response`), migration, and expose top-billed cast + director(s) on the film-detail DTO. Introduces the shared `append_to_response=credits,release_dates,alternative_titles` fetch; lands before NEU-404/406 which extend it.

## Linear hierarchy & relations

- **Project:** Movies: MVP Launch Polish
- **Milestone:** M5 — Comprehensive film page
- **Parent story:** NEU-389 — Film page shows cast & crew
- **Blocks:** NEU-403 `[frontend]` — Cast & crew section on the film page (waits on this DTO)
- **Related:** NEU-404 `[backend]` — Ingest TMDB release_dates (extends the shared append fetch)

## Spec & plan

- **Plan:** `docs/plans/2026-06-25-neu-402-ingest-credits.md`
- **Milestone spec:** `docs/specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md`

### Key intent / acceptance points

- **Schema:** `catalog.person` (Integer natural PK, `autoincrement=False`, like `Genre`; `ON CONFLICT (id) DO UPDATE`) with `name`/`original_name`/`profile_path`/`known_for_department`/`gender`/`popularity`. `catalog.film_credit` (Text `credit_id` PK — a person can hold multiple credits on one film; `film_id` FK CASCADE, `person_id` FK, `credit_type`, `department`, `job`, `character`, `credit_order`). Two indexes: `ix_catalog_film_credit_film` on `film_id`, `ix_catalog_film_credit_person` on `person_id`.
- **Fetch:** `movie_details` adds `params={"append_to_response": "credits,release_dates,alternative_titles"}` — the **full shared triple** even though this PR only parses `credits`; `tmdb_raw` keeps the verbatim payload. **One** request per film (respx must assert a single call carrying `append_to_response` w/ `credits`). New nested DTOs (`extra="ignore"`): `TMDBCastMember`, `TMDBCrewMember`, `TMDBCredits`; `TMDBMovieDetails.credits: TMDBCredits | None = None`.
- **Upsert:** guarded `_upsert_credits` step in `upsert_film`, no-op when no credits. People = union of cast+crew deduped by `id`, `on_conflict_do_update`. Credits = `DELETE WHERE film_id` then bulk insert, **deduped by `credit_id`**. Caller owns the transaction (one commit per film).
- **Migration:** one additive migration creating both tables + the two indexes, all `schema='catalog'`, `film_id` FK `ondelete='CASCADE'`, **no data step**, single-headed off the then-current head (`6d7e2769ba35` at authoring; chain off whatever head exists).
- **DTO / read path:** additively extend `FilmDetailResponse` — `cast: list[CastMemberOut]` (default `[]`) = `credit_type='cast'` joined to person, `order by credit_order asc nulls last, person.name asc`, **limit N (≈10–15)**; `directors: list[str]` (default `[]`) = `credit_type='crew' and job='Director'`. `CastMemberOut{ name, character, profile_path }`. Two scoped `select`s keyed by `film.id` in `get_film_detail`, `nulls_last` ordering, no `relationship()` on `Film`. **Do not** rename/reorder/remove existing fields (incl. NEU-396's). Empty join → `[]`, never `null`.
- **Determinism:** every surfaced list has a deterministic `order_by` (SSR/snapshot-friendly).
- **Backfill = re-fetch**, not an Alembic data step.
- **Out of scope:** no person/filmography pages, no full crew surfacing (only top-billed cast + directors on the DTO; full arrays live in the tables + `tmdb_raw`), no reviews.
- **Gate:** `task test` / `task lint` / `task typecheck` / `task format` green; `alembic heads` single-headed; TMDB mocked with respx (never live network).
