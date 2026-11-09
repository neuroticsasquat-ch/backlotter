**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md
**Depends on:** NEU-400

# NEU-406 `[backend]` — Ingest TMDB alternative_titles + extend search + DTO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This is a **TDD** ticket — write the failing test first, watch it fail for the right reason, then make it pass. Steps use checkbox (`- [ ]`) syntax for tracking. The plan is deliberately light on exact signatures: follow the **existing patterns** in the cited files rather than copying snippets verbatim.

**Goal:** Ingest TMDB's `/movie/{id}/alternative_titles` sub-object into a new normalized `catalog.film_alternative_title` table, fetched **inside the existing per-film `/movie/{id}` call** via the shared `append_to_response` param (no extra HTTP request), upserted idempotently (delete-and-reinsert per film), backed by one additive Alembic migration. Then **extend the existing `GET /films/search` endpoint (NEU-400)** so a film is also found by any of its alternate/foreign titles — by OR-ing an alt-title match into NEU-400's isolated `_title_match` seam, returning each film **once** with primary-title hits ranked ahead of alt-title-only hits. Finally, expose a **notable** set of alt-titles (`alternative_titles: list[str]`) on the shared film-detail DTO. Empty-defaulted so the frontend (NEU-407) omits gracefully.

**Architecture:** This is one of M5's three backend tickets; it **extends shared plumbing** the siblings also touch (the `append_to_response` client param, `TMDBMovieDetails`, `upsert_film`, `FilmDetailResponse`, `get_film_detail`) **and** it is the only M5 ticket that modifies a *second* milestone's endpoint (NEU-400's search) — hence the `Depends on: NEU-400`.

- **Schema** (`catalog/models.py`): one new model `FilmAlternativeTitle` — a per-film detail row (surrogate `BigInteger` PK, FK→`catalog.film.id ON DELETE CASCADE`), rebuilt each ingest. Mirrors NEU-404's `FilmReleaseDate` shape (surrogate PK + delete-and-reinsert), **not** the composite-PK `FilmGenre` join, since `(film_id, country, title)` is not naturally unique (multiple AKAs / types per country).
- **Fetch** (`ingest/tmdb/client.py` + `schemas.py`): `movie_details` carries `append_to_response=credits,release_dates,alternative_titles` so the sub-object rides along in the one existing request. New nested DTOs (`extra="ignore"`) parse the `alternative_titles` key; `TMDBMovieDetails` gains `alternative_titles`.
- **Upsert** (`ingest/tmdb/upsert.py`): one new guarded step in `upsert_film` — `film_alternative_title` rebuilt (`DELETE WHERE film_id` → bulk insert), the same delete-and-reinsert idempotency the existing joins / NEU-404's release dates use. No reference table.
- **Search extension** (`public/service.py`): NEU-400 isolated all title matching behind `_title_match(q)` returning **one** boolean clause (`title ILIKE … OR original_title ILIKE …`), explicitly "alt-title-ready." NEU-406 OR-s in a correlated `EXISTS` over `film_alternative_title.title` using the **same** `_escape_like`-escaped pattern, so a film matches on **either** its primary/original title **or** any alternate title — de-duplicated to one row per film (an `EXISTS` does not multiply rows). Primary/original-title matches rank ahead of alt-title-only matches; otherwise NEU-400's ordering is preserved.
- **Read path** (`public/dto.py` + `public/service.py`): `FilmDetailResponse` gains `alternative_titles: list[str]`; `get_film_detail` adds one scoped `select` keyed by `film.id`, in the NEU-396 explicit-`select` style. **No `relationship()` is added to `Film`.**

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async) + asyncpg, Alembic, Pydantic v2 (`extra="ignore"`), httpx + respx (mock TMDB; never hit the network), pytest (pytest-asyncio `auto` mode). Everything runs in the container via `task` — **never** `pytest`/`ruff`/`pyright`/`alembic`/`python` on the host.

## Global Constraints

- **Repo:** `upcoming-movies-backend` (under the `~/projects/upcoming-movies/` umbrella). Paths below are relative to that repo root.
- **Branch:** use the Linear-provided branch for NEU-406 (one ticket = one PR = one `/implementit` run).
- **Blocked on NEU-400 — rebase onto its merged search service first.** At authoring time NEU-400 is **not yet merged**: `public/service.py` has **no** `get_film_search`, `_title_match`, `_escape_like`, `_publicly_visible_film`, or `_film_index_items`, and `routers/public.py` has **no** `/films/search` route. **Before implementing the search half, confirm NEU-400 has merged into the base branch and rebase onto it.** If the `_title_match` seam is absent, NEU-400 is incomplete — surface that as a blocker rather than re-implementing the search endpoint here. (The schema + ingest + DTO halves of this ticket do **not** depend on NEU-400 and can land regardless.)
- **Run everything in the container via `task`.** Keep the `upmovies-backend` container up. Green before done: `task test`, `task lint`, `task typecheck` all pass; run `task format` on touched files. No new runtime deps → no `task build` needed. Pre-commit hooks delegate into Docker — commit normally (no `--no-verify`).
- **One appended fetch, not a second call.** The alt-titles sub-object MUST be fetched via `append_to_response` on the existing `GET /movie/{id}` request — per-film TMDB volume stays at **1 request**. A separate `GET /movie/{id}/alternative_titles` call is explicitly wrong. A respx assertion must confirm `movie_details` issues a single call carrying `append_to_response` (milestone acceptance #4).
- **Resilient to sibling M5 tickets (NEU-402 credits / NEU-404 release_dates).** They touch the **same** shared plumbing and each adds its own additive migration off the same head. **Add, never overwrite:** when adding/widening `append_to_response`, ensure the comma list **includes `alternative_titles`** alongside whatever a sibling already added (`credits` / `release_dates`) — don't clobber it. At authoring time `movie_details` has **no** param at all (bare `GET /movie/{id}`); whichever sibling merges first introduces it, so add it if missing, widen it if present. Add new DTO fields / upsert steps additively without reordering existing ones. If a sibling has merged, rebase and overlay cleanly.
- **Stay additive on the shared DTO.** `FilmDetailResponse` / `get_film_detail` are also widened by NEU-396 (M2) and the sibling M5 tickets. **Add** `alternative_titles` (empty-defaulted `[]`); do **not** rename, reorder, or remove existing fields (`slug/title/release_date/release_year/poster_path/arc_stage/events`, plus whatever NEU-396 / the siblings added). Existing detail tests read response keys individually, so additive fields won't break them.
- **Additive migration, no data step.** The appended sub-object was never in the old `tmdb_raw`, so existing rows can't be backfilled in SQL — backfill is the next scheduled re-ingest (re-fetches in-window films with the new append param) + a one-off admin re-ingest; dev is `TRUNCATE catalog.film CASCADE` (the new table cascades via `film_id`) + re-ingest. The migration contains **only** `create_table` + `create_index`. Generate it with `task makemigration` **after** the model exists, set `down_revision` to the then-current `alembic heads` (single-headed), review, `task migrate`.
- **Chain off the current head.** At authoring time the single head is **`6d7e2769ba35`** (`add ingest.run_llm_usage table`); `task makemigration` will set `down_revision` to whatever head exists at implementation time — if a sibling M5 migration (NEU-402/404) merged first, chain off **that** head (the milestone designs three additive migrations chaining in merge order). Confirm `alembic heads` stays **single-headed**.
- **Determinism (SSR/snapshot-friendly).** The DTO's `alternative_titles` list is deduped and deterministically ordered (e.g. alphabetical, case-insensitive). Empty → `[]`, never `null`.
- **Commits/PR:** Conventional Commits subject, **no** Linear ID in the commit subject (optional `Refs NEU-406.` in the body), **no** footer/`Co-Authored-By` in the commit. PR **title** carries the trailing `(NEU-406)`; the `🤖 Generated with Claude Code` footer goes in the PR **body** only. Single PR for the ticket.

---

## Schema — `catalog.film_alternative_title`

Granular per-(film, country, title, type) rows, rebuilt per film. Surrogate PK because `(film_id, iso_3166_1, title)` is **not** naturally unique (a country can list multiple AKAs / a "working title" and an "AKA" for the same string). Country is **plain `Text`, no FK** to `production_country` — alt-title countries routinely include codes a film never lists as a production country, and an FK would reject valid rows (the intentional divergence NEU-404 also makes).

| Column | Type | Null? | TMDB source | Notes |
|---|---|---|---|---|
| `id` | `BigInteger`, PK (autoincrement / identity) | no | — | surrogate; no natural uniqueness |
| `film_id` | `UUID`, FK → `catalog.film.id` `ondelete="CASCADE"` | no | — | the per-film owner |
| `iso_3166_1` | `Text` | yes | `titles[].iso_3166_1` | country code; **plain text, no FK** (TMDB sometimes omits it) |
| `title` | `Text` | no | `titles[].title` | the alternate title string |
| `title_type` | `Text` | yes | `titles[].type` | e.g. `"working title"`, `"AKA"` (often `""` → store as-is or null) |

**Indexes** (declare in `__table_args__` alongside `{"schema": "catalog"}`, mirroring `Film`'s `Index(...)` pattern):

- `ix_catalog_film_alt_title_film` on `film_id` — the film-page read (`WHERE film_id = :id`) and FK hygiene.
- **A `title` search index — only if it matches NEU-400's merged strategy.** Inspect NEU-400's merged search at impl time and mirror it. As designed, NEU-400 matches with a plain `ILIKE '%q%'` **substring** scan and ships **no** title index / no migration (a btree cannot serve a leading-`%` substring match, and the corpus is ~230 films). In that (expected) case, add **only** the `film_id` index here. **If** NEU-400 instead shipped a `lower(title)` btree (prefix search) or a `pg_trgm` GIN, add the **same** index type on `lower(title)` for parity — do not introduce a second, inconsistent search mechanism. The milestone decision is explicit: alt-title search uses the *same* matching strategy/index as the primary title.

Model conventions to match `catalog/models.py`: `Mapped[...]` / `mapped_column`; import `BigInteger`/`Text`/`ForeignKey`/`Index` from `sqlalchemy` and `UUID as PGUUID` from `sqlalchemy.dialects.postgresql`; `__table_args__ = (Index(...), {"schema": "catalog"})`. A sole `BigInteger` PK autoincrements (Postgres identity/serial) — no extra args. Adding the class to `models.py` is enough for tests (conftest `create_all` builds it); prod gets it via the migration.

## Fetch + upsert wiring (shared `append_to_response`)

- **Client (`ingest/tmdb/client.py`).** `movie_details` currently does a bare `GET /movie/{id}` (`resp = await self._request("GET", url)`). Add (or widen) `params={"append_to_response": "credits,release_dates,alternative_titles"}` so the sub-object rides along in the one response — **resilient:** if a sibling already added the param, widen the comma list to **include `alternative_titles`**, don't replace `credits`/`release_dates`. The appended object arrives as a nested `alternative_titles: {titles: [...]}` key on the same JSON; it lands in `tmdb_raw` verbatim (the client already assigns `details.tmdb_raw = data` post-validation) **and** is parsed into the typed field below.
- **DTOs (`ingest/tmdb/schemas.py`).** Add (all `extra="ignore"`):
  - `TMDBAlternativeTitle` — `iso_3166_1: str | None = None`, `title: str`, `type: str | None = None` (the TMDB key is `type`; if a `title_type` attribute is preferred on the model, alias it — but keep parsing tolerant).
  - `TMDBAlternativeTitles` — `titles: list[TMDBAlternativeTitle] = Field(default_factory=list)`.
  - `TMDBMovieDetails` gains `alternative_titles: TMDBAlternativeTitles | None = None` (the appended JSON key is `alternative_titles`).
- **Upsert (`ingest/tmdb/upsert.py`).** Add a guarded step to `upsert_film` (e.g. `_upsert_alternative_titles(session, film_id, details)`), no-op when `not details.alternative_titles or not details.alternative_titles.titles`: `delete(FilmAlternativeTitle).where(FilmAlternativeTitle.film_id == film_id)`, then a single bulk `insert` of one row per title (`{film_id, iso_3166_1, title, title_type}`). Place the delete next to the existing `_rebuild_joins` deletes (or a sibling helper) and the insert alongside the existing bulk inserts — same shape, same idempotency. No reference table (unlike person/genre). The caller still owns the transaction (one commit per film); a film with no alt-titles is a clean no-op.

## Search extension (extend NEU-400's `GET /films/search`)

NEU-400 built `GET /films/search?q=` matching `Film.title` **or** `Film.original_title` behind a single `_title_match(q)` helper — explicitly built as the "alt-title-ready" OR-seam, with LIKE-wildcard safety via `_escape_like` + `escape=`. **This is the one place M5 modifies another milestone's endpoint.** Extend it as a localized OR — **no** new route, **no** new DTO, **no** caller changes:

- **Match path.** Inside the search query's WHERE, the film matches when its primary/original title matches **or** any of its alternate titles matches. Add a **correlated `EXISTS`** over `film_alternative_title` — `exists(select(1).where(FilmAlternativeTitle.film_id == Film.id, FilmAlternativeTitle.title.ilike(pattern, escape="\\")))` — using the **same** `pattern = f"%{_escape_like(term)}%"` (or whatever pattern NEU-400's merged `_title_match` uses) so primary and alt matching stay consistent. An `EXISTS` correlated subquery returns each film **once** (no row multiplication, no `DISTINCT` needed) — that's the de-dup.
- **Where the OR lives.** NEU-400 left a one-line comment marking the alt-title extension point inside `_title_match`. The cleanest extension is to OR the alt-title `EXISTS` into that same `or_(...)` so `get_film_search`'s WHERE is unchanged — matching becomes `or_(Film.title.ilike(...), Film.original_title.ilike(...), <alt-title EXISTS>)`. Follow whatever shape NEU-400 actually merged; keep matching behind that one helper.
- **Ranking — primary hits first (milestone acceptance #3).** Preserve NEU-400's base ordering (`release_date desc nulls last, id asc`); add alt-title as an additional match path, **not** a reorder of the existing results. To satisfy "primary-title hits ranked ahead of alt-title-only hits," add a **leading** order-by tiebreak: a boolean expression that is true when the **primary/original** title matches, ordered so `true` (primary hit) sorts before `false` (alt-title-only hit), **before** NEU-400's `release_date`/`id` terms. Implement resiliently — e.g. factor NEU-400's primary clause into a reusable `_primary_title_match(term)` (used both as the rank expression and as the first two arms of the OR) so the rank term and the WHERE never drift. If NEU-400's merged structure makes a clean primary-only expression awkward, an acceptable fallback is `order_by(_primary_title_match(term).desc(), <existing order>)` built inline. Keep the change to `get_film_search`'s `order_by` minimal and additive; do **not** disturb `get_film_index`.
- **Short-circuit / envelope unchanged.** The blank/whitespace/too-short `q` short-circuit, the `MIN_QUERY_LEN` guard, the `FilmIndexResponse` envelope, bounds, and visibility predicate (`_publicly_visible_film()`) are all NEU-400's and stay as-is. Alt-title matching only widens *which films* match, never the contract.

## DTO exposure (notable alt-titles on the film page)

Extend `FilmDetailResponse` (`public/dto.py`) additively — it's the **same** DTO NEU-396 widened and the sibling M5 tickets widen; add only the alt-titles field:

| DTO field | Selection | Notes |
|---|---|---|
| `alternative_titles: list[str]` (default `[]`) | distinct `film_alternative_title.title` for `film_id = :id`, **excluding** any title equal (case-insensitive) to `film.title` or `film.original_title`, deduped, ordered (e.g. alphabetical case-insensitive), capped to a notable handful (e.g. ≈8) | just the title strings — we don't surface country/type on the page |

**Read path (`public/service.py::get_film_detail`).** After the `Film` row is fetched, add one scoped `select(FilmAlternativeTitle.title).where(FilmAlternativeTitle.film_id == film.id)`, de-dup + filter out titles matching `film.title` / `film.original_title` (case-insensitive), order deterministically, cap to the notable handful, and pass through to `FilmDetailResponse(alternative_titles=...)`. Dedup/exclusion can be done in SQL (`distinct`, `func.lower(...)` comparisons, `order_by`, `limit`) or in Python after a small ordered fetch — either is fine; keep it deterministic and wrap results in `list(...)` for pyright. No `relationship()` on `Film`; one extra round-trip per film-detail request (cheap — one film). Empty → `[]`. The route (`routers/public.py`) is unchanged — `response_model=FilmDetailResponse` flows the new field automatically.

## Which part of M5 this realizes

Story **NEU-391** ("Alternate titles improve search and show on the film page"), **backend half**. Parent acceptance: searching an alternate/foreign title returns the film; the film page shows "Also known as". Realizes **M5 milestone acceptance #3** (ingest populates `catalog.film_alternative_title`; `GET /films/search` matches alternate titles in addition to the primary title — a film findable by an AKA — returning each film once with primary-title hits ranked first; the DTO exposes notable `alternative_titles`) and contributes to **#4** (additive migration, single-headed, no data step; per-film TMDB volume unchanged — 1 request carrying `append_to_response`). **NEU-407** (FE "Also known as" line) is blocked on this DTO.

## TDD testing intent

Write the failing test first for each slice, watch it fail for the right reason, then implement. Mock TMDB with **respx** (never hit the network). Integration tests use the `session` fixture against the test DB; re-read Core-upserted rows with `execution_options={"populate_existing": True}` (see `_films` in `test_upsert.py`). **Run the whole file/dir, not a single test** (the known pytest-asyncio session-loop gotcha).

- **Fixtures.** Extend `tests/fixtures/tmdb.py::make_details` to optionally include an `alternative_titles` block (a couple of countries × a couple of titles, including a non-Latin/foreign AKA), defaulting so existing callers are unaffected. Extend `tests/fixtures/public.py` with a small async helper to attach `film_alternative_title` rows to a film for the detail/search tests (insert rows directly with explicit titles). For the search test, the existing `make_film` already takes `title`; set/attach alt-titles via the helper. (If a search test needs `original_title`, set it on the returned `Film` + commit, mirroring NEU-400's approach.)
- **Client (`tests/unit/ingest/tmdb/test_client.py`).** Assert `movie_details` issues a **single** request whose query carries `append_to_response` including `alternative_titles` (respx `route.calls.last.request.url.params`), and that a payload with an appended `alternative_titles` block parses into `details.alternative_titles.titles[...]` while staying captured verbatim in `tmdb_raw`. (Coordinate with siblings: assert the param *contains* `alternative_titles`, not that it equals a fixed string.)
- **Schemas (`tests/unit/ingest/tmdb/test_schemas.py`).** Parsing a nested `alternative_titles` payload populates the typed tree (`titles[]` → `title`/`iso_3166_1`/`type`); a film with no `alternative_titles` key leaves the field `None`; unknown extra keys are ignored.
- **Upsert (`tests/integration/ingest/tmdb/test_upsert.py`).** Ingest **populates** `film_alternative_title` with the right `(iso_3166_1, title, title_type)` rows; **idempotent** (re-running over the same film yields the same row set — delete-and-reinsert, no duplicates); **rebuild on change** (a film whose appended alt-titles differ on re-ingest reflects the new set, stale rows gone); a film with **no** `alternative_titles` inserts nothing and doesn't error; rows cascade-delete with the film.
- **Search (`tests/integration/routers/test_public_films.py`, alongside NEU-400's search tests).** With a **visible** film whose primary `title` does **not** contain the term but which has a `film_alternative_title` that does: `GET /films/search?q=<aka>` **returns** that film (the core parent-acceptance pin — "find a film by its alternate/foreign title"). A film matching the term on **both** primary and alt titles is returned **once** (de-dup). **Visibility parity holds** — a film matching only via an alt-title but with **no summarized event / no slug** is still excluded (alt-title matching widens the match path, not the visible set). **Ranking** — when one film matches on its primary title and another only on an alt-title (constructed so NEU-400's `release_date`/`id` order would otherwise interleave them), the primary-title hit sorts **ahead** of the alt-title-only hit. The blank/short-`q` short-circuit and envelope/bounds behavior from NEU-400 stay green unchanged.
- **DTO / read path (`tests/integration/routers/test_public_films.py`).** `GET /films/{slug}` **surfaces** `alternative_titles` for a film with alt-title rows: distinct titles, **excluding** any equal to `title`/`original_title`, deterministically ordered, capped; a film with no alt-titles returns `alternative_titles == []` (graceful omission). Keep existing detail assertions (events/sources/NEU-396 + sibling M5 fields) intact — they read keys individually, so additive fields don't disturb them.

## Key files touched

- **Modify** `src/upmovies/catalog/models.py` — add `FilmAlternativeTitle` (surrogate `BigInteger` PK, `film_id` FK cascade, `iso_3166_1`/`title`/`title_type`, the `film_id` index [+ a title index only if mirroring NEU-400's], `schema='catalog'`).
- **Modify** `src/upmovies/ingest/tmdb/schemas.py` — add `TMDBAlternativeTitle` / `TMDBAlternativeTitles`; add `alternative_titles` to `TMDBMovieDetails`.
- **Modify** `src/upmovies/ingest/tmdb/client.py` — add/widen `append_to_response` on `movie_details` to include `alternative_titles`.
- **Modify** `src/upmovies/ingest/tmdb/upsert.py` — add the `film_alternative_title` delete-and-reinsert rebuild step (+ import the model), called from `upsert_film`.
- **Modify** `src/upmovies/public/service.py` — extend NEU-400's `_title_match` (OR-in the alt-title `EXISTS`) and `get_film_search`'s ordering (primary-first tiebreak); add the scoped alt-titles `select` + projection in `get_film_detail` (import `FilmAlternativeTitle`).
- **Modify** `src/upmovies/public/dto.py` — add `alternative_titles: list[str] = []` on `FilmDetailResponse`.
- **Create** `migrations/versions/<rev>_add_catalog_film_alternative_title.py` — additive `create_table('film_alternative_title', …, schema='catalog')` + index(es); `down_revision` = then-current `alembic heads`; **no data step**. (Generated via `task makemigration`, then reviewed.)
- **Modify** tests: `tests/fixtures/tmdb.py`, `tests/fixtures/public.py`, `tests/unit/ingest/tmdb/test_client.py`, `tests/unit/ingest/tmdb/test_schemas.py`, `tests/integration/ingest/tmdb/test_upsert.py`, `tests/integration/routers/test_public_films.py`.
- *(reference only — confirm merged, do not re-implement)* NEU-400's search seam in `public/service.py` (`get_film_search`, `_title_match`, `_escape_like`, `MIN_QUERY_LEN`, `_publicly_visible_film`, `_film_index_items`) and the `/films/search` route in `routers/public.py`.

---

## Task 1: Schema + migration (TDD)

**Files:** Modify `catalog/models.py`; Test `tests/integration/test_models.py` (or a focused integration test); generated migration.

- [ ] **Step 1 — Failing test for the table.** Add an integration test that inserts a `FilmAlternativeTitle` (FK to a `Film`) and reads it back, asserting the columns and `ondelete='CASCADE'` (deleting the film removes its alt-titles). Run the relevant dir → FAIL (model absent). *(Run a whole file/dir — single-test isolation trips the pytest-asyncio session-loop warning.)*
- [ ] **Step 2 — Add the model.** Add `FilmAlternativeTitle` (surrogate `BigInteger` PK, `film_id`/`iso_3166_1`/`title`/`title_type`, the `film_id` index, `schema="catalog"`) following the `catalog/models.py` style. Re-run; the table test passes (conftest `create_all` builds it).
- [ ] **Step 3 — Generate the migration.** `task makemigration -- "add catalog film_alternative_title"`. Review: it should `create_table('film_alternative_title', …, schema='catalog')` + the index(es) and **nothing else** (no data step, no unrelated drift). Set `down_revision` to the current `alembic heads` (likely `6d7e2769ba35`, or a sibling M5 migration if one merged first — keep it single-headed). `task migrate`; confirm `alembic heads` is single. Strip any spurious autogen noise.

## Task 2: Client append-param + alt-title DTOs (TDD)

**Files:** Modify `ingest/tmdb/client.py`, `ingest/tmdb/schemas.py`, `tests/fixtures/tmdb.py`; Test `tests/unit/ingest/tmdb/test_client.py`, `test_schemas.py`.

- [ ] **Step 1 — Failing tests.** Add the schema-parse test (nested `alternative_titles` → typed tree; absent → `None`; extra keys ignored) and the client test (single request; `append_to_response` **contains** `alternative_titles`; appended block parses into `details.alternative_titles` + stays verbatim in `tmdb_raw`). Extend `make_details` with an optional `alternative_titles` block. Run the unit dir → FAIL.
- [ ] **Step 2 — Implement.** Add the two nested DTOs + the `alternative_titles` field on `TMDBMovieDetails`; add/widen the `append_to_response` param on `movie_details` (include `alternative_titles`, don't clobber a sibling's value). Run; tests pass. Existing client/schema tests (status/imdb/raw capture) stay green.

## Task 3: Upsert rebuild step (TDD)

**Files:** Modify `ingest/tmdb/upsert.py`; Test `tests/integration/ingest/tmdb/test_upsert.py`.

- [ ] **Step 1 — Failing tests.** Add: populates `film_alternative_title` (titles/countries/types correct); idempotent re-run (no dup rows); rebuild-on-change (new set replaces stale); no-`alternative_titles` is a no-op; cascade-delete with the film. Run the integration dir → FAIL.
- [ ] **Step 2 — Implement.** Add the guarded `_upsert_alternative_titles` step (`DELETE WHERE film_id` + bulk insert), call it from `upsert_film`. Run; tests pass. Existing upsert idempotency/rebuild tests stay green.

## Task 4: DTO exposure — notable alt-titles (TDD)

**Files:** Modify `public/dto.py`, `public/service.py`, `tests/fixtures/public.py`; Test `tests/integration/routers/test_public_films.py`.

- [ ] **Step 1 — Fixture.** Add a small async helper to `tests/fixtures/public.py` to attach `film_alternative_title` rows to a film. Keep it additive.
- [ ] **Step 2 — Failing tests.** Extend the film-detail tests: alt-titles surface as distinct strings, excluding any equal to `title`/`original_title`, deterministically ordered + capped; a film with no alt-titles returns `alternative_titles == []`. Keep existing detail assertions intact. Run `task test -- tests/integration/routers/test_public_films.py` → FAIL.
- [ ] **Step 3 — Implement.** Add `alternative_titles: list[str] = []` to `FilmDetailResponse`; add the scoped `select` + dedup/exclude/order/cap in `get_film_detail` (import `FilmAlternativeTitle`); pass through. Run; tests pass.

## Task 5: Search extension (TDD) — **requires NEU-400 merged**

**Files:** Modify `public/service.py`; Test `tests/integration/routers/test_public_films.py`.

- [ ] **Step 0 — Rebase check.** Confirm NEU-400 has merged into the base branch and rebase onto it: `public/service.py` must contain `get_film_search` + the `_title_match` seam (and `routers/public.py` the `/films/search` route). If absent → **stop and surface the blocker** (do not re-implement NEU-400's endpoint).
- [ ] **Step 1 — Failing tests.** Add the search cases from "TDD testing intent": found-by-AKA (primary title doesn't match, alt-title does); de-dup (matches on both → one row); visibility parity (alt-match but hidden/no-slug → excluded); primary-first ranking. Run `task test -- tests/integration/routers/test_public_films.py` → FAIL.
- [ ] **Step 2 — Implement.** OR the alt-title correlated `EXISTS` into NEU-400's `_title_match` (same escaped pattern), and add the primary-first leading `order_by` tiebreak in `get_film_search` (factor a reusable `_primary_title_match(term)` if cleaner). Leave `get_film_index` untouched. Run; search tests pass; NEU-400's existing search + index regression tests stay green.

## Task 6: Full verification + ship

**Files:** none (verification + git only).

- [ ] **Step 1 — Full local gate.** `task test`, `task lint`, `task typecheck` green; `task format` on touched files. `alembic heads` single-headed.
- [ ] **Step 2 — Confirm scope.** `git diff --stat` confined to the files in "Key files touched"; the migration is additive with **no** data step; `client.movie_details` issues **one** request carrying `append_to_response` (respx asserts it). The search change is confined to `get_film_search`/`_title_match` (no `get_film_index` behavior change).
- [ ] **Step 3 — Single PR.** Suggested subject: `feat(catalog): ingest TMDB alternative titles and match them in search`. PR title: same + ` (NEU-406)`. PR body ends with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.

---

## Acceptance criteria

1. The tmdb ingest fetches alternative titles via `append_to_response` on the existing `/movie/{id}` call — **no extra HTTP request** (respx asserts a single request carrying the param, including `alternative_titles`) — and populates `catalog.film_alternative_title` with per-country, typed rows.
2. The upsert is **idempotent** — rebuilt delete-and-reinsert per film; re-ingest yields the same row set; churn (added/dropped alt-title) is reflected; a film without alt-titles is a no-op; rows cascade-delete with the film.
3. `GET /films/search` matches **alternate titles** in addition to the primary/original title (a film findable by an AKA / foreign title), returning each film **once**, with **primary-title hits ranked ahead** of alt-title-only hits, and the same visibility rule and envelope as NEU-400 (a hidden/slug-less film matching only via an alt-title stays excluded). Alt-title matching uses the same normalization/escaping as the primary match, OR-ed into NEU-400's `_title_match` seam — no new route/DTO/caller change.
4. `GET /films/{slug}` exposes notable `alternative_titles` (distinct strings differing from `title`/`original_title`, ordered, capped); empty → `[]`. NEU-407 (FE) consumes this DTO.
5. An **additive** Alembic migration creates `catalog.film_alternative_title` + index(es), chains single-headed off the then-current head, and contains **no data step**; per-film TMDB volume is unchanged (1 request).
6. `task test` / `task lint` / `task typecheck` green; `task format` clean; existing ingest, upsert, NEU-396, NEU-400 search, and public-films tests still pass unchanged.

## Self-Review

**Spec coverage** (against NEU-406 + M5 §"Story NEU-391 / NEU-406" + NEU-391 parent acceptance):
- `film_alternative_title` schema — surrogate `BigInteger` PK, `film_id` cascade FK, country plain-text (no FK), `title` not-null, nullable `title_type` → Schema + Task 1. ✓
- Shared single `append_to_response` fetch (1 request, widen-don't-clobber, includes `alternative_titles`) → Fetch+upsert + Global Constraints + Task 2 + Acceptance #1. ✓
- Idempotent delete-and-reinsert upsert, no reference table → Fetch+upsert + Task 3 + Acceptance #2. ✓
- Additive migration off head, no data step, single-headed → Global Constraints + Task 1 Step 3 + Acceptance #5. ✓
- Search extension as a localized OR into NEU-400's `_title_match`, correlated `EXISTS` de-dup, primary-first ranking, visibility/envelope preserved, blocked-on-NEU-400 rebase → Search extension + Task 5 + Acceptance #3. ✓
- DTO exposure: notable distinct alt-titles excluding primary/original, ordered, capped, graceful empty → DTO section + Task 4 + Acceptance #4. ✓
- Index strategy mirrors NEU-400 (substring ILIKE ⇒ `film_id` index only, unless NEU-400 shipped a title index) → Schema "Indexes" note. ✓
- Which part of M5 + NEU-391 parent acceptance + NEU-407 FE seam → "Which part of M5". ✓
- TDD intent: ingest populates alt-titles, search matches an AKA, DTO exposes them, idempotent → TDD testing intent + Tasks 1–5. ✓
- No `relationship()` on `Film`; explicit scoped `select` (NEU-396 style); resilient to sibling M5 tickets sharing the plumbing → Architecture + Global Constraints. ✓

**Placeholder scan:** none — no fabricated signatures; the column/DTO tables are intent, light on exact code per the resilient-plan brief. The only code fragments (the alt-title `EXISTS` shape) are explicitly illustrative and deferred to NEU-400's merged seam.

**Type/shape consistency:** `FilmAlternativeTitle` columns match the upsert `values(...)` keys and the DTO/search selects; `alternative_titles: list[str]` on `FilmDetailResponse` matches what `get_film_detail` constructs and the tests assert; the `BigInteger` PK autoincrements without extra args; join/select results wrapped in `list(...)` for pyright.

**Resilience:** the search half is gated behind an explicit NEU-400 rebase check (surface-the-blocker, don't re-implement); the `append_to_response` value and the alt-title title-index are framed as "widen/mirror whatever exists at impl time," not pinned; helper/field names are suggestions ("e.g."); chain off the then-current Alembic head, not a hard-coded revision.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
