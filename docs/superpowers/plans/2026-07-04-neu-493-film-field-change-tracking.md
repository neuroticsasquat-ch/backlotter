# NEU-493 — Film field-change tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record when each `catalog.film` column value last changed, so deterministic "how long have we held this value?" checks (release_date now — NEU-494; status/title/runtime later) can be answered without bespoke per-field columns.

**Architecture:** A `BEFORE UPDATE` trigger on `catalog.film` diffs `to_jsonb(OLD)` vs `to_jsonb(NEW)` and appends a row to a new `catalog.film_field_change` history table for every changed column except a volatile denylist. Film writes are blind `INSERT … ON CONFLICT DO UPDATE`, so the trigger (which has `OLD`/`NEW` for free) is the only place that can see the prior value. A `field_changed_at()` helper reads the latest change time. The trigger DDL is installed in prod by an Alembic migration and in the test DB by an `event.listen("after_create")` hook so `create_all` and migrations stay in sync.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async) + asyncpg, PostgreSQL (PL/pgSQL trigger), Alembic, pytest + pytest-asyncio (auto mode).

## Global Constraints

- **Everything runs in Docker via `task`.** Never run `pytest`/`ruff`/`pyright`/`alembic`/`python` on the host. Use `task test`, `task lint`, `task typecheck`, `task format`, `task makemigration`, `task migrate`. The container must be up (`task up`).
- **Type hints:** modern `X | None` / `X | Y`. **No** `from __future__ import annotations`.
- **Lint:** ruff, line length 100; `import x as x` re-export in `__init__.py` to avoid F401.
- **TDD:** write the failing test first; pytest-asyncio is `auto` mode (no `@pytest.mark.asyncio`). Mock HTTP with respx; never hit the live network (N/A here — DB only).
- **Integration-test isolation quirk:** running a *single* integration test file errors with an async-loop warning. Always scope to the **directory**: `task test -- tests/integration/catalog/`.
- **Schema:** `catalog.film` and the new `catalog.film_field_change` live in the `catalog` Postgres schema; all trigger/table SQL is schema-qualified.
- **Commits:** per this project's subagent workflow, **implementer tasks do NOT commit.** Leave the tree dirty; the human commits the whole NEU-493 change once at the end (see Wrap-up) after `task format`. Branch: `tom/neu-493-track-film-column-value-changes-film_field_change-trigger`.

---

### Task 1: `FilmFieldChange` model + `field_changed_at` helper

**Files:**
- Modify: `src/upmovies/catalog/models.py` (add `FilmFieldChange` model; imports already include `BigInteger, DateTime, ForeignKey, Index, Text, text`, `JSONB`, `PGUUID`, `Mapped`, `mapped_column`)
- Modify: `src/upmovies/catalog/queries.py` (add `field_changed_at`)
- Test: `tests/integration/catalog/test_field_change.py` (create)

**Interfaces:**
- Produces:
  - `class FilmFieldChange(Base)` — table `catalog.film_field_change`, columns `id: int` (BigInteger PK, autoincrement), `film_id: UUID` (FK `catalog.film.id`, ondelete CASCADE), `field: str`, `old_value: object | None` (JSONB), `new_value: object | None` (JSONB), `changed_at: datetime` (tz-aware, server_default `now()`).
  - `async def field_changed_at(session: AsyncSession, film_id: UUID, field: str) -> datetime | None` — latest `changed_at` for that `(film_id, field)`, or `None` if there is no change row.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/catalog/test_field_change.py`:

```python
from datetime import UTC, datetime

from sqlalchemy import select

from upmovies.catalog.models import Film, FilmFieldChange
from upmovies.catalog.queries import field_changed_at


async def test_field_changed_at_returns_latest_row(session):
    film = Film(tmdb_id=990001, title="A")
    session.add(film)
    await session.flush()

    t_old = datetime(2026, 1, 1, tzinfo=UTC)
    t_new = datetime(2026, 6, 1, tzinfo=UTC)
    session.add_all(
        [
            FilmFieldChange(
                film_id=film.id, field="release_date",
                old_value=None, new_value="2027-01-01", changed_at=t_old,
            ),
            FilmFieldChange(
                film_id=film.id, field="release_date",
                old_value="2027-01-01", new_value="2027-06-30", changed_at=t_new,
            ),
            FilmFieldChange(
                film_id=film.id, field="title",
                old_value="A", new_value="B", changed_at=t_new,
            ),
        ]
    )
    await session.flush()

    assert await field_changed_at(session, film.id, "release_date") == t_new


async def test_field_changed_at_none_when_absent(session):
    film = Film(tmdb_id=990002, title="A")
    session.add(film)
    await session.flush()

    assert await field_changed_at(session, film.id, "release_date") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `task test -- tests/integration/catalog/test_field_change.py 2>/dev/null || task test -- tests/integration/catalog/`
Expected: FAIL — `ImportError: cannot import name 'FilmFieldChange'` (and `field_changed_at`).

- [ ] **Step 3: Add the `FilmFieldChange` model**

In `src/upmovies/catalog/models.py`, after the `Film` class, add:

```python
class FilmFieldChange(Base):
    """Append-only history of changed `catalog.film` column values, written by the
    `film_field_change_trg` trigger (see the trigger SQL below). Enables deterministic
    "how long have we held this value?" checks without per-field timestamp columns."""

    __tablename__ = "film_field_change"
    __table_args__ = (
        Index("ix_film_field_change_lookup", "film_id", "field", "changed_at"),
        {"schema": "catalog"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    film_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("catalog.film.id", ondelete="CASCADE"),
        nullable=False,
    )
    field: Mapped[str] = mapped_column(Text, nullable=False)
    old_value: Mapped[object | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[object | None] = mapped_column(JSONB, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
```

- [ ] **Step 4: Add the `field_changed_at` helper**

In `src/upmovies/catalog/queries.py`, add the import and function (keep the existing `from datetime import date` — extend it):

```python
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.catalog.models import Film, FilmFieldChange


async def field_changed_at(
    session: AsyncSession, film_id: UUID, field: str
) -> datetime | None:
    """The most recent time `field` changed on this film, or None if it has never
    changed since insert (the trigger is UPDATE-only). Callers treat None as
    'known since at least `film.created_at`'."""
    stmt = (
        select(FilmFieldChange.changed_at)
        .where(FilmFieldChange.film_id == film_id, FilmFieldChange.field == field)
        .order_by(FilmFieldChange.changed_at.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()
```

(The existing `active_film_clause` stays; only add the imports and the new function.)

- [ ] **Step 5: Run test to verify it passes**

Run: `task test -- tests/integration/catalog/`
Expected: PASS (both `test_field_change.py` tests; existing catalog tests still green).

- [ ] **Step 6: Lint + typecheck**

Run: `task format && task lint && task typecheck`
Expected: no errors.

---

### Task 2: `film_field_change` trigger + test-DB registration

**Files:**
- Modify: `src/upmovies/catalog/models.py` (add denylist constant, install/drop SQL constants, `event.listen` registration; extend the `sqlalchemy` import with `DDL`, `event`)
- Test: `tests/integration/catalog/test_field_change.py` (append trigger tests)

**Interfaces:**
- Consumes: `FilmFieldChange` (Task 1), `Film`.
- Produces (module-level in `catalog/models.py`, imported by the Task 3 migration):
  - `FILM_FIELD_CHANGE_DENYLIST: tuple[str, ...]`
  - `INSTALL_FILM_FIELD_CHANGE_TRIGGER: str` — idempotent `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`.
  - `DROP_FILM_FIELD_CHANGE_TRIGGER: str` — drops trigger then function.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/catalog/test_field_change.py`:

```python
async def test_tracked_column_update_logs_one_row(session):
    film = Film(tmdb_id=990010, title="Original")
    session.add(film)
    await session.flush()  # INSERT does not fire a BEFORE UPDATE trigger

    film.title = "Renamed"
    await session.flush()

    rows = (
        await session.execute(
            select(FilmFieldChange).where(FilmFieldChange.film_id == film.id)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].field == "title"
    assert rows[0].old_value == "Original"
    assert rows[0].new_value == "Renamed"


async def test_denylisted_column_update_logs_nothing(session):
    film = Film(tmdb_id=990011, title="X", popularity=1.0)
    session.add(film)
    await session.flush()

    film.popularity = 99.0
    await session.flush()

    rows = (
        await session.execute(
            select(FilmFieldChange).where(FilmFieldChange.film_id == film.id)
        )
    ).scalars().all()
    assert rows == []


async def test_field_changed_at_reflects_a_real_update(session):
    film = Film(tmdb_id=990012, title="A")
    session.add(film)
    await session.flush()
    assert await field_changed_at(session, film.id, "title") is None

    film.title = "B"
    await session.flush()
    assert await field_changed_at(session, film.id, "title") is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/integration/catalog/`
Expected: FAIL — `test_tracked_column_update_logs_one_row` gets 0 rows (no trigger yet); `test_field_changed_at_reflects_a_real_update` stays `None` after the update.

- [ ] **Step 3: Add the trigger SQL + registration**

In `src/upmovies/catalog/models.py`, extend the top-level `sqlalchemy` import to include `DDL` and `event`:

```python
from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    DDL,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    event,
    text,
)
```

Then, at the **bottom** of the file (after `FilmFieldChange` is defined), add:

```python
# --- Film column-change history trigger -------------------------------------
# Volatile columns TMDB churns on nearly every ingest — excluded so the history
# table records only semantic changes (release_date, status, title, runtime, ...).
FILM_FIELD_CHANGE_DENYLIST: tuple[str, ...] = (
    "popularity",
    "vote_average",
    "vote_count",
    "revenue",
    "tmdb_raw",
    "updated_at",
)


def _denylist_sql_array(cols: tuple[str, ...]) -> str:
    return "ARRAY[" + ", ".join(f"'{c}'" for c in cols) + "]::text[]"


INSTALL_FILM_FIELD_CHANGE_TRIGGER: str = f"""
CREATE OR REPLACE FUNCTION catalog.log_film_field_change() RETURNS trigger AS $$
DECLARE
    o jsonb := to_jsonb(OLD);
    n jsonb := to_jsonb(NEW);
    k text;
BEGIN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
        IF k = ANY({_denylist_sql_array(FILM_FIELD_CHANGE_DENYLIST)}) THEN
            CONTINUE;
        END IF;
        IF o -> k IS DISTINCT FROM n -> k THEN
            INSERT INTO catalog.film_field_change (film_id, field, old_value, new_value)
            VALUES (NEW.id, k, o -> k, n -> k);
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS film_field_change_trg ON catalog.film;
CREATE TRIGGER film_field_change_trg
    BEFORE UPDATE ON catalog.film
    FOR EACH ROW EXECUTE FUNCTION catalog.log_film_field_change();
"""

DROP_FILM_FIELD_CHANGE_TRIGGER: str = """
DROP TRIGGER IF EXISTS film_field_change_trg ON catalog.film;
DROP FUNCTION IF EXISTS catalog.log_film_field_change();
"""

# Install under create_all (test DB). Prod installs the same SQL via the Alembic
# migration's op.execute. before_drop keeps metadata.drop_all symmetric.
event.listen(Film.__table__, "after_create", DDL(INSTALL_FILM_FIELD_CHANGE_TRIGGER))
event.listen(Film.__table__, "before_drop", DDL(DROP_FILM_FIELD_CHANGE_TRIGGER))
```

Notes for the implementer:
- The PL/pgSQL body is **not** validated against `catalog.film_field_change` at `CREATE FUNCTION` time (plpgsql resolves tables at first execution), so the `after_create`-on-`film` ordering is safe even though `film_field_change` is created just afterward.
- The SQL contains no `%` characters, so `DDL`'s printf handling is a no-op — do not add `%%`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `task test -- tests/integration/catalog/`
Expected: PASS (all five tests in `test_field_change.py`).

- [ ] **Step 5: Run the whole suite (trigger must not disturb existing film UPDATEs)**

Run: `task test`
Expected: PASS — no regressions in ingest/upsert or other catalog tests now that `catalog.film` carries a trigger.

- [ ] **Step 6: Lint + typecheck**

Run: `task format && task lint && task typecheck`
Expected: no errors.

---

### Task 3: Alembic migration (table + trigger)

**Files:**
- Create: `migrations/versions/<autogen>_add_film_field_change_table_and_trigger.py`

**Interfaces:**
- Consumes: `INSTALL_FILM_FIELD_CHANGE_TRIGGER`, `DROP_FILM_FIELD_CHANGE_TRIGGER` (Task 2).

- [ ] **Step 1: Autogenerate the table migration**

Run: `task makemigration -- "add film_field_change table and trigger"`
Expected: a new file under `migrations/versions/` whose `upgrade()` calls `op.create_table('film_field_change', ..., schema='catalog')` and `op.create_index('ix_film_field_change_lookup', ...)`. (Alembic does **not** autogenerate the trigger — you add it by hand next.)

- [ ] **Step 2: Add the trigger install/drop to the migration**

Edit the generated file. At the top, import the SQL constants:

```python
from upmovies.catalog.models import (
    DROP_FILM_FIELD_CHANGE_TRIGGER,
    INSTALL_FILM_FIELD_CHANGE_TRIGGER,
)
```

In `upgrade()`, **after** the autogenerated `op.create_table`/`op.create_index` lines, add:

```python
    op.execute(INSTALL_FILM_FIELD_CHANGE_TRIGGER)
```

In `downgrade()`, **before** the autogenerated `op.drop_*` lines, add:

```python
    op.execute(DROP_FILM_FIELD_CHANGE_TRIGGER)
```

(The migration imports the app constant so test and prod install byte-identical SQL. A future change to the trigger ships as a new migration that re-runs `CREATE OR REPLACE` — acceptable at this project's scale.)

- [ ] **Step 3: Apply the migration**

Run: `task migrate`
Expected: `Running upgrade … -> <rev>, add film_field_change table and trigger` with no error.

- [ ] **Step 4: Confirm a single head**

Run: `task shell` then, inside the container, `alembic heads` (exit with `exit`).
Expected: exactly one head revision (the new one). No divergent heads.

- [ ] **Step 5: Round-trip the downgrade (verify `downgrade()` is correct), then re-apply**

Run inside `task shell`: `alembic downgrade -1` then `alembic upgrade head`.
Expected: both succeed — the table, index, trigger, and function drop and recreate cleanly.

---

## Wrap-up (human, once)

The implementer tasks leave the tree dirty and uncommitted by design. To ship NEU-493 as its single PR:

- [ ] Confirm full local CI is green (matches the backend CI gate):
  Run: `task format && task lint && task typecheck && task test`, and confirm `alembic heads` shows one head.
- [ ] Commit on the ticket branch (`tom/neu-493-track-film-column-value-changes-film_field_change-trigger`) with a Conventional Commits message (via `/commit-msg`), e.g. `feat(catalog): track film column changes via film_field_change trigger`. No Linear ID in the subject, no footer, no `Co-Authored-By`. Pre-commit hooks delegate into Docker — commit normally (no `--no-verify`).
- [ ] Open the PR with `/pr-desc`; title `feat(catalog): track film column changes via film_field_change trigger (NEU-493)`; include the `🤖 Generated with Claude Code` footer in the PR body only.

## Self-review notes (coverage vs. NEU-493 / spec Part B)

- **B1 history table** → Task 1 (`FilmFieldChange`).
- **B2 generic trigger + volatile denylist** → Task 2 (`INSTALL_FILM_FIELD_CHANGE_TRIGGER`, `FILM_FIELD_CHANGE_DENYLIST`).
- **B3 test-harness parity (`event.listen("after_create")`)** → Task 2 registration + the trigger tests running under `create_all`.
- **B4 `field_changed_at` helper + `created_at` baseline** → Task 1 helper; `None`-return semantics tested; baseline consumed by NEU-494 (out of scope here).
- **Migration (prod install)** → Task 3.
- **NEU-494 dependency** is satisfied by the `field_changed_at` + `FILM_FIELD_CHANGE_DENYLIST` interface exported here.
