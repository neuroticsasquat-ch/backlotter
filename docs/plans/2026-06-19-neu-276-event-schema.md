# NEU-276: `news.event` + `news.event_story` schema + migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the event record schema — the contract Stage 2 emits and Synthesis consumes.

**Architecture:** Two `news`-schema tables. `Event` (one per film per beat, with `event_type` × `confidence` check constraints) and `EventStory` (composite-PK join with a **unique `story_id`** enforcing one-event-per-story). No summary column — Synthesis owns that. Tests build from the models; one additive migration ships it to prod.

**Tech Stack:** SQLAlchemy 2 async, Alembic, Postgres, pytest.

**Repo:** `upcoming-movies-backend` · **Branch:** `tom/neu-276-be-newsevent-newsevent_story-schema-migration` · **Spec:** `docs/specs/2026-06-19-entity-linking-clustering-design.md`

**Depends on:** NEU-272 (it edits the same `news/models.py` import line).

> **Commit/PR convention:** No per-step commits — implement, run the full check suite, then the user commits once and opens the PR. All commands run in the container via `task`.

---

## File Structure

- **Modify** `src/upmovies/news/models.py` — add `Event` and `EventStory`.
- **Create** `tests/integration/news/test_event_schema.py`.
- **Create** `migrations/versions/<rev>_add_news_event_tables.py` (generated; verify the constraints rendered).

---

### Task 1: Event + EventStory models + tests

**Files:**
- Modify: `src/upmovies/news/models.py`
- Test: `tests/integration/news/test_event_schema.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/news/test_event_schema.py`:

```python
from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from upmovies.catalog.models import Film
from upmovies.news.models import Event, EventStory, Story


async def _film_and_story(session, url="https://e/1"):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    story = Story(source="X", url=url, title="t")
    session.add(story)
    await session.flush()
    return film, story


async def test_event_rejects_bad_type(session):
    film, _ = await _film_and_story(session)
    session.add(
        Event(film_id=film.id, event_type="bogus", confidence="confirmed", occurred_at=datetime.now(UTC))
    )
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_event_rejects_bad_confidence(session):
    film, _ = await _film_and_story(session)
    session.add(
        Event(film_id=film.id, event_type="casting", confidence="maybe", occurred_at=datetime.now(UTC))
    )
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_one_event_per_story_enforced(session):
    film, story = await _film_and_story(session)
    e1 = Event(film_id=film.id, event_type="casting", confidence="confirmed", occurred_at=datetime.now(UTC))
    e2 = Event(film_id=film.id, event_type="trailer", confidence="confirmed", occurred_at=datetime.now(UTC))
    session.add_all([e1, e2])
    await session.flush()
    session.add(EventStory(event_id=e1.id, story_id=story.id))
    await session.flush()
    session.add(EventStory(event_id=e2.id, story_id=story.id))
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_valid_event_and_link_persist(session):
    film, story = await _film_and_story(session)
    event = Event(
        film_id=film.id, event_type="release_date", confidence="rumored", occurred_at=datetime.now(UTC)
    )
    session.add(event)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=story.id))
    await session.commit()  # must not raise
    assert event.created_at is not None
```

- [ ] **Step 2: Run them to verify they fail**

Run: `task test -- tests/integration/news`
Expected: FAIL — `Event` / `EventStory` don't exist.

- [ ] **Step 3: Add the models**

In `src/upmovies/news/models.py`, ensure the SQLAlchemy import line includes everything used (NEU-272 already added `CheckConstraint`/`Float`; add `UniqueConstraint`):

```python
from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Text, UniqueConstraint, text
```

Append these classes at the end of the file:

```python
class Event(Base):
    """A distinct per-film news event (a real beat: casting, trailer, release-date change,
    production milestone, …), grouping the stories that report it. The contract Synthesis
    writes summaries against — no summary column lives here."""

    __tablename__ = "event"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('announced', 'casting', 'production_start', "
            "'production_wrap', 'release_date', 'trailer', 'other')",
            name="ck_event_type",
        ),
        CheckConstraint("confidence IN ('confirmed', 'rumored')", name="ck_event_confidence"),
        Index("ix_event_film_id", "film_id"),
        {"schema": "news"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    film_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("catalog.film.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[str] = mapped_column(Text, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class EventStory(Base):
    """Join row: which stories belong to an event. The unique `story_id` enforces the
    one-event-per-story rule (a story attaches to its single dominant beat)."""

    __tablename__ = "event_story"
    __table_args__ = (
        UniqueConstraint("story_id", name="uq_event_story_story_id"),
        {"schema": "news"},
    )

    event_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("news.event.id", ondelete="CASCADE"), primary_key=True
    )
    story_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("news.story.id", ondelete="CASCADE"), primary_key=True
    )
```

- [ ] **Step 4: Run them to verify they pass**

Run: `task test -- tests/integration/news`
Expected: PASS (4 tests).

---

### Task 2: Migration

**Files:**
- Create: `migrations/versions/<rev>_add_news_event_tables.py`

- [ ] **Step 1: Generate it**

Run: `task makemigration -- "add news event and event_story tables"`

- [ ] **Step 2: Verify the generated file**

Open it. For **new** tables Alembic renders the check + unique constraints inside `create_table` (as it did for `ingest_run`). Confirm the generated `upgrade()` creates `event` (with `ck_event_type`, `ck_event_confidence`, `ix_event_film_id`, the `film_id` FK to `catalog.film`, PK on `id`) and `event_story` (composite PK, `uq_event_story_story_id`, both FKs with `ondelete=CASCADE`), both `schema='news'`. `downgrade()` drops both tables. Add anything Alembic omitted; otherwise leave as generated.

- [ ] **Step 3: Apply + verify single head**

Run: `task migrate`, then `task shell` → `alembic heads` (one head) → exit.
Expected: clean upgrade.

---

## Final verification (before handing off to commit)

- [ ] `task format`
- [ ] `task lint` — clean
- [ ] `task typecheck` — clean
- [ ] `task test` — full suite green
- [ ] Hand off: the user commits (e.g. `feat: add news event + event_story schema`) and opens the PR for NEU-276.

---

## Self-Review

- **Spec coverage:** Matches the spec's `news.event` (id, film_id FK cascade + index, `event_type` check, `confidence` check, `occurred_at`, `created_at`/`updated_at`) and `news.event_story` (composite PK + unique `story_id`), with no summary column. The four tests exercise both check constraints, the one-event-per-story unique, and the happy path.
- **Placeholders:** None.
- **Type consistency:** `event_type`/`confidence` are `Text`/`str`; the taxonomy values in `ck_event_type` match the spec and NEU-277's `_VALID_TYPES`. Constraint names (`ck_event_type`, `ck_event_confidence`, `uq_event_story_story_id`, `ix_event_film_id`) are referenced consistently.
