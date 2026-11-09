**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md

# NEU-402 `[backend]` — Ingest TMDB credits (people/credits schema + DTO) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This is a **TDD** ticket — write the failing test first, watch it fail, then make it pass. Steps use checkbox (`- [ ]`) syntax for tracking. The plan is deliberately light on exact signatures: follow the **existing patterns** in the cited files rather than copying snippets verbatim.

**Goal:** Realize the long-reserved `catalog` "people, credits" seam. Add two new normalized tables — `catalog.person` (reference, natural TMDB-id key) and `catalog.film_credit` (the per-credit edge) — fetch cast & crew from TMDB by **appending `credits` to the existing `/movie/{id}` call** (no extra HTTP request), normalize them into those tables during the existing `upsert_film` orchestration (person upserted by natural key; credits rebuilt delete-and-reinsert per film), ship one additive Alembic migration, and expose **top-billed cast** (name/character/profile_path) + **director(s)** on the shared `FilmDetailResponse`. Every surfaced field is empty-defaulted so the frontend (NEU-403) omits gracefully when credits are absent.

**Architecture:** This is the **first** of M5's three backend tickets, so it introduces the shared plumbing the siblings extend:

- **Schema** (`catalog/models.py`): two new models following the existing `Genre`/`FilmGenre` reference-plus-join template — `Person` mirrors `Genre`'s non-autoincrement natural PK; `FilmCredit` is a per-film detail row (rebuilt each ingest) keyed by TMDB's stable `credit_id`.
- **Fetch** (`ingest/tmdb/client.py` + `schemas.py`): `movie_details` gains `params={"append_to_response": "credits,release_dates,alternative_titles"}` — the **full shared triple** the milestone recommends, even though THIS PR only parses `credits`. The other appended sub-objects (`release_dates`, `alternative_titles`) ride along into the verbatim `tmdb_raw` and are parsed by the sibling tickets (NEU-404 / NEU-406) without re-touching the client. New nested DTOs (`extra="ignore"`) parse the `credits` key; `TMDBMovieDetails` gains `credits`.
- **Upsert** (`ingest/tmdb/upsert.py`): a new guarded step in `upsert_film` — upsert the union of cast+crew people by natural key (`ON CONFLICT (id) DO UPDATE`, names/profile drift), then rebuild `film_credit` (`DELETE WHERE film_id` → bulk insert), exactly the delete-and-reinsert idempotency the existing joins use.
- **Read path** (`public/dto.py` + `public/service.py`): `FilmDetailResponse` gains `cast` + `directors`; `get_film_detail` adds two small scoped `select`s keyed by `film.id` (joining `film_credit` → `person`), in the NEU-396 explicit-`select` style. **No `relationship()` is added to `Film`.**

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async) + asyncpg, Alembic, Pydantic v2 (`extra="ignore"`), httpx + respx (mock TMDB; never hit the network), pytest (pytest-asyncio `auto` mode). Everything runs in the container via `task` — **never** `pytest`/`ruff`/`pyright`/`alembic`/`python` on the host.

## Global Constraints

- **Repo:** `upcoming-movies-backend` (under the `~/projects/upcoming-movies/` umbrella). Paths below are relative to that repo root.
- **Branch:** use the Linear-provided branch for NEU-402 (one ticket = one PR = one `/implementit` run). **No blockers** — this is the lead M5 backend ticket; NEU-403 (FE) and the sibling backend tickets (NEU-404/406) build on its merged plumbing.
- **Run everything in the container via `task`.** Keep the `upmovies-backend` container up. Green before done: `task test`, `task lint`, `task typecheck` all pass; run `task format` on touched files. No new runtime deps → no `task build` needed.
- **Migration workflow (per repo CLAUDE.md):** add the model columns **first** (tests get the tables via `create_all` in `tests/conftest.py`), then `task makemigration -- "add person and film_credit tables"`, **review** the generated file (adjust indexes/`schema='catalog'`/FK `ondelete` to match the models), then `task migrate`. Confirm `alembic heads` stays **single-headed**.
- **Chain off the current head.** At authoring time the single head is **`6d7e2769ba35`** (`add ingest.run_llm_usage table`); `task makemigration` will set `down_revision` to whatever head exists at implementation time — if a sibling/other migration merged first, chain off **that** head (the milestone designs three additive migrations chaining in merge order; this is the first). The migration is **additive only — no data step** (backfill is a re-fetch, see below).
- **Stay additive on the shared DTO.** `FilmDetailResponse` / `get_film_detail` are also widened by NEU-396 (M2) and the sibling M5 tickets. **Add** `cast` + `directors` (empty-defaulted); do **not** rename, reorder, or remove existing fields (`slug/title/release_date/release_year/poster_path/arc_stage/events`, plus whatever NEU-396 added). Existing detail tests read response keys individually, so additive fields won't break them. If NEU-396 has merged, rebase and overlay; if not, design for a clean additive merge.
- **One request per film.** The append param keeps per-film TMDB volume at exactly **1 request**. A respx assertion must confirm `movie_details` issues a single call carrying `append_to_response` (milestone acceptance #4). Do **not** add a second `/movie/{id}/credits` call.
- **Backfill = re-fetch, not a data migration.** The appended `credits` were never in the old `tmdb_raw`, so existing rows can't be backfilled from the DB — the next scheduled tmdb ingest re-fetches in-window films idempotently with the new param (populating the new tables for free); a one-off admin re-ingest covers the rest. **Dev:** `TRUNCATE catalog.film CASCADE` (the new tables cascade via `film_id`) + re-ingest. The Alembic file contains **no** data step.
- **Determinism (SSR/snapshot-friendly).** Every surfaced list has a deterministic `order_by` (see selection rules below). Empty join → `[]`, never `null`.
- **Commits/PR:** Conventional Commits subject, **no** Linear ID in the commit subject (optional `Refs NEU-402.` in body), **no** footer / `Co-Authored-By` in the commit. PR **title** carries the trailing `(NEU-402)`; the `🤖 Generated with Claude Code` footer goes in the PR **body** only.

---

## Schema (new `catalog` tables)

### `catalog.person` — reference table (natural key)

Mirrors `Genre`/`ProductionCompany`: `Integer` PK, `autoincrement=False`, `schema="catalog"`. Upserted `ON CONFLICT (id) DO UPDATE` (names/profile paths drift over time).

| Column | Type | Null? | TMDB source | Notes |
|---|---|---|---|---|
| `id` | `Integer` PK, `autoincrement=False` | no | `id` | TMDB person id (natural key) |
| `name` | `Text` | no | `name` | |
| `original_name` | `Text` | yes | `original_name` | |
| `profile_path` | `Text` | yes | `profile_path` | FE builds the image URL |
| `known_for_department` | `Text` | yes | `known_for_department` | |
| `gender` | `Integer` | yes | `gender` | TMDB enum (0–3) |
| `popularity` | `Float` | yes | `popularity` | |

### `catalog.film_credit` — the credit edge (rebuilt per film)

Per-film detail row; **not** a composite-PK join (a person can hold multiple credits on one film), so it uses TMDB's stable per-credit id as PK.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `credit_id` | `Text` PK | no | TMDB's stable per-credit id |
| `film_id` | `UUID` FK → `catalog.film.id` `ondelete="CASCADE"` | no | matches the existing join FK pattern |
| `person_id` | `Integer` FK → `catalog.person.id` | no | |
| `credit_type` | `Text` | no | `'cast'` or `'crew'` |
| `department` | `Text` | yes | `'Acting'` for cast; crew `department` (e.g. `'Directing'`) |
| `job` | `Text` | yes | crew `job` (e.g. `'Director'`); null for cast |
| `character` | `Text` | yes | cast `character`; null for crew |
| `credit_order` | `Integer` | yes | cast `order` (top-billing); null for crew |

**Indexes** (declare in `__table_args__`, mirroring `Film`'s `Index(...)` usage): `ix_catalog_film_credit_film` on `film_id` (the read is always film-scoped) and `ix_catalog_film_credit_person` on `person_id` (FK hygiene; leaves a future filmography open without a re-ingest — but no person page ships here).

> Note: `character` is a fine SQLAlchemy attribute name (not a Python keyword). Keep the `Mapped[...] / mapped_column(...)` style used throughout `catalog/models.py`; no `relationship()`.

## Fetch (client + DTOs)

- **`ingest/tmdb/client.py::movie_details`** — add `params={"append_to_response": "credits,release_dates,alternative_titles"}` to the `_request("GET", url, ...)` call. Keep the existing `details.tmdb_raw = data` line so the **full appended JSON** (including the not-yet-parsed `release_dates`/`alternative_titles`) is retained verbatim. Resilient note: if a sibling ticket has already added the param, ensure the value still **contains `credits`** rather than overwriting their wider string.
- **`ingest/tmdb/schemas.py`** — new nested models, all `extra="ignore"`:
  - `TMDBCastMember` — `id, name, original_name, profile_path, known_for_department, gender, popularity, character, order, credit_id` (all optional except `id`/`name`/`credit_id`).
  - `TMDBCrewMember` — same person fields plus `department, job, credit_id` (no `character`/`order`).
  - `TMDBCredits` — `cast: list[TMDBCastMember]` + `crew: list[TMDBCrewMember]`, both `Field(default_factory=list)`.
  - `TMDBMovieDetails` gains `credits: TMDBCredits | None = None` (the appended key is `credits`).

## Upsert wiring (`ingest/tmdb/upsert.py`)

Add a guarded step to `upsert_film` after the existing relations, e.g. `_upsert_credits(session, film_id, details)`, no-op when `not details.credits`:

1. **People** — collect the **union of cast + crew**, **deduped by `id`** (a person can appear in both arrays, or twice), then `insert(Person).values([...]).on_conflict_do_update(index_elements=[Person.id], set_={name, original_name, profile_path, known_for_department, gender, popularity})` — same shape as `_upsert_references`.
2. **Credits** — `delete(FilmCredit).where(FilmCredit.film_id == film_id)`, then bulk `insert(FilmCredit)` of one row per cast member (`credit_type='cast'`, `character`, `credit_order=order`, `department` from the member or `'Acting'`, `job=None`) and one per crew member (`credit_type='crew'`, `department`, `job`, `character=None`, `credit_order=None`). **Dedupe the inserted rows by `credit_id`** (PK) to avoid an in-statement conflict on the rare duplicate. Same delete-and-reinsert idempotency as `_rebuild_joins`.

The caller still owns the transaction (one commit per film). A film lacking `credits` writes nothing new.

## Migration

One additive migration: `create_table('person', …)` and `create_table('film_credit', …)` + the two `film_credit` indexes, all `schema='catalog'`, with `film_id` FK `ondelete='CASCADE'` and the `person_id` FK. `down_revision` = the then-current head (`6d7e2769ba35` at authoring time). **No data step.** `downgrade` drops the indexes + both tables (drop `film_credit` before `person`).

## DTO / read path (`public/dto.py` + `public/service.py`)

Extend the shared `FilmDetailResponse`:

| DTO field | Type | Selection | Notes |
|---|---|---|---|
| `cast` | `list[CastMemberOut]` (default `[]`) | `film_credit` where `credit_type='cast'`, joined to `person`, `order by credit_order asc nulls last, person.name asc`, **limit N (≈12)** | `CastMemberOut{ name, character, profile_path }` |
| `directors` | `list[str]` (default `[]`) | `film_credit` where `credit_type='crew' and job='Director'`, joined to `person.name`, ordered by `credit_order` nulls-last / `name` | director name(s); TMDB can list co-directors |

- New nested DTO `CastMemberOut(BaseModel)` — `name: str`, `character: str | None`, `profile_path: str | None`.
- In `get_film_detail`, after the `Film` row is fetched, add two scoped `select`s keyed by `film.id` (use `nulls_last(FilmCredit.credit_order.asc())` exactly as the service already imports/uses `nulls_last`). Wrap `.scalars().all()` / `.all()` results in `list(...)` for pyright. Pass `cast` + `directors` through to `FilmDetailResponse(...)` alongside the existing fields. The route (`routers/public.py`) is unchanged — `response_model=FilmDetailResponse` flows the new fields automatically.
- "**Top-billed**" = cast ordered by `credit_order asc nulls last`, capped at N. "**Director(s)**" = crew rows with `job='Director'`.

---

## Which part of M5 this realizes

Story **NEU-389** ("Film page shows cast & crew"), **backend half** + the milestone's **shared plumbing** (the append-param client change and the lead additive migration). Milestone acceptance **#1** (credits ingested via `append_to_response`, no extra HTTP call; `person` + `film_credit` populated; DTO exposes top-billed `cast` + `directors`) and **#4** (additive migration chains single-headed off `6d7e2769ba35`; per-film volume stays 1 request). NEU-403 (FE cast & crew section) is blocked on this DTO.

## File Structure

- **Modify** `src/upmovies/catalog/models.py` — add `Person` + `FilmCredit` models (+ the two indexes).
- **Modify** `src/upmovies/ingest/tmdb/client.py` — add the `append_to_response` param to `movie_details`.
- **Modify** `src/upmovies/ingest/tmdb/schemas.py` — add `TMDBCastMember` / `TMDBCrewMember` / `TMDBCredits`; add `credits` to `TMDBMovieDetails`.
- **Modify** `src/upmovies/ingest/tmdb/upsert.py` — add the `_upsert_credits` step (person upsert + `film_credit` rebuild), called from `upsert_film`.
- **Modify** `src/upmovies/public/dto.py` — add `CastMemberOut`; add `cast` + `directors` to `FilmDetailResponse`.
- **Modify** `src/upmovies/public/service.py` — add the two scoped credit `select`s in `get_film_detail`; import `Person`, `FilmCredit`.
- **New** Alembic migration under `migrations/versions/` (generated by `task makemigration`).
- **Modify tests** — `tests/fixtures/tmdb.py` (credits in `make_details`), `tests/integration/ingest/tmdb/test_upsert.py`, `tests/unit/ingest/tmdb/test_client.py`, `tests/unit/ingest/tmdb/test_schemas.py`, `tests/fixtures/public.py` (attach credits helper), `tests/integration/routers/test_public_films.py`.

---

## Task 1: Schema + migration (TDD)

**Files:** Modify `src/upmovies/catalog/models.py`; Test `tests/integration/test_models.py` (or a focused integration test); generated migration.

- [ ] **Step 1 — Failing test:** add an integration test that inserts a `Person` and a `FilmCredit` (FK to a `Film`) and reads them back, asserting the PK/columns/`ondelete='CASCADE'` behavior (deleting the film removes its credits). Run the relevant test dir → FAIL (models don't exist). *(Per the repo gotcha, run a whole file/dir — single-test isolation trips a pytest-asyncio session-loop warning.)*
- [ ] **Step 2 — Models:** add `Person` (natural Integer PK like `Genre`) and `FilmCredit` (Text `credit_id` PK, `film_id`/`person_id` FKs, `credit_type/department/job/character/credit_order`, the two indexes), `schema="catalog"`, following the `catalog/models.py` style. Tests pick the tables up via `create_all`. → test PASSES.
- [ ] **Step 3 — Migration:** `task makemigration -- "add person and film_credit tables"`; review the file — confirm both `create_table(..., schema='catalog')`, the two `film_credit` indexes, `film_id` FK `ondelete='CASCADE'`, `person_id` FK, **no data step**, and `down_revision` chains off the current head. `task migrate`; `alembic heads` single-headed.

## Task 2: Client append-param + credit DTOs (TDD)

**Files:** Modify `src/upmovies/ingest/tmdb/client.py`, `schemas.py`; Test `tests/unit/ingest/tmdb/test_client.py`, `test_schemas.py`.

- [ ] **Step 1 — Failing tests:**
  - `test_client.py` (respx): mock `/movie/{id}` and assert (a) exactly **one** request is made, (b) its query carries `append_to_response` including `credits`, and (c) a payload with a `credits: {cast, crew}` block parses into `details.credits` while `tmdb_raw` keeps the verbatim payload.
  - `test_schemas.py`: a `credits` block validates into `TMDBCredits` with typed `cast`/`crew`; extra TMDB keys are ignored; absent `credits` → `None`.
  Run the unit dir → FAIL.
- [ ] **Step 2 — Implement:** add the `append_to_response=credits,release_dates,alternative_titles` param in `movie_details`; add the three nested DTOs + `credits` on `TMDBMovieDetails`. → tests PASS.

## Task 3: Upsert wiring (TDD)

**Files:** Modify `src/upmovies/ingest/tmdb/upsert.py`, `tests/fixtures/tmdb.py`; Test `tests/integration/ingest/tmdb/test_upsert.py`.

- [ ] **Step 1 — Fixture:** extend `make_details` to accept a `credits` override (default a small `{cast:[...], crew:[...]}` with at least one cast member carrying `order`/`character`/`credit_id` and one crew `Director`), defaulting so existing callers are unaffected.
- [ ] **Step 2 — Failing tests:** add cases asserting (a) ingest populates `catalog.person` (union of cast+crew, deduped) and `catalog.film_credit` with correct `credit_type/job/character/credit_order`; (b) **re-ingest is idempotent** (same final rows, no duplicate-key error — credits rebuilt); (c) re-ingesting with a **changed** cast/crew set removes stale credits (delete-and-reinsert); (d) a film with **no** `credits` writes no person/credit rows (graceful). Run the integration dir → FAIL.
- [ ] **Step 3 — Implement:** add `_upsert_credits` (person `on_conflict_do_update` by id; `film_credit` delete-and-reinsert, deduped by `credit_id`), call it from `upsert_film`. → tests PASS.

## Task 4: DTO exposure — top cast + directors (TDD)

**Files:** Modify `src/upmovies/public/dto.py`, `src/upmovies/public/service.py`, `tests/fixtures/public.py`; Test `tests/integration/routers/test_public_films.py`.

- [ ] **Step 1 — Fixture:** add a small async helper to `tests/fixtures/public.py` to attach credits to a film (insert `Person` rows with explicit ids — natural PK — then `FilmCredit` rows for cast with `credit_order`/`character` and crew with `job='Director'`). Keep it additive.
- [ ] **Step 2 — Failing tests:** extend the film-detail tests:
  - cast comes back **top-billed** (`credit_order asc nulls last`, then name), capped at N, each item `{name, character, profile_path}`;
  - `directors` lists `job='Director'` crew name(s) (incl. co-directors);
  - a film with **no** credits returns `cast == []`, `directors == []`, `200` (graceful).
  Keep existing detail assertions (events/sources/NEU-396 fields) intact. Run `task test -- tests/integration/routers/test_public_films.py` → FAIL.
- [ ] **Step 3 — Implement:** add `CastMemberOut` + `cast`/`directors` to `FilmDetailResponse`; add the two scoped `select`s (join `film_credit`→`person`, `nulls_last` ordering, cast `limit N`) in `get_film_detail`; wrap results in `list(...)`. → tests PASS.

## Task 5: Full verification + ship

- [ ] **Step 1 — Local gate:** `task test`, `task lint`, `task typecheck`, `task format` all green; `alembic heads` single-headed; no unused imports.
- [ ] **Step 2 — Manual smoke (optional):** with the stack up, re-ingest a film with credits and `GET /films/{slug}` → populated top-billed `cast` + `directors`; a credit-less film → `cast: []`, `directors: []` without error. Confirm a single TMDB request carries `append_to_response` (respx already asserts this).
- [ ] **Step 3 — Single commit + PR:** commit once on the Linear branch. Suggested subject: `feat(catalog): ingest tmdb credits and expose cast & directors`. PR title: same + ` (NEU-402)`. PR body ends with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.

---

## Testing intent (TDD summary)

- **Client:** one request, carries `append_to_response` w/ `credits`; `credits` parses; `tmdb_raw` verbatim (respx, no network).
- **Schemas:** `TMDBCredits`/cast/crew typed; extra keys ignored; absent → `None`.
- **Upsert:** populates `person` (deduped union) + `film_credit` (typed); idempotent re-ingest; stale-credit removal on change; credit-less film is a no-op; backfill path is the idempotent re-ingest (not a data migration).
- **DTO:** top-billed cast (ordered, capped, `{name,character,profile_path}`) + directors; graceful empties; existing detail/NEU-396 tests unchanged.
- **Migration:** applies cleanly, additive, single-headed off `6d7e2769ba35`, no data step.

## Self-Review

**Spec coverage** (against NEU-402 + the M5 spec's NEU-389 section):
- `catalog.person` natural-key reference + `catalog.film_credit` `credit_id`-PK edge, with both indexes → Schema + Task 1. ✓
- Single appended fetch (`append_to_response=credits,release_dates,alternative_titles`), 1 request/film, verbatim `tmdb_raw` → Fetch + Task 2 (respx single-request assertion). ✓
- Person upsert by natural key + `film_credit` delete-and-reinsert idempotency, guarded/no-op when absent → Upsert + Task 3. ✓
- One additive migration, no data step, single-headed off `6d7e2769ba35` (or then-current head) → Migration + Task 1 Step 3. ✓
- Shared `FilmDetailResponse` additively gains top-billed `cast` + `directors`; explicit scoped `select`s, no `relationship()`; deterministic ordering; graceful empties → DTO/read path + Task 4. ✓
- Backfill = re-fetch (idempotent next ingest / admin re-ingest / dev TRUNCATE CASCADE), not an Alembic data step → Global Constraints + Testing intent. ✓
- TDD red→green per task, whole-file/dir runs (pytest-asyncio gotcha), respx-mocked TMDB → every task. ✓

**Placeholder scan:** none — all snippets are illustrative; steps describe intent + exact `task` commands.

**Type/shape consistency:** `CastMemberOut`/`FilmDetailResponse` field names match what `get_film_detail` constructs and the tests assert; `Person`/`FilmCredit` columns match the upsert `values(...)` keys and the DTO selects; reference (`Person`) rows inserted with explicit natural PKs in fixtures; join results wrapped in `list(...)` for pyright.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
