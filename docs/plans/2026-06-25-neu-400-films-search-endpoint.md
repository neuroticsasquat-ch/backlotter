**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m04-film-search.md

# NEU-400 `[backend]` — `GET /films/search?q=` endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development (write the failing test first, watch it fail for the right reason, then make it pass), then superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new public `GET /films/search?q=` endpoint that returns publicly-visible films whose `title` **or** `original_title` matches `q` case-insensitively (ILIKE substring), using the **same visibility rule and offset/limit envelope as `GET /films`**, so every result is guaranteed openable at `/film/{slug}` and the frontend can reuse the index types verbatim. Design the title match behind one isolated helper so the later alt-title milestone (NEU-406) is a localized OR — but **do not** implement alt-title matching here.

**Realizes (M4):** Story **NEU-388** ("Find a film by title"), backend half. This is **NEU-400**; the frontend search box + `/search` results page (**NEU-401**) is blocked on this endpoint and consumes the `FilmIndexResponse` contract. No frontend work in this ticket.

**Architecture:** Backend-only, read-path-only. Two source files plus tests. In `src/upmovies/public/service.py`: a small **enabling refactor** extracts the shared visibility predicate (`slug IS NOT NULL` + the ≥1-summarized-event `EXISTS`) and the item-building loop out of `get_film_index` so the new `get_film_search` reuses both verbatim (single source of truth — "what's searchable" can never drift from "what's listed"). A new `get_film_search` clones the index's `count`/`select`/`order_by`/envelope and adds one `_title_match(q)` clause. In `src/upmovies/routers/public.py`: a new `GET /films/search` route declared **before** `GET /films/{slug}` (the one real footgun). **Response DTO is reused** — `FilmIndexResponse`/`FilmIndexItem`, no new DTO. **No migration, no model change, no ingestion change** — `Film.title`/`Film.original_title`/`Film.slug` already exist.

**Tech Stack:** Python 3.13, FastAPI, async SQLAlchemy 2 + asyncpg, Pydantic v2, pytest (pytest-asyncio `auto` mode). Everything runs in the container via `task` — **never** run `pytest`/`ruff`/`pyright` on the host.

## Global Constraints

- **Repo:** `upcoming-movies-backend` (under the `~/projects/upcoming-movies/` umbrella). Paths below are relative to that repo root.
- **Branch:** use the Linear-provided branch for NEU-400 (one ticket = one PR).
- **Read-path only.** Touch exactly `src/upmovies/routers/public.py`, `src/upmovies/public/service.py`, the integration tests (`tests/integration/routers/test_public_films.py`), and a small unit test under `tests/unit/public/` for the LIKE-escape helper. **No migration / no `alembic` run, no ingestion/TMDB change, no DTO file change** (the response reuses `FilmIndexResponse`). Confirm the final diff is confined to those files.
- **Run everything in the container via `task`.** Keep the `upmovies-backend` container up. Green before done: `task format` → `task lint` → `task typecheck` → `task test` all pass. No new deps, so no `task build` needed; `alembic heads` must be unchanged.
- **No behavior change to `GET /films`.** The refactor that extracts the shared predicate/item-builder must leave `get_film_index` byte-identical in output — the existing `test_public_films.py` index tests (`test_index_*`) are the regression net and must stay green untouched.
- **TDD.** Write the failing test(s) first, watch them fail for the right reason (the route 404s / matches wrongly / leaks hidden films), then implement. Per the repo gotcha, **run the whole file or directory** — a single integration test in isolation trips a known pytest-asyncio session-loop warning.
- **Commits/PR:** Conventional Commits subject, **no** Linear ID in the commit subject (optional `Refs NEU-400.` in body), **no** footer / **no** `Co-Authored-By` in the commit. PR **title** carries the trailing `(NEU-400)`; the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer goes in the PR **body** only. Single commit + one PR for the ticket.

---

## The contract (what NEU-401 will consume)

- **Endpoint:** `GET /films/search?q=<term>&limit=<n>&offset=<n>` → `200` with a `FilmIndexResponse` body (`{items, total, limit, offset}`), each item a `FilmIndexItem` (`slug`, `title`, `release_year`, `poster_path`, `arc_stage`) — **identical** to `GET /films`.
- **Visibility:** results are exactly the publicly-visible set (`Film.slug IS NOT NULL` **and** ≥1 summarized, non-hidden event) — the same predicate `/films` uses, so any result is openable at `/film/{slug}`.
- **Match:** `title` **or** `original_title` ILIKE the term (case-insensitive substring); `original_title` is nullable and a `NULL` simply fails its half of the OR (no `coalesce`).
- **Ordering:** `release_date desc` (nulls last), then `id asc` — same as the index (relevance ranking is an explicit M4 non-goal).
- **Graceful empty:** blank / whitespace-only / too-short `q` → `200` with `items: []`, `total: 0` (never a `422` for an empty box).
- **Bounds:** `limit` `ge=1, le=100` (default **20**), `offset` `ge=0` — same envelope bounds as `/films`; out-of-range → `422`.
- **Alt-title seam:** matching lives behind one `_title_match(q)` helper returning a single boolean clause; NEU-406 extends it by OR-ing in an alt-title `EXISTS` there, with zero caller changes. Alt-title matching is **not** implemented in this ticket.

---

## What changes

### 1. `src/upmovies/public/service.py`

**(a) Extract the shared visibility predicate.** Today `get_film_index` builds the `has_summary` `EXISTS` inline and filters `select(...).where(Film.slug.is_not(None), has_summary)` in two places (the `count` and the page `select`). Factor the two gating clauses into a small helper so both endpoints share one source of truth — e.g. a `_publicly_visible_film()` that returns the pair `(Film.slug.is_not(None), <has_summary EXISTS>)` (the `EXISTS` continues to use `_visible_events()` for the hidden-`other` filter). Rewrite `get_film_index` to spread that pair into its `count`/`select` `.where(...)` — **no behavior change**.

**(b) Extract the item-builder.** The index's post-fetch loop (build `_event_types_by_film`, then one `FilmIndexItem` per film with `slug`/`title`/`release_year`/`poster_path`/`derive_arc_stage(...)`) is factored into a helper (e.g. `async def _film_index_items(session, films) -> list[FilmIndexItem]`) so search produces **byte-identical** item shapes. `get_film_index` calls it; nothing about its output changes.

**(c) The match predicate + alt-title seam.** Add `_title_match(q: str)` returning **one** boolean clause: `or_(Film.title.ilike(pattern, escape=...), Film.original_title.ilike(pattern, escape=...))`, where `pattern = f"%{_escape_like(q)}%"`. Decisions:
- **Substring** (`%q%`) per the spec — most forgiving for a "find by title" box (matches "odyssey" inside "The Odyssey"). The implementer may switch to prefix (`q%`); the pattern is the only line to change, and either way matching stays behind this one helper.
- **Case-insensitivity** via SQLAlchemy `Column.ilike(...)` (Postgres `ILIKE`) — no `func.lower`.
- **LIKE-wildcard safety:** a tiny pure `_escape_like(q)` escapes `\`, `%`, `_` (escape the backslash first) and `_title_match` passes `escape="\\"` to `ilike`, so a user typing `%` searches for a literal percent, not "match anything". Unit-tested.
- Leave a one-line comment marking the alt-title OR extension point (NEU-406) inside `_title_match`.

**(d) The search service.** Add `async def get_film_search(session, *, q, limit, offset) -> FilmIndexResponse` that mirrors `get_film_index` exactly, plus `_title_match`:
- `term = q.strip()`; if `len(term) < MIN_QUERY_LEN` (a small module constant, e.g. `2`) → return an empty `FilmIndexResponse(items=[], total=0, limit=limit, offset=offset)` (graceful short-circuit — no query).
- Otherwise build `where = (*_publicly_visible_film(), _title_match(term))`, run the same `count` + page `select` (same `order_by(nulls_last(Film.release_date.desc()), Film.id.asc())`, `limit`, `offset`), and build items via `_film_index_items(...)`.

Illustrative (adapt to the surrounding style; not signatures to copy verbatim):

```python
async def get_film_search(
    session: AsyncSession, *, q: str, limit: int, offset: int
) -> FilmIndexResponse:
    term = q.strip()
    if len(term) < MIN_QUERY_LEN:
        return FilmIndexResponse(items=[], total=0, limit=limit, offset=offset)
    where = (*_publicly_visible_film(), _title_match(term))
    total = await session.scalar(select(func.count()).select_from(Film).where(*where))
    films = (
        (await session.execute(
            select(Film).where(*where)
            .order_by(nulls_last(Film.release_date.desc()), Film.id.asc())
            .limit(limit).offset(offset)
        )).scalars().all()
    )
    items = await _film_index_items(session, films)
    return FilmIndexResponse(items=items, total=total or 0, limit=limit, offset=offset)
```

Add `or_` to the existing `from sqlalchemy import ...` line.

### 2. `src/upmovies/routers/public.py`

Add the search route **above** the existing `@router.get("/films/{slug}")` (which currently sits right after `@router.get("/films")`). FastAPI matches in declaration order — if `/films/search` came after `/films/{slug}`, the literal `search` would be captured as a `slug` and 404. Reuse the index's exact `Query` bounds for the envelope; `q` is required with a sane `max_length`, the service trims/short-circuits blank input (so an empty box never 422s):

```python
@router.get("/films/search", response_model=FilmIndexResponse)
async def search_films(
    q: str = Query(..., max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> FilmIndexResponse:
    return await service.get_film_search(session, q=q, limit=limit, offset=offset)
```

`FilmIndexResponse` is already imported in this module; no DTO import change.

---

## TDD testing intent

All integration tests go in `tests/integration/routers/test_public_films.py`, reusing the `client` / `make_film` / `add_event` fixtures from `tests/fixtures/public.py` (no fixture changes needed — `make_film` already takes `title`, and the model's `original_title` can be set via a tiny fixture tweak **only if** a test needs it; prefer setting it directly on the returned `Film` + commit, or add an `original_title` kwarg to `make_film` defaulting to `None` if cleaner). Write these **red first**, watch them fail (the route 404s as a slug, or matching/visibility is wrong), then implement.

1. **Matches on `title`, case-insensitive** — a visible film titled "The Odyssey" is returned for `q=odyssey`, `q=ODYSSEY`, and a mid-word substring (`q=dyss`); a non-matching film is excluded.
2. **Matches on `original_title`** — a film whose `title` does not contain the term but whose `original_title` does is returned (and the nullable case: a film with `original_title = None` and a non-matching `title` is excluded, proving `NULL ILIKE` doesn't match).
3. **Visibility parity** — mirror `test_index_lists_only_films_with_a_summarized_event`: a film whose title matches `q` but which has **no summarized event** (or **no slug**, or **only `other` events**) is **excluded** from search results, exactly as it is from `/films`.
4. **Envelope + pagination** — `total`/`limit`/`offset` echoed; default `limit` is `20`; paging with `limit`/`offset` slices the matched set; out-of-range (`limit=0`, `limit=101`, `offset=-1`) → `422`, mirroring `test_index_rejects_out_of_range_pagination`.
5. **Item shape parity** — a search hit's item carries the same keys/values (`slug`, `title`, `release_year`, `poster_path`, `arc_stage`) the index produces for the same film (the shared `_film_index_items` guarantees this).
6. **Blank / whitespace / too-short `q`** → `200` with `items == []`, `total == 0` (assert `q=""`, `q="   "`, and a 1-char `q` if `MIN_QUERY_LEN == 2` all return the empty envelope, not `422`).
7. **LIKE-wildcard input is literal** — with films titled e.g. "100% Real" and "Plain", `q=%` returns only the literal-percent film (proving `%` is escaped, not treated as match-anything); similarly `_` matches literally.
8. **Route-order regression** — `GET /films/search?q=...` resolves to the **search** handler, not `/films/{slug}` (e.g. assert it returns the index-shaped envelope `{items,total,limit,offset}`, not a `FilmDetailResponse`/404-for-slug). This is the pin for the one real footgun.
9. **Index unchanged** — the existing `test_index_*` tests stay green untouched, proving the extraction refactor is behavior-preserving.

Unit test (`tests/unit/public/`, alongside `test_arc.py`/`test_sources.py`): a small `test_search.py` for `_escape_like` — `%`, `_`, `\` are each escaped (and a plain term is unchanged) — so the pure helper is covered independently of the DB.

---

## Tasks

- [ ] **Task 1 — Tests first (red).** Add the integration tests (cases 1–8 above) to `test_public_films.py` and the `_escape_like` unit test under `tests/unit/public/`. If a test needs `original_title`, set it on the film (or add an `original_title=None` kwarg to `make_film`). Run `task test -- tests/integration/routers/test_public_films.py` (whole file, per the asyncio-loop gotcha) and confirm the new tests fail for the right reason (route 404 / no matches / hidden film leaks), while the existing `test_index_*` tests still pass.
- [ ] **Task 2 — Service refactor + search (green).** In `public/service.py`: extract `_publicly_visible_film()` and `_film_index_items(...)`, rewrite `get_film_index` to use them (no behavior change), add `_escape_like`, `_title_match`, `MIN_QUERY_LEN`, and `get_film_search`; import `or_`. Re-run the suite — index tests stay green, search tests now pass.
- [ ] **Task 3 — Route (green).** In `routers/public.py`, add `GET /films/search` **before** `GET /films/{slug}`. Re-run; the route-order regression test passes.
- [ ] **Task 4 — Full CI gate + ship.** `task format` → `task lint` → `task typecheck` → `task test` all green; `alembic heads` unchanged; `git diff --stat` confined to `routers/public.py`, `public/service.py`, `tests/integration/routers/test_public_films.py`, and the new `tests/unit/public/` file. Commit once on the ticket branch and open the PR (suggested subject `feat(public): add GET /films/search title endpoint`; PR title appends `(NEU-400)`; footer in PR body only).

---

## Acceptance criteria

1. `GET /films/search?q=` returns publicly-visible films (slug not null + ≥1 visible summarized event — the **same** rule as `GET /films`, via the shared `_publicly_visible_film()` predicate) whose `title` **or** `original_title` matches `q` **case-insensitively** (substring).
2. The response is a `FilmIndexResponse` with the **same `{items,total,limit,offset}` envelope and `ge/le` bounds** as `/films`, ordered `release_date desc` (nulls last) then `id asc`; items are byte-identical in shape to the index (shared item-builder).
3. Blank / whitespace / too-short `q` → empty `items`, `total 0`, **HTTP 200** (not `422`); out-of-range `limit`/`offset` → `422`.
4. LIKE wildcards (`%`, `_`) in `q` are matched **literally**; the alt-title extension is a single OR inside `_title_match` — alt-title matching itself is **not** implemented here.
5. `/films/search` is declared **before** `/films/{slug}` and a test proves `search` is not captured as a slug; `get_film_index` behavior is **unchanged** after the extraction refactor (existing index tests green).
6. Tests cover title + original_title + substring matching, case-insensitivity, visibility parity (excluded films), pagination/envelope/bounds, blank/short `q`, wildcard escaping, and route ordering; `_escape_like` unit-tested. `task format`/`lint`/`typecheck`/`test` all green; no migration ran; diff confined to the four files.

---

## Key files touched

- `src/upmovies/public/service.py` — extract `_publicly_visible_film()` + `_film_index_items(...)` from `get_film_index` (no behavior change); add `_escape_like`, `_title_match` (the alt-title OR seam), `MIN_QUERY_LEN`, and `get_film_search`; import `or_`.
- `src/upmovies/routers/public.py` — add `GET /films/search` **before** `GET /films/{slug}`, reusing the index `Query` bounds and `FilmIndexResponse` response model.
- `tests/integration/routers/test_public_films.py` — search tests (title/original_title/substring/case, visibility parity, envelope/pagination/bounds, blank/short `q`, wildcard-literal, route-order); index tests left green.
- `tests/unit/public/test_search.py` *(new)* — `_escape_like` unit coverage.
- *(reference only, not modified)* `src/upmovies/public/dto.py` (`FilmIndexResponse`/`FilmIndexItem` reused — no new DTO); `tests/fixtures/public.py` (`make_film`/`add_event` reused; add `original_title` kwarg only if a test needs it).

---

## Self-Review

**Spec coverage** (against NEU-400 + the M4 spec §2.1 / §4):
- Shared `_publicly_visible_film()` predicate (slug + summarized-event EXISTS), search surface ⊆ listable surface → Task 2, criteria 1 & 5. ✓
- `_film_index_items` extraction → byte-identical item shape, no index behavior change → Task 2, criteria 2 & 5, test case 9. ✓
- `_title_match` single-clause OR on `title`+`original_title`, ILIKE substring, alt-title seam, **no** alt-title impl → Task 2, criteria 1 & 4. ✓
- LIKE-wildcard escaping via `_escape_like` + `escape=` → Task 2, criterion 4, unit test. ✓
- `FilmIndexResponse` reuse, same envelope/bounds/order, default `limit=20` → criteria 2 & 3. ✓
- Blank/short `q` → empty `200` envelope → criterion 3, test case 6. ✓
- Route declared before `/films/{slug}`, regression-pinned → Task 3, criterion 5, test case 8. ✓
- No migration / no DTO / no ingestion change; diff confined → Global Constraints, Task 4, criterion 6. ✓
- TDD red→green, whole-file run (pytest-asyncio gotcha) → Tasks 1–3. ✓

**Placeholder scan:** none — the two code blocks are explicitly illustrative (mirror the milestone spec); all other steps describe intent + exact `task` commands.

**Resilience:** no exact signatures pinned beyond the reused DTO/envelope contract; helper names are suggestions ("e.g."); the substring-vs-prefix choice and `MIN_QUERY_LEN` value are left to the implementer with the seam isolated so either is a one-line change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
