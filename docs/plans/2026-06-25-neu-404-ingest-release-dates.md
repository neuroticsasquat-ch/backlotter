**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md

# NEU-404 `[backend]` — Ingest TMDB release_dates (+types) + expose on DTO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This is a **TDD** ticket — write the failing test first, watch it fail, then make it pass. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest TMDB's per-country `/movie/{id}/release_dates` sub-object (the six TMDB release `type`s — 1 Premiere · 2 Theatrical limited · 3 Theatrical wide · 4 Digital · 5 Physical · 6 TV) into a new normalized `catalog.film_release_date` table, fetched **inside the existing per-film `/movie/{id}` call** via `append_to_response` (no extra HTTP call), upserted idempotently (delete-and-reinsert per film), backed by an additive Alembic migration, and surfaced as a labeled home-region slice on the public film-detail DTO. The same table — with a forward-looking `(release_date, release_type)` index — is the substrate the Release-calendar `GET /calendar` endpoint (**NEU-408**, separate milestone, blocked on this ticket) will range-scan; this ticket ships **only** the schema, index, ingest, and film-page projection, **not** the calendar endpoint.

**Architecture:** Five backend source files plus their tests. New SQLAlchemy model `FilmReleaseDate` in `catalog/models.py` (surrogate `BigInteger` PK, FK→`film.id ON DELETE CASCADE`, two indexes). New TMDB DTOs in `ingest/tmdb/schemas.py` (`TMDBReleaseDate` / `TMDBReleaseDatesByCountry` / `TMDBReleaseDates`) + a `release_dates` field on `TMDBMovieDetails`. The TMDB client (`ingest/tmdb/client.py`) gains the shared `append_to_response` param so the sub-object rides along in the one existing request. `upsert_film` (`ingest/tmdb/upsert.py`) gains one rebuild step (flatten `results[].release_dates[]`, `DELETE WHERE film_id` + bulk insert) following the **exact** existing delete-and-reinsert join idempotency. `get_film_detail` (`public/service.py`) adds one scoped `select` keyed by `film.id`, projected through a new `ReleaseDateOut` on `FilmDetailResponse` (`public/dto.py`) with a small pure integer→label map. **`Film` gains no ORM `relationship()`** — the read follows the service's existing explicit-`select` style (same as NEU-396's genres/companies joins). An additive Alembic migration creates the table + indexes; **no data step** (backfill is a re-fetch, not a migration).

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async) + asyncpg, Alembic, Pydantic v2, httpx, pytest (pytest-asyncio `auto` mode), respx for HTTP mocking. Everything runs in the container via `task` — **never** `pytest`/`ruff`/`pyright`/`alembic` on the host.

## Global Constraints

- **Repo:** `upcoming-movies-backend` (under the `~/projects/upcoming-movies/` umbrella). Paths below are relative to that repo root.
- **Branch:** use the Linear-provided branch for NEU-404 (one ticket = one PR = one `/implementit` run). **No blockers** — this ticket can start immediately and unblocks NEU-405 (FE) and NEU-408 (calendar).
- **Run everything in the container via `task`.** Keep the `upmovies-backend` container up. Green before done: `task test`, `task lint`, `task typecheck` all pass; run `task format` on touched files. No new third-party deps, so no `task build` needed. Pre-commit hooks delegate into Docker — commit normally (no `--no-verify`).
- **One appended fetch, not a second call.** The release-dates sub-object MUST be fetched via `append_to_response` on the existing `GET /movie/{id}` request — per-film TMDB volume stays at **1 request**. A separate `GET /movie/{id}/release_dates` call is explicitly wrong.
- **Resilient to sibling M5 tickets.** NEU-402 (credits) and NEU-406 (alt-titles) touch the **same** shared plumbing (`client.movie_details`'s append param, `TMDBMovieDetails`, `upsert_film`, `FilmDetailResponse`, `get_film_detail`) and each adds its own additive migration off the same head. **Add, never overwrite:** when widening the `append_to_response` param, include `release_dates` alongside whatever is already there (don't clobber a sibling's `credits`/`alternative_titles`); add new DTO fields/steps without reordering existing ones. If a sibling has already merged, rebase and overlay cleanly; if not, design so a later merge is additive. This ticket's logical slice is **only** the release-dates field, model, upsert step, and DTO field.
- **Idempotent ingest.** `film_release_date` is rebuilt per film (`DELETE WHERE film_id = :id` then bulk insert) — re-running ingest over the same film yields the same final rows; a film gaining/dropping a country/type/date between runs is reflected. The caller owns the transaction (the service commits once per film); the upsert step is pure DB I/O, no commit.
- **Additive migration, no data step.** The appended sub-object was never in the old `tmdb_raw`, so existing rows can't be backfilled in SQL — backfill is the next scheduled re-ingest (re-fetches in-window films with the new append param) + a one-off admin re-ingest; dev is `TRUNCATE catalog.film CASCADE` + re-ingest. The migration contains **only** `create_table` + `create_index`. Generate it with `task makemigration` **after** the model exists, set `down_revision` to the then-current `alembic heads` (single-headed), review, `task migrate`.
- **Determinism (SSR/snapshot-friendly).** Order the DTO's `release_dates` list deterministically (by `release_date` asc, then a stable tiebreak — e.g. `release_type` asc, then country) so the payload is byte-stable for SSR/snapshots. Empty → `[]`, never `null`.
- **Commits/PR:** Conventional Commits subject, **no** Linear ID in the commit subject (optional `Refs NEU-404.` in the body), **no** footer/`Co-Authored-By` in the commit. PR **title** carries the trailing `(NEU-404)`; the `🤖 Generated with Claude Code` footer goes in the PR **body** only. Single PR for the ticket.

---

## Schema — `catalog.film_release_date`

Granular per-(film, country, type, date) rows, rebuilt per film. Surrogate PK because `(film_id, country, type)` is **not** unique (re-releases, multiple typed entries per country). Country is **plain `Text`, no FK** to `production_country` — release countries routinely include codes a film never lists as a production country, and an FK would reject valid rows (an intentional divergence from the `film_production_country` FK pattern).

| Column | Type | TMDB source | Notes |
|---|---|---|---|
| `id` | `BigInteger`, PK (autoincrement / identity) | — | surrogate; no natural uniqueness |
| `film_id` | `UUID`, FK → `catalog.film.id` `ON DELETE CASCADE`, not null | — | the per-film owner |
| `iso_3166_1` | `Text`, not null | `results[].iso_3166_1` | country code; **plain text, no FK** |
| `release_type` | `Integer`, not null | `release_dates[].type` | TMDB enum 1–6 (premiere/limited/wide/digital/physical/TV) |
| `release_date` | `DateTime(timezone=True)`, not null | `release_dates[].release_date` | TMDB returns full ISO `…T00:00:00.000Z`; store as timestamptz |
| `certification` | `Text`, nullable | `release_dates[].certification` | e.g. `"PG-13"` (may be `""` → store as-is or null) |
| `note` | `Text`, nullable | `release_dates[].note` | free-text (e.g. "Cannes Film Festival") |
| `iso_639_1` | `Text`, nullable | `release_dates[].iso_639_1` | language tag |

**Indexes** (declare in the model's `__table_args__` alongside `{"schema": "catalog"}`, mirroring `Film`'s `Index(...)` pattern):

- `ix_catalog_film_release_date_film` on `film_id` — the film-page read (`WHERE film_id = :id`).
- **`ix_catalog_film_release_date_lookup` on `(release_date, release_type)`** — the forward-looking calendar query. `GET /calendar` (NEU-408) runs `WHERE release_date >= :today AND release_type IN (1,2,3)` ordered by date across **all** films; indexing the date column (not just `film_id`) is what makes that range scan efficient. **This index is the seam for NEU-408** and is part of this ticket's acceptance even though the calendar endpoint is out of scope.

Model conventions to match `catalog/models.py`: `Mapped[...]` / `mapped_column`, import `BigInteger`/`Integer`/`Text`/`DateTime`/`ForeignKey`/`Index` from `sqlalchemy` and `UUID as PGUUID` from `sqlalchemy.dialects.postgresql`; `__table_args__ = (Index(...), Index(...), {"schema": "catalog"})`. A sole `BigInteger` PK autoincrements (Postgres identity/serial) — no extra args needed. Adding the class to `models.py` is enough for tests (conftest `create_all` builds it); prod gets it via the migration.

## Fetch + upsert wiring (shared `append_to_response`)

- **Client (`ingest/tmdb/client.py`).** `movie_details` currently does a bare `GET /movie/{id}`. Add `params={"append_to_response": "release_dates"}` so the sub-object rides along in the one response (resilient: if a sibling already added the param, **widen** the comma list to include `release_dates`, don't replace). The appended object arrives as a nested `release_dates: {results: [...]}` key on the same JSON; it lands in `tmdb_raw` verbatim (already captured — the client assigns `details.tmdb_raw = data` post-validation) **and** is parsed into the typed field below.
- **DTOs (`ingest/tmdb/schemas.py`).** Add (all `extra="ignore"`):
  - `TMDBReleaseDate` — `certification: str | None`, `iso_639_1: str | None`, `note: str | None`, `release_date: datetime`, `type: int`.
  - `TMDBReleaseDatesByCountry` — `iso_3166_1: str`, `release_dates: list[TMDBReleaseDate]`.
  - `TMDBReleaseDates` — `results: list[TMDBReleaseDatesByCountry]`.
  - `TMDBMovieDetails` gains `release_dates: TMDBReleaseDates | None = None` (additive field; the appended JSON key is `release_dates`).
- **Upsert (`ingest/tmdb/upsert.py`).** Add a `film_release_date` rebuild guarded `if details.release_dates and details.release_dates.results:` — `DELETE WHERE film_id == film_id`, then a single bulk `insert` of one row per `(country, entry)` flattening `results[].release_dates[]` into `{film_id, iso_3166_1, release_type, release_date, certification, note, iso_639_1}`. No reference table (unlike person/genre). Place the delete next to the existing `_rebuild_joins` deletes (or a sibling helper) and the insert alongside the existing bulk inserts — same shape, same idempotency. A film with no `release_dates` is a clean no-op.

## DTO exposure (which dates surface on the film page)

Extend `FilmDetailResponse` (`public/dto.py`) additively — it's the **same** DTO NEU-396 widened and the sibling M5 tickets widen; add only the release-dates field:

| DTO field | Selection | Notes |
|---|---|---|
| `release_dates: list[ReleaseDateOut]` | `film_release_date` rows for a **home region** (constant `"US"`) plus the film's `origin_country[0]` if different, across all 6 types, ordered `release_date` asc then a stable tiebreak | curated regional slice — **not** all ~50 countries (those stay in the table + `tmdb_raw`) |

`ReleaseDateOut(BaseModel)` carries `country: str`, `release_type: int`, `type_label: str`, `date: datetime` (or `date` — match what the FE NEU-405 consumes; the model stores timestamptz, so a `datetime`/ISO string is the natural surface), `certification: str | None`.

`type_label` maps the integer to a human label via a **small pure map** — `1→"Premiere"`, `2→"Theatrical (limited)"`, `3→"Theatrical"`, `4→"Digital"`, `5→"Physical"`, `6→"TV"`. House it in a new pure module `public/release.py` (`RELEASE_TYPE_LABELS: dict[int, str]` + `release_type_label(t: int) -> str`), unit-testable in isolation. **Seam note:** NEU-408's calendar (which depends on this ticket) will add its `1/2/3 → premiere/limited/wide` *bucket* map; if it lands in the same `public/release.py`, the two maps coexist (labels = film page; buckets = calendar) — don't conflate them.

**Read path (`public/service.py::get_film_detail`).** After the `Film` row is fetched, add one scoped `select(FilmReleaseDate).where(FilmReleaseDate.film_id == film.id, FilmReleaseDate.iso_3166_1.in_(regions))` (regions = `{"US"} ∪ {film.origin_country[0]}`) ordered by `release_date` asc + tiebreak, building `ReleaseDateOut` rows through `release_type_label`. No `relationship()` on `Film`; one extra round-trip per film-detail request (cheap — one film). Empty → `[]`.

## Which part of M5 this realizes + the NEU-408 seam

- **Story NEU-390** ("Film page shows release dates"), **backend half**. Parent acceptance: the film page shows release date(s) with type (at least primary/US), sourced from ingested release_dates. **NEU-405** (FE render) is blocked on this DTO.
- Realizes **M5 milestone acceptance #2** (ingest populates `catalog.film_release_date` per-country/typed; DTO exposes a labeled home-region/origin slice) and contributes to **#4** (additive migration, single-headed, no data step; per-film TMDB volume unchanged — 1 request carrying `append_to_response`).
- **Seam for NEU-408 (Release-calendar `GET /calendar`, M6).** That endpoint range-scans this table `WHERE release_date >= today (UTC) AND iso_3166_1 = 'US' AND release_type IN (1,2,3)` ordered by `release_date, release_type` across all films, applying its own canonical-date + bucket policy. M6 **only reads** this table and does **not** redesign it — so the `(release_date, release_type)` index and the granular per-country/per-type rows (no collapsing to a single "release date") are the load-bearing contract this ticket must land. M6 assumes a queryable `(film_id, iso_3166_1, release_date, release_type ∈ 1..6)` shape — keep those column names/semantics stable.

## TDD testing intent

Write the failing test first for each slice, watch it fail, then implement. Mock TMDB with **respx** (never hit the network). Integration tests use the `session` fixture against the test DB; re-read Core-upserted rows with `execution_options={"populate_existing": True}` (see `_films` in `test_upsert.py`). **Run the whole file/dir, not a single test** (pytest-asyncio session-loop gotcha).

- **Fixtures.** Extend `tests/fixtures/tmdb.py::make_details` to optionally include a `release_dates` block (a couple of countries × a couple of types, with full-ISO `release_date` strings) so upsert/schema tests can drive it; extend `tests/fixtures/public.py` with a small helper to attach `film_release_date` rows to a film for the detail test.
- **Client (`tests/unit/ingest/tmdb/test_client.py`).** Assert `movie_details` issues a **single** request whose query carries `append_to_response` including `release_dates` (respx `route.calls.last.request.url.params`), and that a payload with an appended `release_dates` block parses into `details.release_dates.results[...]` while staying captured verbatim in `tmdb_raw`.
- **Schemas (`tests/unit/ingest/tmdb/test_schemas.py`).** Parsing a nested `release_dates` payload populates the typed tree (country → entries → `type`/`release_date`/`certification`); a film with no `release_dates` key leaves the field `None`; unknown extra keys are ignored.
- **Upsert (`tests/integration/ingest/tmdb/test_upsert.py`).** Ingest **populates** `film_release_date` with the right `(iso_3166_1, release_type, release_date)` rows (types **and** dates persisted); **idempotent** (re-running over the same film yields the same row set — delete-and-reinsert, no duplicates); **rebuild on change** (a film whose appended release_dates differ on re-ingest reflects the new set, stale rows gone); a film with no `release_dates` inserts nothing and doesn't error; rows cascade-delete with the film.
- **DTO / read path (`tests/integration/routers/test_public_films.py`).** `GET /films/{slug}` **surfaces** `release_dates` for a film with US (+ origin) rows: each item carries `country`, `release_type`, the correct `type_label` (1→"Premiere" … 6→"TV"), `date`, `certification`; the list is **ordered** by date; a film with no release dates returns `release_dates == []` (graceful omission); non-home-region rows are excluded from the slice. Keep existing detail assertions intact (they read keys individually — additive fields don't disturb them).
- **Label map (`tests/unit/public/`).** Unit-test `release_type_label` / `RELEASE_TYPE_LABELS` for all six TMDB types (and a sane fallback for an unexpected int).
- **Index exists (calendar seam).** Assert the `(release_date, release_type)` index is present on `catalog.film_release_date` — durably via SQLAlchemy's inspector / a `pg_indexes` query for `ix_catalog_film_release_date_lookup` (the milestone's "EXPLAIN that the index serves a date-range scan" is a fine *additional* check, but planner choice on a tiny test table is flaky — prefer the index-presence assertion as the gating test). This protects the NEU-408 seam from a future drop.

## Key files touched

- **Modify** `src/upmovies/catalog/models.py` — add `FilmReleaseDate` (surrogate `BigInteger` PK, `film_id` FK cascade, `iso_3166_1`/`release_type`/`release_date`/`certification`/`note`/`iso_639_1`, the two indexes, `schema='catalog'`).
- **Modify** `src/upmovies/ingest/tmdb/schemas.py` — add the three `TMDBReleaseDate*` models + the `release_dates` field on `TMDBMovieDetails`.
- **Modify** `src/upmovies/ingest/tmdb/client.py` — add/widen `append_to_response` to include `release_dates` on `movie_details`.
- **Modify** `src/upmovies/ingest/tmdb/upsert.py` — add the `film_release_date` delete-and-reinsert rebuild step (+ import the model).
- **Create** `src/upmovies/public/release.py` — `RELEASE_TYPE_LABELS` + `release_type_label`.
- **Modify** `src/upmovies/public/dto.py` — add `ReleaseDateOut` + `release_dates: list[ReleaseDateOut] = []` on `FilmDetailResponse`.
- **Modify** `src/upmovies/public/service.py` — in `get_film_detail`, add the home-region/origin `select` and project `ReleaseDateOut`s (import `FilmReleaseDate`, `release_type_label`).
- **Create** `migrations/versions/<rev>_add_catalog_film_release_date.py` — additive `create_table('film_release_date', …, schema='catalog')` + the two `create_index`; `down_revision` = then-current `alembic heads`; **no data step**. (Generated via `task makemigration`, then reviewed.)
- **Modify** tests: `tests/fixtures/tmdb.py`, `tests/fixtures/public.py`, `tests/unit/ingest/tmdb/test_client.py`, `tests/unit/ingest/tmdb/test_schemas.py`, `tests/integration/ingest/tmdb/test_upsert.py`, `tests/integration/routers/test_public_films.py`, and a new `tests/unit/public/test_release.py`.

---

## Task 1: Schema + migration (TDD)

**Files:** Modify `catalog/models.py`; Test `tests/integration/ingest/tmdb/test_upsert.py` (or a small model test) + the index-presence assertion; Create the migration after the model.

- [ ] **Step 1 — Failing test for the table/index.** Add an integration test asserting (a) a `FilmReleaseDate` row can be inserted/queried with the columns above and (b) the `ix_catalog_film_release_date_lookup` index on `(release_date, release_type)` exists (inspector / `pg_indexes`). Run the suite; expect FAIL (model absent).
- [ ] **Step 2 — Add the model.** Add `FilmReleaseDate` to `catalog/models.py` with the columns, FK cascade, and both indexes in `__table_args__`. Re-run; the table/index tests pass (conftest `create_all` builds it).
- [ ] **Step 3 — Generate the migration.** `task makemigration -- "add catalog film_release_date"`. Review: it should `create_table('film_release_date', …, schema='catalog')` + the two indexes and **nothing else** (no data step, no unrelated drift). Set `down_revision` to the current `alembic heads` (likely `6d7e2769ba35`, or a sibling M5 migration if one merged first — keep it single-headed). `task migrate`; confirm `alembic heads` is single. Strip any spurious autogen noise.

## Task 2: Client + schema DTOs (TDD)

**Files:** Modify `ingest/tmdb/client.py`, `ingest/tmdb/schemas.py`; Test `tests/unit/ingest/tmdb/test_client.py`, `tests/unit/ingest/tmdb/test_schemas.py`, `tests/fixtures/tmdb.py`.

- [ ] **Step 1 — Failing tests.** Add the schema-parse test (nested `release_dates` → typed tree; absent → `None`) and the client test (single request, `append_to_response` includes `release_dates`; appended block parses + stays in `tmdb_raw`). Extend `make_details` with an optional `release_dates` block. Run; expect FAIL.
- [ ] **Step 2 — Implement.** Add the three `TMDBReleaseDate*` models + the `release_dates` field; add/widen the `append_to_response` param on `movie_details`. Run; tests pass. Existing client/schema tests (status/imdb/raw capture) stay green.

## Task 3: Upsert rebuild step (TDD)

**Files:** Modify `ingest/tmdb/upsert.py`; Test `tests/integration/ingest/tmdb/test_upsert.py`.

- [ ] **Step 1 — Failing tests.** Add: populates `film_release_date` (types + dates correct); idempotent re-run (no dup rows); rebuild-on-change (new set replaces stale); no-`release_dates` is a no-op. Run; expect FAIL.
- [ ] **Step 2 — Implement.** Add the guarded `DELETE WHERE film_id` + bulk insert flattening `results[].release_dates[]`. Run; tests pass. Existing upsert idempotency/rebuild tests stay green.

## Task 4: DTO label map + read-path projection (TDD)

**Files:** Create `public/release.py`, `tests/unit/public/test_release.py`; Modify `public/dto.py`, `public/service.py`, `tests/fixtures/public.py`, `tests/integration/routers/test_public_films.py`.

- [ ] **Step 1 — Failing label-map test.** Unit-test `release_type_label` for types 1–6 + fallback. Run; expect FAIL (module absent).
- [ ] **Step 2 — Failing DTO test.** Add the detail tests (US+origin slice surfaces labeled, date-ordered rows; empty → `[]`; non-home-region excluded) + the fixture helper. Run; expect FAIL.
- [ ] **Step 3 — Implement.** Add `public/release.py`; add `ReleaseDateOut` + `release_dates` field; wire the scoped `select` + projection in `get_film_detail`. Run; all pass. Existing detail tests (events/sources/NEU-396 fields) stay green.

## Task 5: Full verification + ship

**Files:** none (verification + git only).

- [ ] **Step 1 — Full local gate.** `task test`, `task lint`, `task typecheck` green; `task format` on touched files. `alembic heads` single. (Per the milestone's CI gate.)
- [ ] **Step 2 — Confirm scope.** `git diff --stat` is confined to the files in "Key files touched"; the migration is additive with **no** data step; `client.movie_details` issues **one** request carrying `append_to_response`.
- [ ] **Step 3 — Single PR.** Suggested subject: `feat(catalog): ingest TMDB per-country release dates`. PR title: `feat(catalog): ingest TMDB per-country release dates (NEU-404)`. PR body ends with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.

---

## Acceptance criteria

1. The tmdb ingest fetches release dates via `append_to_response` on the existing `/movie/{id}` call — **no extra HTTP request** (respx asserts a single request carrying the param) — and populates `catalog.film_release_date` with per-country, typed rows (TMDB types 1–6), `release_date` stored as timestamptz.
2. The upsert is **idempotent** — rebuilt delete-and-reinsert per film; re-ingest yields the same row set; churn (added/dropped country/type/date) is reflected; a film without release_dates is a no-op.
3. `GET /films/{slug}` exposes `release_dates` as a **labeled** home-region (`US`) + origin-country slice across all 6 types, ordered by date; empty → `[]`; raw certification passed through. NEU-405 (FE) consumes this DTO.
4. An **additive** Alembic migration creates `catalog.film_release_date` + both indexes, chains single-headed off the then-current head, and contains **no data step**.
5. The `(release_date, release_type)` index (`ix_catalog_film_release_date_lookup`) exists and is asserted by a test — the forward-looking **seam for NEU-408**'s calendar range scan.
6. `task test` / `task lint` / `task typecheck` green; `task format` clean; existing ingest, upsert, NEU-396, and public-films tests still pass unchanged.

## Self-Review

**Spec coverage** (against NEU-404 + M5 §"Story NEU-390 / NEU-404" + M6 §3.1):
- `film_release_date` schema — surrogate `BigInteger` PK, `film_id` cascade FK, country plain-text (no FK), `release_type` int, `release_date` timestamptz, nullable `certification`/`note`/`iso_639_1` → Schema section + Task 1. ✓
- Both indexes incl. the calendar-serving `(release_date, release_type)` → Schema + Task 1 + Acceptance #5. ✓
- Shared single `append_to_response` fetch (1 request, widen-don't-clobber) → Fetch+upsert + Global Constraints + Task 2 + Acceptance #1. ✓
- Idempotent delete-and-reinsert upsert → Fetch+upsert + Task 3 + Acceptance #2. ✓
- Additive migration off head, no data step, single-headed → Global Constraints + Task 1 Step 3 + Acceptance #4. ✓
- DTO exposure: labeled US+origin slice, ordered, pure label map → DTO section + Task 4 + Acceptance #3. ✓
- Which part of M5 + the NEU-408 calendar seam (granular rows + index, M6 only reads) → "Which part of M5" section + Acceptance #5. ✓
- TDD intent: ingest populates dates+types, idempotent, DTO surfaces them, index exists → TDD testing intent + Tasks 1–4. ✓
- No `relationship()` on `Film`; explicit scoped `select` (NEU-396 style) → Architecture + DTO read path. ✓
- Resilient to sibling M5 tickets sharing the same plumbing → Global Constraints. ✓

**Placeholder scan:** none — no fabricated signatures; the column/DTO tables are intent, light on exact code per the resilient-plan brief.

**Type consistency:** `ReleaseDateOut` fields match what `get_film_detail` constructs and the detail tests assert; `release_type_label` typed `int → str`; model `BigInteger` PK autoincrements without extra args; `release_date` is timestamptz in DB and `datetime`/ISO on the wire.
