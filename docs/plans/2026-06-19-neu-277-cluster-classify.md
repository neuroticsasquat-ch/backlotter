# NEU-277: Cluster + classify service (Stage 2) + idempotent merge + pipeline wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Segment each film's unclustered linked stories into distinct events (attaching to recent existing events where they continue a beat), classify each `event_type` × `confidence`, and run this as Stage 2 of the link pipeline.

**Architecture:** `link/cluster.py::cluster_film_events` handles one film: load its unclustered linked stories + recent existing events (with member headlines), one LLM call returns event groups (`existing` index to attach, or a new `type`/`confidence`), then upsert `Event` + `EventStory`. Idempotent: "unclustered" = linked stories with no `event_story` row, so re-runs grow events instead of duplicating; the unique `story_id` is the backstop. `run_link_ingest` gains a Stage-2 phase over the films touched by Stage 1.

**Tech Stack:** SQLAlchemy 2 async, the `llm`/`link` packages, pytest.

**Repo:** `upcoming-movies-backend` · **Branch:** `tom/neu-277-be-clusterclassify-service-stage-2-idempotent-merge-wire` · **Spec:** `docs/specs/2026-06-19-entity-linking-clustering-design.md`

**Depends on:** NEU-274 (`Completer`, `cached_system_block`), NEU-275 (`run_link_ingest`, `_background_link`), NEU-276 (`Event`/`EventStory`).

> **Commit/PR convention:** No per-step commits — implement, run the full check suite, then the user commits once and opens the PR. All commands run in the container via `task`.

---

## File Structure

- **Create** `src/upmovies/link/cluster.py` — `cluster_film_events`, `ClusterResult`.
- **Modify** `src/upmovies/link/pipeline.py` — add `cluster_model` param + the Stage-2 phase.
- **Modify** `src/upmovies/link/__init__.py` — re-export the new names.
- **Modify** `src/upmovies/routers/ingest_admin.py` — pass `cluster_model` in `_background_link`.
- **Create** `tests/integration/link/test_cluster.py`.
- **Modify** `tests/integration/link/test_pipeline.py` — two-stage fake client + event assertions.

---

### Task 1: `cluster_film_events`

**Files:**
- Create: `src/upmovies/link/cluster.py`
- Test: `tests/integration/link/test_cluster.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/link/test_cluster.py`:

```python
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.link.cluster import cluster_film_events
from upmovies.news.models import Event, EventStory, Story


class FakeClient:
    def __init__(self, response: dict):
        self._response = response
        self.calls: list[dict] = []

    async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
        self.calls.append({"system": system, "messages": messages})
        return json.dumps(self._response)


async def _linked_story(session, film, url, *, title="Runner news"):
    story = Story(
        source="X", url=url, title=title, link_status="linked", film_id=film.id,
        published_at=datetime.now(UTC), raw={"summary": ""},
    )
    session.add(story)
    await session.flush()
    return story


async def test_creates_new_event_for_unclustered_stories(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    story = await _linked_story(session, film, "https://e/1")
    await session.commit()

    client = FakeClient(
        {"events": [{"existing": None, "type": "trailer", "confidence": "confirmed",
                     "stories": [str(story.id)]}]}
    )
    result = await cluster_film_events(
        session, client=client, model="m", film_id=film.id, recency_days=45
    )
    await session.commit()

    assert result.events_created == 1
    assert result.stories_clustered == 1
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 1
    assert events[0].event_type == "trailer"
    assert events[0].confidence == "confirmed"
    links = (await session.execute(select(EventStory))).scalars().all()
    assert [el.story_id for el in links] == [story.id]


async def test_attaches_to_existing_event(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    first = await _linked_story(session, film, "https://e/1")
    event = Event(film_id=film.id, event_type="casting", confidence="confirmed",
                  occurred_at=datetime.now(UTC))
    session.add(event)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=first.id))
    second = await _linked_story(session, film, "https://e/2")  # unclustered
    await session.commit()

    client = FakeClient({"events": [{"existing": 1, "stories": [str(second.id)]}]})
    result = await cluster_film_events(
        session, client=client, model="m", film_id=film.id, recency_days=45
    )
    await session.commit()

    assert result.events_created == 0
    assert result.stories_clustered == 1
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 1  # no new event
    member_ids = {
        el.story_id
        for el in (await session.execute(select(EventStory))).scalars().all()
    }
    assert member_ids == {first.id, second.id}


async def test_noop_when_nothing_unclustered(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    story = await _linked_story(session, film, "https://e/1")
    event = Event(film_id=film.id, event_type="casting", confidence="confirmed",
                  occurred_at=datetime.now(UTC))
    session.add(event)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=story.id))
    await session.commit()

    client = FakeClient({"events": []})
    result = await cluster_film_events(
        session, client=client, model="m", film_id=film.id, recency_days=45
    )
    assert result == result.__class__(0, 0)
    assert client.calls == []  # short-circuits before calling the model
```

- [ ] **Step 2: Run them to verify they fail**

Run: `task test -- tests/integration/link`
Expected: FAIL — `upmovies.link.cluster` does not exist.

- [ ] **Step 3: Implement `cluster.py`**

Create `src/upmovies/link/cluster.py`:

```python
"""Stage 2: cluster a single film's unclustered linked stories into events and classify
them, attaching to recent existing events where they continue a beat. Idempotent — only
touches linked stories that have no event_story row yet; the unique story_id is the
backstop. The caller owns the session/commit."""

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.catalog.models import Film
from upmovies.link.linker import Completer
from upmovies.llm.client import cached_system_block
from upmovies.news.models import Event, EventStory, Story

log = logging.getLogger(__name__)

_VALID_TYPES = {
    "announced", "casting", "production_start", "production_wrap",
    "release_date", "trailer", "other",
}
_SUMMARY_MAX = 500
_MAX_TOKENS = 1500

_INSTRUCTIONS = """You group a single film's news stories into distinct EVENTS — real beats \
in its life (casting, a trailer, a release-date change, production milestones, etc.) — and \
classify each. You are given the FILM, its EXISTING recent events, and NEW stories to place.

For each new story, either attach it to an existing event (it continues a beat already \
logged) or assign it to a new event (a beat not yet logged). Group new stories that report \
the SAME beat into ONE new event; split different beats into separate events. Five outlets \
reporting the same casting is one event.

New events carry:
- "type": one of announced, casting, production_start, production_wrap, release_date, \
trailer, other
- "confidence": "confirmed" if reported as fact, "rumored" if speculation/unconfirmed.

Return ONLY JSON — no prose, no markdown:
{"events": [{"existing": <existing event number or null>, "type": <type or null>, \
"confidence": "confirmed" | "rumored" | null, "stories": ["<story id>", ...]}]}

When "existing" is a number, attach its "stories" to that event ("type"/"confidence" may \
be null). Otherwise it is a new event and "type"/"confidence" are required. Every new \
story id must appear in exactly one group."""


@dataclass
class ClusterResult:
    events_created: int
    stories_clustered: int


def _extract_json_object(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return text
    return text[start : end + 1]


async def cluster_film_events(
    session: AsyncSession,
    *,
    client: Completer,
    model: str,
    film_id: UUID,
    recency_days: int,
) -> ClusterResult:
    film = (await session.execute(select(Film).where(Film.id == film_id))).scalar_one_or_none()
    if film is None:
        return ClusterResult(0, 0)

    already_clustered = exists().where(EventStory.story_id == Story.id)
    unclustered = (
        await session.execute(
            select(Story).where(
                Story.film_id == film_id, Story.link_status == "linked", ~already_clustered
            )
        )
    ).scalars().all()
    if not unclustered:
        return ClusterResult(0, 0)

    cutoff = datetime.now(UTC) - timedelta(days=recency_days)
    existing_events = (
        await session.execute(
            select(Event)
            .where(Event.film_id == film_id, Event.updated_at >= cutoff)
            .order_by(Event.occurred_at, Event.id)
        )
    ).scalars().all()

    existing_payload = []
    for i, event in enumerate(existing_events, start=1):
        headlines = (
            await session.execute(
                select(Story.title)
                .join(EventStory, EventStory.story_id == Story.id)
                .where(EventStory.event_id == event.id)
            )
        ).scalars().all()
        existing_payload.append(
            {"event": i, "type": event.event_type, "confidence": event.confidence,
             "headlines": list(headlines)}
        )

    by_id = {str(s.id): s for s in unclustered}
    new_payload = [
        {
            "id": sid,
            "title": s.title,
            "summary": (str(s.raw.get("summary", "")) if isinstance(s.raw, dict) else "")[:_SUMMARY_MAX],
        }
        for sid, s in by_id.items()
    ]

    user = {
        "film": {"title": film.title, "year": film.release_date.year if film.release_date else None},
        "existing_events": existing_payload,
        "new_stories": new_payload,
    }
    raw = await client.complete(
        model=model,
        system=[cached_system_block(_INSTRUCTIONS)],
        messages=[{"role": "user", "content": json.dumps(user)}],
        max_tokens=_MAX_TOKENS,
    )
    data = json.loads(_extract_json_object(raw))

    now = datetime.now(UTC)
    assigned: set[str] = set()
    events_created = stories_clustered = 0

    for group in data.get("events", []):
        sids = [sid for sid in (group.get("stories") or []) if sid in by_id and sid not in assigned]
        if not sids:
            continue
        existing_idx = group.get("existing")
        if isinstance(existing_idx, int) and 1 <= existing_idx <= len(existing_events):
            event = existing_events[existing_idx - 1]
            event.updated_at = now
        else:
            etype = group.get("type")
            conf = group.get("confidence")
            if etype not in _VALID_TYPES or conf not in ("confirmed", "rumored"):
                log.warning(
                    "cluster: invalid new event for film %s: type=%r confidence=%r",
                    film_id, etype, conf,
                )
                continue
            occurred = min((by_id[sid].published_at or by_id[sid].fetched_at) for sid in sids)
            event = Event(
                film_id=film_id, event_type=etype, confidence=conf, occurred_at=occurred
            )
            session.add(event)
            await session.flush()
            events_created += 1
        for sid in sids:
            session.add(EventStory(event_id=event.id, story_id=UUID(sid)))
            assigned.add(sid)
            stories_clustered += 1

    return ClusterResult(events_created, stories_clustered)
```

- [ ] **Step 4: Run them to verify they pass**

Run: `task test -- tests/integration/link`
Expected: PASS (the three cluster tests; the roster/pipeline tests still pass).

---

### Task 2: Wire Stage 2 into the pipeline

**Files:**
- Modify: `src/upmovies/link/pipeline.py`
- Modify: `src/upmovies/link/__init__.py`
- Modify: `src/upmovies/routers/ingest_admin.py`
- Modify: `tests/integration/link/test_pipeline.py`

- [ ] **Step 1: Update the pipeline test for two stages**

Replace `tests/integration/link/test_pipeline.py` with:

```python
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.ingest.models import IngestRun
from upmovies.ingest.runs import create_run
from upmovies.link.pipeline import run_link_ingest
from upmovies.news.models import Event, Story


class FakeClient:
    """Routes on the system prompt: link decisions for Stage 1, one new event for Stage 2."""

    async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
        if "entity-linking classifier" in system[0]["text"]:
            stories = json.loads(messages[0]["content"])
            return json.dumps(
                [{"id": s["id"], "film": 1, "confidence": 0.95, "reason": "about"} for s in stories]
            )
        new_ids = [s["id"] for s in json.loads(messages[0]["content"])["new_stories"]]
        return json.dumps(
            {"events": [{"existing": None, "type": "trailer", "confidence": "confirmed",
                         "stories": new_ids}]}
        )


async def _story(url, *, published_offset_days, status="pending"):
    now = datetime.now(UTC)
    return Story(
        source="X", url=url, title="Runner news",
        published_at=now - timedelta(days=published_offset_days),
        link_status=status, raw={"summary": ""},
    )


async def _run(session, run_id):
    return await run_link_ingest(
        session_factory=lambda: session, client=FakeClient(), run_id=run_id,
        model="link-m", cluster_model="cluster-m", recency_days=45, batch_size=10, floor=0.7,
    )


async def test_links_then_clusters_recent_pending(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all([
        await _story("https://e/recent", published_offset_days=2),
        await _story("https://e/old", published_offset_days=400),
    ])
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    result = await _run(session, run_id)

    assert result.linked == 1
    rows = {
        s.url: s
        for s in (
            await session.execute(select(Story), execution_options={"populate_existing": True})
        ).scalars().all()
    }
    assert rows["https://e/recent"].link_status == "linked"
    assert rows["https://e/recent"].film_id == film.id
    assert rows["https://e/old"].link_status == "pending"

    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 1
    assert events[0].event_type == "trailer"

    run = (
        await session.execute(
            select(IngestRun).where(IngestRun.id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert run.status == "succeeded"
    assert run.detail and "linked 1" in run.detail and "1 events" in run.detail


async def test_rerun_is_noop_when_fully_processed(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    result = await _run(session, run_id)
    assert result.linked == 0 and result.rejected == 0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `task test -- tests/integration/link`
Expected: FAIL — `run_link_ingest` has no `cluster_model` parameter / does not create events yet.

- [ ] **Step 3: Add the Stage-2 phase to `run_link_ingest`**

In `src/upmovies/link/pipeline.py`, add imports:

```python
from sqlalchemy import exists, func, select
```

(extend the existing `from sqlalchemy import func, select` line to include `exists`), and:

```python
from upmovies.link.cluster import cluster_film_events
from upmovies.news.models import EventStory, Story
```

(extend the existing `Story` import to also import `EventStory`).

Change the signature to add `cluster_model: str` (place it right after `model: str`):

```python
async def run_link_ingest(
    *,
    session_factory: SessionFactory,
    client: Completer,
    run_id: UUID,
    model: str,
    cluster_model: str,
    recency_days: int,
    batch_size: int,
    floor: float,
) -> LinkIngestResult:
```

Then, **between** the Stage-1 batch loop and the `finalize_run` call, insert the Stage-2 phase:

```python
    # --- Stage 2: cluster + classify, per film with unclustered linked stories ---
    async with _owned_session(session_factory) as s:
        clustered = exists().where(EventStory.story_id == Story.id)
        film_ids = (
            await s.execute(
                select(Story.film_id)
                .where(
                    Story.link_status == "linked",
                    Story.film_id.is_not(None),
                    ~clustered,
                )
                .distinct()
            )
        ).scalars().all()

    events_created = 0
    stories_clustered = 0
    for film_id in film_ids:
        try:
            async with _owned_session(session_factory) as s:
                cluster = await cluster_film_events(
                    s, client=client, model=cluster_model, film_id=film_id,
                    recency_days=recency_days,
                )
                await s.commit()
            events_created += cluster.events_created
            stories_clustered += cluster.stories_clustered
        except Exception:
            log.exception("clustering failed for film %s", film_id)
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=1)
                await s.commit()
```

Finally, change the `finalize_run` detail to include the event counts:

```python
    async with _owned_session(session_factory) as s:
        await finalize_run(
            s,
            run_id,
            status="succeeded",
            detail=(
                f"linked {linked}, rejected {rejected}; "
                f"{events_created} events from {stories_clustered} stories"
            ),
        )
        await s.commit()
    return LinkIngestResult(linked, rejected)
```

- [ ] **Step 4: Pass `cluster_model` from the background wrapper**

In `src/upmovies/routers/ingest_admin.py::_background_link`, add `cluster_model=settings.cluster_model` to the `run_link_ingest(...)` call (right after `model=settings.link_model`).

- [ ] **Step 5: Re-export the new names**

In `src/upmovies/link/__init__.py`, add:

```python
from upmovies.link.cluster import ClusterResult as ClusterResult
from upmovies.link.cluster import cluster_film_events as cluster_film_events
```

- [ ] **Step 6: Run the pipeline + endpoint tests to verify they pass**

Run: `task test -- tests/integration/link tests/integration/routers`
Expected: PASS (Stage 1 → Stage 2 end-to-end; the existing `test_link_admin.py` crash test still passes — `_background_link` now also reads `cluster_model`, which the test settings provide via the compose placeholder defaults).

---

## Final verification (before handing off to commit)

- [ ] `task format`
- [ ] `task lint` — clean
- [ ] `task typecheck` — clean
- [ ] `task test` — full suite green
- [ ] Hand off: the user commits (e.g. `feat: add event clustering/classification as link pipeline stage 2`) and opens the PR for NEU-277.

---

## Self-Review

- **Spec coverage:** Implements Stage 2 — per-film clustering of unclustered linked stories, attach-to-existing vs new-event with `event_type` × `confidence`, `occurred_at` from member stories, idempotent re-runs (unclustered = no `event_story` row; unique `story_id` backstop), wired into `run_link_ingest` with event counts in the run detail. Matches the spec's "Cluster + classify" and "Idempotency / event-evolution" sections.
- **Placeholders:** None — full prompt, parse, merge, and wiring code.
- **Type consistency:** `cluster_film_events(session, *, client: Completer, model, film_id, recency_days) -> ClusterResult` is used identically in the test and the pipeline; `_VALID_TYPES` matches NEU-276's `ck_event_type`; `run_link_ingest` now takes `cluster_model` everywhere it's called (`_background_link`, the pipeline test).
- **Cross-ticket change noted:** this modifies NEU-275's `pipeline.py` + `test_pipeline.py` (expected — "wire Stage 2 into the pipeline"). Same-package, sequential.
