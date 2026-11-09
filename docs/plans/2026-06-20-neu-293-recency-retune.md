# Recency-Window Retune — feed 3d / link 4d (NEU-293) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retune the two recency knobs in `config.py` for the tight hourly-ingest / daily-link cadence: `FEED_RECENCY_DAYS` 14 → **3** and `LINK_RECENCY_DAYS` 45 → **4**. The link window stays ≥ the feed window, with a +1-day margin that absorbs the daily-run timing offset and closes the "ingested-but-never-linked" race for a story published near the feed-window edge.

**Architecture:** Both values are already plumbed end-to-end — `feed_recency_days` drives the Google `when:Nd` operator + the `drop_stale` `published_at` gate (`fetcher.run_feeds_ingest`); `link_recency_days` drives the `coalesce(published_at, fetched_at) >= cutoff` selection in `link.pipeline.run_link_ingest`. **This ticket changes only the two defaults plus tests** — no signatures, no wiring, no schema.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, Pydantic v2 / pydantic-settings, pytest (+ respx for HTTP). **Everything runs in Docker via `task`** — never run `python`/`pytest`/`ruff` on the host.

**Spec:** `docs/specs/2026-06-20-ingestion-cadence-recency-architecture-design.md` (sections "Recency model" + "Testing"). Parent story: NEU-289.

---

## Execution notes (this repo / user)

- **Branch:** do all work on `tom/neu-293-be-retune-feedlink-recency-windows-3d-4d` (the Linear branch), cut from `main`. Verify branch + clean tree before starting.
- **Single PR for the whole ticket** (one of three child PRs under NEU-289). Each task committed separately on the branch.
- **Subagents do NOT commit.** The orchestrator/user commits at each task boundary and opens the one PR at the end (use `/commit-msg` and `/pr-desc`).
- **Pre-commit hooks delegate into Docker** — commit normally (no `--no-verify`); run `task format` first and keep the container up (`task up`).
- **No migration:** no models/schema change, so no Alembic step.
- **CI gate before pushing:** `task format` then `task test`, `task lint`, `task typecheck` all green.
- **Out of scope:** the hardcoded `RECENCY_DAYS = 45` in `scripts/export_link_validation_draft.py` is a one-off export script, **not** `config.py` — leave it untouched.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/upmovies/config.py` | Settings | `feed_recency_days` default 14 → 3; `link_recency_days` default 45 → 4 |
| `tests/unit/news/test_recency.py` | Unit | Add a 3-day-window `drop_stale` case |
| `tests/integration/link/test_pipeline.py` | Integration | Add a `LINK_RECENCY_DAYS=4` edge-case selection test (the race) |

---

## Task 1: Retune the two config defaults

**Files:**
- Modify: `src/upmovies/config.py` (lines 34 and 36)

- [ ] **Step 1: Change the defaults**

In `src/upmovies/config.py`, change line 34 from:

```python
    link_recency_days: int = Field(default=45, alias="LINK_RECENCY_DAYS")
```

to:

```python
    link_recency_days: int = Field(default=4, alias="LINK_RECENCY_DAYS")
```

and line 36 from:

```python
    feed_recency_days: int = Field(default=14, alias="FEED_RECENCY_DAYS")
```

to:

```python
    feed_recency_days: int = Field(default=3, alias="FEED_RECENCY_DAYS")
```

- [ ] **Step 2: Verify the suite still passes**

Run: `task test`
Expected: PASS. (Existing feed/link tests pass `recency_days` explicitly into the pipelines, so they're unaffected by the default change; this step catches any test that happens to read `settings.*_recency_days`.)

- [ ] **Step 3: Checkpoint (orchestrator commits)**

```bash
task format && git add -A && git commit -m "feat: retune recency windows to feed 3d / link 4d"
```

---

## Task 2: Unit test — `drop_stale` at the 3-day feed window

`drop_stale` is the pure `published_at` gate. Add a case pinned to the new 3-day window (alongside the existing boundary test).

**Files:**
- Modify: `tests/unit/news/test_recency.py`

- [ ] **Step 1: Add the failing/with-coverage test**

Append to `tests/unit/news/test_recency.py`:

```python
from datetime import timedelta


def test_drop_stale_excludes_entries_older_than_three_day_window():
    # Mirrors FEED_RECENCY_DAYS=3: cutoff = now - 3d.
    now = datetime(2026, 6, 20, 12, 0, tzinfo=UTC)
    cutoff = now - timedelta(days=3)
    fresh = _entry("https://e/fresh", now - timedelta(days=2))  # inside window: kept
    stale = _entry("https://e/stale", now - timedelta(days=4))  # past window: dropped
    undated = _entry("https://e/undated", None)  # safety net: kept

    kept = drop_stale([fresh, stale, undated], cutoff=cutoff)

    assert kept == [fresh, undated]
```

(`datetime`/`UTC` are already imported at the top of the file; add the `timedelta` import there or inline as shown.)

- [ ] **Step 2: Run the test**

Run: `task test -- tests/unit/news/test_recency.py`
Expected: PASS (the `drop_stale` logic already exists; this test pins the 3-day behaviour the ticket calls for).

- [ ] **Step 3: Checkpoint (orchestrator commits)**

```bash
task format && git add -A && git commit -m "test: cover drop_stale at the 3-day feed window"
```

---

## Task 3: Integration test — link selection at `LINK_RECENCY_DAYS=4` (the race case)

The link selection gates on `coalesce(published_at, fetched_at) >= cutoff` (SQL), so this needs the DB → integration test. Assert that with a 4-day link window a story published **3.5 days ago** (just past the 3-day feed window) is still selected and linked, while one at **4.5 days** stays pending. This proves the +1 margin keeps edge-of-window stories link-eligible.

> **Note on the fixture:** `_story(...)` sets `published_at` and lets `fetched_at` default to `now()`, so the story is "fetched today" exactly as the ticket describes. Because `published_at` is non-null here, `coalesce` resolves to `published_at` — the "fetched today" clause is incidental for this fixture (the genuine `published_at IS NULL → fetched_at` fallback isn't this ticket's focus). The meaningful assertion is the window size: 3.5d is in at 4, out at 3.

**Files:**
- Modify: `tests/integration/link/test_pipeline.py`

- [ ] **Step 1: Let `_run` take an overridable window**

In `tests/integration/link/test_pipeline.py`, change the `_run` helper (lines ~49–59) from:

```python
async def _run(session, run_id):
    return await run_link_ingest(
        session_factory=lambda: session,
        client=FakeClient(),
        run_id=run_id,
        model="link-m",
        cluster_model="cluster-m",
        recency_days=45,
        batch_size=10,
        floor=0.7,
    )
```

to:

```python
async def _run(session, run_id, recency_days=45):
    return await run_link_ingest(
        session_factory=lambda: session,
        client=FakeClient(),
        run_id=run_id,
        model="link-m",
        cluster_model="cluster-m",
        recency_days=recency_days,
        batch_size=10,
        floor=0.7,
    )
```

(`_story` already supports fractional `published_offset_days` via `timedelta(days=...)` — no change needed.)

- [ ] **Step 2: Add the edge-case test**

Append to `tests/integration/link/test_pipeline.py`:

```python
async def test_link_window_of_four_includes_story_past_the_feed_window(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all(
        [
            # Published 3.5d ago: past the 3-day feed window but inside the 4-day link
            # window — the +1 margin must keep it eligible (fetched_at defaults to now).
            await _story("https://e/edge", published_offset_days=3.5),
            # Published 4.5d ago: outside the 4-day link window — stays pending.
            await _story("https://e/past", published_offset_days=4.5),
        ]
    )
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    result = await _run(session, run_id, recency_days=4)

    assert result.linked == 1
    rows = {
        s.url: s
        for s in (
            await session.execute(select(Story), execution_options={"populate_existing": True})
        )
        .scalars()
        .all()
    }
    assert rows["https://e/edge"].link_status == "linked"
    assert rows["https://e/edge"].film_id == film.id
    assert rows["https://e/past"].link_status == "pending"
```

- [ ] **Step 3: Run the link integration tests**

Run: `task test -- tests/integration/link/test_pipeline.py`
Expected: PASS (the `coalesce >= cutoff` selection already exists; this test pins the 4-day window edge behaviour).

- [ ] **Step 4: Checkpoint (orchestrator commits)**

```bash
task format && git add -A && git commit -m "test: cover link selection at the 4-day recency window edge"
```

---

## Wrap-up

- [ ] **Run the full CI gate locally**

Run: `task format && task test && task lint && task typecheck`
Expected: all green. (No Alembic step — no schema change.)

- [ ] **Open the single PR for NEU-293**

Use `/commit-msg` (if squashing) and `/pr-desc`. PR title carries the Linear ID parenthetical, e.g. `feat: retune feed/link recency windows to 3d/4d (NEU-293)`. Push the branch and open the PR against `main`. The GitHub↔Linear connector moves the ticket status — don't touch it.

---

## Self-Review (author check)

- **Spec coverage:** ✅ `FEED_RECENCY_DAYS` 14 → 3 and `LINK_RECENCY_DAYS` 45 → 4 (T1, exactly the two `config.py` defaults named in the spec's "Config summary"); `drop_stale` excludes >3d (T2); link selection at window 4 includes the 3.5-day edge story / excludes 4.5d (T3) — both tests enumerated in the spec's "Testing" section. `link_use_batches` and the feed-source/workflow changes are **other** tickets in the milestone (NEU-292/294 + M1/M3), not this PR.
- **No over-reach:** ✅ no signature/wiring/schema changes — both values are already plumbed (`config.py:34,36` → `ingest_admin.py` triggers → pipelines). `scripts/export_link_validation_draft.py`'s hardcoded 45 is deliberately left alone.
- **Boundary semantics:** ✅ `drop_stale` keeps `published_at >= cutoff` and always keeps null-dated; link selection is `coalesce(published_at, fetched_at) >= cutoff`. 3.5d < 4d → included; 4.5d > 4d → excluded. The "fetched today" wording is satisfied by the default `fetched_at`, with the documented caveat that `coalesce` resolves to `published_at` for these non-null fixtures.
- **Placeholder scan:** ✅ none — every code/test step has full content.
