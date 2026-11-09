# Stop Processing Released Films — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop spending tokens/API calls on released and canceled films by excluding them from the per-film news fetch and the linking roster, while leaving them fully surfaceable via search and direct URL.

**Architecture:** Add one shared, NULL-safe SQLAlchemy predicate — `active_film_clause` — in `catalog/queries.py`, then apply it as a `WHERE` in the two `select(Film...)` query sites that drive ongoing spend: `news/fetcher.py:_film_titles` (Gate 1) and `link/roster.py:build_roster` (Gate 2). Clustering and all read paths are unchanged.

**Tech Stack:** Python 3.12, SQLAlchemy 2 (async), FastAPI, pytest (async, real Postgres via Docker), ruff. Orchestrated with go-task; tests run inside the container.

## Global Constraints

- **Spec:** `docs/superpowers/specs/NEU-286-stop-processing-released-films.md` — the source of truth for behavior and acceptance criteria (A1–A4).
- **Definition of "inactive":** `release_date < today OR status ∈ excluded_statuses`. The active predicate is the negation, with NULL guards (`release_date IS NULL` and `status IS NULL` both count as active).
- **Excluded-status set:** always `settings.tmdb_excluded_statuses` (= `{"Released", "Canceled"}`, `config.py:88`). Never hardcode the set at a call site.
- **`today`:** callers compute `datetime.now(UTC).date()` and pass it into the predicate (keeps the predicate deterministic/testable).
- **Python style:** modern `X | None` unions; no `from __future__ import annotations`; ruff-clean. Run `task format` before any commit (pre-commit hooks delegate into Docker — commit normally, no `--no-verify`; keep the container up).
- **Test commands:** `task test` (full suite in container), `task test:integration`, or a single test via `task test -- <path>::<name> -v`.
- **Commits/PRs:** This plan lists per-task commit steps for completeness. In this project's subagent-driven workflow, implementer subagents do **not** commit — the user consolidates into a single commit/PR at the end. Follow whatever the executing skill/user directs at execution time.

---

### Task 1: `active_film_clause` shared predicate

**Files:**
- Create: `src/upmovies/catalog/queries.py`
- Create: `tests/integration/catalog/__init__.py` (empty — mirrors the package-style test dirs)
- Test: `tests/integration/catalog/test_queries.py`

**Interfaces:**
- Consumes: `Film` from `upmovies.catalog.models`.
- Produces: `active_film_clause(*, today: date, excluded_statuses: frozenset[str]) -> ColumnElement[bool]` — a `WHERE` predicate selecting films still in play.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/catalog/__init__.py` as an empty file, then create `tests/integration/catalog/test_queries.py`:

```python
from datetime import date

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.catalog.queries import active_film_clause

TODAY = date(2026, 7, 2)
EXCLUDED = frozenset({"Released", "Canceled"})


async def test_active_film_clause_keeps_only_in_play_films(session):
    session.add_all(
        [
            # active: future date, non-terminal status
            Film(tmdb_id=1, title="Future Normal", release_date=date(2026, 12, 1), status="Post Production"),
            # inactive: release_date < today (status frozen pre-"Released")
            Film(tmdb_id=2, title="Past Dated", release_date=date(2026, 1, 1), status="Post Production"),
            # inactive: undated but terminal status
            Film(tmdb_id=3, title="Undated Released", release_date=None, status="Released"),
            # active: undated, unknown status
            Film(tmdb_id=4, title="Undated Unknown", release_date=None, status=None),
            # inactive: future date but canceled
            Film(tmdb_id=5, title="Canceled Future", release_date=date(2027, 1, 1), status="Canceled"),
        ]
    )
    await session.commit()

    rows = await session.execute(
        select(Film.title).where(active_film_clause(today=TODAY, excluded_statuses=EXCLUDED))
    )

    assert set(rows.scalars().all()) == {"Future Normal", "Undated Unknown"}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/catalog/test_queries.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.catalog.queries'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/upmovies/catalog/queries.py`:

```python
"""Shared query predicates over `catalog.film`."""

from datetime import date

from sqlalchemy import ColumnElement, and_, or_

from upmovies.catalog.models import Film


def active_film_clause(
    *, today: date, excluded_statuses: frozenset[str]
) -> ColumnElement[bool]:
    """WHERE predicate selecting films still in play (not released/canceled).

    A film is INACTIVE when ``release_date < today`` OR ``status`` is in
    ``excluded_statuses``; this returns the negation. The NULL guards keep undated
    films and films with an unknown status in the active set — without them SQL's
    ``NULL NOT IN (...)`` evaluates to NULL and would wrongly drop those rows.
    """
    return and_(
        or_(Film.release_date.is_(None), Film.release_date >= today),
        or_(Film.status.is_(None), Film.status.not_in(excluded_statuses)),
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/catalog/test_queries.py -v`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
task format
git add src/upmovies/catalog/queries.py tests/integration/catalog/
git commit -m "feat(catalog): add active_film_clause predicate (NEU-286)"
```

---

### Task 2: Gate 1 — exclude inactive films from the per-film news fetch

**Files:**
- Modify: `src/upmovies/news/fetcher.py` (imports + `_film_titles`, around `:123-128`)
- Test: `tests/integration/news/test_fetcher.py` (add one test)

**Interfaces:**
- Consumes: `active_film_clause` (Task 1); `get_settings` from `upmovies.config`.
- Produces: no new public interface — `_film_titles(session_factory)` keeps its signature; it now returns only active films' titles.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/news/test_fetcher.py`. The file already imports `Film` and `from datetime import UTC, datetime, timedelta` — add `date` to that datetime import, and add `from upmovies.news.fetcher import _film_titles` (the file already imports `run_feeds_ingest` from the same module).

```python
async def test_film_titles_excludes_released_and_canceled(session):
    session.add_all(
        [
            Film(tmdb_id=101, title="Active Future", release_date=date(2026, 12, 1), status="Post Production"),
            Film(tmdb_id=102, title="Released Past", release_date=date(2026, 1, 1), status="Released"),
            Film(tmdb_id=103, title="Canceled Later", release_date=date(2027, 1, 1), status="Canceled"),
        ]
    )
    await session.commit()

    titles = await _film_titles(lambda: session)

    assert titles == ["Active Future"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/news/test_fetcher.py::test_film_titles_excludes_released_and_canceled -v`
Expected: FAIL — assertion error: all three titles returned (no filter yet).

- [ ] **Step 3: Implement the gate**

In `src/upmovies/news/fetcher.py`, add these imports next to the existing `from upmovies.catalog.models import Film` line:

```python
from upmovies.catalog.queries import active_film_clause
from upmovies.config import get_settings
```

(`datetime` and `UTC` are already imported at the top of the file.) Replace `_film_titles`:

```python
async def _film_titles(session_factory: SessionFactory) -> list[str]:
    """Lightweight roster read for per-film queries — the deliberate news→catalog
    coupling. Title column only (not link.roster.build_roster's heavier rows).
    Released/canceled films are excluded so we stop searching news for them (NEU-286)."""
    excluded = get_settings().tmdb_excluded_statuses
    today = datetime.now(UTC).date()
    async with _owned_session(session_factory) as s:
        rows = await s.execute(
            select(Film.title)
            .where(active_film_clause(today=today, excluded_statuses=excluded))
            .order_by(Film.title)
        )
        return list(rows.scalars().all())
```

- [ ] **Step 4: Run the new test plus the existing fetcher suite**

Run: `task test -- tests/integration/news/test_fetcher.py -v`
Expected: PASS — the new test passes and no existing fetcher test regresses. (If an existing test seeded a film with a past `release_date` and expected a per-film Google search for it, update that fixture to a future date; note the change in the commit.)

- [ ] **Step 5: Format and commit**

```bash
task format
git add src/upmovies/news/fetcher.py tests/integration/news/test_fetcher.py
git commit -m "feat(news): skip released/canceled films in per-film fetch (NEU-286)"
```

---

### Task 3: Gate 2 — exclude inactive films from the linking roster

**Files:**
- Modify: `src/upmovies/link/roster.py` (imports + `build_roster`, around `:55-56`)
- Test: `tests/integration/link/test_roster.py` (add one test)

**Interfaces:**
- Consumes: `active_film_clause` (Task 1); `get_settings` from `upmovies.config`.
- Produces: no signature change — `build_roster(session)` now omits released/canceled films from `Roster.entries`, so they can no longer be linked to or gain new events.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/link/test_roster.py` (it already imports `from datetime import date`, `Film`, and `build_roster`):

```python
async def test_build_roster_excludes_released_and_canceled_films(session):
    session.add_all(
        [
            Film(tmdb_id=10, title="Active", release_date=date(2026, 12, 1), status="Post Production"),
            Film(tmdb_id=11, title="Released", release_date=date(2026, 1, 1), status="Released"),
            Film(tmdb_id=12, title="Canceled", release_date=date(2027, 1, 1), status="Canceled"),
        ]
    )
    await session.commit()

    roster = await build_roster(session)

    assert [e.title for e in roster.entries] == ["Active"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/link/test_roster.py::test_build_roster_excludes_released_and_canceled_films -v`
Expected: FAIL — assertion error: `["Active", "Canceled", "Released"]` returned (no filter yet).

- [ ] **Step 3: Implement the gate**

In `src/upmovies/link/roster.py`, add imports below the existing `from uuid import UUID`:

```python
from datetime import UTC, datetime
```

and next to `from upmovies.catalog.models import Film, FilmGenre, Genre`:

```python
from upmovies.catalog.queries import active_film_clause
from upmovies.config import get_settings
```

Change the first query in `build_roster` from:

```python
    films = (await session.execute(select(Film).order_by(Film.title))).scalars().all()
```

to:

```python
    excluded = get_settings().tmdb_excluded_statuses
    today = datetime.now(UTC).date()
    films = (
        await session.execute(
            select(Film)
            .where(active_film_clause(today=today, excluded_statuses=excluded))
            .order_by(Film.title)
        )
    ).scalars().all()
```

Leave the genre subquery untouched — it is keyed by `film_id` and only joined against films already in `entries`, so extra rows are harmless.

- [ ] **Step 4: Run the roster suite**

Run: `task test -- tests/integration/link/test_roster.py -v`
Expected: PASS — new test passes; the two existing roster tests (which seed future-dated films with no status) still pass, since a `NULL` status and a future `release_date` are both active.

- [ ] **Step 5: Format and commit**

```bash
task format
git add src/upmovies/link/roster.py tests/integration/link/test_roster.py
git commit -m "feat(link): exclude released/canceled films from linking roster (NEU-286)"
```

---

### Task 4: Full-suite verification + residual-cost check (no code expected)

**Files:** none (verification only — add a follow-up ticket if a gap is found).

- [ ] **Step 1: Run the complete test suite**

Run: `task test`
Expected: PASS — the whole suite is green. If any test outside Tasks 1–3 fails, it almost certainly seeded a past-dated or `Released`/`Canceled` film and relied on it appearing in the fetch/roster; fix that fixture (future date or non-terminal status) rather than weakening the gate.

- [ ] **Step 2: Confirm read paths are untouched (acceptance A3)**

Confirm no change was made to `public/service.py` or `routers/public.py`. A released film with visible events must still be returned by `/films/search` and `/films/{slug}`; `/calendar` still filters `release_date >= today`. These files are not modified by this plan — a quick `git diff --name-only` should list only the six files from Tasks 1–3.

- [ ] **Step 3: Verify no re-link retry loop for released-film stories (spec residual-cost note)**

Read the link pipeline's pending-story selection (`src/upmovies/link/pipeline.py`, the query that picks stories to link) and confirm that a story which the linker fails to match leaves the pending set (e.g. moves to a `rejected`/terminal link-state) rather than being re-selected every run. If it IS re-selected — an unbounded re-link cost independent of this change — do **not** fix it here; file a follow-up ticket and note it, since it predates NEU-286 and is out of this ticket's scope. Record the finding (terminal vs. retried) in the PR description.

---

## Notes for the executor

- The two gates are independent and each ships with its own passing test; Task 1 must land first (both gates import `active_film_clause`).
- No Alembic migration — this is query-only; no schema change.
- No new config keys — the excluded-status set is reused from discovery.
