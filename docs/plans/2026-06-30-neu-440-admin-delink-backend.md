# NEU-440 — Backend: admin delink endpoints + service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the human admin UI two endpoints to reverse a bad story↔film link — delink one source from an event, or delete a whole bogus event — durably (so the link/cluster stages never re-create it).

**Architecture:** New `link/moderation.py` service (pure DB I/O, caller commits) + new `routers/moderation_admin.py` (session + `is_admin` + CSRF gated). Expose `event_id` on `EventOut` so the FE can target the whole-event delete. Reuses the existing reject semantics and the synthesize staleness check.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Pydantic v2, pytest (+ httpx ASGI). The `news` models (`Story`, `Event`, `EventStory`, `EventSummary`).

## Global Constraints

- Everything runs in the container via `task` — never run tools on the host.
- `task test`, `task lint`, `task typecheck` green before done; `task format` reformats.
- Modern type hints (`X | None`); no `from __future__ import annotations`; ruff line length 100; `import x as x` re-export pattern in `__init__.py`.
- Layering: routers → services → models. **Repos/services are pure DB I/O; the caller (router) owns commit/rollback.**
- Two admin modes stay separate: `require_current_admin` (session cookie + `is_admin`, human-facing) — used here. NOT `require_admin` (ADMIN_TOKEN).
- Tests: TDD (failing test first); pytest-asyncio `auto` mode (no marker); integration tests use the `session` fixture; re-read rows with `execution_options={"populate_existing": True}` after writes through another session.
- Commits: Conventional Commits, no Linear ID in subject (optional `Refs NEU-440.` in body), no footer, no `Co-Authored-By`.
- Branch: `tom/neu-440-backend-admin-delink-endpoints-service`.

## Key existing facts (verified)

- `news.event_story.event_id` and `news.event_summary.event_id` FK the event with `ondelete CASCADE` — deleting an `Event` removes its `event_story` + `event_summary` rows automatically. `story.url` is `unique`.
- `Event.updated_at` has `server_default now()` and **no** `onupdate`, so an explicit assignment sticks. Synthesize re-summarizes when `Event.updated_at > EventSummary.source_updated_at`.
- The `add_event` test fixture creates `Event` + `EventSummary` (when `summary` given) + one `Story` + `EventStory` per `sources` dict, and returns the `Event` (with `.id`). `admin_authed_client` is a session admin with CSRF wired; `authed_client` is a non-admin session; `client` is anonymous.

---

### Task 1: Expose `event_id` on `EventOut`

**Files:**
- Modify: `src/upmovies/public/dto.py` (add field + `UUID` import)
- Modify: `src/upmovies/public/service.py` (populate it in `get_film_detail`)
- Test: `tests/integration/routers/test_public_films.py`

**Interfaces:**
- Produces: `EventOut.event_id: UUID` — every event in `GET /films/{slug}` carries its id.

- [ ] **Step 1: Write the failing test.** Append to `tests/integration/routers/test_public_films.py`:

```python
async def test_detail_event_exposes_event_id(client, make_film, add_event):
    film = await make_film(slug="ids-2026")
    event = await add_event(film=film, event_type="casting", summary="Cast announced.")

    r = await client.get("/films/ids-2026")
    assert r.status_code == 200
    events = r.json()["events"]
    assert events[0]["event_id"] == str(event.id)
```

- [ ] **Step 2: Run it — verify it fails**

Run: `task test -- tests/integration/routers/test_public_films.py::test_detail_event_exposes_event_id -v`
Expected: FAIL — `KeyError: 'event_id'` (field absent).

- [ ] **Step 3: Add the field.** In `src/upmovies/public/dto.py`, add the import and field:

```python
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel
```

```python
class EventOut(BaseModel):
    event_id: UUID
    event_type: str
    confidence: str
    created_at: datetime
    summary: str
    sources: list[SourceOut]
```

- [ ] **Step 4: Populate it.** In `src/upmovies/public/service.py`, in `get_film_detail`'s
`events = [EventOut(...) for event, summary in summarized]` comprehension, add as the first
field:

```python
        EventOut(
            event_id=event.id,
            event_type=event.event_type,
            confidence=event.confidence,
            created_at=event.created_at,
            summary=summary,
            sources=[ ... unchanged ... ],
        )
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `task test -- tests/integration/routers/test_public_films.py -v`
Expected: PASS (the new test and all existing film-detail tests).

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/public/dto.py src/upmovies/public/service.py tests/integration/routers/test_public_films.py
git commit -m "feat: expose event_id on film-detail events"
```

---

### Task 2: The moderation service

**Files:**
- Create: `src/upmovies/link/moderation.py`
- Test: `tests/unit/link/test_moderation.py` (uses the `session` fixture — DB-backed, lives under unit/ alongside other link tests; if the session-loop quirk bites, move to `tests/integration/link/`)

**Interfaces:**
- Produces:
  - `delink_story(session, *, event_id: UUID, url: str) -> DelinkResult`
  - `delete_event(session, *, event_id: UUID) -> DelinkResult`
  - `DelinkResult(delinked: int, event_removed: bool, resummarize_queued: bool)`
  - `EventNotFound`, `StoryNotInEvent` exceptions
  - Caller commits.

- [ ] **Step 1: Write the failing tests.** Create `tests/unit/link/test_moderation.py`:

```python
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from upmovies.link import moderation
from upmovies.news.models import Event, EventStory, EventSummary, Story


async def test_delink_only_source_removes_event(session, make_film, add_event):
    film = await make_film(slug="dl-1")
    event = await add_event(
        film=film, summary="Bogus.",
        sources=({"url": "https://x.test/a", "source": "ScreenRant", "title": "t"},),
    )

    result = await moderation.delink_story(session, event_id=event.id, url="https://x.test/a")
    await session.commit()

    assert result.delinked == 1 and result.event_removed is True
    assert (await session.get(Event, event.id)) is None  # event + summary cascaded
    story = (await session.execute(select(Story).where(Story.url == "https://x.test/a"))).scalar_one()
    assert story.link_status == "rejected" and story.film_id is None
    assert story.link_note == "manual-unlink"


async def test_delink_one_of_two_keeps_event_and_marks_stale(session, make_film, add_event):
    film = await make_film(slug="dl-2")
    event = await add_event(
        film=film, summary="Two sources.",
        sources=(
            {"url": "https://x.test/a", "source": "A", "title": "ta"},
            {"url": "https://x.test/b", "source": "B", "title": "tb"},
        ),
    )

    result = await moderation.delink_story(session, event_id=event.id, url="https://x.test/a")
    await session.commit()

    assert result.event_removed is False and result.resummarize_queued is True
    kept = await session.get(Event, event.id, execution_options={"populate_existing": True})
    assert kept is not None
    remaining = (await session.execute(
        select(func.count()).select_from(EventStory).where(EventStory.event_id == event.id)
    )).scalar_one()
    assert remaining == 1
    summary = (await session.execute(
        select(EventSummary).where(EventSummary.event_id == event.id)
    )).scalar_one()
    assert kept.updated_at > summary.source_updated_at  # stale → synthesize re-summarizes


async def test_delete_event_rejects_all_and_cascades(session, make_film, add_event):
    film = await make_film(slug="dl-3")
    event = await add_event(
        film=film, summary="Whole event bogus.",
        sources=(
            {"url": "https://x.test/a", "source": "A", "title": "ta"},
            {"url": "https://x.test/b", "source": "B", "title": "tb"},
        ),
    )

    result = await moderation.delete_event(session, event_id=event.id)
    await session.commit()

    assert result.delinked == 2 and result.event_removed is True
    assert (await session.get(Event, event.id)) is None
    assert (await session.execute(
        select(func.count()).select_from(EventSummary).where(EventSummary.event_id == event.id)
    )).scalar_one() == 0
    statuses = (await session.execute(select(Story.link_status))).scalars().all()
    assert set(statuses) == {"rejected"}


async def test_delink_unknown_event_raises(session):
    from uuid import uuid4
    with pytest.raises(moderation.EventNotFound):
        await moderation.delink_story(session, event_id=uuid4(), url="https://x.test/a")


async def test_delink_url_not_in_event_raises(session, make_film, add_event):
    film = await make_film(slug="dl-4")
    event = await add_event(
        film=film, summary="s",
        sources=({"url": "https://x.test/a", "source": "A", "title": "ta"},),
    )
    with pytest.raises(moderation.StoryNotInEvent):
        await moderation.delink_story(session, event_id=event.id, url="https://x.test/nope")
```

- [ ] **Step 2: Run — verify they fail**

Run: `task test -- tests/unit/link/test_moderation.py -v`
Expected: FAIL — `ModuleNotFoundError: upmovies.link.moderation`.

- [ ] **Step 3: Implement the service.** Create `src/upmovies/link/moderation.py`:

```python
"""Admin moderation of story↔film links: reverse a bad link decision. Reject the affected
stories and detach them from their event so neither the link stage (touches only `pending`)
nor the cluster stage (touches only `linked` + unclustered) reprocesses them; drop events that
become empty, and bump `updated_at` on surviving events so synthesize re-summarizes them.

Pure DB I/O — the caller owns the commit."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.news.models import Event, EventStory, Story


class EventNotFound(Exception):
    """No event with the given id."""


class StoryNotInEvent(Exception):
    """No story with the given url is attached to the given event."""


@dataclass
class DelinkResult:
    delinked: int
    event_removed: bool
    resummarize_queued: bool


def _reject(story: Story, now: datetime) -> None:
    story.link_status = "rejected"
    story.film_id = None
    story.link_confidence = None
    story.link_note = "manual-unlink"
    story.linked_at = now


async def _remaining_sources(session: AsyncSession, event_id: UUID) -> int:
    return (
        await session.execute(
            select(func.count()).select_from(EventStory).where(EventStory.event_id == event_id)
        )
    ).scalar_one()


async def delink_story(session: AsyncSession, *, event_id: UUID, url: str) -> DelinkResult:
    event = await session.get(Event, event_id)
    if event is None:
        raise EventNotFound(str(event_id))
    story = (
        await session.execute(select(Story).where(Story.url == url))
    ).scalar_one_or_none()
    if story is None:
        raise StoryNotInEvent(url)
    link = (
        await session.execute(
            select(EventStory).where(
                EventStory.event_id == event_id, EventStory.story_id == story.id
            )
        )
    ).scalar_one_or_none()
    if link is None:
        raise StoryNotInEvent(url)

    now = datetime.now(UTC)
    _reject(story, now)
    await session.delete(link)
    await session.flush()

    if await _remaining_sources(session, event_id) == 0:
        await session.delete(event)  # event_summary cascades
        return DelinkResult(delinked=1, event_removed=True, resummarize_queued=False)
    event.updated_at = now
    return DelinkResult(delinked=1, event_removed=False, resummarize_queued=True)


async def delete_event(session: AsyncSession, *, event_id: UUID) -> DelinkResult:
    event = await session.get(Event, event_id)
    if event is None:
        raise EventNotFound(str(event_id))
    story_ids = (
        await session.execute(
            select(EventStory.story_id).where(EventStory.event_id == event_id)
        )
    ).scalars().all()
    now = datetime.now(UTC)
    stories = (
        await session.execute(select(Story).where(Story.id.in_(story_ids)))
    ).scalars().all()
    for story in stories:
        _reject(story, now)
    await session.flush()
    await session.delete(event)  # event_story + event_summary cascade
    return DelinkResult(delinked=len(stories), event_removed=True, resummarize_queued=False)
```

- [ ] **Step 4: Run — verify pass**

Run: `task test -- tests/unit/link/test_moderation.py -v`
Expected: PASS (all five).

- [ ] **Step 5: Lint/typecheck/format, then commit**

```bash
task format && task lint && task typecheck
git add src/upmovies/link/moderation.py tests/unit/link/test_moderation.py
git commit -m "feat: add admin delink/delete-event moderation service"
```

---

### Task 3: The admin router

**Files:**
- Create: `src/upmovies/routers/moderation_admin.py`
- Modify: `src/upmovies/main.py` (import + `include_router`)
- Test: `tests/integration/routers/test_moderation_admin.py`

**Interfaces:**
- Consumes: `moderation.delink_story` / `moderation.delete_event` (Task 2); `require_current_admin`, `require_csrf`, `get_session` (existing `deps`).
- Produces: `POST /admin/events/{event_id}/delink` (body `{ "url": ... }`) and `DELETE /admin/events/{event_id}`, both returning `{ delinked, event_removed, resummarize_queued }`.

- [ ] **Step 1: Write the failing tests.** Create `tests/integration/routers/test_moderation_admin.py`:

```python
from sqlalchemy import func, select

from upmovies.news.models import Event, EventStory, Story


async def _event_with_source(make_film, add_event, *, slug, url):
    film = await make_film(slug=slug)
    return await add_event(
        film=film, summary="Bogus recast.",
        sources=({"url": url, "source": "ScreenRant", "title": "the next Batman"},),
    )


# --- gating ---

async def test_delink_requires_auth(client, make_film, add_event):
    event = await _event_with_source(make_film, add_event, slug="g1", url="https://x.test/a")
    r = await client.post(f"/admin/events/{event.id}/delink", json={"url": "https://x.test/a"})
    assert r.status_code == 401


async def test_delink_forbidden_for_non_admin(authed_client, make_film, add_event):
    event = await _event_with_source(make_film, add_event, slug="g2", url="https://x.test/a")
    r = await authed_client.post(
        f"/admin/events/{event.id}/delink", json={"url": "https://x.test/a"}
    )
    assert r.status_code == 403


# --- behavior ---

async def test_admin_delink_removes_empty_event(admin_authed_client, session, make_film, add_event):
    event = await _event_with_source(make_film, add_event, slug="b1", url="https://x.test/a")
    r = await admin_authed_client.post(
        f"/admin/events/{event.id}/delink", json={"url": "https://x.test/a"}
    )
    assert r.status_code == 200
    assert r.json() == {"delinked": 1, "event_removed": True, "resummarize_queued": False}
    assert (await session.get(Event, event.id, execution_options={"populate_existing": True})) is None
    story = (await session.execute(
        select(Story).where(Story.url == "https://x.test/a")
    )).scalar_one()
    assert story.link_status == "rejected" and story.film_id is None


async def test_admin_delete_event(admin_authed_client, session, make_film, add_event):
    film = await make_film(slug="b2")
    event = await add_event(
        film=film, summary="junk",
        sources=(
            {"url": "https://x.test/a", "source": "A", "title": "ta"},
            {"url": "https://x.test/b", "source": "B", "title": "tb"},
        ),
    )
    r = await admin_authed_client.delete(f"/admin/events/{event.id}")
    assert r.status_code == 200
    assert r.json()["delinked"] == 2 and r.json()["event_removed"] is True
    assert (await session.get(Event, event.id, execution_options={"populate_existing": True})) is None
    assert (await session.execute(
        select(func.count()).select_from(EventStory).where(EventStory.event_id == event.id)
    )).scalar_one() == 0


async def test_admin_delink_unknown_event_404(admin_authed_client):
    from uuid import uuid4
    r = await admin_authed_client.post(
        f"/admin/events/{uuid4()}/delink", json={"url": "https://x.test/a"}
    )
    assert r.status_code == 404


async def test_admin_delink_url_not_in_event_404(admin_authed_client, make_film, add_event):
    event = await _event_with_source(make_film, add_event, slug="b3", url="https://x.test/a")
    r = await admin_authed_client.post(
        f"/admin/events/{event.id}/delink", json={"url": "https://x.test/missing"}
    )
    assert r.status_code == 404
```

- [ ] **Step 2: Run — verify they fail**

Run: `task test -- tests/integration/routers/test_moderation_admin.py -v`
Expected: FAIL — 404 on the route (router not mounted).

- [ ] **Step 3: Implement the router.** Create `src/upmovies/routers/moderation_admin.py`:

```python
"""Session + is_admin + CSRF protected endpoints for correcting bad story↔film links from the
admin UI. Human-facing (cookie + is_admin via `require_current_admin`), distinct from the
ADMIN_TOKEN machine endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.deps import get_session, require_csrf, require_current_admin
from upmovies.link import moderation

router = APIRouter(
    prefix="/admin/events",
    tags=["admin"],
    dependencies=[Depends(require_current_admin), Depends(require_csrf)],
)


class DelinkBody(BaseModel):
    url: str


class DelinkResponse(BaseModel):
    delinked: int
    event_removed: bool
    resummarize_queued: bool


@router.post("/{event_id}/delink", response_model=DelinkResponse)
async def delink_source(
    event_id: UUID, body: DelinkBody, db: AsyncSession = Depends(get_session)
) -> DelinkResponse:
    try:
        result = await moderation.delink_story(db, event_id=event_id, url=body.url)
    except moderation.EventNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event_not_found")
    except moderation.StoryNotInEvent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="story_not_in_event")
    await db.commit()
    return DelinkResponse(**vars(result))


@router.delete("/{event_id}", response_model=DelinkResponse)
async def delete_event(
    event_id: UUID, db: AsyncSession = Depends(get_session)
) -> DelinkResponse:
    try:
        result = await moderation.delete_event(db, event_id=event_id)
    except moderation.EventNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event_not_found")
    await db.commit()
    return DelinkResponse(**vars(result))
```

- [ ] **Step 4: Register the router.** In `src/upmovies/main.py`, add `moderation_admin` to the
import line and include it:

```python
from upmovies.routers import (
    admin_runs,
    auth,
    health,
    ingest_admin,
    invites_admin,
    me,
    moderation_admin,
    public,
)
```

```python
    app.include_router(moderation_admin.router)
```

- [ ] **Step 5: Run — verify pass**

Run: `task test -- tests/integration/routers/test_moderation_admin.py -v`
Expected: PASS.

- [ ] **Step 6: Full suite + lint/typecheck**

Run: `task test && task lint && task typecheck`
Expected: all green (run the whole suite — single integration files trip a known asyncio-loop quirk).

- [ ] **Step 7: Commit**

```bash
git add src/upmovies/routers/moderation_admin.py src/upmovies/main.py tests/integration/routers/test_moderation_admin.py
git commit -m "feat: add admin delink + delete-event endpoints"
```

---

## Self-Review

- **Spec coverage:** `event_id` on `EventOut` (Task 1) ✓; reject+detach+empty-delete+stale-bump
  semantics (Task 2) ✓; both endpoints, `require_current_admin`+CSRF, 401/403/404, cascade
  (Task 3) ✓. Stickiness is covered by asserting post-state `rejected` + `film_id=None` (link
  stage skips non-pending; cluster stage skips null `film_id`).
- **Placeholders:** none — every file and test has complete code.
- **Consistency:** `DelinkResult` fields (`delinked`, `event_removed`, `resummarize_queued`)
  match the router's `DelinkResponse` and the JSON asserted in tests. `delink_story` /
  `delete_event` signatures match between service, router, and tests.

## Execution Handoff

Recommend **subagent-driven** (3 clean TDD tasks with independent gates). Per project feedback,
strip any commit step from a subagent's prompt only if you're batching — otherwise the commits
above are correct (1 PR for the ticket).
