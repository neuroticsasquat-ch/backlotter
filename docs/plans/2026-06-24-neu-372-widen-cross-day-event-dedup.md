# NEU-372 — Widen cross-day event dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the clusterer's existing-event attach lookback from the 4-day story-recency window so a re-reported beat older than `LINK_RECENCY_DAYS` attaches to its original event instead of spawning a duplicate.

**Architecture:** `build_cluster_request` currently filters attach-candidate events by `Event.updated_at >= now - recency_days`, where `recency_days = LINK_RECENCY_DAYS (4)`. We replace that date cutoff with a count cap: offer the film's N most-recent events by `occurred_at`, age-independent (`N = LINK_CLUSTER_ATTACH_LIMIT`, default 25), and cap each event to its 3 most-recent headlines so the widened prompt stays token-bounded. The `recency_days` parameter on the cluster functions becomes `attach_limit`; the story-recency window in `run_link_ingest` is untouched.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async + asyncpg, Pydantic v2 / pydantic-settings, pytest (pytest-asyncio auto mode). All tooling runs in Docker via `task`.

**Spec:** `docs/specs/2026-06-24-neu-372-widen-cross-day-event-dedup-design.md`

## Global Constraints

- **Everything runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python` on the host.
- **Integration tests:** scope to a *directory*, not a single file (running one integration file in isolation errors with a pytest-asyncio session-loop warning — a known quirk). Use `task test -- tests/integration/link/`.
- **Type hints:** modern `X | None` / `X | Y`; **no** `from __future__ import annotations`.
- **ruff:** line length 100; rules E,F,W,I,B,UP. Remove now-unused imports (F401).
- **TDD:** write the failing test first.
- **Config default duplication is the existing pattern** — `cluster_max_tokens` already defaults to `4096` in both `config.py` and `run_link_ingest`; `attach_limit` mirrors this with `25`.
- **Commits:** Conventional Commits subject; **no** Linear ID in the subject (optional `Refs NEU-372.` in the body); **no** `🤖 Generated with Claude Code` footer; **no** `Co-Authored-By`. Run `task format` before committing (pre-commit hooks delegate into Docker — commit normally, no `--no-verify`).

---

### Task 1: Decouple existing-event attach lookback (most-recent-N + headline cap)

**Files:**
- Modify: `src/upmovies/config.py` (add one setting)
- Modify: `src/upmovies/link/cluster.py` (imports, constant, `build_cluster_request`, `build_cluster_batch_request`, `cluster_film_events`)
- Modify: `src/upmovies/link/pipeline.py` (`_cluster_stage_sequential`, `_cluster_stage_batched`, `run_link_ingest`)
- Modify: `src/upmovies/routers/ingest_admin.py` (`_background_link` call site)
- Test: `tests/integration/link/test_cluster.py` (4 new tests + rename existing kwargs)
- Test: `tests/integration/link/test_pipeline.py` (rename one kwarg)

**Interfaces:**
- Produces — config setting `Settings.link_cluster_attach_limit: int` (alias `LINK_CLUSTER_ATTACH_LIMIT`, default `25`).
- Produces — `build_cluster_request(session, *, film_id: UUID, attach_limit: int)` (was `recency_days`).
- Produces — `build_cluster_batch_request(session, *, custom_id, model, film_id, attach_limit: int, max_tokens=...)` (was `recency_days`).
- Produces — `cluster_film_events(session, *, client, model, film_id, attach_limit: int, max_tokens=...)` (was `recency_days`).
- Produces — `_cluster_stage_sequential` / `_cluster_stage_batched` keyword `attach_limit: int` (was `recency_days`).
- Produces — `run_link_ingest(..., recency_days: int, attach_limit: int = 25, ...)` — `recency_days` retained for the story cutoff; `attach_limit` added and threaded to the cluster stages.
- Produces — module constant `cluster._HEADLINES_PER_EVENT = 3`.

---

- [ ] **Step 1: Add the config setting**

In `src/upmovies/config.py`, add immediately after the `link_cluster_max_tokens` line:

```python
    link_cluster_attach_limit: int = Field(default=25, alias="LINK_CLUSTER_ATTACH_LIMIT")
```

---

- [ ] **Step 2: Write the failing tests**

Append these four tests to `tests/integration/link/test_cluster.py`. (`FakeClient`, `_linked_story`, `Film`, `Event`, `EventStory`, `Story`, `build_cluster_request`, `cluster_film_events`, `json`, `select`, `datetime`, `UTC` are all already imported in that file.)

```python
# ---------------------------------------------------------------------------
# NEU-372 — attach lookback decoupled from the story-recency window
# ---------------------------------------------------------------------------


async def test_build_cluster_request_includes_event_older_than_recency_window(session):
    """An event last touched well beyond LINK_RECENCY_DAYS (4) is still offered as an
    attach candidate — the lookback no longer depends on updated_at recency."""
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    old = datetime(2026, 1, 1, tzinfo=UTC)
    event = Event(
        film_id=film.id,
        event_type="casting",
        confidence="confirmed",
        occurred_at=old,
        updated_at=old,  # far older than the 4-day window
    )
    session.add(event)
    await session.flush()
    member = await _linked_story(session, film, "https://e/old", title="Old casting beat")
    session.add(EventStory(event_id=event.id, story_id=member.id))
    await _linked_story(session, film, "https://e/new", title="Re-report")  # unclustered
    await session.commit()

    built = await build_cluster_request(session, film_id=film.id, attach_limit=25)
    assert built is not None
    _system, messages, plan = built
    payload = json.loads(messages[0]["content"])
    assert [e["type"] for e in payload["existing_events"]] == ["casting"]
    assert plan.existing_event_ids == [event.id]


async def test_build_cluster_request_caps_existing_events_to_attach_limit(session):
    """With more events than attach_limit, only the most-recent N by occurred_at are
    offered, presented oldest->newest so 1-based positional indices stay stable."""
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    events = []
    for day in (1, 2, 3):
        ev = Event(
            film_id=film.id,
            event_type="casting",
            confidence="confirmed",
            occurred_at=datetime(2026, 1, day, tzinfo=UTC),
        )
        session.add(ev)
        await session.flush()
        st = await _linked_story(session, film, f"https://e/m{day}", title=f"beat day {day}")
        session.add(EventStory(event_id=ev.id, story_id=st.id))
        events.append(ev)
    await _linked_story(session, film, "https://e/new")  # unclustered -> request is built
    await session.commit()

    built = await build_cluster_request(session, film_id=film.id, attach_limit=2)
    assert built is not None
    _system, messages, plan = built
    payload = json.loads(messages[0]["content"])
    titles = [h for e in payload["existing_events"] for h in e["headlines"]]
    assert titles == ["beat day 2", "beat day 3"]  # 2 most recent, oldest->newest
    assert plan.existing_event_ids == [events[1].id, events[2].id]


async def test_build_cluster_request_caps_headlines_per_event(session):
    """An event with many member stories contributes at most 3 headlines, most-recent first."""
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    event = Event(
        film_id=film.id,
        event_type="casting",
        confidence="confirmed",
        occurred_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    session.add(event)
    await session.flush()
    for i in range(1, 6):
        st = Story(
            source="X",
            url=f"https://e/m{i}",
            title=f"headline {i}",
            link_status="linked",
            film_id=film.id,
            published_at=datetime(2026, 1, i, tzinfo=UTC),
            raw={"summary": ""},
        )
        session.add(st)
        await session.flush()
        session.add(EventStory(event_id=event.id, story_id=st.id))
    await _linked_story(session, film, "https://e/new")  # unclustered -> request is built
    await session.commit()

    built = await build_cluster_request(session, film_id=film.id, attach_limit=25)
    assert built is not None
    _system, messages, _plan = built
    payload = json.loads(messages[0]["content"])
    assert len(payload["existing_events"]) == 1
    assert payload["existing_events"][0]["headlines"] == ["headline 5", "headline 4", "headline 3"]


async def test_cluster_film_events_attaches_across_day_window_without_moving_occurred_at(session):
    """NEU-372 end-to-end: a re-report of a beat logged long ago attaches to the existing
    event (no duplicate) and leaves occurred_at anchored to the original beat date."""
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    old = datetime(2026, 1, 1, tzinfo=UTC)
    event = Event(
        film_id=film.id,
        event_type="casting",
        confidence="confirmed",
        occurred_at=old,
        updated_at=old,
    )
    session.add(event)
    await session.flush()
    first = await _linked_story(session, film, "https://e/1", title="Original casting")
    session.add(EventStory(event_id=event.id, story_id=first.id))
    rereport = await _linked_story(session, film, "https://e/2", title="Casting, revisited")
    await session.commit()

    client = FakeClient({"events": [{"existing": 1, "stories": [1]}]})
    result = await cluster_film_events(
        session, client=client, model="m", film_id=film.id, attach_limit=25
    )
    await session.commit()

    assert result.events_created == 0
    assert result.stories_clustered == 1
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 1  # attached, no duplicate
    member_ids = {el.story_id for el in (await session.execute(select(EventStory))).scalars().all()}
    assert member_ids == {first.id, rereport.id}
    refreshed = (await session.execute(select(Event).where(Event.id == event.id))).scalar_one()
    assert refreshed.occurred_at == old  # unchanged — timeline stays anchored
    assert refreshed.updated_at > old  # attach bumped updated_at
```

---

- [ ] **Step 3: Run the new tests, verify they fail**

Run: `task test -- tests/integration/link/test_cluster.py -k "older_than_recency_window or caps_existing_events or caps_headlines or attaches_across_day_window"`

Expected: FAIL — `build_cluster_request()`/`cluster_film_events()` raise `TypeError: ... got an unexpected keyword argument 'attach_limit'` (the parameter does not exist yet).

---

- [ ] **Step 4: Implement the cluster.py changes**

In `src/upmovies/link/cluster.py`:

**4a.** Change the datetime import (drop now-unused `timedelta`):

```python
from datetime import UTC, datetime
```

**4b.** Add `func` to the sqlalchemy import:

```python
from sqlalchemy import exists, func, select
```

**4c.** Add a module constant next to `_DEFAULT_MAX_TOKENS`:

```python
_HEADLINES_PER_EVENT = 3
```

**4d.** In `build_cluster_request`, change the signature parameter `recency_days: int` to `attach_limit: int`. Then replace the existing-events query **and** the per-event headline query. Replace this block:

```python
    cutoff = datetime.now(UTC) - timedelta(days=recency_days)
    existing_events = (
        (
            await session.execute(
                select(Event)
                .where(Event.film_id == film_id, Event.updated_at >= cutoff)
                .order_by(Event.occurred_at, Event.id)
            )
        )
        .scalars()
        .all()
    )

    existing_payload = []
    for i, event in enumerate(existing_events, start=1):
        headlines = (
            (
                await session.execute(
                    select(Story.title)
                    .join(EventStory, EventStory.story_id == Story.id)
                    .where(EventStory.event_id == event.id)
                )
            )
            .scalars()
            .all()
        )
```

with:

```python
    # Most-recent N events by occurred_at, age-independent (NEU-372), then reversed to
    # oldest->newest so the 1-based positional indices the model uses stay stable.
    existing_events = list(
        reversed(
            (
                await session.execute(
                    select(Event)
                    .where(Event.film_id == film_id)
                    .order_by(Event.occurred_at.desc(), Event.id.desc())
                    .limit(attach_limit)
                )
            )
            .scalars()
            .all()
        )
    )

    existing_payload = []
    for i, event in enumerate(existing_events, start=1):
        headlines = (
            (
                await session.execute(
                    select(Story.title)
                    .join(EventStory, EventStory.story_id == Story.id)
                    .where(EventStory.event_id == event.id)
                    .order_by(func.coalesce(Story.published_at, Story.fetched_at).desc())
                    .limit(_HEADLINES_PER_EVENT)
                )
            )
            .scalars()
            .all()
        )
```

**4e.** In `build_cluster_batch_request`, change the signature parameter `recency_days: int` to `attach_limit: int` and update the inner call:

```python
    built = await build_cluster_request(session, film_id=film_id, attach_limit=attach_limit)
```

**4f.** In `cluster_film_events`, change the signature parameter `recency_days: int` to `attach_limit: int` and update the inner call:

```python
    built = await build_cluster_request(session, film_id=film_id, attach_limit=attach_limit)
```

---

- [ ] **Step 5: Thread attach_limit through the pipeline and router**

In `src/upmovies/link/pipeline.py`:

**5a.** `_cluster_stage_sequential` — rename the keyword-only parameter `recency_days: int` to `attach_limit: int`, and in the `cluster_film_events(...)` call change `recency_days=recency_days` to `attach_limit=attach_limit`.

**5b.** `_cluster_stage_batched` — rename the keyword-only parameter `recency_days: int` to `attach_limit: int`, and in the `build_cluster_batch_request(...)` call change `recency_days=recency_days` to `attach_limit=attach_limit`.

**5c.** `run_link_ingest` — **keep** `recency_days: int` (it still drives the story cutoff). Add a new keyword-only parameter `attach_limit: int = 25` (place it just after `recency_days`). In the `cluster_stage(...)` call, change `recency_days=recency_days` to `attach_limit=attach_limit`.

In `src/upmovies/routers/ingest_admin.py`, in `_background_link`'s `run_link_ingest(...)` call, add this line right after `recency_days=settings.link_recency_days,`:

```python
                attach_limit=settings.link_cluster_attach_limit,
```

---

- [ ] **Step 6: Update the existing test call sites**

**6a.** In `tests/integration/link/test_cluster.py`, replace every `recency_days=` keyword argument with `attach_limit=` (keep each numeric value). These are the *only* uses of `recency_days` in that file — calls to `build_cluster_request`, `build_cluster_batch_request`, and `cluster_film_events` at lines 64, 94, 121, 137, 141, 152, 289, 348, 374, 389, 456. A file-wide replace of `recency_days=` → `attach_limit=` is safe here.

**6b.** In `tests/integration/link/test_pipeline.py`, in the direct `_cluster_stage_batched(...)` call (~line 511), change `recency_days=45` to `attach_limit=45`. Leave every other `recency_days=` in this file unchanged — those pass to `run_link_ingest`, which retains the parameter.

---

- [ ] **Step 7: Run the link test directory, verify green**

Run: `task test -- tests/integration/link/`

Expected: PASS — the four new tests pass and all pre-existing cluster/pipeline tests still pass (including `test_apply_uses_build_time_event_order_across_sessions`, which still sees `plan.existing_event_ids == [e1.id, e2.id]` because reversing the descending-ordered events reproduces ascending order).

---

- [ ] **Step 8: Run the full suite and static checks**

Run, in order:

```bash
task format
task lint
task typecheck
task test
```

Expected: all green. `task format` may reformat — re-stage if it does.

---

- [ ] **Step 9: Commit**

```bash
git add src/upmovies/config.py src/upmovies/link/cluster.py src/upmovies/link/pipeline.py \
        src/upmovies/routers/ingest_admin.py \
        tests/integration/link/test_cluster.py tests/integration/link/test_pipeline.py
git commit -m "$(cat <<'EOF'
feat(link): widen existing-event attach lookback for cross-day dedup

Decouple the clusterer's existing-event lookback from LINK_RECENCY_DAYS:
offer the film's most-recent N events (LINK_CLUSTER_ATTACH_LIMIT, default
25) regardless of age, and cap each event to its 3 most-recent headlines so
the widened prompt stays token-bounded. Re-reported beats older than the
story-recency window now attach to their original event instead of
spawning a duplicate; occurred_at stays anchored to the original beat.

Refs NEU-372.
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Decision 1 (most-recent-N, age-independent, drop cutoff) → Step 4d; proven by `test_..._includes_event_older_than_recency_window` and `test_..._caps_existing_events_to_attach_limit`.
- Decision 2 (`LINK_CLUSTER_ATTACH_LIMIT`, default 25) → Steps 1, 5c.
- Decision 3 (cap 3 headlines/event) → Step 4c/4d; proven by `test_..._caps_headlines_per_event`.
- Decision 4 (`occurred_at` invariant) → no code change; locked by `test_cluster_film_events_attaches_across_day_window_without_moving_occurred_at`.
- Story-recency window unchanged → Step 5c keeps `recency_days` in `run_link_ingest`; Step 6b leaves its test callers alone.
- Threading through both cluster paths (sequential + batched) → Steps 5a/5b.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `attach_limit: int` is used identically across `build_cluster_request`, `build_cluster_batch_request`, `cluster_film_events`, both `_cluster_stage_*` functions, and `run_link_ingest`; `_HEADLINES_PER_EVENT` and `func`/`timedelta` import changes are self-contained in `cluster.py`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
