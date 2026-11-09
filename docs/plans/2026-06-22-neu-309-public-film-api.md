# Public Film Index/Detail API + Sitemap (NEU-309) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first unauthenticated read surface — `GET /films`, `GET /films/{slug}`, `GET /sitemap.xml` — serving the per-movie update log and discovery sitemap.

**Architecture:** A thin no-auth router (`routers/public.py`) over a dedicated `public/` package: pure arc-stage derivation (`arc.py`), Pydantic response DTOs (`dto.py`), async read queries (`service.py`), and a sitemap renderer (`sitemap.py`). No schema changes; one new config setting (`PUBLIC_BASE_URL`).

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 (async) + asyncpg, Pydantic v2 / pydantic-settings, pytest (+ pytest-asyncio `auto` mode). Everything runs in the container via `task` (no host Python).

**Design of record:** `docs/specs/2026-06-22-neu-309-public-film-api-design.md`.

---

## Working agreements (read first)

- **All commands run in the container via `task`.** Never run `pytest`/`ruff`/`pyright` on the host. Keep the container up (`task up`).
- **Commits:** Do **NOT** commit per task. NEU-309 ships as **one PR**. The user commits once at the end (Task 5). If executing via subagents, strip any commit step from implementer prompts.
- **TDD, test-first.** pytest-asyncio is in `auto` mode — async tests/fixtures need **no** `@pytest.mark.asyncio`. **No** `from __future__ import annotations`. Modern type hints (`X | None`). ruff line length 100.
- **Test data visibility:** the test `session` fixture and the app's request session are separate sessions on the **same** test DB. Fixtures must `commit()` so endpoints (which open their own session) can see the rows. The provided factories do this.
- **Integration-test run quirk:** running a *single integration file* in isolation triggers a pytest-asyncio session-loop error. Always scope integration runs to the **directory** (`tests/integration/routers/`), optionally narrowed with `-k`.

## File structure

| File | Responsibility |
|---|---|
| `src/upmovies/public/__init__.py` (create) | Package marker (empty). |
| `src/upmovies/public/arc.py` (create) | Pure arc-stage derivation. No DB. |
| `src/upmovies/public/dto.py` (create) | Pydantic v2 response models. |
| `src/upmovies/public/service.py` (create) | Async read queries → DTOs; `SitemapFilm`. |
| `src/upmovies/public/sitemap.py` (create) | Render sitemap XML from `SitemapFilm`s. |
| `src/upmovies/routers/public.py` (create) | No-auth `APIRouter`; the three endpoints. |
| `src/upmovies/main.py` (modify) | Register the public router. |
| `src/upmovies/config.py` (modify) | Add `public_base_url` (`PUBLIC_BASE_URL`). |
| `tests/unit/public/__init__.py` (create) | Test package marker. |
| `tests/unit/public/test_arc.py` (create) | Unit tests for arc derivation. |
| `tests/fixtures/public.py` (create) | `client` + `make_film` + `add_event` factories. |
| `tests/conftest.py` (modify) | Register the new fixtures plugin. |
| `tests/integration/routers/test_public_films.py` (create) | Index + detail endpoint tests. |
| `tests/integration/routers/test_public_sitemap.py` (create) | Sitemap endpoint tests. |

---

## Task 1: Arc-stage derivation (pure)

**Files:**
- Create: `src/upmovies/public/__init__.py`
- Create: `src/upmovies/public/arc.py`
- Create: `tests/unit/public/__init__.py`
- Test: `tests/unit/public/test_arc.py`

- [ ] **Step 1: Create the package markers**

Create `src/upmovies/public/__init__.py` (empty file) and `tests/unit/public/__init__.py` (empty file).

- [ ] **Step 2: Write the failing test**

Create `tests/unit/public/test_arc.py`:

```python
from upmovies.public.arc import derive_arc_stage


def test_status_baselines_with_no_events():
    assert derive_arc_stage("Rumored", []) == "announced"
    assert derive_arc_stage("Planned", []) == "announced"
    assert derive_arc_stage("In Production", []) == "shooting"
    assert derive_arc_stage("Post Production", []) == "wrapped"
    assert derive_arc_stage("Released", []) == "released"


def test_unknown_or_none_status_floors_to_announced():
    assert derive_arc_stage(None, []) == "announced"
    assert derive_arc_stage("Whatever", []) == "announced"


def test_event_types_advance_stage():
    assert derive_arc_stage("Planned", ["casting"]) == "cast"
    assert derive_arc_stage("Planned", ["release_date"]) == "dated"
    assert derive_arc_stage("Planned", ["trailer"]) == "trailer"


def test_max_combine_takes_the_furthest_stage():
    # In Production baseline (shooting) is ahead of an "announced" event.
    assert derive_arc_stage("In Production", ["announced"]) == "shooting"
    # A trailer event pulls a Planned film all the way to trailer.
    assert derive_arc_stage("Planned", ["announced", "casting", "trailer"]) == "trailer"


def test_other_event_type_contributes_nothing():
    assert derive_arc_stage("Planned", ["other"]) == "announced"
    assert derive_arc_stage("In Production", ["other"]) == "shooting"
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- tests/unit/public/test_arc.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.public.arc'`.

- [ ] **Step 4: Implement the arc module**

Create `src/upmovies/public/arc.py`:

```python
"""Pure arc-stage derivation for the public film surface.

The current arc stage is a coarse progress indicator on a linear arc. It is
derived from the film's TMDB ``status`` as a baseline, advanced by the
furthest-along event type present across *all* the film's events.
"""

from collections.abc import Iterable

# Linear arc in ascending order of progress.
ARC_STAGES: tuple[str, ...] = (
    "announced",
    "cast",
    "shooting",
    "wrapped",
    "dated",
    "trailer",
    "released",
)

_RANK: dict[str, int] = {stage: index for index, stage in enumerate(ARC_STAGES)}

# TMDB catalog.film.status -> baseline arc stage.
_STATUS_BASELINE: dict[str, str] = {
    "Rumored": "announced",
    "Planned": "announced",
    "In Production": "shooting",
    "Post Production": "wrapped",
    "Released": "released",
}

# news.event.event_type -> the arc stage it implies ("other" implies nothing).
_EVENT_STAGE: dict[str, str] = {
    "announced": "announced",
    "casting": "cast",
    "production_start": "shooting",
    "production_wrap": "wrapped",
    "release_date": "dated",
    "trailer": "trailer",
}


def derive_arc_stage(status: str | None, event_types: Iterable[str]) -> str:
    """Return a film's current arc stage.

    ``status`` is ``catalog.film.status`` (``None`` or an unknown value floors to
    ``"announced"``). ``event_types`` is every event type on the film (order and
    duplicates do not matter). The result is the highest-ranked stage among the
    status baseline and each event type's implied stage.
    """
    best = _RANK[_STATUS_BASELINE.get(status or "", "announced")]
    for event_type in event_types:
        stage = _EVENT_STAGE.get(event_type)
        if stage is not None:
            best = max(best, _RANK[stage])
    return ARC_STAGES[best]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test -- tests/unit/public/test_arc.py`
Expected: PASS (5 passed).

---

## Task 2: Film index endpoint `GET /films`

**Files:**
- Create: `tests/fixtures/public.py`
- Modify: `tests/conftest.py:6`
- Create: `src/upmovies/public/dto.py`
- Create: `src/upmovies/public/service.py`
- Create: `src/upmovies/routers/public.py`
- Modify: `src/upmovies/main.py:16,67`
- Test: `tests/integration/routers/test_public_films.py`

- [ ] **Step 1: Create the shared test fixtures**

Create `tests/fixtures/public.py`:

```python
from collections.abc import AsyncIterator
from datetime import date, datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.catalog.models import Film
from upmovies.main import app
from upmovies.news.models import Event, EventStory, EventSummary, Story


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:
        yield c


@pytest.fixture
def make_film(session: AsyncSession):
    counter = {"n": 0}

    async def _make(
        *,
        slug: str,
        title: str = "A Film",
        status: str | None = "Planned",
        release_date: date | None = date(2026, 7, 17),
        poster_path: str | None = "/poster.jpg",
    ) -> Film:
        counter["n"] += 1
        film = Film(
            tmdb_id=1000 + counter["n"],
            slug=slug,
            title=title,
            status=status,
            release_date=release_date,
            poster_path=poster_path,
        )
        session.add(film)
        await session.commit()
        await session.refresh(film)
        return film

    return _make


@pytest.fixture
def add_event(session: AsyncSession):
    async def _add(
        *,
        film: Film,
        event_type: str = "casting",
        confidence: str = "confirmed",
        occurred_at: datetime = datetime(2025, 3, 1, tzinfo=timezone.utc),
        summary: str | None = "A neutral summary.",
        sources: tuple[dict, ...] = (),
    ) -> Event:
        event = Event(
            film_id=film.id,
            event_type=event_type,
            confidence=confidence,
            occurred_at=occurred_at,
        )
        session.add(event)
        await session.flush()  # populate event.id
        if summary is not None:
            session.add(
                EventSummary(
                    event_id=event.id,
                    summary=summary,
                    model="claude-haiku-4-5",
                    prompt_version="1",
                    source_updated_at=occurred_at,
                )
            )
        for src in sources:
            story = Story(
                source=src.get("source", "Deadline"),
                url=src["url"],
                title=src.get("title", "Story title"),
                published_at=src.get("published_at"),
            )
            session.add(story)
            await session.flush()  # populate story.id
            session.add(EventStory(event_id=event.id, story_id=story.id))
        await session.commit()
        await session.refresh(event)
        return event

    return _add
```

- [ ] **Step 2: Register the fixtures plugin**

In `tests/conftest.py`, line 6, change:

```python
pytest_plugins = ["tests.fixtures.users"]
```

to:

```python
pytest_plugins = ["tests.fixtures.users", "tests.fixtures.public"]
```

- [ ] **Step 3: Write the failing index test**

Create `tests/integration/routers/test_public_films.py`:

```python
from datetime import date


async def test_index_lists_only_films_with_a_summarized_event(client, make_film, add_event):
    shown = await make_film(slug="shown-2026", title="Shown")
    await add_event(film=shown, event_type="casting", summary="A summary.")
    hidden = await make_film(slug="hidden-2026", title="Hidden")
    await add_event(film=hidden, summary=None)  # event but no summary
    await make_film(slug="bare-2026", title="Bare")  # no events at all

    r = await client.get("/films")
    assert r.status_code == 200
    body = r.json()
    assert [item["slug"] for item in body["items"]] == ["shown-2026"]
    assert body["total"] == 1
    assert body["limit"] == 50
    assert body["offset"] == 0
    item = body["items"][0]
    assert item["title"] == "Shown"
    assert item["release_year"] == 2026
    assert item["poster_path"] == "/poster.jpg"
    assert item["arc_stage"] == "cast"  # Planned baseline + casting event


async def test_index_orders_by_release_date_desc_nulls_last(client, make_film, add_event):
    later = await make_film(slug="later-2027", release_date=date(2027, 1, 1))
    await add_event(film=later, summary="s")
    earlier = await make_film(slug="earlier-2026", release_date=date(2026, 1, 1))
    await add_event(film=earlier, summary="s")
    undated = await make_film(slug="undated", release_date=None)
    await add_event(film=undated, summary="s")

    r = await client.get("/films")
    assert [i["slug"] for i in r.json()["items"]] == ["later-2027", "earlier-2026", "undated"]


async def test_index_pagination(client, make_film, add_event):
    for i in range(3):
        film = await make_film(slug=f"f{i}-2026", release_date=date(2026, 1, 1 + i))
        await add_event(film=film, summary="s")

    page1 = (await client.get("/films", params={"limit": 2, "offset": 0})).json()
    assert page1["total"] == 3
    assert len(page1["items"]) == 2
    assert page1["limit"] == 2
    assert page1["offset"] == 0

    page2 = (await client.get("/films", params={"limit": 2, "offset": 2})).json()
    assert len(page2["items"]) == 1


async def test_index_rejects_out_of_range_pagination(client):
    assert (await client.get("/films", params={"limit": 0})).status_code == 422
    assert (await client.get("/films", params={"limit": 101})).status_code == 422
    assert (await client.get("/films", params={"offset": -1})).status_code == 422
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `task test -- tests/integration/routers/ -k public`
Expected: FAIL — the `/films` route does not exist yet, so `GET /films` returns 404 (asserts expect 200).

- [ ] **Step 5: Create the response DTOs**

Create `src/upmovies/public/dto.py`:

```python
from datetime import date, datetime

from pydantic import BaseModel


class SourceOut(BaseModel):
    url: str
    source: str
    title: str
    published_at: datetime | None


class EventOut(BaseModel):
    event_type: str
    confidence: str
    occurred_at: datetime
    summary: str
    sources: list[SourceOut]


class FilmIndexItem(BaseModel):
    slug: str
    title: str
    release_year: int | None
    poster_path: str | None
    arc_stage: str


class FilmIndexResponse(BaseModel):
    items: list[FilmIndexItem]
    total: int
    limit: int
    offset: int


class FilmDetailResponse(BaseModel):
    slug: str
    title: str
    release_date: date | None
    release_year: int | None
    poster_path: str | None
    arc_stage: str
    events: list[EventOut]
```

- [ ] **Step 6: Create the read service with the index query**

Create `src/upmovies/public/service.py`:

```python
from datetime import date
from uuid import UUID

from sqlalchemy import func, nulls_last, select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.catalog.models import Film
from upmovies.news.models import Event, EventSummary
from upmovies.public.arc import derive_arc_stage
from upmovies.public.dto import FilmIndexItem, FilmIndexResponse


def _release_year(release_date: date | None) -> int | None:
    return release_date.year if release_date is not None else None


async def _event_types_by_film(
    session: AsyncSession, film_ids: list[UUID]
) -> dict[UUID, list[str]]:
    if not film_ids:
        return {}
    rows = await session.execute(
        select(Event.film_id, Event.event_type).where(Event.film_id.in_(film_ids))
    )
    result: dict[UUID, list[str]] = {}
    for film_id, event_type in rows:
        result.setdefault(film_id, []).append(event_type)
    return result


async def get_film_index(session: AsyncSession, *, limit: int, offset: int) -> FilmIndexResponse:
    has_summary = (
        select(Event.id)
        .join(EventSummary, EventSummary.event_id == Event.id)
        .where(Event.film_id == Film.id)
        .exists()
    )
    total = await session.scalar(select(func.count()).select_from(Film).where(has_summary))
    films = (
        (
            await session.execute(
                select(Film)
                .where(has_summary)
                .order_by(nulls_last(Film.release_date.desc()), Film.id.asc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    event_types = await _event_types_by_film(session, [film.id for film in films])
    items = [
        FilmIndexItem(
            slug=film.slug,
            title=film.title,
            release_year=_release_year(film.release_date),
            poster_path=film.poster_path,
            arc_stage=derive_arc_stage(film.status, event_types.get(film.id, [])),
        )
        for film in films
    ]
    return FilmIndexResponse(items=items, total=total or 0, limit=limit, offset=offset)
```

- [ ] **Step 7: Create the public router with `/films`**

Create `src/upmovies/routers/public.py`:

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.deps import get_session
from upmovies.public import service
from upmovies.public.dto import FilmIndexResponse

router = APIRouter(tags=["public"])


@router.get("/films", response_model=FilmIndexResponse)
async def list_films(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> FilmIndexResponse:
    return await service.get_film_index(session, limit=limit, offset=offset)
```

- [ ] **Step 8: Register the router in `main.py`**

In `src/upmovies/main.py`, line 16, change:

```python
from upmovies.routers import admin_runs, auth, health, ingest_admin, invites_admin, me
```

to:

```python
from upmovies.routers import admin_runs, auth, health, ingest_admin, invites_admin, me, public
```

Then, after `app.include_router(me.router)` (line 67), add:

```python
    app.include_router(public.router)
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `task test -- tests/integration/routers/ -k public`
Expected: PASS (4 passed; other router tests deselected).

---

## Task 3: Film detail endpoint `GET /films/{slug}`

**Files:**
- Modify: `src/upmovies/public/service.py` (add `get_film_detail`)
- Modify: `src/upmovies/routers/public.py` (add route + imports)
- Test: `tests/integration/routers/test_public_films.py` (append)

- [ ] **Step 1: Append the failing detail tests**

Append to `tests/integration/routers/test_public_films.py` (the existing `from datetime import date` import is already present — add `datetime, timezone` to it so the line reads `from datetime import date, datetime, timezone`):

```python
async def test_detail_returns_chronological_summarized_events_with_sources(
    client, make_film, add_event
):
    film = await make_film(slug="odyssey-2026", title="The Odyssey", status="In Production")
    await add_event(
        film=film,
        event_type="casting",
        confidence="confirmed",
        occurred_at=datetime(2025, 3, 1, tzinfo=timezone.utc),
        summary="Casting announced.",
        sources=(
            {
                "url": "https://deadline.com/a",
                "source": "Deadline",
                "title": "Cast revealed",
                "published_at": datetime(2025, 3, 1, 12, tzinfo=timezone.utc),
            },
        ),
    )
    await add_event(
        film=film,
        event_type="trailer",
        occurred_at=datetime(2025, 1, 1, tzinfo=timezone.utc),  # earlier
        summary="Trailer dropped.",
    )

    r = await client.get("/films/odyssey-2026")
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "odyssey-2026"
    assert body["title"] == "The Odyssey"
    assert body["release_date"] == "2026-07-17"
    assert body["release_year"] == 2026
    assert body["arc_stage"] == "trailer"  # In Production baseline, trailer event wins
    # Chronological ascending: the January trailer before the March casting.
    assert [e["event_type"] for e in body["events"]] == ["trailer", "casting"]
    casting = body["events"][1]
    assert casting["confidence"] == "confirmed"
    assert casting["summary"] == "Casting announced."
    assert casting["sources"][0]["url"] == "https://deadline.com/a"
    assert casting["sources"][0]["source"] == "Deadline"


async def test_detail_omits_summary_less_events(client, make_film, add_event):
    film = await make_film(slug="partial-2026")
    await add_event(film=film, event_type="casting", summary="Has summary.")
    await add_event(film=film, event_type="trailer", summary=None)

    body = (await client.get("/films/partial-2026")).json()
    assert [e["event_type"] for e in body["events"]] == ["casting"]


async def test_detail_empty_log_film_returns_200_with_derived_arc(client, make_film, add_event):
    film = await make_film(slug="quiet-2026", status="In Production")
    await add_event(film=film, event_type="production_start", summary=None)  # no summary

    r = await client.get("/films/quiet-2026")
    assert r.status_code == 200
    body = r.json()
    assert body["events"] == []
    assert body["arc_stage"] == "shooting"  # In Production / production_start


async def test_detail_unknown_slug_returns_404(client):
    assert (await client.get("/films/does-not-exist")).status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/routers/ -k public`
Expected: FAIL — `GET /films/{slug}` has no route, so it returns 404 for the existing-film cases (which assert 200).

- [ ] **Step 3: Add `get_film_detail` to the service**

In `src/upmovies/public/service.py`, update the imports at the top so they read:

```python
from datetime import date
from uuid import UUID

from sqlalchemy import func, nulls_last, select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.catalog.models import Film
from upmovies.news.models import Event, EventStory, EventSummary, Story
from upmovies.public.arc import derive_arc_stage
from upmovies.public.dto import (
    EventOut,
    FilmDetailResponse,
    FilmIndexItem,
    FilmIndexResponse,
    SourceOut,
)
```

Then append this function to the end of the file:

```python
async def get_film_detail(session: AsyncSession, slug: str) -> FilmDetailResponse | None:
    film = (
        await session.execute(select(Film).where(Film.slug == slug))
    ).scalar_one_or_none()
    if film is None:
        return None

    all_event_types = [
        event_type
        for (event_type,) in await session.execute(
            select(Event.event_type).where(Event.film_id == film.id)
        )
    ]
    arc_stage = derive_arc_stage(film.status, all_event_types)

    summarized = (
        await session.execute(
            select(Event, EventSummary.summary)
            .join(EventSummary, EventSummary.event_id == Event.id)
            .where(Event.film_id == film.id)
            .order_by(Event.occurred_at.asc(), Event.id.asc())
        )
    ).all()

    event_ids = [event.id for event, _ in summarized]
    sources_by_event: dict[UUID, list[Story]] = {}
    if event_ids:
        source_rows = (
            await session.execute(
                select(EventStory.event_id, Story)
                .join(Story, Story.id == EventStory.story_id)
                .where(EventStory.event_id.in_(event_ids))
                .order_by(nulls_last(Story.published_at.asc()), Story.id.asc())
            )
        ).all()
        for event_id, story in source_rows:
            sources_by_event.setdefault(event_id, []).append(story)

    events = [
        EventOut(
            event_type=event.event_type,
            confidence=event.confidence,
            occurred_at=event.occurred_at,
            summary=summary,
            sources=[
                SourceOut(
                    url=story.url,
                    source=story.source,
                    title=story.title,
                    published_at=story.published_at,
                )
                for story in sources_by_event.get(event.id, [])
            ],
        )
        for event, summary in summarized
    ]
    return FilmDetailResponse(
        slug=film.slug,
        title=film.title,
        release_date=film.release_date,
        release_year=_release_year(film.release_date),
        poster_path=film.poster_path,
        arc_stage=arc_stage,
        events=events,
    )
```

- [ ] **Step 4: Add the `/films/{slug}` route**

In `src/upmovies/routers/public.py`, update the imports so they read:

```python
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.deps import get_session
from upmovies.public import service
from upmovies.public.dto import FilmDetailResponse, FilmIndexResponse
```

Then append this route to the end of the file:

```python
@router.get("/films/{slug}", response_model=FilmDetailResponse)
async def get_film(
    slug: str,
    session: AsyncSession = Depends(get_session),
) -> FilmDetailResponse:
    film = await service.get_film_detail(session, slug)
    if film is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="film not found")
    return film
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/integration/routers/ -k public`
Expected: PASS (8 passed).

---

## Task 4: Sitemap endpoint `GET /sitemap.xml`

**Files:**
- Modify: `src/upmovies/config.py` (add `public_base_url`)
- Modify: `src/upmovies/public/service.py` (add `SitemapFilm` + `get_sitemap_films`)
- Create: `src/upmovies/public/sitemap.py`
- Modify: `src/upmovies/routers/public.py` (add route + imports)
- Test: `tests/integration/routers/test_public_sitemap.py`

- [ ] **Step 1: Write the failing sitemap test**

Create `tests/integration/routers/test_public_sitemap.py`:

```python
from datetime import date, datetime, timezone
from xml.etree import ElementTree

_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


async def test_sitemap_lists_indexed_films_plus_root(client, make_film, add_event):
    shown = await make_film(slug="shown-2026")
    await add_event(film=shown, summary="s", occurred_at=datetime(2025, 5, 1, tzinfo=timezone.utc))
    await make_film(slug="bare-2026")  # no summarized event -> excluded

    r = await client.get("/sitemap.xml")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")

    root = ElementTree.fromstring(r.text)
    locs = [el.text for el in root.findall(".//sm:url/sm:loc", _NS)]
    assert "http://localhost:5173/" in locs
    assert "http://localhost:5173/film/shown-2026" in locs
    assert all("bare-2026" not in (loc or "") for loc in locs)


async def test_sitemap_lastmod_is_a_valid_date(client, make_film, add_event):
    film = await make_film(slug="dated-2026")
    await add_event(film=film, summary="s")

    r = await client.get("/sitemap.xml")
    root = ElementTree.fromstring(r.text)
    lastmods = [el.text for el in root.findall(".//sm:url/sm:lastmod", _NS)]
    assert len(lastmods) == 1
    date.fromisoformat(lastmods[0])  # raises ValueError if not YYYY-MM-DD
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/routers/ -k sitemap`
Expected: FAIL — no `/sitemap.xml` route (404), so `ElementTree.fromstring` on a JSON 404 body raises / status assert fails.

- [ ] **Step 3: Add the `public_base_url` setting**

In `src/upmovies/config.py`, immediately after the `cors_allowed_origins_raw` field (the block ending at line 55), add:

```python
    public_base_url: str = Field(default="http://localhost:5173", alias="PUBLIC_BASE_URL")
```

- [ ] **Step 4: Add `SitemapFilm` and `get_sitemap_films` to the service**

In `src/upmovies/public/service.py`, add `from dataclasses import dataclass` and `from datetime import datetime` to the imports (the date import line becomes `from datetime import date, datetime`). Then append to the end of the file:

```python
@dataclass
class SitemapFilm:
    slug: str
    lastmod: datetime


async def get_sitemap_films(session: AsyncSession) -> list[SitemapFilm]:
    rows = (
        await session.execute(
            select(Film.slug, func.max(Event.created_at), Film.updated_at)
            .join(Event, Event.film_id == Film.id)
            .join(EventSummary, EventSummary.event_id == Event.id)
            .group_by(Film.id, Film.slug, Film.updated_at)
            .order_by(Film.slug.asc())
        )
    ).all()
    return [
        SitemapFilm(slug=slug, lastmod=last_event_created or updated_at)
        for slug, last_event_created, updated_at in rows
    ]
```

- [ ] **Step 5: Create the sitemap renderer**

Create `src/upmovies/public/sitemap.py`:

```python
from xml.sax.saxutils import escape

from upmovies.public.service import SitemapFilm


def render_sitemap(base_url: str, films: list[SitemapFilm]) -> str:
    base = base_url.rstrip("/")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        f"  <url><loc>{escape(base)}/</loc></url>",
    ]
    for film in films:
        loc = f"{base}/film/{film.slug}"
        lastmod = film.lastmod.date().isoformat()
        lines.append(f"  <url><loc>{escape(loc)}</loc><lastmod>{lastmod}</lastmod></url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"
```

- [ ] **Step 6: Add the `/sitemap.xml` route**

In `src/upmovies/routers/public.py`, update the imports so they read:

```python
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.config import get_settings
from upmovies.deps import get_session
from upmovies.public import service
from upmovies.public.dto import FilmDetailResponse, FilmIndexResponse
from upmovies.public.sitemap import render_sitemap
```

Then append this route to the end of the file:

```python
@router.get("/sitemap.xml")
async def get_sitemap(session: AsyncSession = Depends(get_session)) -> Response:
    settings = get_settings()
    films = await service.get_sitemap_films(session)
    return Response(
        content=render_sitemap(settings.public_base_url, films),
        media_type="application/xml",
    )
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `task test -- tests/integration/routers/ -k sitemap`
Expected: PASS (2 passed).

---

## Task 5: Full verification + handoff

**Files:** none (verification only).

- [ ] **Step 1: Format**

Run: `task format`
Expected: ruff reformats/leaves files clean; no errors.

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: `All checks passed!`

- [ ] **Step 3: Type-check**

Run: `task typecheck`
Expected: pyright reports 0 errors.

- [ ] **Step 4: Full test suite**

Run: `task test`
Expected: the entire suite passes (the new unit + integration tests included). Running the whole suite avoids the single-file pytest-asyncio quirk.

- [ ] **Step 5: Hand off for commit (user)**

Do **not** commit from within task execution. Report green gates to the user. The user commits the whole NEU-309 change as **one PR** off the ticket branch `tom/neu-309-backend-public-film-indexdetail-api-sitemap`, using `/commit-msg` (Conventional Commits subject, no Linear ID, no Claude footer) and `/pr-desc` (PR title carries `(NEU-309)`). Pre-commit hooks delegate into Docker — commit normally with the container up.

---

## Self-review

**Spec coverage** (`docs/specs/2026-06-22-neu-309-public-film-api-design.md`):
- Public no-auth router registered in `main.py` → Task 2 Steps 7–8 (router has no `dependencies=`).
- `GET /films` paginated index (slug, title, year, poster, arc stage); inclusion rule; ordering → Task 2.
- `GET /films/{slug}` detail, chronological events (type, confidence, occurred_at, summary, sources), derived arc, 404 unknown slug, 200 empty-log → Task 3.
- `GET /sitemap.xml` (`/film/{slug}` URLs + root, lastmod, `application/xml`) → Task 4.
- Summary-less events omitted → Task 3 `test_detail_omits_summary_less_events`; index inclusion → Task 2 `test_index_lists_only_films_with_a_summarized_event`.
- Typed Pydantic DTOs, read-only → Task 2 Step 5 (`dto.py`); no writes/commits in `service.py`.
- Arc derivation (status baseline + furthest event, all events) → Task 1 + asserted in index/detail tests.
- `PUBLIC_BASE_URL` config → Task 4 Step 3.
- Tests for shape/ordering/slug+404/omission/arc/sitemap; `task test`/`lint`/`typecheck` green → Tasks 1–5.

**Placeholder scan:** none — every code/test step contains complete code and exact `task` commands with expected output.

**Type/name consistency:** `derive_arc_stage(status, event_types)` (Task 1) is called identically in `service.py` (Tasks 2–3). DTOs `FilmIndexResponse`/`FilmIndexItem`/`FilmDetailResponse`/`EventOut`/`SourceOut` (Task 2 `dto.py`) are imported and constructed with matching field names in `service.py` (Tasks 2–3). `SitemapFilm` (Task 4 `service.py`) is imported by `sitemap.py` and produced by `get_sitemap_films`; `render_sitemap(base_url, films)` signature matches the router call. Router imports grow monotonically across Tasks 2→3→4 and every imported symbol is used.
