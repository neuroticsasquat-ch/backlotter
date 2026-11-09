# Synthesize Pipeline (NEU-305) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the NEU-304 summarization service into a fourth ingest stage (`synthesize`) that fills `news.event_summary`, so the public surface (`/feed`, `/films`, `/films/{slug}`, sitemap) stops rendering empty.

**Architecture:** A new `synthesize/pipeline.py` mirroring `link/pipeline.py`: select events whose summary is missing/stale/version-mismatched, map each (with its member stories and film title) to the service's `EventInput`, summarize via a sequential (Messages) **or** batched (Batches) path gated on `summary_use_batches`, and `on_conflict_do_update` into `news.event_summary`. Plus the `synthesize` ingest kind (+ migration), the `POST /admin/ingest/synthesize` trigger, and the daily-cron step after `link`.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async + asyncpg, Alembic, FastAPI, pytest (pytest-asyncio `auto` mode), respx/fakes for LLM. Everything runs in the container via `task` — **never** run `pytest`/`alembic`/`python` on the host.

---

## Conventions for this plan

- **Commits:** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-305.` in the body), **no** `Co-Authored-By`, **no** `🤖 Generated with Claude Code` footer in commits. One ticket = one PR (branch `tom/neu-305-backend-synthesize-pipeline-ingest-kind-trigger-cron`). If executed via subagent-driven-development, implementer subagents do **not** commit — the user commits once at the end.
- **Run tests/lint/typecheck via `task`** (they `docker compose exec` into `upmovies-backend`). Keep the container up (`task up`). Run `task format` before committing.
- **Integration-test quirk (CLAUDE.md):** running a single integration *file* in isolation errors with a pytest-asyncio session-loop warning. Scope to a directory (`task test -- tests/integration/synthesize`) or run the whole suite — do **not** run one file alone.

## File structure

| File | Responsibility |
|---|---|
| `src/upmovies/synthesize/pipeline.py` | **new** — selection + ORM→`EventInput` mapping, `event_summary` upsert, sequential + batched stages, `run_synthesize_ingest`, `SynthesizeResult` |
| `src/upmovies/synthesize/__init__.py` | re-export `run_synthesize_ingest`, `SynthesizeResult` |
| `src/upmovies/ingest/models.py` | extend `ck_ingest_run_kind` to include `synthesize` |
| `migrations/versions/<gen>_add_synthesize_ingest_kind.py` | **new** hand-written CHECK-constraint swap |
| `src/upmovies/routers/ingest_admin.py` | `_background_synth` + `POST /admin/ingest/synthesize` |
| `.github/workflows/daily-pipeline.yml` | add `synthesize` step after `link` |
| `tests/integration/synthesize/__init__.py` | **new** package marker |
| `tests/integration/synthesize/test_pipeline.py` | **new** — kind, selection, upsert, both stages |
| `tests/integration/routers/test_synthesize_admin.py` | **new** — trigger tests |

---

## Task 1: Add the `synthesize` ingest kind (model + migration)

**Files:**
- Modify: `src/upmovies/ingest/models.py:18`
- Create: `tests/integration/synthesize/__init__.py`
- Create: `tests/integration/synthesize/test_pipeline.py`
- Create: `migrations/versions/<generated>_add_synthesize_ingest_kind.py`

- [ ] **Step 1: Create the test package marker**

Create `tests/integration/synthesize/__init__.py` (empty file).

- [ ] **Step 2: Write the failing test**

Create `tests/integration/synthesize/test_pipeline.py`:

```python
from sqlalchemy import select

from upmovies.ingest.models import IngestRun
from upmovies.ingest.runs import create_run


async def test_synthesize_is_a_valid_ingest_kind(session):
    run_id = await create_run(session, kind="synthesize")
    await session.commit()
    row = (
        await session.execute(select(IngestRun).where(IngestRun.id == run_id))
    ).scalar_one()
    assert row.kind == "synthesize"
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- tests/integration/synthesize/test_pipeline.py::test_synthesize_is_a_valid_ingest_kind`
Expected: FAIL — `IntegrityError` violating `ck_ingest_run_kind` (current constraint is `('tmdb','feeds','link')`).

- [ ] **Step 4: Update the model constraint**

In `src/upmovies/ingest/models.py`, change the kind CheckConstraint (line ~18) from:

```python
        CheckConstraint("kind IN ('tmdb', 'feeds', 'link')", name="ck_ingest_run_kind"),
```

to:

```python
        CheckConstraint(
            "kind IN ('tmdb', 'feeds', 'link', 'synthesize')", name="ck_ingest_run_kind"
        ),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test -- tests/integration/synthesize/test_pipeline.py::test_synthesize_is_a_valid_ingest_kind`
Expected: PASS (tests build schema from models via `create_all`, so the model change is enough for tests).

- [ ] **Step 6: Generate the migration shell**

Run: `task makemigration -- "add synthesize ingest kind"`
This creates `migrations/versions/<generated>_add_synthesize_ingest_kind.py` with an **empty** `upgrade`/`downgrade` (Alembic does not diff CheckConstraints) and `down_revision = '2655e0fe958c'` (the current head).

- [ ] **Step 7: Fill in the migration by hand**

Replace the generated `upgrade`/`downgrade` bodies (mirror the precedent in `37f37eb3edeb`):

```python
def upgrade() -> None:
    op.drop_constraint("ck_ingest_run_kind", "ingest_run", type_="check", schema="ingest")
    op.create_check_constraint(
        "ck_ingest_run_kind",
        "ingest_run",
        "kind IN ('tmdb', 'feeds', 'link', 'synthesize')",
        schema="ingest",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ingest_run_kind", "ingest_run", type_="check", schema="ingest")
    op.create_check_constraint(
        "ck_ingest_run_kind",
        "ingest_run",
        "kind IN ('tmdb', 'feeds', 'link')",
        schema="ingest",
    )
```

- [ ] **Step 8: Verify single head and apply**

Run: `task migrate` (applies to the dev `upmovies` DB).
Then confirm a single head: `task shell` → `alembic heads` (expect exactly one revision id, the new one). Exit the shell.

- [ ] **Step 9: Commit**

```bash
task format
git add src/upmovies/ingest/models.py migrations/versions/ tests/integration/synthesize/
git commit -m "feat(ingest): add synthesize ingest kind + migration"
```

---

## Task 2: Event selection + ORM→`EventInput` mapping

Adds `_select_pending` to the new `pipeline.py`: returns the events needing a (re)summary, each already mapped to an `EventInput`, plus an `is_new` flag for the run-detail counts.

**Files:**
- Create: `src/upmovies/synthesize/pipeline.py`
- Test: `tests/integration/synthesize/test_pipeline.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/synthesize/test_pipeline.py` (add imports at top of file):

```python
from datetime import UTC, datetime, timedelta

from upmovies.catalog.models import Film
from upmovies.news.models import Event, EventStory, EventSummary, Story
from upmovies.synthesize.pipeline import _select_pending


async def _film(session, *, tmdb_id=1, title="Runner"):
    film = Film(tmdb_id=tmdb_id, title=title)
    session.add(film)
    await session.flush()
    return film


async def _event_with_story(session, film, *, event_type="casting", dek="A dek.", source="Deadline"):
    story = Story(
        source=source, url=f"https://e/{film.id}-{event_type}", title="Headline",
        published_at=datetime.now(UTC), raw={"summary": dek},
    )
    session.add(story)
    await session.flush()
    event = Event(
        film_id=film.id, event_type=event_type, confidence="confirmed",
        occurred_at=datetime.now(UTC),
    )
    session.add(event)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=story.id))
    await session.flush()
    return event


async def test_select_pending_includes_new_event_and_maps_input(session):
    film = await _film(session, title="Runner")
    event = await _event_with_story(session, film, event_type="trailer", dek="Trailer dropped.")
    await session.commit()

    pending = await _select_pending(session, prompt_version="1")

    assert len(pending) == 1
    pe = pending[0]
    assert pe.event_id == event.id
    assert pe.is_new is True
    assert pe.event_input.event_type == "trailer"
    assert pe.event_input.film_title == "Runner"
    assert pe.event_input.source_updated_at == event.updated_at
    assert [s.dek for s in pe.event_input.stories] == ["Trailer dropped."]
    assert [s.source for s in pe.event_input.stories] == ["Deadline"]


async def test_select_pending_skips_up_to_date_event(session):
    film = await _film(session)
    event = await _event_with_story(session, film)
    session.add(EventSummary(
        event_id=event.id, summary="done", model="m", prompt_version="1",
        source_updated_at=event.updated_at,
    ))
    await session.commit()

    pending = await _select_pending(session, prompt_version="1")
    assert pending == []


async def test_select_pending_includes_stale_event(session):
    film = await _film(session)
    event = await _event_with_story(session, film)
    # summary built against an OLDER updated_at than the event now has
    session.add(EventSummary(
        event_id=event.id, summary="old", model="m", prompt_version="1",
        source_updated_at=event.updated_at - timedelta(hours=1),
    ))
    await session.commit()

    pending = await _select_pending(session, prompt_version="1")
    assert len(pending) == 1
    assert pending[0].is_new is False


async def test_select_pending_includes_prompt_version_mismatch(session):
    film = await _film(session)
    event = await _event_with_story(session, film)
    session.add(EventSummary(
        event_id=event.id, summary="v1", model="m", prompt_version="1",
        source_updated_at=event.updated_at,
    ))
    await session.commit()

    pending = await _select_pending(session, prompt_version="2")
    assert len(pending) == 1
    assert pending[0].is_new is False
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/synthesize/test_pipeline.py -k _select_pending`
Expected: FAIL — `ImportError` (`_select_pending` / `pipeline` does not exist).

- [ ] **Step 3: Create `pipeline.py` with the selection helper**

Create `src/upmovies/synthesize/pipeline.py`:

```python
"""The `synthesize` pipeline: select events whose summary is missing, stale (the event grew),
or prompt-version-mismatched; summarize each (sequential Messages path or batched Batches path);
and upsert news.event_summary. Idempotent — a re-run with nothing pending is a no-op. One event's
failure never rolls back others. Mirrors link/pipeline.py structurally."""

import logging
from collections import defaultdict
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, nulls_last, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.catalog.models import Film
from upmovies.ingest.runs import finalize_run, record_progress
from upmovies.news.models import Event, EventStory, EventSummary, Story
from upmovies.synthesize.summarizer import (
    EventInput,
    StoryInput,
    SummaryClient,
    SummaryResult,
    build_summary_batch_request,
    parse_summary,
    summarize_event,
)

log = logging.getLogger(__name__)

SessionFactory = Callable[[], AsyncSession]


@dataclass
class SynthesizeResult:
    new: int
    refreshed: int
    failed: int


@dataclass
class _PendingEvent:
    event_id: UUID
    is_new: bool
    event_input: EventInput


@asynccontextmanager
async def _owned_session(session_factory: SessionFactory) -> AsyncIterator[AsyncSession]:
    async with session_factory() as s:
        yield s


async def _select_pending(session: AsyncSession, *, prompt_version: str) -> list[_PendingEvent]:
    """Events missing a summary, or whose summary is stale (event.updated_at later than the
    stored source_updated_at), or whose stored prompt_version differs from the current one.
    Returns each mapped to an EventInput (plain dataclasses — safe to use after the session
    closes), with is_new = no prior summary existed."""
    rows = (
        await session.execute(
            select(Event, Film.title, EventSummary.event_id)
            .join(Film, Film.id == Event.film_id)
            .outerjoin(EventSummary, EventSummary.event_id == Event.id)
            .where(
                EventSummary.event_id.is_(None)
                | (Event.updated_at > EventSummary.source_updated_at)
                | (EventSummary.prompt_version != prompt_version)
            )
        )
    ).all()
    if not rows:
        return []

    event_ids = [event.id for event, _title, _existing in rows]
    stories_by_event: dict[UUID, list[Story]] = defaultdict(list)
    story_rows = (
        await session.execute(
            select(EventStory.event_id, Story)
            .join(Story, Story.id == EventStory.story_id)
            .where(EventStory.event_id.in_(event_ids))
            .order_by(nulls_last(Story.published_at.asc()), Story.id.asc())
        )
    ).all()
    for event_id, story in story_rows:
        stories_by_event[event_id].append(story)

    pending: list[_PendingEvent] = []
    for event, film_title, existing in rows:
        story_inputs = [
            StoryInput(
                title=s.title,
                dek=str((s.raw or {}).get("summary", "")),
                source=s.source,
            )
            for s in stories_by_event.get(event.id, [])
        ]
        pending.append(
            _PendingEvent(
                event_id=event.id,
                is_new=existing is None,
                event_input=EventInput(
                    event_type=event.event_type,
                    film_title=film_title,
                    source_updated_at=event.updated_at,
                    stories=story_inputs,
                ),
            )
        )
    return pending
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/integration/synthesize/test_pipeline.py -k _select_pending`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
task format
git add src/upmovies/synthesize/pipeline.py tests/integration/synthesize/test_pipeline.py
git commit -m "feat(synthesize): add stale-event selection and EventInput mapping"
```

---

## Task 3: The `event_summary` upsert helper

**Files:**
- Modify: `src/upmovies/synthesize/pipeline.py`
- Test: `tests/integration/synthesize/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/synthesize/test_pipeline.py`:

```python
from upmovies.synthesize.pipeline import _upsert_summary
from upmovies.synthesize.summarizer import SummaryResult


async def test_upsert_summary_inserts_then_updates_idempotently(session):
    film = await _film(session)
    event = await _event_with_story(session, film)
    await session.commit()

    first = SummaryResult(
        summary="First.", model="claude-haiku-4-5", prompt_version="1",
        source_updated_at=event.updated_at,
    )
    await _upsert_summary(session, event.id, first)
    await session.commit()

    rows = (
        await session.execute(
            select(EventSummary).where(EventSummary.event_id == event.id),
            execution_options={"populate_existing": True},
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].summary == "First."

    second = SummaryResult(
        summary="Second.", model="claude-haiku-4-5", prompt_version="2",
        source_updated_at=event.updated_at,
    )
    await _upsert_summary(session, event.id, second)
    await session.commit()

    row = (
        await session.execute(
            select(EventSummary).where(EventSummary.event_id == event.id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert row.summary == "Second."
    assert row.prompt_version == "2"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/synthesize/test_pipeline.py::test_upsert_summary_inserts_then_updates_idempotently`
Expected: FAIL — `ImportError` (`_upsert_summary` not defined).

- [ ] **Step 3: Add the upsert helper to `pipeline.py`**

Append to `src/upmovies/synthesize/pipeline.py`:

```python
async def _upsert_summary(session: AsyncSession, event_id: UUID, result: SummaryResult) -> None:
    """Insert or update the one summary row for an event (PK event_id). Refreshes generated_at
    on update. Caller owns the commit."""
    stmt = pg_insert(EventSummary).values(
        event_id=event_id,
        summary=result.summary,
        model=result.model,
        prompt_version=result.prompt_version,
        source_updated_at=result.source_updated_at,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["event_id"],
        set_={
            "summary": result.summary,
            "model": result.model,
            "prompt_version": result.prompt_version,
            "source_updated_at": result.source_updated_at,
            "generated_at": func.now(),
        },
    )
    await session.execute(stmt)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/synthesize/test_pipeline.py::test_upsert_summary_inserts_then_updates_idempotently`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
task format
git add src/upmovies/synthesize/pipeline.py tests/integration/synthesize/test_pipeline.py
git commit -m "feat(synthesize): add idempotent event_summary upsert"
```

---

## Task 4: Sequential orchestration — `run_synthesize_ingest`

Adds the sequential stage and the top-level orchestrator (selection → summarize per event → upsert+commit per event → finalize with counts). Default `use_batches=True` is wired in Task 5; this task exercises `use_batches=False`.

**Files:**
- Modify: `src/upmovies/synthesize/pipeline.py`
- Test: `tests/integration/synthesize/test_pipeline.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/synthesize/test_pipeline.py` (add `IngestRun`/`create_run` are already imported; add the fake + helper):

```python
import json

from upmovies.ingest.runs import create_run as _create_run  # alias to avoid earlier-import clash
from upmovies.synthesize.pipeline import run_synthesize_ingest


class FakeSummaryClient:
    """Serves both surfaces. `complete` (sequential) and `complete_batch` (batched) both return
    the JSON summary envelope the service expects."""

    def __init__(self, summary="A neutral update."):
        self._summary = summary
        self.complete_calls = 0
        self.batch_requests = None

    async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
        self.complete_calls += 1
        return json.dumps({"summary": self._summary})

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        from upmovies.llm.client import BatchResult

        self.batch_requests = list(requests)
        return {
            r.custom_id: BatchResult(
                custom_id=r.custom_id, ok=True, text=json.dumps({"summary": self._summary})
            )
            for r in self.batch_requests
        }


async def _run(session, run_id, *, use_batches=False, client=None, prompt_version="1"):
    return await run_synthesize_ingest(
        session_factory=lambda: session,
        client=client or FakeSummaryClient(),
        run_id=run_id,
        model="claude-haiku-4-5",
        prompt_version=prompt_version,
        use_batches=use_batches,
    )


async def test_sequential_summarizes_new_event_and_finalizes(session):
    film = await _film(session)
    event = await _event_with_story(session, film, dek="Star cast.")
    await session.commit()
    run_id = await _create_run(session, kind="synthesize")
    await session.commit()

    result = await _run(session, run_id, use_batches=False)

    assert (result.new, result.refreshed, result.failed) == (1, 0, 0)
    row = (
        await session.execute(
            select(EventSummary).where(EventSummary.event_id == event.id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert row.summary == "A neutral update."
    assert row.source_updated_at == event.updated_at

    run = (
        await session.execute(
            select(IngestRun).where(IngestRun.id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert run.status == "succeeded"
    assert run.detail == "summarized 1 (1 new, 0 refreshed); 0 failed"


async def test_rerun_is_noop_when_nothing_pending(session):
    film = await _film(session)
    event = await _event_with_story(session, film)
    await session.commit()
    run_id = await _create_run(session, kind="synthesize")
    await session.commit()
    await _run(session, run_id, use_batches=False)  # first run summarizes

    run_id2 = await _create_run(session, kind="synthesize")
    await session.commit()
    result = await _run(session, run_id2, use_batches=False)

    assert (result.new, result.refreshed, result.failed) == (0, 0, 0)


async def test_prompt_version_bump_refreshes(session):
    film = await _film(session)
    event = await _event_with_story(session, film)
    await session.commit()
    run_id = await _create_run(session, kind="synthesize")
    await session.commit()
    await _run(session, run_id, use_batches=False, prompt_version="1")

    run_id2 = await _create_run(session, kind="synthesize")
    await session.commit()
    result = await _run(session, run_id2, use_batches=False, prompt_version="2")

    assert (result.new, result.refreshed, result.failed) == (0, 1, 0)
    row = (
        await session.execute(
            select(EventSummary).where(EventSummary.event_id == event.id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert row.prompt_version == "2"


class _FailOneCompleter(FakeSummaryClient):
    """Raises for the event whose film title starts 'FAIL', succeeds otherwise."""

    async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
        payload = json.loads(messages[0]["content"])
        if payload["film"].startswith("FAIL"):
            raise RuntimeError("boom")
        return json.dumps({"summary": self._summary})


async def test_sequential_failure_is_isolated_per_event(session):
    ok_film = await _film(session, tmdb_id=1, title="Runner")
    fail_film = await _film(session, tmdb_id=2, title="FAIL Movie")
    ok_event = await _event_with_story(session, ok_film)
    fail_event = await _event_with_story(session, fail_film)
    await session.commit()
    run_id = await _create_run(session, kind="synthesize")
    await session.commit()

    result = await _run(session, run_id, use_batches=False, client=_FailOneCompleter())

    assert (result.new, result.failed) == (1, 1)
    summarized = {
        r.event_id
        for r in (
            await session.execute(select(EventSummary), execution_options={"populate_existing": True})
        ).scalars().all()
    }
    assert ok_event.id in summarized
    assert fail_event.id not in summarized

    run = (
        await session.execute(
            select(IngestRun).where(IngestRun.id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert run.status == "succeeded"
    assert run.items_processed == 1
    assert run.items_failed == 1
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/synthesize/test_pipeline.py -k "sequential or rerun or prompt_version_bump"`
Expected: FAIL — `ImportError` (`run_synthesize_ingest` not defined).

- [ ] **Step 3: Add the sequential stage and orchestrator to `pipeline.py`**

Append to `src/upmovies/synthesize/pipeline.py`:

```python
async def _summary_stage_sequential(
    *,
    session_factory: SessionFactory,
    client: SummaryClient,
    run_id: UUID,
    model: str,
    prompt_version: str,
    pending: list[_PendingEvent],
) -> tuple[int, int, int]:
    new = refreshed = failed = 0
    for pe in pending:
        try:
            result = await summarize_event(
                client=client, model=model, prompt_version=prompt_version, event=pe.event_input
            )
            async with _owned_session(session_factory) as s:
                await _upsert_summary(s, pe.event_id, result)
                await record_progress(s, run_id, processed_delta=1)
                await s.commit()
            if pe.is_new:
                new += 1
            else:
                refreshed += 1
        except Exception:
            log.exception("summarize failed for event %s", pe.event_id)
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=1)
                await s.commit()
            failed += 1
    return new, refreshed, failed


async def run_synthesize_ingest(
    *,
    session_factory: SessionFactory,
    client: SummaryClient,
    run_id: UUID,
    model: str,
    prompt_version: str,
    use_batches: bool = True,
) -> SynthesizeResult:
    async with _owned_session(session_factory) as s:
        pending = await _select_pending(s, prompt_version=prompt_version)

    stage = _summary_stage_batched if use_batches else _summary_stage_sequential
    new, refreshed, failed = await stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=model,
        prompt_version=prompt_version,
        pending=pending,
    )

    async with _owned_session(session_factory) as s:
        await finalize_run(
            s,
            run_id,
            status="succeeded",
            detail=(
                f"summarized {new + refreshed} "
                f"({new} new, {refreshed} refreshed); {failed} failed"
            ),
        )
        await s.commit()
    return SynthesizeResult(new=new, refreshed=refreshed, failed=failed)
```

> Note: `run_synthesize_ingest` references `_summary_stage_batched`, which is added in Task 5. Until then the **batched** branch is unused; the sequential tests in this task pass because they call with `use_batches=False`. If your linter flags the forward reference, proceed — Task 5 defines it. (To keep each task independently green, you may temporarily define `_summary_stage_batched = _summary_stage_sequential` and replace it in Task 5; optional.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/integration/synthesize/test_pipeline.py -k "sequential or rerun or prompt_version_bump"`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
task format
git add src/upmovies/synthesize/pipeline.py tests/integration/synthesize/test_pipeline.py
git commit -m "feat(synthesize): add sequential pipeline and run orchestration"
```

---

## Task 5: Batched stage

Adds `_summary_stage_batched` (one `BatchRequest` per event, submit all, apply per result with per-event isolation, whole-batch-failure handling) and proves the flag routes to the right surface.

**Files:**
- Modify: `src/upmovies/synthesize/pipeline.py`
- Test: `tests/integration/synthesize/test_pipeline.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/synthesize/test_pipeline.py`:

```python
import pytest

from upmovies.llm.client import BatchResult


@pytest.mark.parametrize("use_batches", [False, True])
async def test_both_paths_summarize_new_event(session, use_batches):
    film = await _film(session)
    event = await _event_with_story(session, film)
    await session.commit()
    run_id = await _create_run(session, kind="synthesize")
    await session.commit()

    result = await _run(session, run_id, use_batches=use_batches)

    assert (result.new, result.refreshed, result.failed) == (1, 0, 0)
    row = (
        await session.execute(
            select(EventSummary).where(EventSummary.event_id == event.id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert row.summary == "A neutral update."


async def test_batched_request_mapping(session):
    film = await _film(session)
    event = await _event_with_story(session, film)
    await session.commit()
    run_id = await _create_run(session, kind="synthesize")
    await session.commit()

    client = FakeSummaryClient()
    await _run(session, run_id, use_batches=True, client=client)

    reqs = client.batch_requests
    assert reqs is not None
    assert {r.custom_id for r in reqs} == {str(event.id)}  # one request per event, keyed by id
    assert reqs[0].model == "claude-haiku-4-5"
    assert reqs[0].max_tokens == 256
    assert client.complete_calls == 0  # batched path never calls complete()


class _BatchFailOne:
    """Fails the request whose event payload's film starts 'FAIL'; succeeds otherwise."""

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        out = {}
        for r in requests:
            payload = json.loads(r.messages[0]["content"])
            if payload["film"].startswith("FAIL"):
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id, ok=False, error_type="errored", error_message="boom"
                )
            else:
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id, ok=True, text=json.dumps({"summary": "ok."})
                )
        return out


async def test_batched_failure_is_isolated_per_event(session):
    ok_film = await _film(session, tmdb_id=1, title="Runner")
    fail_film = await _film(session, tmdb_id=2, title="FAIL Movie")
    ok_event = await _event_with_story(session, ok_film)
    fail_event = await _event_with_story(session, fail_film)
    await session.commit()
    run_id = await _create_run(session, kind="synthesize")
    await session.commit()

    result = await _run(session, run_id, use_batches=True, client=_BatchFailOne())

    assert (result.new, result.failed) == (1, 1)
    summarized = {
        r.event_id
        for r in (
            await session.execute(select(EventSummary), execution_options={"populate_existing": True})
        ).scalars().all()
    }
    assert ok_event.id in summarized
    assert fail_event.id not in summarized


class _RaisingBatchClient:
    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        raise TimeoutError("batch never reached 'ended'")


async def test_batched_whole_submit_failure_marks_all_failed_run_succeeds(session):
    film = await _film(session)
    event = await _event_with_story(session, film)
    await session.commit()
    run_id = await _create_run(session, kind="synthesize")
    await session.commit()

    result = await _run(session, run_id, use_batches=True, client=_RaisingBatchClient())

    assert (result.new, result.refreshed, result.failed) == (0, 0, 1)
    rows = (
        await session.execute(select(EventSummary), execution_options={"populate_existing": True})
    ).scalars().all()
    assert rows == []  # nothing summarized; events retried next run

    run = (
        await session.execute(
            select(IngestRun).where(IngestRun.id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert run.status == "succeeded"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/synthesize/test_pipeline.py -k "both_paths or batched"`
Expected: FAIL — `_summary_stage_batched` not defined (or `AttributeError` if you used the temporary alias in Task 4).

- [ ] **Step 3: Add `_summary_stage_batched` to `pipeline.py`**

Insert this function **above** `run_synthesize_ingest` (replace the temporary alias from Task 4 if you added one):

```python
async def _summary_stage_batched(
    *,
    session_factory: SessionFactory,
    client: SummaryClient,
    run_id: UUID,
    model: str,
    prompt_version: str,
    pending: list[_PendingEvent],
) -> tuple[int, int, int]:
    if not pending:
        return 0, 0, 0

    by_id = {str(pe.event_id): pe for pe in pending}
    requests = [
        build_summary_batch_request(
            custom_id=str(pe.event_id), model=model, event=pe.event_input
        )
        for pe in pending
    ]

    try:
        results = await client.complete_batch(requests)
    except Exception:
        log.exception("summary batch submit of %d events failed", len(requests))
        async with _owned_session(session_factory) as s:
            await record_progress(s, run_id, failed_delta=len(requests))
            await s.commit()
        return 0, 0, len(requests)

    new = refreshed = failed = 0
    for custom_id, pe in by_id.items():
        result = results.get(custom_id)
        try:
            if result is None or not result.ok:
                detail = result.error_type if result else "missing"
                raise RuntimeError(f"summary for event {custom_id} unavailable: {detail}")
            summary_result = SummaryResult(
                summary=parse_summary(result.text),
                model=model,
                prompt_version=prompt_version,
                source_updated_at=pe.event_input.source_updated_at,
            )
            async with _owned_session(session_factory) as s:
                await _upsert_summary(s, pe.event_id, summary_result)
                await record_progress(s, run_id, processed_delta=1)
                await s.commit()
            if pe.is_new:
                new += 1
            else:
                refreshed += 1
        except Exception:
            log.exception("summary apply failed for event %s", custom_id)
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=1)
                await s.commit()
            failed += 1
    return new, refreshed, failed
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/integration/synthesize/test_pipeline.py -k "both_paths or batched"`
Expected: PASS (all five, including both `use_batches` params).

- [ ] **Step 5: Run the whole synthesize directory**

Run: `task test -- tests/integration/synthesize`
Expected: PASS (all tests from Tasks 1–5).

- [ ] **Step 6: Commit**

```bash
task format
git add src/upmovies/synthesize/pipeline.py tests/integration/synthesize/test_pipeline.py
git commit -m "feat(synthesize): add batched pipeline path behind summary_use_batches"
```

---

## Task 6: Trigger endpoint + background wrapper + re-exports

**Files:**
- Modify: `src/upmovies/synthesize/__init__.py`
- Modify: `src/upmovies/routers/ingest_admin.py`
- Create: `tests/integration/routers/test_synthesize_admin.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/routers/test_synthesize_admin.py` (mirrors `test_link_admin.py`):

```python
import asyncio
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
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


async def test_trigger_synthesize_requires_admin_token(client):
    assert (await client.post("/admin/ingest/synthesize")).status_code == 401


async def test_trigger_synthesize_creates_run_and_returns_id(client, session, monkeypatch):
    called: list[tuple[str, uuid.UUID]] = []

    async def fake_synth(run_id, settings):
        called.append(("synthesize", run_id))

    monkeypatch.setattr(ingest_admin, "_background_synth", fake_synth)

    r = await client.post("/admin/ingest/synthesize", headers=_admin_header())
    assert r.status_code == 202
    run_id = uuid.UUID(r.json()["run_id"])
    await asyncio.sleep(0.05)
    assert ("synthesize", run_id) in called
    row = await _run_row(session, run_id)
    assert row.kind == "synthesize"
    assert row.status == "running"


async def test_background_synth_marks_run_failed_on_crash(session, monkeypatch):
    async def boom(**kwargs):
        raise RuntimeError("simulated synth crash")

    monkeypatch.setattr("upmovies.routers.ingest_admin.run_synthesize_ingest", boom)
    run_id = await create_run(session, kind="synthesize")
    await session.commit()

    await ingest_admin._background_synth(run_id, get_settings())

    row = await _run_row(session, run_id)
    assert row.status == "failed"
    assert row.error and "simulated synth crash" in row.error
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/routers/test_synthesize_admin.py`
Expected: FAIL — `_background_synth` / `run_synthesize_ingest` not importable in `ingest_admin`.

- [ ] **Step 3: Re-export from the synthesize package**

In `src/upmovies/synthesize/__init__.py`, add (keep the existing re-exports):

```python
from upmovies.synthesize.pipeline import SynthesizeResult as SynthesizeResult
from upmovies.synthesize.pipeline import run_synthesize_ingest as run_synthesize_ingest
```

- [ ] **Step 4: Add the trigger + background wrapper**

In `src/upmovies/routers/ingest_admin.py`, add the import near the others:

```python
from upmovies.synthesize.pipeline import run_synthesize_ingest
```

Add the background wrapper after `_background_link` (mirrors it):

```python
async def _background_synth(run_id: UUID, settings: Settings) -> None:
    try:
        async with AnthropicClient(api_key=settings.anthropic_api_key) as client:
            await run_synthesize_ingest(
                session_factory=_session_factory,
                client=client,
                run_id=run_id,
                model=settings.summary_model,
                prompt_version=settings.summary_prompt_version,
                use_batches=settings.summary_use_batches,
            )
    except Exception as e:
        log.exception("background synthesize ingest crashed")
        await _finalize_failed(run_id, str(e))
```

Add the trigger after `trigger_link` (mirrors it):

```python
@router.post("/synthesize", status_code=status.HTTP_202_ACCEPTED)
async def trigger_synthesize(
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    run_id = await create_run(session, kind="synthesize")
    await session.commit()
    asyncio.create_task(_background_synth(run_id, settings))
    return {"run_id": str(run_id)}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/integration/routers/test_synthesize_admin.py`
Expected: PASS (all three).

> Reminder (CLAUDE.md): do not run this single file alone if it triggers the pytest-asyncio session-loop warning; if so, run `task test -- tests/integration/routers` instead.

- [ ] **Step 6: Commit**

```bash
task format
git add src/upmovies/synthesize/__init__.py src/upmovies/routers/ingest_admin.py tests/integration/routers/test_synthesize_admin.py
git commit -m "feat(synthesize): add POST /admin/ingest/synthesize trigger"
```

---

## Task 7: Add the `synthesize` step to the daily cron

No automated test (it's a GitHub Actions workflow); verified by inspection.

**Files:**
- Modify: `.github/workflows/daily-pipeline.yml`

- [ ] **Step 1: Add the step after `link`**

In `.github/workflows/daily-pipeline.yml`, find the run sequence:

```bash
          rc=0
          trigger_and_wait tmdb || rc=1
          trigger_and_wait feeds "?per_film=true" || rc=1
          trigger_and_wait link || rc=1
          exit "${rc}"
```

Change it to:

```bash
          rc=0
          trigger_and_wait tmdb || rc=1
          trigger_and_wait feeds "?per_film=true" || rc=1
          trigger_and_wait link || rc=1
          trigger_and_wait synthesize || rc=1
          exit "${rc}"
```

- [ ] **Step 2: Update the header comment**

Update the top-of-file comment so the ordering reads `TMDB → per-film feeds → link → synthesize` (it currently says `TMDB → per-film feeds → link`). Adjust the prose that lists what the daily run does to mention the summarization pass.

- [ ] **Step 3: Verify the YAML**

Run: `task shell` → `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/daily-pipeline.yml'))" 2>/dev/null || true`
(Or just re-read the file.) Confirm indentation matches the surrounding lines and the file is valid YAML. Exit the shell.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/daily-pipeline.yml
git commit -m "ci: run synthesize after link in the daily pipeline"
```

---

## Task 8: Full local CI + verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite**

Run: `task test`
Expected: PASS (entire suite green, including the new synthesize tests).

- [ ] **Step 2: Lint and typecheck**

Run: `task lint` then `task typecheck`
Expected: both clean. (If `ruff` reports formatting, run `task format` and re-stage.)

- [ ] **Step 3: Confirm a single migration head**

Run: `task shell` → `alembic heads`
Expected: exactly one head (the new `add_synthesize_ingest_kind` revision). Exit the shell.

- [ ] **Step 4: Localdev smoke (the originating goal)**

Ensure the backend `.env` has `ANTHROPIC_API_KEY` set, and `SUMMARY_USE_BATCHES=false` for immediate results, then recreate the container so env is picked up:

```bash
task up
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8000/admin/ingest/synthesize
# → {"run_id": "..."}; poll GET /admin/ingest/<run_id> until status=succeeded
```

(Use the API base URL / port from your compose setup; `$ADMIN_TOKEN` must match the backend's `ADMIN_TOKEN`.) Confirm `news.event_summary` is now populated (≈197 rows) and the frontend home page "Latest Updates" renders entries.

> This step requires live Anthropic calls and is a manual local check — it is **not** part of the test suite.

---

## Self-review (completed by plan author)

- **Spec coverage:** kind+migration (Task 1), selection incl. prompt_version (Task 2), upsert (Task 3), sequential + orchestration + detail counts + failure isolation + no-op (Task 4), batched path + flag routing + whole-batch failure (Task 5), trigger + background wrapper (Task 6), cron (Task 7), config already exists (no task — verified in spec), admin runs surfaces synthesize automatically (covered: a `synthesize` run is created in Task 6's test and `admin_runs` is kind-agnostic). All spec sections map to a task.
- **Placeholder scan:** none — every code/test step contains complete content.
- **Type consistency:** `run_synthesize_ingest`, `SynthesizeResult(new/refreshed/failed)`, `_PendingEvent(event_id/is_new/event_input)`, `_select_pending`, `_upsert_summary`, `_summary_stage_sequential`, `_summary_stage_batched`, `_background_synth`, `trigger_synthesize` are named identically everywhere they appear. Service symbols (`EventInput`, `StoryInput`, `SummaryResult`, `SummaryClient`, `summarize_event`, `build_summary_batch_request`, `parse_summary`) match `synthesize/summarizer.py`. `BatchResult` fields (`custom_id`, `ok`, `text`, `error_type`) match `llm/client.py`.
- **Known forward reference:** Task 4 introduces `run_synthesize_ingest` referencing `_summary_stage_batched` (defined in Task 5); Task 4's tests only use the sequential branch, so they pass. Optional temporary alias noted in Task 4 Step 3.
