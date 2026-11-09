**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m02-polish-existing-pages.md

# NEU-396 `[backend]` — Film-detail DTO exposes already-captured film metadata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This is a **TDD** ticket — write the failing test first, watch it fail, then make it pass. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the public film-detail read path so `/films/{slug}` returns the rich TMDB basics already persisted on `catalog.film` — overview, tagline, runtime, genres, rating (`vote_average`/`vote_count`), original language, backdrop, production companies, and collection — every field nullable / empty-defaulted so the frontend (NEU-397) can omit gracefully. **No ingestion, no migration** — purely read-path.

**Architecture:** Two source files plus their integration tests. `FilmDetailResponse` (`public/dto.py`) gains the new fields and a small nested `CollectionOut`. `get_film_detail` (`public/service.py`) passes the scalar `Film` columns straight through (they're already on the fetched row) and adds three small scoped `select(...)` joins keyed by `film.id` for genres, production companies, and collection. **`Film` has no ORM `relationship()`s** — only FK columns and standalone association tables — so the joins follow the service's existing explicit-`select` style (the same pattern `arc_stage` already uses for distinct event types). The route (`routers/public.py`) is unchanged: it already serializes via `response_model=FilmDetailResponse`, so new DTO fields flow through automatically.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async) + asyncpg, Pydantic v2, pytest (pytest-asyncio `auto` mode). Everything runs in the container via `task` — **never** `pytest`/`ruff`/`pyright` on the host.

## Global Constraints

- **Repo:** `upcoming-movies-backend` (under the `~/projects/upcoming-movies/` umbrella). Paths below are relative to that repo root.
- **Branch:** use the Linear-provided branch for NEU-396 (one ticket = one PR).
- **Read-path only.** Touch exactly `src/upmovies/public/dto.py`, `src/upmovies/public/service.py`, and the tests (`tests/integration/routers/test_public_films.py`, fixtures in `tests/fixtures/public.py`). **No migration, no `alembic` run, no ingestion/TMDB change** — every field reads a column or join table ingest already populates. Confirm the final diff is confined to those files (milestone acceptance #3).
- **Run everything in the container via `task`.** Keep the `upmovies-backend` container up. Green before done: `task test`, `task lint`, `task typecheck` all pass; run `task format` on touched files. No new deps, so no `task build` needed.
- **Stay additive.** Add fields/defaults; do not rename or reorder existing ones (`slug/title/release_date/release_year/poster_path/arc_stage/events` stay as-is). Existing detail tests read response keys individually (not whole-dict equality), so additive fields won't break them — keep those assertions intact.
- **Coexist with NEU-394.** That sibling ticket renames `EventOut.occurred_at → created_at` and edits the same three files. NEU-396 only adds **film-level** fields to `FilmDetailResponse` (a different model than `EventOut`) and **film-level** joins in `get_film_detail`, so the two are logically independent. If NEU-394 has already merged, rebase and keep its `EventOut`/event-ordering changes intact; if not, design so a later merge is a clean additive overlay. Do not touch `EventOut` or the event-ordering `.order_by(...)` here.
- **Determinism (SSR/snapshot-friendly).** Order the genres and production-companies lists by name ascending so the payload is stable. Empty join → empty list (`[]`), never `null`; absent scalar/collection → `None`.
- **Rating semantics.** The DTO carries `vote_average` and `vote_count` raw (both nullable). The "hide 0.0 for unrated films" gate (`vote_count > 0`) is the **frontend's** job (NEU-397) — do not filter or null it server-side.
- **Commits/PR:** Conventional Commits subject, **no** Linear ID in the commit subject (optional `Refs NEU-396.` in body), **no** footer/`Co-Authored-By` in the commit. PR **title** carries the trailing `(NEU-396)`; the `🤖 Generated with Claude Code` footer goes in the PR **body** only. Single commit + one PR for the ticket.

---

## Fields to add (DTO ↔ source)

Add to `FilmDetailResponse`; every field nullable / empty-defaulted:

| DTO field | Type | Source | How loaded |
| --- | --- | --- | --- |
| `overview` | `str \| None` | `Film.overview` | direct column (already on the fetched row) |
| `tagline` | `str \| None` | `Film.tagline` | direct column |
| `runtime` | `int \| None` | `Film.runtime` | direct column (minutes) |
| `vote_average` | `float \| None` | `Film.vote_average` | direct column (TMDB 0–10) |
| `vote_count` | `int \| None` | `Film.vote_count` | direct column (gates FE rating) |
| `original_language` | `str \| None` | `Film.original_language` | direct column (ISO-639-1) |
| `backdrop_path` | `str \| None` | `Film.backdrop_path` | direct column (FE builds URL) |
| `genres` | `list[str]` | `Genre.name` via `FilmGenre` | join `select`, ordered by name asc, `[]` when none |
| `production_companies` | `list[str]` | `ProductionCompany.name` via `FilmProductionCompany` | join `select`, ordered by name asc, `[]` when none |
| `collection` | `CollectionOut \| None` | `Collection` via `Film.collection_id` | one-row `select` only when `film.collection_id is not None`, else `None` |

New nested DTO `CollectionOut(BaseModel)` carries at minimum `name: str` (the franchise label, e.g. "The Lord of the Rings Collection"). `poster_path: str | None` is an acceptable additive extra (`Collection.poster_path` exists), but the FE type (NEU-397) only consumes `name` — keep it minimal unless there's a reason to surface the poster.

The three direct-column passthroughs the service already had access to via the fetched `Film` row are zero new queries. The three joins run once per request (one film per page), so the extra round-trips are cheap — no batching like `_event_types_by_film` is needed.

## Which part of M2 this realizes

Story **NEU-387** ("Film page shows all known basic info"), backend half. Milestone acceptance #2 (richer film page) and #3 (no migration / no ingestion change — diff confined to `public/service.py`, `public/dto.py`, tests). NEU-397 (FE render) is blocked on this DTO.

## File Structure

- **Modify** `src/upmovies/public/dto.py` — add `CollectionOut(BaseModel)` and the new fields on `FilmDetailResponse` (defaulting list fields to `[]`, scalars/collection to `None`).
- **Modify** `src/upmovies/public/service.py` — in `get_film_detail`, pass the scalar `Film` columns through and add the genres / companies / collection `select`s keyed by `film.id`. Import `Genre`, `FilmGenre`, `ProductionCompany`, `FilmProductionCompany`, `Collection` from `upmovies.catalog.models`.
- **Modify** `tests/fixtures/public.py` — extend `make_film` to accept the new `Film` columns; add small helpers to attach genres / production companies / a collection (these tables have **non-autoincrement integer PKs**, so insert reference rows with explicit ids, then the join rows).
- **Modify** `tests/integration/routers/test_public_films.py` — add detail tests asserting the new fields round-trip, list ordering, collection present-vs-`None`, and graceful null/empty omission.
- **No change** to `routers/public.py` (response_model already references `FilmDetailResponse`).

---

## Task 1: Widen the film-detail DTO + service (TDD)

**Files:**
- Modify: `src/upmovies/public/dto.py`, `src/upmovies/public/service.py`
- Test: `tests/fixtures/public.py`, `tests/integration/routers/test_public_films.py`

**Interfaces (intent, not signatures to copy verbatim):**
- `CollectionOut(BaseModel)` with `name: str` (optional `poster_path: str | None`).
- `FilmDetailResponse` gains the ten fields in the table above; list fields default `[]`, scalars/`collection` default `None`.
- `get_film_detail` returns the same shape plus the new fields; genres/companies are name-ascending lists; `collection` is populated only when `film.collection_id` is set.

- [ ] **Step 1: Extend the test fixtures**

In `tests/fixtures/public.py`, extend `make_film`'s keyword args to accept the new `Film` columns (`overview`, `tagline`, `runtime`, `vote_average`, `vote_count`, `original_language`, `backdrop_path`, `collection_id`) — all defaulting to `None`/falsy so existing callers are unaffected — and forward them to the `Film(...)` constructor.

Add minimal async helpers (new fixtures, or extend `make_film` to optionally attach) for the joins, e.g. `attach_genres(film, [(id, name), ...])`, `attach_companies(film, [(id, name), ...])`, and `make_collection(id, name, poster_path=None)`. Because `Genre`/`ProductionCompany`/`Collection` use natural (non-autoincrement) integer PKs, insert the reference row with an explicit `id` first, then the `FilmGenre`/`FilmProductionCompany` join row (or set `film.collection_id`). Commit so the route's session sees them. Keep these helpers small and additive — don't rework the existing fixture behavior.

- [ ] **Step 2: Write the failing integration tests**

In `tests/integration/routers/test_public_films.py`, add detail tests (keyed off the existing `client` + fixtures) covering:

1. **All metadata present round-trips.** A film with overview/tagline/runtime/`vote_average`/`vote_count`/`original_language`/`backdrop_path`, two genres, two production companies, and a collection. Assert each scalar field equals what was stored; `genres` and `production_companies` come back **name-ascending**; `collection` is `{"name": ...}` (matching `CollectionOut`).
2. **Sparse film omits gracefully.** A film with none of the optional metadata (no genres/companies/collection, null scalars) returns `200` with `overview`/`tagline`/… `== None`, `genres == []`, `production_companies == []`, `collection is None` — it must not error.
3. **Rating fields are raw passthrough.** A film with `vote_average=0.0, vote_count=0` returns those values unchanged (server does **not** apply the FE's `vote_count > 0` gate).

Keep the existing detail assertions (events ordering, sources cap, outlet label, `other`-exclusion, summary-less omission) intact — they read response keys individually, so additive fields don't disturb them.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `task test -- tests/integration/routers/test_public_films.py`
Expected: FAIL — the new fields are absent from the response (`KeyError`/`assert ... == None`/missing-key), since `FilmDetailResponse` and `get_film_detail` don't carry them yet. The pre-existing detail tests still pass.
(Per the repo gotcha, run the whole file/dir — single-test isolation trips a pytest-asyncio session-loop warning.)

- [ ] **Step 4: Add the DTO fields**

In `src/upmovies/public/dto.py`, add `CollectionOut(BaseModel)` (with `name: str`, optional `poster_path: str | None`) above `FilmDetailResponse`, and add the ten new fields to `FilmDetailResponse` — list fields with a `[]` default, scalars and `collection` with a `None` default. Leave the existing fields and ordering as-is.

- [ ] **Step 5: Wire the service joins**

In `src/upmovies/public/service.py`, import the needed models and, inside `get_film_detail` after the `Film` row is fetched, add the three scoped queries keyed by `film.id` (illustrative — adapt to the surrounding style; the spec's snippet is the reference):

```python
genres = list((await session.execute(
    select(Genre.name)
    .join(FilmGenre, FilmGenre.genre_id == Genre.id)
    .where(FilmGenre.film_id == film.id)
    .order_by(Genre.name.asc())
)).scalars().all())

companies = list((await session.execute(
    select(ProductionCompany.name)
    .join(FilmProductionCompany, FilmProductionCompany.company_id == ProductionCompany.id)
    .where(FilmProductionCompany.film_id == film.id)
    .order_by(ProductionCompany.name.asc())
)).scalars().all())

collection = None
if film.collection_id is not None:
    row = (await session.execute(
        select(Collection).where(Collection.id == film.collection_id)
    )).scalar_one_or_none()
    if row is not None:
        collection = CollectionOut(name=row.name)
```

Then pass the scalar `Film` columns and these three through to `FilmDetailResponse(...)` alongside the existing fields. Wrap the `.scalars().all()` results in `list(...)` so pyright sees `list[str]` (not `Sequence[str]`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `task test -- tests/integration/routers/test_public_films.py`
Expected: PASS — new and pre-existing detail tests all green.

---

## Task 2: Full verification + ship

**Files:** none (verification + git only).

- [ ] **Step 1: Full local gate**

Run and confirm green (per "green before done"):

```bash
task test
task lint
task typecheck
task format
```

Expected: full suite green; ruff clean (no unused imports — the new `catalog.models` imports are all used); pyright clean (`genres`/`companies` typed `list[str]`, `collection` typed `CollectionOut | None`). No migration is generated or run.

- [ ] **Step 2: Confirm the diff is read-path only**

`git status` / `git diff --stat` shows changes confined to `public/dto.py`, `public/service.py`, `tests/fixtures/public.py`, `tests/integration/routers/test_public_films.py` — no migration, no ingestion/TMDB file (milestone acceptance #3).

- [ ] **Step 3: Manual smoke check (optional)**

With the stack up, `GET /films/{slug}` for a film that has metadata and one that doesn't; confirm the rich film returns populated fields with name-ascending `genres`/`production_companies` and a `collection` object, and the sparse film returns nulls/`[]`/`null` without error.

- [ ] **Step 4: Single commit + PR**

Commit once on the Linear branch and open the PR. Suggested subject: `feat(public): expose film basics on film-detail DTO`. PR title: `feat(public): expose film basics on film-detail DTO (NEU-396)`. PR body ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Self-Review

**Spec coverage** (against NEU-396 + the M2 spec's NEU-396 section):
- All ten fields added with correct nullability/empty-defaults → Task 1 Step 4 (DTO) + the fields table. ✓
- Direct columns passed through; genres/companies/collection via explicit `select` joins keyed by `film.id` (no `relationship()` added) → Task 1 Step 5. ✓
- Name-ascending genre/company ordering for deterministic payload → Global Constraints + Task 1 Steps 2 & 5. ✓
- Collection present-vs-`None`, nested `CollectionOut` → Task 1 Steps 4–5; tested in Step 2 cases 1–2. ✓
- Rating raw passthrough (FE owns the `vote_count > 0` gate) → Global Constraints + Step 2 case 3. ✓
- Graceful null/empty omission for a sparse film → Step 2 case 2. ✓
- No migration / no ingestion change; diff confined → Global Constraints + Task 2 Step 2. ✓
- Additive design; coexists with NEU-394 (`EventOut` untouched) → Global Constraints. ✓
- TDD red→green with the whole-file run (pytest-asyncio gotcha) → Task 1 Steps 2–3, 6. ✓

**Placeholder scan:** none — the one code block is explicitly illustrative (mirrors the milestone spec); all other steps describe intent + exact commands.

**Type consistency:** `CollectionOut`/`FilmDetailResponse` field names/types in the DTO match what the service constructs and what the tests assert; join results wrapped in `list(...)` to satisfy `list[str]`; reference tables inserted with explicit PKs (non-autoincrement) in fixtures.
