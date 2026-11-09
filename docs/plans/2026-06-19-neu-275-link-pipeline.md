# NEU-275: Link pipeline orchestration + trigger endpoint + cron step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the Stage-1 link service as a tracked, idempotent background pipeline: select recent pending stories, link them in batches, wire `ingest.runs`, expose `POST /admin/ingest/link`, and add the daily cron step.

**Architecture:** `link/pipeline.py::run_link_ingest` mirrors the TMDB/feeds services — builds the roster once, selects `pending` stories inside the recency window (`coalesce(published_at, fetched_at) >= cutoff`), then for each batch opens an owned session, calls `link_story_batch`, records progress, and commits (one batch's failure never rolls back others). The trigger endpoint + background wrapper mirror `_background_feeds`. The cron gains a third `trigger_and_wait link` after feeds.

**Tech Stack:** SQLAlchemy 2 async, FastAPI, the `llm.AnthropicClient` (NEU-273) and `link` package (NEU-274), GitHub Actions.

**Repo:** `upcoming-movies-backend` · **Branch:** `tom/neu-275-be-link-pipeline-orchestration-trigger-endpoint-cron-step` · **Spec:** `docs/specs/2026-06-19-entity-linking-clustering-design.md`

**Depends on:** NEU-272 (link-state + `link` kind), NEU-273 (`AnthropicClient` + config), NEU-274 (`build_roster`, `link_story_batch`, `Completer`).

> **Commit/PR convention:** No per-step commits — implement the ticket, run the full check suite, then the user commits once and opens the PR. All commands run in the container via `task`.

---

## File Structure

- **Create** `src/upmovies/link/pipeline.py` — `run_link_ingest`, `LinkIngestResult`.
- **Modify** `src/upmovies/routers/ingest_admin.py` — `_background_link` + `POST /admin/ingest/link`.
- **Modify** `.github/workflows/daily-ingest.yml` — add the `link` step.
- **Create** `tests/integration/link/test_pipeline.py`.
- **Create** `tests/integration/routers/test_link_admin.py`.

> No `main.py` change: `ingest_admin.router` is already included, the new route lives on it, and stale-run cleanup is kind-agnostic.

---

### Task 1: `run_link_ingest`

**Files:**
- Create: `src/upmovies/link/pipeline.py`
- Test: `tests/integration/link/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/link/test_pipeline.py`:

```python
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.ingest.models import IngestRun
from upmovies.ingest.runs import create_run
from upmovies.link.pipeline import run_link_ingest
from upmovies.news.models import Story


class FakeClient:
    """Returns 'about #1' for every story in the batch."""

    async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
        stories = json.loads(messages[0]["content"])
        return json.dumps(
            [{"id": s["id"], "film": 1, "confidence": 0.95, "reason": "about"} for s in stories]
        )


async def _story(url, *, published_offset_days, status="pending"):
    now = datetime.now(UTC)
    return Story(
        source="X",
        url=url,
        title="Runner news",
        published_at=now - timedelta(days=published_offset_days),
        link_status=status,
        raw={"summary": ""},
    )


async def test_links_recent_pending_skips_old_and_finalizes(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    recent = await _story("https://e/recent", published_offset_days=2)
    old = await _story("https://e/old", published_offset_days=400)
    session.add_all([recent, old])
    await session.commit()

    run_id = await create_run(session, kind="link")
    await session.commit()

    result = await run_link_ingest(
        session_factory=lambda: session,
        client=FakeClient(),
        run_id=run_id,
        model="m",
        recency_days=45,
        batch_size=10,
        floor=0.7,
    )

    assert result.linked == 1
    rows = {
        s.url: s
        for s in (
            await session.execute(select(Story), execution_options={"populate_existing": True})
        ).scalars().all()
    }
    assert rows["https://e/recent"].link_status == "linked"
    assert rows["https://e/recent"].film_id == film.id
    assert rows["https://e/old"].link_status == "pending"  # outside the recency window

    run = (
        await session.execute(
            select(IngestRun).where(IngestRun.id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert run.status == "succeeded"
    assert run.items_processed == 1
    assert run.detail and "linked 1" in run.detail


async def test_rerun_is_noop_when_nothing_pending(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add(await _story("https://e/done", published_offset_days=1, status="linked"))
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    result = await run_link_ingest(
        session_factory=lambda: session,
        client=FakeClient(),
        run_id=run_id,
        model="m",
        recency_days=45,
        batch_size=10,
        floor=0.7,
    )
    assert result.linked == 0 and result.rejected == 0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `task test -- tests/integration/link`
Expected: FAIL — `upmovies.link.pipeline` does not exist.

- [ ] **Step 3: Implement `pipeline.py`**

Create `src/upmovies/link/pipeline.py`:

```python
"""The `link` pipeline (Stage 1): select recent pending stories and link them in batches,
tracking the run. Idempotent — only touches `pending` stories inside the recency window;
re-runs with nothing pending are a no-op. One batch's failure never rolls back others."""

import logging
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.ingest.runs import finalize_run, record_progress
from upmovies.link.linker import Completer, link_story_batch
from upmovies.link.roster import build_roster
from upmovies.news.models import Story

log = logging.getLogger(__name__)

SessionFactory = Callable[[], AsyncSession]


@dataclass
class LinkIngestResult:
    linked: int
    rejected: int


@asynccontextmanager
async def _owned_session(session_factory: SessionFactory) -> AsyncIterator[AsyncSession]:
    async with session_factory() as s:
        yield s


def _chunks(seq: Sequence[UUID], size: int) -> list[list[UUID]]:
    return [list(seq[i : i + size]) for i in range(0, len(seq), size)]


async def run_link_ingest(
    *,
    session_factory: SessionFactory,
    client: Completer,
    run_id: UUID,
    model: str,
    recency_days: int,
    batch_size: int,
    floor: float,
) -> LinkIngestResult:
    async with _owned_session(session_factory) as s:
        roster = await build_roster(s)

    cutoff = datetime.now(UTC) - timedelta(days=recency_days)
    async with _owned_session(session_factory) as s:
        result = await s.execute(
            select(Story.id).where(
                Story.link_status == "pending",
                func.coalesce(Story.published_at, Story.fetched_at) >= cutoff,
            )
        )
        pending_ids = [row[0] for row in result.all()]

    linked = rejected = 0
    for batch_ids in _chunks(pending_ids, batch_size):
        try:
            async with _owned_session(session_factory) as s:
                stories = (
                    await s.execute(select(Story).where(Story.id.in_(batch_ids)))
                ).scalars().all()
                batch = await link_story_batch(
                    client=client, model=model, roster=roster, stories=list(stories), floor=floor
                )
                await record_progress(s, run_id, processed_delta=batch.linked + batch.rejected)
                await s.commit()
            linked += batch.linked
            rejected += batch.rejected
        except Exception:
            log.exception("link batch of %d stories failed", len(batch_ids))
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=len(batch_ids))
                await s.commit()

    async with _owned_session(session_factory) as s:
        await finalize_run(
            s, run_id, status="succeeded", detail=f"linked {linked}, rejected {rejected}"
        )
        await s.commit()
    return LinkIngestResult(linked, rejected)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `task test -- tests/integration/link`
Expected: PASS (roster + pipeline tests).

---

### Task 2: Trigger endpoint + background wrapper

**Files:**
- Modify: `src/upmovies/routers/ingest_admin.py`
- Test: `tests/integration/routers/test_link_admin.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/routers/test_link_admin.py`:

```python
import asyncio
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from upmovies.config import get_settings
from upmovies.ingest.models import IngestRun
from upmovies.ingest.runs import create_run
from upmovies.main import app
from upmovies.routers import ingest_admin


def _admin_header() -> dict[str, str]:
    return {"Authorization": f"Bearer {get_settings().admin_token}"}


@pytest.fixture
async def client(session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:
        yield c


async def _run_row(session, run_id) -> IngestRun:
    return (
        await session.execute(
            select(IngestRun).where(IngestRun.id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()


async def test_trigger_link_requires_admin_token(client):
    assert (await client.post("/admin/ingest/link")).status_code == 401


async def test_trigger_link_creates_run_and_returns_id(client, session, monkeypatch):
    called: list[tuple[str, uuid.UUID]] = []

    async def fake_link(run_id, settings):
        called.append(("link", run_id))

    monkeypatch.setattr(ingest_admin, "_background_link", fake_link)

    r = await client.post("/admin/ingest/link", headers=_admin_header())
    assert r.status_code == 202
    run_id = uuid.UUID(r.json()["run_id"])
    await asyncio.sleep(0.05)
    assert ("link", run_id) in called
    row = await _run_row(session, run_id)
    assert row.kind == "link"
    assert row.status == "running"


async def test_background_link_marks_run_failed_on_crash(session, monkeypatch):
    async def boom(**kwargs):
        raise RuntimeError("simulated link crash")

    monkeypatch.setattr("upmovies.routers.ingest_admin.run_link_ingest", boom)
    run_id = await create_run(session, kind="link")
    await session.commit()

    await ingest_admin._background_link(run_id, get_settings())

    row = await _run_row(session, run_id)
    assert row.status == "failed"
    assert row.error and "simulated link crash" in row.error
```

- [ ] **Step 2: Run them to verify they fail**

Run: `task test -- tests/integration/routers`
Expected: FAIL — `_background_link` / `/admin/ingest/link` do not exist.

- [ ] **Step 3: Wire the endpoint**

In `src/upmovies/routers/ingest_admin.py`, add these imports next to the existing ones:

```python
from upmovies.link.pipeline import run_link_ingest
from upmovies.llm.client import AnthropicClient
```

Add the background wrapper after `_background_feeds`:

```python
async def _background_link(run_id: UUID, settings: Settings) -> None:
    try:
        async with AnthropicClient(api_key=settings.anthropic_api_key) as client:
            await run_link_ingest(
                session_factory=_session_factory,
                client=client,
                run_id=run_id,
                model=settings.link_model,
                recency_days=settings.link_recency_days,
                batch_size=settings.link_batch_size,
                floor=settings.link_confidence_floor,
            )
    except Exception as e:
        log.exception("background link ingest crashed")
        await _finalize_failed(run_id, str(e))
```

Add the trigger endpoint after `trigger_feeds` (before `get_run_status`):

```python
@router.post("/link", status_code=status.HTTP_202_ACCEPTED)
async def trigger_link(
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    run_id = await create_run(session, kind="link")
    await session.commit()
    asyncio.create_task(_background_link(run_id, settings))
    return {"run_id": str(run_id)}
```

> Note: `get_run_status` is a catch-all `GET /{run_id}`. Keep the new `POST /link` declared **above** it (POST vs GET, so no real conflict, but mirror the tmdb/feeds ordering).

- [ ] **Step 4: Run them to verify they pass**

Run: `task test -- tests/integration/routers`
Expected: PASS.

---

### Task 3: Daily cron step

**Files:**
- Modify: `.github/workflows/daily-ingest.yml`

- [ ] **Step 1: Add the `link` step**

Replace the final run block (currently ending the script) so it runs all three pipelines:

```bash
          # Run all pipelines; fail the job if any did not succeed. link runs after
          # feeds (it consumes freshly-fetched stories).
          rc=0
          trigger_and_wait tmdb || rc=1
          trigger_and_wait feeds || rc=1
          trigger_and_wait link || rc=1
          exit "${rc}"
```

Also update the top-of-file comment from "TMDB + feeds ingestion pipelines" to "TMDB, feeds, and link pipelines".

- [ ] **Step 2: Sanity-check the YAML**

Run: `task shell` then `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/daily-ingest.yml'))"` (exit the shell after). Expected: no error.

---

## Final verification (before handing off to commit)

- [ ] `task format`
- [ ] `task lint` — clean
- [ ] `task typecheck` — clean
- [ ] `task test` — full suite green
- [ ] Hand off: the user commits (e.g. `feat: add link ingestion pipeline, trigger endpoint, and cron step`) and opens the PR for NEU-275.

---

## Self-Review

- **Spec coverage:** `run_link_ingest` selects `pending` stories by `coalesce(published_at, fetched_at)` within `link_recency_days`, links per batch, commits per batch, and wires `ingest.runs` with a `linked/rejected` detail; `POST /admin/ingest/link` + background wrapper mirror the existing triggers; the cron gains the `link` step after feeds. Matches the spec's "Pipeline ops" section.
- **Placeholders:** None — full pipeline, endpoint, and YAML edits given.
- **Type consistency:** `run_link_ingest(*, session_factory, client: Completer, run_id, model, recency_days, batch_size, floor) -> LinkIngestResult` is called identically in the test and `_background_link`; the settings fields (`link_model`, `link_recency_days`, `link_batch_size`, `link_confidence_floor`, `anthropic_api_key`) match NEU-273. `AnthropicClient` satisfies `Completer`.
- **Decisions noted:** per-batch isolation (no consecutive-failure abort) — a possible future refinement if the LLM API flaps; un-parseable batches raise and are counted as failures, leaving those stories `pending` for the next run. No `main.py` change required.
