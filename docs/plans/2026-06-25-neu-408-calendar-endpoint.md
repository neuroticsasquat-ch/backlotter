**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m06-release-calendar.md
**Depends on:** NEU-404

# NEU-408 `[backend]` — `GET /calendar` (upcoming by date + release type) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development (write the failing test first, watch it fail for the right reason, then make it pass), then superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new public `GET /calendar?limit&offset` endpoint that returns **upcoming theatrical releases (today forward)** read from the NEU-404 per-country release-dates table (`catalog.film_release_date`), scoped to a single governing region (**US**), with each TMDB release `type` folded into a small set of display **buckets** (`premiere` / `limited` / `wide`), returned as a **flat, server-ordered list** the frontend groups **by date → type**. The shape mirrors `get_feed_grouped` / `FeedDayResponse` exactly (flat list + envelope, client-side grouping), so the FE (NEU-409) groups by walking the ordered list with no client sort.

**Realizes (M6):** Story **NEU-373** ("Public release calendar"), backend half — parent acceptance: `/calendar` lists upcoming releases soonest-first grouped by date + type. This is **NEU-408**; the FE SSR `/calendar` route (**NEU-409**) is blocked on this endpoint and consumes the `CalendarResponse` contract. **No frontend work in this ticket.** Realizes milestone-acceptance bullet **"NEU-408 — `GET /calendar` (backend)"** (M6 §4).

**Architecture:** Backend-only, read-path-only. Three source files plus tests:
- `src/upmovies/public/release.py` — **add** the TMDB-type→bucket map (`RELEASE_BUCKETS`, `_TMDB_TYPE_TO_BUCKET`, `bucket_for_tmdb_type`) **alongside** NEU-404's existing `RELEASE_TYPE_LABELS`/`release_type_label` (labels = film page; buckets = calendar — two coexisting maps, do not conflate). If NEU-404 hasn't created this module yet (see §"Dependency on NEU-404"), create it.
- `src/upmovies/public/service.py` — a new `get_calendar(session, *, limit, offset) -> CalendarResponse` mirroring `get_feed_grouped`'s flat-list + `total = count over the grouped subquery` + UTC-day pattern, range-scanning `FilmReleaseDate` joined to `Film`. Plus the `CALENDAR_REGION = "US"` named constant.
- `src/upmovies/routers/public.py` — a new `GET /calendar` route beside `/feed/grouped`.
- `src/upmovies/public/dto.py` — new `CalendarItem` + `CalendarResponse` DTOs (mirror `FeedDayItem`/`FeedDayResponse`).

**No migration, no model change, no ingestion change** — `catalog.film_release_date` (and its `(release_date, release_type)` index, the seam this query was built for) are owned by NEU-404; this ticket only **reads** that table.

**Tech Stack:** Python 3.13, FastAPI, async SQLAlchemy 2 + asyncpg, Pydantic v2, pytest (pytest-asyncio `auto` mode). Tests run against **real Postgres** (Postgres-specific SQL — `func.timezone`, `func.coalesce`, `func.array_agg` — is fine). Everything runs in the container via `task` — **never** run `pytest`/`ruff`/`pyright`/`alembic` on the host.

## Global Constraints

- **Repo:** `upcoming-movies-backend` (under the `~/projects/upcoming-movies/` umbrella). Paths below are relative to that repo root.
- **Branch:** use the Linear-provided branch for NEU-408 (one ticket = one PR = one `/implementit` run).
- **Read-path only.** Touch exactly `src/upmovies/public/release.py`, `src/upmovies/public/service.py`, `src/upmovies/public/dto.py`, `src/upmovies/routers/public.py`, a new integration test file, and the public test fixtures. **No migration / no `alembic` run, no model change, no ingestion/TMDB change.** Confirm the final diff is confined to those files; `alembic heads` must be unchanged and single.
- **Run everything in the container via `task`.** Keep the `upmovies-backend` container up. Green before done: `task format` → `task lint` → `task typecheck` → `task test` all pass. No new deps, so no `task build` needed.
- **TDD.** Write the failing test(s) first, watch them fail for the right reason (route 404s; wrong rows surfaced; wrong order), then implement. Per the repo gotcha, **run the whole file or directory** — a single integration test in isolation trips a known pytest-asyncio session-loop warning. Mock nothing here — there's no HTTP; integration tests use the `session` fixture against the test DB.
- **Determinism (SSR/snapshot-friendly).** All ordering is **server-side** (`release_date ASC, release_type ASC, popularity DESC NULLS LAST, slug ASC`); the FE groups by adjacency. Compute "today" in Python (`datetime.now(tz=UTC).date()`) and bind it as a parameter — **never** SQL `CURRENT_DATE` (session-timezone dependent). Mirrors the feed's UTC-day handling (NEU-364).
- **Commits/PR:** Conventional Commits subject, **no** Linear ID in the commit subject (optional `Refs NEU-408.` in body), **no** footer / **no** `Co-Authored-By` in the commit. PR **title** carries the trailing `(NEU-408)`; the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer goes in the PR **body** only. Single PR for the ticket.

---

## Dependency on NEU-404 (hard blocker)

`GET /calendar` reads **only** the `catalog.film_release_date` table defined by **NEU-404** (model `FilmReleaseDate` in `catalog/models.py`; columns `film_id`, `iso_3166_1`, `release_type` (TMDB int 1–6), `release_date`, `certification`, `note`, `iso_639_1`; the calendar-serving `ix_catalog_film_release_date_lookup` index on `(release_date, release_type)`). This ticket **assumes that table exists, is migrated, and is populated**; it does **not** define, migrate, or alter it.

**Resilience to NEU-404's final shape — adapt, don't assume:** before writing the query, open `catalog/models.py` and confirm the actual `FilmReleaseDate` column names/types, and check whether `public/release.py` already exists.
- **`release_date` type.** Per the NEU-404 plan this column is `DateTime(timezone=True)` (TMDB returns `…T00:00:00.000Z`). The query must reduce it to a **UTC calendar date** for both the `>= today` cutoff and the grouped/emitted value — mirror `get_feed_grouped`'s `cast(func.timezone("UTC", <col>), Date)`. **If NEU-404 instead landed a plain `Date` column, drop the `timezone` cast** and compare/emit the date directly. Either way the wire value is `"YYYY-MM-DD"`.
- **`public/release.py`.** NEU-404 creates it with `RELEASE_TYPE_LABELS`/`release_type_label`. **Add** the bucket map to that same module (don't recreate the file). If NEU-404 somehow isn't merged yet at implementation time, create the module with both the labels (if missing) and the buckets — but normally NEU-404 lands first (it's a hard blocker), so expect to be additive.

---

## The contract (what NEU-409 will consume)

- **Endpoint:** `GET /calendar?limit=<n>&offset=<n>` → `200` with a `CalendarResponse` body `{ items, total, limit, offset }`.
- **`CalendarItem`:** `film_slug: str`, `film_title: str`, `poster_path: str | None` (raw TMDB path; FE builds the URL), `release_date` (`date` → `"YYYY-MM-DD"`, the US date), `release_type: str` (the **bucket string** `"premiere" | "limited" | "wide"` — never the raw TMDB int).
- **Future-first:** only `release_date >= today (UTC)`; **today is inclusive** (a film releasing today still appears).
- **Single governing region:** `iso_3166_1 = CALENDAR_REGION` (`"US"`, a named constant); a film with no US type-1/2/3 row simply doesn't appear (no cross-country fallback in v1).
- **Bucketing:** TMDB `type` `1→premiere`, `2→limited`, `3→wide` (festival collapses into `premiere` — TMDB has no distinct festival type; it's encoded as type 1); types **4/5/6 (digital/physical/TV) excluded**. The SQL `IN (...)` filter is **derived from the bucket-map keys** so the surfaced set and the mapping can never drift.
- **One row per `(film, US date, bucket)`:** `GROUP BY`/`DISTINCT` collapses TMDB's frequent duplicate per-country/type rows (different `note`/`certification`). A film with both a limited and a wide US date → two rows.
- **Ordering:** `release_date ASC, release_type ASC, popularity DESC NULLS LAST, slug ASC` — items arrive **date-then-type adjacent**, so the FE groups by walking the list (no client sort). `release_type ASC` doubles as bucket significance order (`1<2<3` ⇒ `premiere<limited<wide`).
- **Visibility:** `slug IS NOT NULL` **+** `NOT adult` (safety filter) — **no summary gate** (deliberately *unlike* `/films`/`/feed`; the release date itself is the content, so dated-but-quiet films must surface). `slug IS NOT NULL` guarantees every item is openable at `/film/{slug}`.
- **`total`:** number of `(film, date, bucket)` rows in the window (count over the grouped subquery — mirrors `get_feed_grouped`).
- **Envelope/bounds:** `limit` `Query(default=100, ge=1, le=200)` (a calendar window is naturally larger than a feed page; FE renders the whole window without paging in v1); `offset` `Query(default=0, ge=0)` (kept for envelope consistency / future "load more"). Out-of-range → `422`.
- **Empty:** no upcoming rows → `200` with `items: []`, `total: 0` (never an error — the FE renders a graceful empty state).

---

## What changes

### 1. `src/upmovies/public/release.py` — add the bucket map (additive to NEU-404)

A pure module (mirrors `public/arc.py`/`public/sources.py` style), unit-testable in isolation. **Add alongside** NEU-404's `RELEASE_TYPE_LABELS`/`release_type_label` — do not replace them:

```python
# TMDB release_dates `type` ints (per /movie/{id}/release_dates):
#   1 Premiere · 2 Theatrical (limited) · 3 Theatrical (wide) · 4 Digital · 5 Physical · 6 TV
# Calendar (M6) surfaces only the theatrical/premiere arc; festival ≈ Premiere (TMDB has no
# distinct festival type — it's type 1 distinguishable only by free-text `note`), so festival
# collapses into `premiere`. 4/5/6 are excluded in v1 (one-line widening to add later).
RELEASE_BUCKETS: tuple[str, ...] = ("premiere", "limited", "wide")  # display + significance order
_TMDB_TYPE_TO_BUCKET: dict[int, str] = {1: "premiere", 2: "limited", 3: "wide"}

def bucket_for_tmdb_type(tmdb_type: int) -> str | None:
    """The calendar display bucket for a TMDB release `type`, or None if not surfaced."""
    return _TMDB_TYPE_TO_BUCKET.get(tmdb_type)
```

**Seam note:** the SQL filter in the service should derive the surfaced int set from this map (`tuple(_TMDB_TYPE_TO_BUCKET)`), so adding a future bucket (e.g. digital) is a one-line map entry that widens the query automatically.

### 2. `src/upmovies/public/dto.py` — new DTOs (mirror `FeedDayItem`/`FeedDayResponse`)

```python
class CalendarItem(BaseModel):
    film_slug: str
    film_title: str
    poster_path: str | None
    release_date: date          # US release date → "YYYY-MM-DD"
    release_type: str           # display bucket: "premiere" | "limited" | "wide"

class CalendarResponse(BaseModel):
    items: list[CalendarItem]
    total: int
    limit: int
    offset: int
```

`date` is already imported in `dto.py`. Place these after `FeedDayResponse`.

### 3. `src/upmovies/public/service.py` — `get_calendar` (mirror `get_feed_grouped`)

Add the region constant and the service function. Import `FilmReleaseDate` from `catalog.models` and `bucket_for_tmdb_type` (+ `_TMDB_TYPE_TO_BUCKET`) from `public.release`; the new DTOs from `public.dto`; ensure `datetime`/`UTC` and `Date`/`cast`/`func`/`nulls_last`/`select` are imported (most already are — add `UTC` to the `datetime` import).

Illustrative — adapt to the surrounding style and to NEU-404's actual column types; **not** signatures to copy verbatim:

```python
CALENDAR_REGION = "US"  # single governing region for v1 (named for trivial later parametrization)

async def get_calendar(session: AsyncSession, *, limit: int, offset: int) -> CalendarResponse:
    today = datetime.now(tz=UTC).date()                      # Python-side, NOT SQL CURRENT_DATE
    # If NEU-404's release_date is a plain Date, drop the timezone() cast and use the column directly.
    rel_day = cast(func.timezone("UTC", FilmReleaseDate.release_date), Date)
    surfaced_types = tuple(_TMDB_TYPE_TO_BUCKET)             # (1, 2, 3) — derived, never drifts

    base = (
        select(
            Film.slug.label("slug"),
            Film.title.label("title"),
            Film.poster_path.label("poster_path"),
            rel_day.label("release_date"),
            FilmReleaseDate.release_type.label("release_type"),
        )
        .select_from(FilmReleaseDate)
        .join(Film, Film.id == FilmReleaseDate.film_id)
        .where(
            FilmReleaseDate.iso_3166_1 == CALENDAR_REGION,
            FilmReleaseDate.release_type.in_(surfaced_types),
            rel_day >= today,                                # inclusive "today forward"
            Film.slug.is_not(None),
            func.coalesce(Film.adult, False).is_(False),     # NOT adult; no summary gate
        )
        # one row per (film, US date, bucket); grouping by Film.id lets us order by Film.popularity
        # (functional dependency on the PK), exactly like get_feed_grouped.
        .group_by(
            Film.id, Film.slug, Film.title, Film.poster_path,
            rel_day, FilmReleaseDate.release_type,
        )
    )

    total = await session.scalar(select(func.count()).select_from(base.subquery()))

    rows = (
        await session.execute(
            base.order_by(
                rel_day.asc(),
                FilmReleaseDate.release_type.asc(),
                nulls_last(Film.popularity.desc()),
                Film.slug.asc(),
            )
            .limit(limit)
            .offset(offset)
        )
    ).all()

    items = [
        CalendarItem(
            film_slug=slug,
            film_title=title,
            poster_path=poster_path,
            release_date=release_date,
            # SQL already filtered to surfaced types, so the bucket is always present.
            # Use _TMDB_TYPE_TO_BUCKET[release_type] (pyright sees `str`) or assert non-None
            # if calling bucket_for_tmdb_type (which is typed `str | None`).
            release_type=_TMDB_TYPE_TO_BUCKET[release_type],
        )
        for slug, title, poster_path, release_date, release_type in rows
    ]
    return CalendarResponse(items=items, total=total or 0, limit=limit, offset=offset)
```

Notes:
- The Python-side bucket mapping keeps the SQL a straight projection and the mapping unit-testable in isolation. Because the SQL `IN (...)` already restricts to surfaced types, the per-row lookup is total; prefer the direct dict lookup (`_TMDB_TYPE_TO_BUCKET[...]`) so pyright sees `str` (or `assert (b := bucket_for_tmdb_type(t)) is not None`).
- Each surfaced TMDB type maps 1:1 to a distinct bucket (1→premiere, 2→limited, 3→wide), so `GROUP BY release_type` is equivalent to grouping by bucket — no ambiguity.
- `total` over the grouped subquery counts `(film, date, bucket)` rows, matching the FE's group count expectation.

### 4. `src/upmovies/routers/public.py` — the route

Add beside `GET /feed/grouped` (a top-level literal path — **no route-order footgun**, unlike `/films/search`). Add `CalendarResponse` to the existing `from upmovies.public.dto import (...)` block.

```python
@router.get("/calendar", response_model=CalendarResponse)
async def get_calendar(
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> CalendarResponse:
    return await service.get_calendar(session, limit=limit, offset=offset)
```

---

## TDD testing intent

Write tests **red first**, watch them fail (route 404 / wrong rows / wrong order), then implement. Per the repo gotcha, **run the whole file/dir**, not a single test.

### Fixtures (`tests/fixtures/public.py`)
Add a small helper to attach `film_release_date` rows to a film — e.g. `add_release_date(film, *, iso_3166_1="US", release_type=3, release_date=..., certification=None, note=None)` inserting a `FilmReleaseDate` and committing (mirror `add_event`'s shape; import `FilmReleaseDate`). For the adult-exclusion case, either add an `adult` kwarg to `make_film` (default `None`) or set `film.adult = True` + commit on the returned `Film`. (Confirm the kwarg/field names against NEU-404's merged model before writing.)

### Unit tests (`tests/unit/public/test_release.py`)
Extend (or create alongside NEU-404's coverage) the bucket map: `bucket_for_tmdb_type` returns `premiere`/`limited`/`wide` for `1`/`2`/`3` and `None` for `4`/`5`/`6` (and a stray int); `RELEASE_BUCKETS == ("premiere", "limited", "wide")` and the SQL-filter set `tuple(_TMDB_TYPE_TO_BUCKET) == (1, 2, 3)`. Keep NEU-404's label tests intact.

### Integration tests (`tests/integration/routers/test_public_calendar.py`, new)
Reuse `client` / `make_film` and the new release-date fixture. Use **fixed** future/past dates relative to a clear "today" (the service uses real `now()` UTC; pick dates well in the past/future so the suite isn't time-fragile — e.g. far-future `2099-…` for "upcoming", `2000-…` for "past"; and a `== today` case computed from `datetime.now(UTC).date()` for the inclusive-boundary test).

1. **Envelope + defaults** — empty DB → `200`, `{items: [], total: 0, limit: 100, offset: 0}`.
2. **Future-first cutoff** — a US wide row in the past is **excluded**; one in the future is **included**; a row dated **exactly today** (UTC) is **included** (inclusive boundary).
3. **US-only scoping** — a film with a future `GB` (or other non-US) row but **no** US row does **not** appear; given both US and GB rows, only the US date is listed.
4. **Type mapping → buckets** — a film with US type 1/2/3 rows surfaces `release_type` `"premiere"`/`"limited"`/`"wide"` respectively; a film with **only** type 4/5/6 (digital/physical/TV) US rows does **not** appear (excluded).
5. **Festival collapses into premiere** — a type-1 row with a festival `note` still surfaces as bucket `"premiere"` (no separate festival bucket).
6. **Ordering soonest-first, then type** — across films/dates, items come back ordered `release_date ASC` then (within a date) `release_type ASC` (premiere → limited → wide); add a popularity/slug tiebreak case within the same (date, type) to pin `popularity DESC NULLS LAST, slug ASC`.
7. **Distinct `(film, date, bucket)` de-dup** — two US type-3 rows for the same film on the same date (different `note`/`certification`) collapse to **one** calendar row; a film with both a US limited (type 2) and a US wide (type 3) date yields **two** rows.
8. **Visibility** — a matching film with `slug IS NULL` is excluded; an `adult` film is excluded; **a dated film with no summarized events is still INCLUDED** (the key divergence from `/films`/`/feed` — assert it explicitly).
9. **`limit`/`offset` + `total`** — `total` is the full window count; paging slices it; out-of-range (`limit=0`, `limit=201`, `offset=-1`) → `422`.

---

## Tasks

- [ ] **Task 1 — Bucket map + unit tests (red→green).** Add `RELEASE_BUCKETS`/`_TMDB_TYPE_TO_BUCKET`/`bucket_for_tmdb_type` to `public/release.py` (creating the module only if NEU-404 hasn't). Write `tests/unit/public/test_release.py` cases for the buckets first (red), then confirm green. Keep any NEU-404 label tests passing.
- [ ] **Task 2 — DTOs + integration tests (red).** Add `CalendarItem`/`CalendarResponse` to `public/dto.py`. Add the release-date fixture helper to `tests/fixtures/public.py`. Write `tests/integration/routers/test_public_calendar.py` (cases 1–9). Run `task test -- tests/integration/routers/test_public_calendar.py` (whole file) — confirm they fail for the right reason (route 404s; service absent).
- [ ] **Task 3 — Service + route (green).** Add `CALENDAR_REGION` + `get_calendar` to `public/service.py` (range-scan `FilmReleaseDate` ⋈ `Film`, US/types-1-3/future/visibility filters, group + order, Python bucket map, `total` over the grouped subquery). Add `GET /calendar` to `routers/public.py` before/beside `/feed/grouped` and import `CalendarResponse`. Re-run the suite — calendar tests pass; existing public tests stay green.
- [ ] **Task 4 — Full CI gate + ship.** `task format` → `task lint` → `task typecheck` → `task test` all green; `alembic heads` unchanged/single; `git diff --stat` confined to `public/release.py`, `public/service.py`, `public/dto.py`, `routers/public.py`, `tests/fixtures/public.py`, and `tests/integration/routers/test_public_calendar.py` (+ `tests/unit/public/test_release.py`). Commit once on the ticket branch and open the PR (suggested subject `feat(public): add GET /calendar upcoming-releases endpoint`; PR title appends `(NEU-408)`; footer in PR body only).

---

## Acceptance criteria

1. `GET /calendar?limit&offset` returns a `CalendarResponse` `{ items, total, limit, offset }` reading `catalog.film_release_date` (NEU-404), with `limit` `ge=1, le=200` (default 100) and `offset` `ge=0`; out-of-range → `422`; empty → `200` with `items: []`, `total: 0`.
2. Items are **future-first**: `release_date >= today (UTC, computed in Python)`, today inclusive; past rows excluded.
3. Items are ordered `release_date ASC, release_type ASC, popularity DESC NULLS LAST, slug ASC` (soonest-first, then bucket significance), one row per **(film, US date, bucket)** (duplicate TMDB rows collapsed); `total` is the window's `(film, date, bucket)` count.
4. TMDB types map `1→premiere, 2→limited, 3→wide` via the pure `public/release.py` helper; **festival collapses into `premiere`**; types **4/5/6 excluded** (and the SQL `IN` set is derived from the map so it can't drift).
5. The listed date is scoped to **`iso_3166_1 = CALENDAR_REGION ("US")`** (named constant); films with no US type-1/2/3 row don't appear.
6. Visibility = **`slug IS NOT NULL`** + `NOT adult`, with **no summary gate** (dated-but-quiet films surface) — covered by a test asserting a no-summary film still lists.
7. Tests cover bucket mapping (1/2/3 → buckets; 4/5/6 not surfaced), future-first cutoff (past excluded, today included), US-only scoping, date-then-type ordering + tiebreaks, distinct de-dup, slug-null + adult exclusion, no-summary inclusion, `limit`/`offset`/`total`, and empty. `task format`/`lint`/`typecheck`/`test` all green; no migration ran; diff confined to the listed files.

---

## Key files touched

- `src/upmovies/public/release.py` — **add** `RELEASE_BUCKETS`, `_TMDB_TYPE_TO_BUCKET`, `bucket_for_tmdb_type` alongside NEU-404's labels (create the module only if NEU-404 hasn't).
- `src/upmovies/public/dto.py` — add `CalendarItem` + `CalendarResponse` (mirror `FeedDayItem`/`FeedDayResponse`).
- `src/upmovies/public/service.py` — add `CALENDAR_REGION = "US"` + `get_calendar(...)` (range-scan `FilmReleaseDate` ⋈ `Film`; US/types-1-3/future/visibility; group + order; Python bucket map; `total` over the grouped subquery); add imports (`FilmReleaseDate`, `bucket_for_tmdb_type`/`_TMDB_TYPE_TO_BUCKET`, `CalendarItem`/`CalendarResponse`, `UTC`).
- `src/upmovies/routers/public.py` — add `GET /calendar` beside `/feed/grouped`; import `CalendarResponse`.
- `tests/integration/routers/test_public_calendar.py` *(new)* — endpoint integration tests (cases 1–9).
- `tests/unit/public/test_release.py` — bucket-map unit tests (extend, don't clobber NEU-404's label tests).
- `tests/fixtures/public.py` — add a `film_release_date` insert helper (+ an `adult` kwarg/field path for the adult-exclusion test).
- *(reference only, not modified)* `src/upmovies/catalog/models.py` (`FilmReleaseDate` from NEU-404 — read its actual column names/types before writing the query); `src/upmovies/public/service.py::get_feed_grouped` (the pattern mirrored).

---

## Self-Review

**Spec coverage** (against NEU-408 + M6 §2.1–2.4, §3.2–3.3, §4):
- `GET /calendar?limit&offset` → `CalendarResponse`, default 100 / `le=200`, offset envelope → The contract, §3/§4, criterion 1. ✓
- Future-first, UTC "today" computed in Python (not `CURRENT_DATE`), inclusive boundary → service (§3), Global Constraints, criterion 2, test case 2. ✓
- US governing region as named constant `CALENDAR_REGION`, no cross-country fallback → service, criterion 5, test case 3. ✓
- TMDB 1/2/3 → premiere/limited/wide via pure helper, festival ≈ premiere, 4/5/6 excluded, SQL `IN` derived from map → release.py (§1), criterion 4, test cases 4–5. ✓
- Distinct `(film, date, bucket)` rows, `release_type ASC` = bucket order, `total` = grouped count → service, criterion 3, test cases 6–7. ✓
- Visibility `slug IS NOT NULL` + `NOT adult`, **no** summary gate (dated-but-quiet surfaces) → contract, criterion 6, test case 8. ✓
- DTO/envelope mirrors `FeedDayResponse`; flat list grouped client-side; server-side ordering for SSR determinism → §2, Global Constraints. ✓
- Realizes M6 "NEU-408 — `GET /calendar` (backend)" / Story NEU-373 backend half; FE NEU-409 consumes it → Realizes section. ✓
- Hard dependency on NEU-404; reads only, adapts to its actual `release_date` type + `public/release.py` presence → Dependency section. ✓
- TDD red→green, whole-file run (pytest-asyncio gotcha), real Postgres → Global Constraints, Tasks 1–4. ✓

**Placeholder scan:** none fabricated — the `release.py`/DTO/service/router blocks are explicitly illustrative (they reproduce the milestone spec's shapes); column names are flagged as "confirm against NEU-404's merged model." No invented signatures pinned as contract beyond the `CalendarResponse` envelope the FE depends on.

**Resilience:** light on exact signatures; the surfaced-type SQL set is derived from the bucket map (one-line widening to add digital/physical/TV later); the `release_date` UTC-cast has an explicit "if NEU-404 landed a plain Date, drop the cast" escape; the region is a constant; fixture kwarg names are "confirm against the merged model." No route-order footgun (`/calendar` is a top-level literal).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
