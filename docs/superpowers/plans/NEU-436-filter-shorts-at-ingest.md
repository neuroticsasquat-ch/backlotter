# Filter Shorts at Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip short films at TMDB ingest time so they never enter `catalog.film` (and never reach the linking/clustering/synthesis pipeline).

**Architecture:** Add one config threshold (`TMDB_MIN_RUNTIME`, default 60). Introduce a pure `classify_skip()` function that returns a skip reason (`"short"` / `"excluded_status"`) or `None`, folding in the existing status skip. Call it in the `run_tmdb_ingest` loop before `upsert_film`, and track skips per reason in a `Counter` surfaced in the run summary.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 (async), Pydantic v2 / pydantic-settings, httpx, pytest + pytest-asyncio (auto mode) + respx.

**Spec:** `docs/superpowers/specs/NEU-436-filter-shorts-at-ingest.md`

## Global Constraints

- **Everything runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python` on the host. Use `task test` (scope with `task test -- tests/...`), `task lint`, `task typecheck`, `task format`.
- **Definition of done for every task:** `task format` then `task test`, `task lint`, `task typecheck` all green.
- **Type hints:** modern `X | None` / `X | Y`. **No** `from __future__ import annotations`.
- **ruff:** line length 100; rules E,F,W,I,B,UP. Use `import x as x` re-export in `__init__.py` to avoid F401.
- **Tests:** TDD (failing test first). pytest-asyncio is `auto` mode — no `@pytest.mark.asyncio`. Mock HTTP with **respx**; never hit the network. Integration tests use the `session` fixture; re-read rows with `execution_options={"populate_existing": True}`.
- **No DB schema change** — this ticket adds no columns/tables, so **no Alembic migration**.
- **Commits:** Conventional Commits subject (`feat:`, `refactor:`, …); **no** Linear ID in the subject (optional `Refs NEU-436.` in the body); **no** `🤖 Generated with Claude Code` footer in commits; **no** `Co-Authored-By`.
- **Single integration test file run in isolation** errors with a known pytest-asyncio loop quirk — scope to the directory (`task test -- tests/integration/ingest/tmdb/`) or run the whole suite, not a lone file.

## File Structure

- **Modify** `src/upmovies/config.py` — add `tmdb_min_runtime` setting.
- **Create** `src/upmovies/ingest/tmdb/filters.py` — pure `classify_skip()`.
- **Modify** `src/upmovies/ingest/tmdb/service.py` — `IngestResult` gains `skipped_by_reason`; `run_tmdb_ingest` gains `min_runtime`; loop calls `classify_skip`; per-reason `Counter`; run-summary detail.
- **Modify** `src/upmovies/routers/ingest_admin.py` — pass `min_runtime=settings.tmdb_min_runtime` at the call site.
- **Tests:** `tests/unit/test_config.py`, `tests/unit/ingest/tmdb/test_filters.py` (new), `tests/integration/ingest/tmdb/test_service.py`.

---

### Task 1: Config — `TMDB_MIN_RUNTIME`

**Files:**
- Modify: `src/upmovies/config.py`
- Test: `tests/unit/test_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Settings.tmdb_min_runtime: int` (default `60`, env alias `TMDB_MIN_RUNTIME`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/test_config.py` (the `_set_required` helper already exists in the file):

```python
def test_settings_min_runtime_default(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.delenv("TMDB_MIN_RUNTIME", raising=False)
    s = Settings()  # type: ignore[call-arg]
    assert s.tmdb_min_runtime == 60


def test_settings_min_runtime_override_from_env(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.setenv("TMDB_MIN_RUNTIME", "0")
    s = Settings()  # type: ignore[call-arg]
    assert s.tmdb_min_runtime == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/test_config.py -k min_runtime`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'tmdb_min_runtime'`.

- [ ] **Step 3: Add the setting**

In `src/upmovies/config.py`, add this line immediately after the `tmdb_min_popularity` field (keep it with the other discover settings):

```python
    tmdb_min_runtime: int = Field(default=60, alias="TMDB_MIN_RUNTIME")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `task test -- tests/unit/test_config.py -k min_runtime`
Expected: PASS (2 passed).

- [ ] **Step 5: Format, lint, typecheck**

Run: `task format && task lint && task typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/config.py tests/unit/test_config.py
git commit -m "feat: add TMDB_MIN_RUNTIME setting for shorts filter

Refs NEU-436."
```

---

### Task 2: Pure skip classifier — `classify_skip`

**Files:**
- Create: `src/upmovies/ingest/tmdb/filters.py`
- Test: `tests/unit/ingest/tmdb/test_filters.py` (new; the package `tests/unit/ingest/tmdb/__init__.py` already exists)

**Interfaces:**
- Consumes: `TMDBMovieDetails` from `upmovies.ingest.tmdb.schemas` (key fields: `status: str | None`, `runtime: int | None`).
- Produces:
  ```python
  def classify_skip(
      details: TMDBMovieDetails,
      *,
      excluded_statuses: frozenset[str],
      min_runtime: int,
  ) -> str | None: ...
  ```
  Returns `"excluded_status"`, `"short"`, or `None` (keep). Status check takes precedence over the runtime check.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ingest/tmdb/test_filters.py`:

```python
import pytest

from upmovies.ingest.tmdb.filters import classify_skip
from upmovies.ingest.tmdb.schemas import TMDBMovieDetails


def _details(**overrides) -> TMDBMovieDetails:
    base = {"id": 1, "title": "X", "status": "Planned", "runtime": 120}
    base.update(overrides)
    return TMDBMovieDetails(**base)


@pytest.mark.parametrize(
    ("runtime", "min_runtime", "expected"),
    [
        (7, 60, "short"),     # well under the floor
        (59, 60, "short"),    # just under the floor
        (60, 60, None),       # boundary is kept (strict <)
        (0, 60, None),        # 0 = unfinished, kept
        (None, 60, None),     # unknown runtime, kept
        (7, 0, None),         # min_runtime=0 disables the rule
        (200, 60, None),      # long feature, kept
    ],
)
def test_classify_skip_runtime_rule(runtime, min_runtime, expected):
    details = _details(runtime=runtime, status="Planned")
    assert (
        classify_skip(details, excluded_statuses=frozenset(), min_runtime=min_runtime)
        == expected
    )


def test_excluded_status_is_skipped():
    details = _details(runtime=120, status="Released")
    result = classify_skip(
        details, excluded_statuses=frozenset({"Released", "Canceled"}), min_runtime=60
    )
    assert result == "excluded_status"


def test_excluded_status_takes_precedence_over_short():
    # A short that is ALSO an excluded status reports the status reason first.
    details = _details(runtime=7, status="Canceled")
    result = classify_skip(
        details, excluded_statuses=frozenset({"Canceled"}), min_runtime=60
    )
    assert result == "excluded_status"


def test_normal_film_is_kept():
    details = _details(runtime=120, status="Planned")
    assert classify_skip(details, excluded_statuses=frozenset(), min_runtime=60) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/ingest/tmdb/test_filters.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.ingest.tmdb.filters'`.

- [ ] **Step 3: Implement the classifier**

Create `src/upmovies/ingest/tmdb/filters.py`:

```python
"""Pure ingest-time skip rules for TMDB films. Kept free of DB/HTTP so the policy is
unit-testable in isolation and lives in one place."""

from upmovies.ingest.tmdb.schemas import TMDBMovieDetails


def classify_skip(
    details: TMDBMovieDetails,
    *,
    excluded_statuses: frozenset[str],
    min_runtime: int,
) -> str | None:
    """Return a reason this film should NOT be ingested, or None to keep it.

    Reasons:
      - "excluded_status": status is in the excluded set (e.g. Released, Canceled).
      - "short": a KNOWN runtime below min_runtime. A runtime of 0 or None means
        unknown/unfinished and is kept. min_runtime=0 disables the rule.

    The status check takes precedence over the runtime check.
    """
    if details.status in excluded_statuses:
        return "excluded_status"
    if details.runtime is not None and 0 < details.runtime < min_runtime:
        return "short"
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `task test -- tests/unit/ingest/tmdb/test_filters.py`
Expected: PASS (all parametrized cases + the named tests).

- [ ] **Step 5: Format, lint, typecheck**

Run: `task format && task lint && task typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/ingest/tmdb/filters.py tests/unit/ingest/tmdb/test_filters.py
git commit -m "feat: add classify_skip ingest filter for shorts

Refs NEU-436."
```

---

### Task 3: Wire the filter into `run_tmdb_ingest` + the call site

**Files:**
- Modify: `src/upmovies/ingest/tmdb/service.py`
- Modify: `src/upmovies/routers/ingest_admin.py:51-60`
- Test: `tests/integration/ingest/tmdb/test_service.py`

**Interfaces:**
- Consumes: `classify_skip(...)` (Task 2); `Settings.tmdb_min_runtime` (Task 1).
- Produces:
  - `run_tmdb_ingest(..., min_runtime: int = 0)` — new keyword param (default `0` = shorts rule disabled, preserving existing callers/tests).
  - `IngestResult` gains `skipped_by_reason: dict[str, int]` (default empty); `films_skipped` remains the total.

- [ ] **Step 1: Write the failing tests**

In `tests/integration/ingest/tmdb/test_service.py`, update the `_run` helper to forward `min_runtime` (add the param with a default of `0` so every existing test keeps the shorts rule off):

```python
async def _run(
    session,
    *,
    min_popularity: float = 10.0,
    failure_threshold: int = 10,
    excluded_statuses: frozenset[str] = frozenset(),
    min_runtime: int = 0,
):
    run_id = await create_run(session, kind="tmdb")
    await session.commit()
    async with _client() as c:
        result = await run_tmdb_ingest(
            session_factory=lambda: session,
            client=c,
            run_id=run_id,
            release_date_gte=GTE,
            release_date_lte=LTE,
            min_popularity=min_popularity,
            failure_threshold=failure_threshold,
            excluded_statuses=excluded_statuses,
            min_runtime=min_runtime,
        )
    return run_id, result
```

Then add these tests at the end of the file:

```python
@respx.mock
async def test_ingest_skips_shorts(session):
    _discover(page="1").mock(
        return_value=httpx.Response(
            200,
            json=make_discover_page(
                page=1, total_pages=1, results=[make_summary(1), make_summary(2)]
            ),
        )
    )
    _details(1).mock(
        return_value=httpx.Response(200, json=make_details(1, runtime=7, status="Planned"))
    )
    _details(2).mock(
        return_value=httpx.Response(200, json=make_details(2, runtime=120, status="Planned"))
    )

    _, result = await _run(session, min_runtime=60)

    assert result.films_processed == 1
    assert result.films_skipped == 1
    assert result.skipped_by_reason == {"short": 1}
    assert {f.tmdb_id for f in await _films(session)} == {2}


@respx.mock
async def test_ingest_keeps_unknown_runtime(session):
    # runtime 0 == unfinished/unknown, must be kept even with the shorts rule on.
    _discover(page="1").mock(
        return_value=httpx.Response(
            200, json=make_discover_page(page=1, total_pages=1, results=[make_summary(1)])
        )
    )
    _details(1).mock(
        return_value=httpx.Response(200, json=make_details(1, runtime=0, status="Planned"))
    )

    _, result = await _run(session, min_runtime=60)

    assert result.films_processed == 1
    assert result.films_skipped == 0
    assert {f.tmdb_id for f in await _films(session)} == {1}


@respx.mock
async def test_ingest_reports_skip_reasons_breakdown(session):
    _discover(page="1").mock(
        return_value=httpx.Response(
            200,
            json=make_discover_page(
                page=1, total_pages=1, results=[make_summary(1), make_summary(2), make_summary(3)]
            ),
        )
    )
    _details(1).mock(
        return_value=httpx.Response(200, json=make_details(1, runtime=7, status="Planned"))
    )
    _details(2).mock(
        return_value=httpx.Response(200, json=make_details(2, runtime=120, status="Released"))
    )
    _details(3).mock(
        return_value=httpx.Response(200, json=make_details(3, runtime=120, status="Planned"))
    )

    _, result = await _run(
        session, min_runtime=60, excluded_statuses=frozenset({"Released"})
    )

    assert result.films_processed == 1
    assert result.skipped_by_reason == {"short": 1, "excluded_status": 1}
    assert {f.tmdb_id for f in await _films(session)} == {3}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/integration/ingest/tmdb/`
Expected: FAIL — `run_tmdb_ingest() got an unexpected keyword argument 'min_runtime'` (and `AttributeError: ... 'skipped_by_reason'`).

- [ ] **Step 3: Update `IngestResult` and imports in `service.py`**

At the top of `src/upmovies/ingest/tmdb/service.py`, add the imports:

```python
from collections import Counter
from dataclasses import dataclass, field
```

(Remove the existing bare `from dataclasses import dataclass` line — replace it with the line above so `field` is imported once.)

Then add the `classify_skip` import alongside the other tmdb imports:

```python
from upmovies.ingest.tmdb.filters import classify_skip
```

Replace the `IngestResult` dataclass with:

```python
@dataclass
class IngestResult:
    films_processed: int
    films_failed: int
    films_skipped: int = 0
    skipped_by_reason: dict[str, int] = field(default_factory=dict)
```

- [ ] **Step 4: Add the `min_runtime` param and the skip-detail helper**

In `run_tmdb_ingest`'s signature, add `min_runtime: int = 0,` immediately after the `excluded_statuses` parameter:

```python
    excluded_statuses: frozenset[str] = frozenset(),
    min_runtime: int = 0,
) -> IngestResult:
```

Add this module-level helper (e.g. just above `run_tmdb_ingest`):

```python
def _format_skip_detail(skip_counts: Counter[str]) -> str:
    total = sum(skip_counts.values())
    if not skip_counts:
        return f"skipped {total}"
    breakdown = ", ".join(f"{reason}={n}" for reason, n in sorted(skip_counts.items()))
    return f"skipped {total} ({breakdown})"
```

- [ ] **Step 5: Replace the counter + status check in the loop**

Change the counter initialization from:

```python
    processed = 0
    failed = 0
    skipped = 0
    consecutive_failures = 0
```

to:

```python
    processed = 0
    failed = 0
    skip_counts: Counter[str] = Counter()
    consecutive_failures = 0
```

Replace the inline status check:

```python
            details = await client.movie_details(tmdb_id)
            if details.status in excluded_statuses:
                skipped += 1
                consecutive_failures = 0
                continue
```

with the classifier call:

```python
            details = await client.movie_details(tmdb_id)
            reason = classify_skip(
                details, excluded_statuses=excluded_statuses, min_runtime=min_runtime
            )
            if reason is not None:
                skip_counts[reason] += 1
                consecutive_failures = 0
                continue
```

- [ ] **Step 6: Update both return paths and the success detail**

The early-abort return (inside the consecutive-failures branch) changes from:

```python
            return IngestResult(processed, failed, skipped)
```

to:

```python
            return IngestResult(
                processed, failed, sum(skip_counts.values()), dict(skip_counts)
            )
```

The success `finalize_run` detail changes from:

```python
            detail=f"upserted {processed}, skipped {skipped} (excluded status)",
```

to:

```python
            detail=f"upserted {processed}, {_format_skip_detail(skip_counts)}",
```

And the final return changes from:

```python
    return IngestResult(processed, failed, skipped)
```

to:

```python
    return IngestResult(processed, failed, sum(skip_counts.values()), dict(skip_counts))
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `task test -- tests/integration/ingest/tmdb/`
Expected: PASS — the new shorts/unknown/breakdown tests pass, and the existing `test_ingest_skips_excluded_statuses` / `test_ingest_skip_resets_consecutive_failure_counter` still pass (their `films_skipped` totals are unchanged).

- [ ] **Step 8: Wire the call site**

In `src/upmovies/routers/ingest_admin.py`, in `_background_tmdb`, add the new kwarg to the `run_tmdb_ingest(...)` call (immediately after `excluded_statuses=settings.tmdb_excluded_statuses,`):

```python
                excluded_statuses=settings.tmdb_excluded_statuses,
                min_runtime=settings.tmdb_min_runtime,
```

- [ ] **Step 9: Run the full suite + lint + typecheck**

Run: `task format && task test && task lint && task typecheck`
Expected: all green (full suite, since this touches the shared service).

- [ ] **Step 10: Commit**

```bash
git add src/upmovies/ingest/tmdb/service.py src/upmovies/routers/ingest_admin.py tests/integration/ingest/tmdb/test_service.py
git commit -m "feat: skip shorts during TMDB ingest

Apply classify_skip in run_tmdb_ingest before upsert, track skip
reasons per category, and surface the breakdown in the run summary.

Refs NEU-436."
```

---

## Self-Review

**Spec coverage:**
- Pure `classify_skip` classifier folding in status skip → Task 2. ✅
- Shorts rule `0 < runtime < min` with 0/None kept, boundary kept → Task 2 (unit matrix) + Task 3 (integration). ✅
- `TMDB_MIN_RUNTIME` config default 60, 0 disables → Task 1. ✅
- `run_tmdb_ingest` gains `min_runtime`, loop integration before upsert → Task 3. ✅
- Per-reason skip counter + `IngestResult.skipped_by_reason` + run-summary breakdown → Task 3. ✅
- Call-site wiring in `ingest_admin.py` → Task 3, Step 8. ✅
- Existing status skip + popularity floor unchanged → preserved (status folded into classifier; popularity untouched). ✅
- Acceptance criteria 1–7 all map to the tasks above. ✅
- Out-of-scope items (no re-release rule, no blocklist, no query-time filters, no backfill) → nothing in the plan adds them. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output. ✅

**Type consistency:** `classify_skip(details, *, excluded_statuses, min_runtime) -> str | None` is defined once (Task 2) and called identically (Task 3, Step 5). `IngestResult.skipped_by_reason: dict[str, int]` defined (Task 3, Step 3) and asserted (Task 3, Step 1). `min_runtime: int` default `0` consistent across `run_tmdb_ingest`, the `_run` test helper, and the call site. ✅
