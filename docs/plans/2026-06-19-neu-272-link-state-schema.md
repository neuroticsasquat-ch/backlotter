# NEU-272: Link-state schema + `link` ingest kind + migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the entity-linking state columns to `news.story` and register the new `link` pipeline kind on `ingest.ingest_run`, with an Alembic migration.

**Architecture:** Pure schema change. Add four columns + an index + a check constraint to the `Story` model, widen the `IngestRun.kind` check constraint, then generate and hand-correct one additive migration. Tests build the schema from the models via `create_all`, so they go green on the model edit alone; the migration is for prod and is verified with `task migrate`.

**Tech Stack:** SQLAlchemy 2 (async, declarative), Alembic, Postgres, pytest (asyncio auto mode).

**Repo:** `upcoming-movies-backend` · **Branch:** `tom/neu-272-be-link-state-schema-link-ingest-kind-migration` · **Spec:** `docs/specs/2026-06-19-entity-linking-clustering-design.md`

> **Commit/PR convention (this project):** Do **not** scatter per-step commits. Implement the whole ticket, run the full check suite, then the user commits once (Conventional Commits subject, no Linear ID in subject, no co-author/footer) and opens the PR. All commands run in the container via `task` (never run `pytest`/`alembic` on the host). Keep the container up.

---

## File Structure

- **Modify** `src/upmovies/news/models.py` — add `link_status`, `link_confidence`, `linked_at`, `link_note` to `Story`; add `ix_story_link_status` index and `ck_story_link_status` check constraint.
- **Modify** `src/upmovies/ingest/models.py` — widen `ck_ingest_run_kind` to include `link`.
- **Create** `tests/integration/test_link_state_schema.py` — schema behavior tests.
- **Create** `migrations/versions/<rev>_add_story_link_state_and_link_kind.py` — generated, then hand-corrected.

---

### Task 1: Story link-state columns + ingest kind (model + tests)

**Files:**
- Modify: `src/upmovies/news/models.py`
- Modify: `src/upmovies/ingest/models.py`
- Test: `tests/integration/test_link_state_schema.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/test_link_state_schema.py`:

```python
import pytest
from sqlalchemy.exc import IntegrityError

from upmovies.ingest.models import IngestRun
from upmovies.news.models import Story


async def test_story_link_state_defaults(session):
    story = Story(source="Deadline", url="https://example.com/a", title="A")
    session.add(story)
    await session.commit()
    await session.refresh(story)
    assert story.link_status == "pending"
    assert story.link_confidence is None
    assert story.linked_at is None
    assert story.link_note is None


async def test_story_link_status_rejects_invalid_value(session):
    story = Story(
        source="Deadline", url="https://example.com/b", title="B", link_status="bogus"
    )
    session.add(story)
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_ingest_run_accepts_link_kind(session):
    run = IngestRun(kind="link", status="running")
    session.add(run)
    await session.commit()
    await session.refresh(run)
    assert run.kind == "link"


async def test_ingest_run_rejects_unknown_kind(session):
    run = IngestRun(kind="bogus", status="running")
    session.add(run)
    with pytest.raises(IntegrityError):
        await session.commit()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration -k "link_state or link_kind or accepts_link or link_status"`

(Scoping to the `tests/integration` **directory** avoids the known single-file asyncio loop-scope quirk.)

Expected: FAIL — `Story` has no attribute `link_status` (and the `kind='link'` row would violate the current check constraint).

- [ ] **Step 3: Add the columns + constraint + index to `Story`**

In `src/upmovies/news/models.py`, widen the imports and add the columns. Change the import line:

```python
from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Text, text
```

Replace the `__table_args__` block with:

```python
    __table_args__ = (
        Index("ix_story_film_id", "film_id"),
        Index("ix_story_link_status", "link_status"),
        CheckConstraint(
            "link_status IN ('pending', 'linked', 'rejected')",
            name="ck_story_link_status",
        ),
        {"schema": "news"},
    )
```

Add these columns immediately after the existing `film_id` column:

```python
    link_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'pending'")
    )
    link_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    link_note: Mapped[str | None] = mapped_column(Text, nullable=True)
```

(`datetime` is already imported at the top of the file.)

- [ ] **Step 4: Widen the ingest kind check constraint**

In `src/upmovies/ingest/models.py`, change the `kind` check constraint:

```python
        CheckConstraint("kind IN ('tmdb', 'feeds', 'link')", name="ck_ingest_run_kind"),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/integration -k "link_state or link_kind or accepts_link or link_status"`
Expected: PASS (4 tests).

---

### Task 2: Alembic migration

**Files:**
- Create: `migrations/versions/<rev>_add_story_link_state_and_link_kind.py`

- [ ] **Step 1: Generate the migration**

Run: `task makemigration -- "add story link state and link ingest kind"`

This autogenerates the four `add_column`s and the `ix_story_link_status` index. Alembic does **not** autogenerate CheckConstraint changes, so they must be added by hand.

- [ ] **Step 2: Hand-correct the migration body**

Open the generated file. Keep the generated `revision` / `down_revision` (down_revision should be the current head `26f140c4f334`). Make `upgrade()` / `downgrade()` read exactly:

```python
def upgrade() -> None:
    op.add_column(
        "story",
        sa.Column("link_status", sa.Text(), server_default=sa.text("'pending'"), nullable=False),
        schema="news",
    )
    op.add_column("story", sa.Column("link_confidence", sa.Float(), nullable=True), schema="news")
    op.add_column(
        "story", sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True), schema="news"
    )
    op.add_column("story", sa.Column("link_note", sa.Text(), nullable=True), schema="news")
    op.create_index("ix_story_link_status", "story", ["link_status"], schema="news")
    op.create_check_constraint(
        "ck_story_link_status",
        "story",
        "link_status IN ('pending', 'linked', 'rejected')",
        schema="news",
    )
    # Alembic doesn't diff CheckConstraints — swap the ingest kind constraint by hand.
    op.drop_constraint("ck_ingest_run_kind", "ingest_run", type_="check", schema="ingest")
    op.create_check_constraint(
        "ck_ingest_run_kind",
        "ingest_run",
        "kind IN ('tmdb', 'feeds', 'link')",
        schema="ingest",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ingest_run_kind", "ingest_run", type_="check", schema="ingest")
    op.create_check_constraint(
        "ck_ingest_run_kind",
        "ingest_run",
        "kind IN ('tmdb', 'feeds')",
        schema="ingest",
    )
    op.drop_constraint("ck_story_link_status", "story", type_="check", schema="news")
    op.drop_index("ix_story_link_status", table_name="story", schema="news")
    op.drop_column("story", "link_note", schema="news")
    op.drop_column("story", "linked_at", schema="news")
    op.drop_column("story", "link_confidence", schema="news")
    op.drop_column("story", "link_status", schema="news")
```

- [ ] **Step 3: Apply it to the dev DB**

Run: `task migrate`
Expected: upgrades to head with no error. The existing 620 `news.story` rows backfill `link_status = 'pending'` via the server default.

- [ ] **Step 4: Verify a single Alembic head**

Run: `task shell` then `alembic heads` (exit the shell after).
Expected: exactly one head (the new revision). 

---

## Final verification (before handing off to commit)

- [ ] `task format` (ruff reformats src + tests)
- [ ] `task lint` — clean
- [ ] `task typecheck` — clean
- [ ] `task test` — full suite green
- [ ] Hand off: the user commits (e.g. `feat: add story link state + link ingest kind`) and opens the PR for NEU-272.

---

## Self-Review

- **Spec coverage:** Covers the NEU-272 scope exactly — `link_status`/`link_confidence`/`linked_at`/`link_note` (with default + check), `ix_story_link_status`, the widened `ck_ingest_run_kind`, and the migration. Matches the spec's "Schema (`news`) → `news.story` — extended (link state)" table and the `link` ingest kind.
- **Placeholders:** None — all code and commands are concrete.
- **Type consistency:** `link_status` (Text/str, default `'pending'`), `link_confidence` (Float/`float | None`), `linked_at` (DateTime tz/`datetime | None`), `link_note` (Text/`str | None`) are identical across the model, the migration, and the tests. Constraint names (`ck_story_link_status`, `ck_ingest_run_kind`, `ix_story_link_status`) match between model and migration.
