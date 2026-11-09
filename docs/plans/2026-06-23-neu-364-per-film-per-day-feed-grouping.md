# NEU-364 — Per-film-per-day grouped feed endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `GET /feed/grouped` endpoint returning one record per (film, UTC day) — film slug/title/poster, the day, the day's most-significant event type, and the count of summarized events — to back the per-film-per-day home feed.

**Architecture:** A new endpoint (not a `groupBy` mode) with its own DTO. One grouped SQL query buckets summarized events by `(film, date(created_at @ UTC))`, counts them, aggregates the distinct event types, and paginates/orders in SQL (mirroring the existing `get_feed`). A pure Python helper picks the day's most-significant event type from the aggregated set, reusing `arc.py`'s existing ordering so there is no divergent ranking.

**Tech Stack:** FastAPI, async SQLAlchemy 2.x (Postgres), Pydantic v2, pytest (`asyncio_mode = "auto"`) + httpx ASGI client. Repo: `upcoming-movies-backend`.

**Spec:** `docs/specs/2026-06-23-neu-364-per-film-per-day-feed-grouping-design.md`

## Global Constraints

- **Postgres-only SQL is allowed** — tests run against real Postgres (`TEST_DATABASE_URL`) and prod is Postgres. `cast(... , Date)`, `timezone('UTC', ...)`, `array_agg(DISTINCT ...)` are all fine.
- **Type hints:** modern `X | None` / `X | Y`; no `from __future__ import annotations`.
- **ruff** line-length 100, rules `E,F,W,I,B,UP`; format with `task format` before finishing.
- **All tooling runs in Docker** via `task` (the container delegates pre-commit too). Keep the backend container up: `task up`.
- **Commits are batched into ONE PR for the whole ticket.** Per-task steps below intentionally **omit** git commits — implement all tasks, then run Task 3 (full local CI) and make a single commit + open one PR. (Per the user's one-ticket-one-PR / subagents-don't-commit workflow.)
- **Branch:** `tom/neu-364-backend-per-film-per-day-grouping-mode-for-the-public-feed` (create off `main` before starting).
- **No DB migration** — no schema change.

Run a single test with the CLI passthrough, e.g.:
`task test -- tests/unit/public/test_arc.py::test_most_significant_other_only -v`

---

### Task 1: Pure significance ranker `most_significant_event_type`

Adds a pure helper that returns the most-significant `event_type` from a group, reusing the arc ordering. `other` (which has no arc stage) ranks below `announced`.

**Files:**
- Modify: `src/upmovies/public/arc.py`
- Test: `tests/unit/public/test_arc.py` (extend)

**Interfaces:**
- Consumes: nothing new (uses existing module-private `_EVENT_STAGE`, `_RANK`).
- Produces: `most_significant_event_type(event_types: Iterable[str]) -> str` — returns a raw `event_type` value (e.g. `"release_date"`). Assumes a **non-empty** input.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/public/test_arc.py`, change the import line at the top:

```python
from upmovies.public.arc import derive_arc_stage, most_significant_event_type
```

Append these tests to the end of the file:

```python
def test_most_significant_picks_highest_ranked_type():
    assert most_significant_event_type(["announced", "casting", "trailer"]) == "trailer"
    assert most_significant_event_type(["casting", "release_date"]) == "release_date"
    assert most_significant_event_type(["production_start", "production_wrap"]) == "production_wrap"


def test_most_significant_is_order_independent():
    assert most_significant_event_type(["trailer", "announced"]) == "trailer"
    assert most_significant_event_type(["announced", "trailer"]) == "trailer"


def test_most_significant_single_type():
    assert most_significant_event_type(["casting"]) == "casting"


def test_most_significant_other_ranks_below_announced():
    assert most_significant_event_type(["announced", "other"]) == "announced"


def test_most_significant_other_only():
    assert most_significant_event_type(["other"]) == "other"
    assert most_significant_event_type(["other", "other"]) == "other"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/public/test_arc.py -v`
Expected: FAIL — `ImportError: cannot import name 'most_significant_event_type'`.

- [ ] **Step 3: Implement the helper**

Append to `src/upmovies/public/arc.py` (the file already has `from collections.abc import Iterable` at the top and defines `_EVENT_STAGE` and `_RANK`):

```python
def most_significant_event_type(event_types: Iterable[str]) -> str:
    """Return the most-significant event_type from a non-empty group, using the same
    ordering as the film arc. event_types with no arc stage (i.e. "other") rank below
    "announced", so an other-only group returns "other"."""
    return max(
        event_types,
        key=lambda t: _RANK[_EVENT_STAGE[t]] if t in _EVENT_STAGE else -1,
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/public/test_arc.py -v`
Expected: PASS (all tests, including the pre-existing `derive_arc_stage` ones).

---

### Task 2: `GET /feed/grouped` endpoint (DTOs + service + route)

Adds the DTOs, the grouped-feed service query, and the route, driven by a new integration test file.

**Files:**
- Modify: `src/upmovies/public/dto.py` (add `FeedDayItem`, `FeedDayResponse`)
- Modify: `src/upmovies/public/service.py` (add `get_feed_grouped`)
- Modify: `src/upmovies/routers/public.py` (add the route)
- Test (create): `tests/integration/routers/test_public_feed_grouped.py`

**Interfaces:**
- Consumes: `most_significant_event_type` (Task 1); existing `Event`, `EventSummary`, `Film` models; existing pytest fixtures `client`, `make_film`, `add_event` (in `tests/fixtures/public.py`).
- Produces:
  - `FeedDayItem(film_slug: str, film_title: str, poster_path: str | None, day: date, top_event_type: str, event_count: int)`
  - `FeedDayResponse(items: list[FeedDayItem], total: int, limit: int, offset: int)`
  - `service.get_feed_grouped(session, *, limit: int, offset: int) -> FeedDayResponse`
  - route `GET /feed/grouped?limit&offset`

Fixture reminder (from `tests/fixtures/public.py`): `make_film(*, slug, title="A Film", status="Planned", release_date=date(2026,7,17), poster_path="/poster.jpg")`; `add_event(*, film, event_type="casting", confidence="confirmed", occurred_at=..., created_at=None, summary="A neutral summary.", sources=())` — when `summary=None` no `EventSummary` row is written; when `created_at` is given it's set on the event.

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/routers/test_public_feed_grouped.py`:

```python
from datetime import UTC, datetime


async def test_grouped_one_row_per_film_day_with_count_and_top_type(client, make_film, add_event):
    film = await make_film(slug="film-2026", title="A Film")
    await add_event(
        film=film, event_type="announced", summary="a",
        created_at=datetime(2026, 6, 3, 8, tzinfo=UTC),
    )
    await add_event(
        film=film, event_type="casting", summary="b",
        created_at=datetime(2026, 6, 3, 12, tzinfo=UTC),
    )
    await add_event(
        film=film, event_type="trailer", summary="c",
        created_at=datetime(2026, 6, 3, 20, tzinfo=UTC),
    )

    body = (await client.get("/feed/grouped")).json()
    assert body["total"] == 1
    assert body["limit"] == 50
    assert body["offset"] == 0
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["film_slug"] == "film-2026"
    assert item["film_title"] == "A Film"
    assert item["poster_path"] == "/poster.jpg"
    assert item["day"] == "2026-06-03"
    assert item["event_count"] == 3
    assert item["top_event_type"] == "trailer"


async def test_grouped_same_film_two_days_makes_two_rows(client, make_film, add_event):
    film = await make_film(slug="film-2026")
    await add_event(
        film=film, event_type="casting", summary="day1",
        created_at=datetime(2026, 6, 1, 10, tzinfo=UTC),
    )
    await add_event(
        film=film, event_type="trailer", summary="day2",
        created_at=datetime(2026, 6, 2, 10, tzinfo=UTC),
    )

    body = (await client.get("/feed/grouped")).json()
    assert body["total"] == 2
    assert [(i["day"], i["top_event_type"]) for i in body["items"]] == [
        ("2026-06-02", "trailer"),
        ("2026-06-01", "casting"),
    ]


async def test_grouped_newest_day_first_across_films(client, make_film, add_event):
    a = await make_film(slug="a-2026")
    b = await make_film(slug="b-2026")
    await add_event(film=a, summary="A", created_at=datetime(2026, 6, 1, tzinfo=UTC))
    await add_event(film=b, summary="B", created_at=datetime(2026, 6, 2, tzinfo=UTC))

    body = (await client.get("/feed/grouped")).json()
    assert [i["film_slug"] for i in body["items"]] == ["b-2026", "a-2026"]


async def test_grouped_within_day_orders_by_latest_event_time(client, make_film, add_event):
    # Same UTC day. latest-event-time must win over slug ordering:
    # zzz-late (22:00) precedes aaa-early (08:00) even though "aaa" < "zzz".
    early = await make_film(slug="aaa-early")
    late = await make_film(slug="zzz-late")
    await add_event(film=early, summary="early", created_at=datetime(2026, 6, 5, 8, tzinfo=UTC))
    await add_event(film=late, summary="late", created_at=datetime(2026, 6, 5, 22, tzinfo=UTC))

    items = (await client.get("/feed/grouped")).json()["items"]
    assert [i["film_slug"] for i in items] == ["zzz-late", "aaa-early"]


async def test_grouped_only_counts_summarized_events(client, make_film, add_event):
    film = await make_film(slug="partial-2026")
    await add_event(
        film=film, event_type="casting", summary="has",
        created_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    await add_event(
        film=film, event_type="trailer", summary=None,
        created_at=datetime(2026, 6, 1, tzinfo=UTC),
    )

    body = (await client.get("/feed/grouped")).json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["event_count"] == 1
    assert item["top_event_type"] == "casting"  # the summary-less trailer is ignored


async def test_grouped_film_with_no_summarized_events_absent(client, make_film, add_event):
    film = await make_film(slug="nosum-2026")
    await add_event(
        film=film, event_type="trailer", summary=None,
        created_at=datetime(2026, 6, 1, tzinfo=UTC),
    )

    body = (await client.get("/feed/grouped")).json()
    assert body["items"] == []
    assert body["total"] == 0


async def test_grouped_excludes_films_without_slug(client, make_film, add_event):
    slugged = await make_film(slug="has-slug-2026")
    unslugged = await make_film(slug=None)
    await add_event(film=slugged, summary="shown", created_at=datetime(2026, 6, 1, tzinfo=UTC))
    await add_event(film=unslugged, summary="hidden", created_at=datetime(2026, 6, 1, tzinfo=UTC))

    body = (await client.get("/feed/grouped")).json()
    assert [i["film_slug"] for i in body["items"]] == ["has-slug-2026"]
    assert body["total"] == 1


async def test_grouped_utc_day_boundary_splits_groups(client, make_film, add_event):
    film = await make_film(slug="boundary-2026")
    await add_event(
        film=film, event_type="casting", summary="before midnight",
        created_at=datetime(2026, 6, 1, 23, 59, tzinfo=UTC),
    )
    await add_event(
        film=film, event_type="trailer", summary="after midnight",
        created_at=datetime(2026, 6, 2, 0, 1, tzinfo=UTC),
    )

    body = (await client.get("/feed/grouped")).json()
    assert body["total"] == 2
    assert [i["day"] for i in body["items"]] == ["2026-06-02", "2026-06-01"]


async def test_grouped_pagination(client, make_film, add_event):
    film = await make_film(slug="film-2026")
    for i in range(3):
        await add_event(
            film=film, event_type="casting", summary=f"s{i}",
            created_at=datetime(2026, 6, 1 + i, 10, tzinfo=UTC),
        )

    page1 = (await client.get("/feed/grouped", params={"limit": 2, "offset": 0})).json()
    assert page1["total"] == 3
    assert len(page1["items"]) == 2
    assert page1["limit"] == 2
    assert page1["offset"] == 0
    assert [i["day"] for i in page1["items"]] == ["2026-06-03", "2026-06-02"]

    page2 = (await client.get("/feed/grouped", params={"limit": 2, "offset": 2})).json()
    assert page2["total"] == 3
    assert len(page2["items"]) == 1
    assert page2["items"][0]["day"] == "2026-06-01"


async def test_grouped_rejects_out_of_range_pagination(client):
    assert (await client.get("/feed/grouped", params={"limit": 0})).status_code == 422
    assert (await client.get("/feed/grouped", params={"limit": 101})).status_code == 422
    assert (await client.get("/feed/grouped", params={"offset": -1})).status_code == 422


async def test_grouped_empty_returns_empty_list(client):
    body = (await client.get("/feed/grouped")).json()
    assert body["items"] == []
    assert body["total"] == 0


async def test_grouped_other_only_day_surfaces_other(client, make_film, add_event):
    film = await make_film(slug="other-2026")
    await add_event(
        film=film, event_type="other", summary="misc",
        created_at=datetime(2026, 6, 1, tzinfo=UTC),
    )

    item = (await client.get("/feed/grouped")).json()["items"][0]
    assert item["top_event_type"] == "other"
    assert item["event_count"] == 1
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/routers/test_public_feed_grouped.py -v`
Expected: FAIL — the route doesn't exist yet, so requests return 404 and the assertions fail.

- [ ] **Step 3: Add the DTOs**

In `src/upmovies/public/dto.py` (it already imports `from datetime import date, datetime`), append:

```python
class FeedDayItem(BaseModel):
    film_slug: str
    film_title: str
    poster_path: str | None
    day: date
    top_event_type: str
    event_count: int


class FeedDayResponse(BaseModel):
    items: list[FeedDayItem]
    total: int
    limit: int
    offset: int
```

- [ ] **Step 4: Add the service query**

In `src/upmovies/public/service.py`:

Change the SQLAlchemy import line from:

```python
from sqlalchemy import func, nulls_last, select
```

to:

```python
from sqlalchemy import Date, cast, distinct, func, nulls_last, select
```

Add `most_significant_event_type` to the arc import:

```python
from upmovies.public.arc import derive_arc_stage, most_significant_event_type
```

Add `FeedDayItem` and `FeedDayResponse` to the dto import block (keep the others):

```python
from upmovies.public.dto import (
    EventOut,
    FeedDayItem,
    FeedDayResponse,
    FeedItem,
    FeedResponse,
    FilmDetailResponse,
    FilmIndexItem,
    FilmIndexResponse,
    SourceOut,
)
```

Append this function to the end of the file:

```python
async def get_feed_grouped(
    session: AsyncSession, *, limit: int, offset: int
) -> FeedDayResponse:
    day = cast(func.timezone("UTC", Event.created_at), Date)
    last_created = func.max(Event.created_at)

    base = (
        select(
            Film.slug.label("slug"),
            Film.title.label("title"),
            Film.poster_path.label("poster_path"),
            day.label("day"),
            func.count().label("event_count"),
            func.array_agg(distinct(Event.event_type)).label("event_types"),
        )
        .select_from(Event)
        .join(EventSummary, EventSummary.event_id == Event.id)
        .join(Film, Film.id == Event.film_id)
        .where(Film.slug.is_not(None))
        .group_by(Film.id, Film.slug, Film.title, Film.poster_path, day)
    )

    total = await session.scalar(select(func.count()).select_from(base.subquery()))

    rows = (
        await session.execute(
            base.order_by(day.desc(), last_created.desc(), Film.slug.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    items = [
        FeedDayItem(
            film_slug=slug,
            film_title=title,
            poster_path=poster_path,
            day=day_value,
            top_event_type=most_significant_event_type(event_types),
            event_count=event_count,
        )
        for slug, title, poster_path, day_value, event_count, event_types in rows
    ]
    return FeedDayResponse(items=items, total=total or 0, limit=limit, offset=offset)
```

Notes:
- `cast(func.timezone("UTC", Event.created_at), Date)` → `CAST(timezone('UTC', event.created_at) AS DATE)` = the UTC calendar date (matches the FE's `dayKey`).
- `distinct(Event.event_type)` inside `func.array_agg(...)` renders `array_agg(DISTINCT event.event_type)` and returns a Python `list[str]` (asyncpg). The ranker is order-independent, so the unordered list is fine.
- Rows are unpacked positionally in the same order as the `select(...)` columns (pyright-friendly, matching the rest of the module).

- [ ] **Step 5: Wire the route**

In `src/upmovies/routers/public.py`, add `FeedDayResponse` to the dto import:

```python
from upmovies.public.dto import (
    FeedDayResponse,
    FeedResponse,
    FilmDetailResponse,
    FilmIndexResponse,
)
```

Add this handler (place it after the existing `get_feed` handler):

```python
@router.get("/feed/grouped", response_model=FeedDayResponse)
async def get_grouped_feed(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> FeedDayResponse:
    return await service.get_feed_grouped(session, limit=limit, offset=offset)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `task test -- tests/integration/routers/test_public_feed_grouped.py -v`
Expected: PASS (all 12 tests).

---

### Task 3: Full local CI + single commit + PR

Runs the complete local pipeline, then makes the one commit and opens the single PR for the ticket.

**Files:** none (verification + git).

- [ ] **Step 1: Format**

Run: `task format`
Expected: ruff reformats nothing of substance (or only the new lines); no errors.

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: `All checks passed!`

- [ ] **Step 3: Type-check**

Run: `task typecheck`
Expected: `0 errors`.

- [ ] **Step 4: Confirm a single Alembic head (no migration added)**

Run: `docker compose exec upmovies-backend alembic heads`
Expected: exactly one head printed (NEU-364 adds no migration, so the head is unchanged).

- [ ] **Step 5: Run the full test suite**

Run: `task test`
Expected: the whole suite passes (new arc unit tests + new grouped-feed integration tests + all pre-existing tests).

- [ ] **Step 6: Commit and open the PR (single PR for the ticket)**

From inside `upcoming-movies-backend`, on branch `tom/neu-364-backend-per-film-per-day-grouping-mode-for-the-public-feed`:

```bash
git add -A
git commit -m "feat(public): add per-film-per-day grouped feed endpoint (NEU-364)"
git push -u origin tom/neu-364-backend-per-film-per-day-grouping-mode-for-the-public-feed
```

Open the PR against `main` with title `feat(public): per-film-per-day grouped feed endpoint (NEU-364)`. PR body should summarize the endpoint + link the spec, and end with the footer:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

(No `Co-Authored-By` trailer. The footer goes in the PR body only, never the commit message. For personal projects Tom typically generates the commit/PR copy via `/shipit`.)

---

## Self-Review

**Spec coverage:**
- "New endpoint, not a mode" → Task 2 Step 5 (`GET /feed/grouped`). ✓
- "Day = UTC date of created_at" → Task 2 Step 4 (`cast(timezone('UTC', created_at), Date)`); tested by `test_grouped_utc_day_boundary_splits_groups`. ✓
- "Only summarized events / slugged films" → `INNER JOIN event_summary` + `Film.slug.is_not(None)`; tested by `..._only_counts_summarized_events`, `..._no_summarized_events_absent`, `..._excludes_films_without_slug`. ✓
- "Most-significant event type, reuse arc ordering, `other` lowest" → Task 1 + `..._other_only_day_surfaces_other`. ✓
- "event_count correct" → `func.count()`; tested by the count assertions. ✓
- "One row per (film, day), two days → two rows" → `..._same_film_two_days_makes_two_rows`. ✓
- "Newest day first, paginated by film-day" → `order_by(day.desc(), ...)` + `limit/offset`; `total` over the grouped subquery; tested by `..._newest_day_first...`, `..._within_day_orders_by_latest_event_time`, `..._pagination`. ✓
- "Minimal payload (no summary/sources/confidence)" → `FeedDayItem` fields only. ✓
- "Unblocks NEU-362" → DTO carries slug/title/poster/day/top_event_type/event_count. ✓
- "No migration" → Task 3 Step 4 confirms unchanged head. ✓

**Placeholder scan:** none — every step has concrete code/commands and expected output.

**Type consistency:** `most_significant_event_type(event_types: Iterable[str]) -> str` defined in Task 1, consumed in Task 2 Step 4. `FeedDayItem`/`FeedDayResponse` fields defined in Task 2 Step 3 match their construction in Step 4 and the route's `response_model` in Step 5. Service signature `get_feed_grouped(session, *, limit, offset)` matches the route call. Row unpack order matches the `select(...)` column order.
