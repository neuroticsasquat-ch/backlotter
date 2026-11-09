# Stage-2 Clustering via Batches API (NEU-298) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `link_use_batches` flag to Stage-2 (per-film clustering) so the daily link pass runs `batch Stage-1 → commit → batch Stage-2 → commit`, producing event/cluster outcomes identical to the sequential path.

**Architecture:** Mirror the Stage-1 split. Refactor `link/cluster.py` so per-film clustering separates into a pure **build** half (DB reads → request + a `ClusterPlan` carrying ordered existing-event IDs and unclustered story IDs) and a pure **apply** half (plan + raw JSON → DB writes). Both Stage-2 paths call the *same* `apply_cluster_decisions`, so parity is structural. `link/pipeline.py` gains `_cluster_stage_sequential` / `_cluster_stage_batched`, selected by the existing `use_batches` parameter — symmetric with `_link_stage_*`.

**Tech Stack:** Python 3.13, async SQLAlchemy 2, pytest (pytest-asyncio `auto` mode), Anthropic Message Batches API via the existing `AnthropicClient.complete_batch`. Everything runs in the container via `task`.

**Spec:** `docs/specs/2026-06-22-neu-298-stage2-clustering-via-batches-design.md`

---

## Conventions for this plan

- **No per-task git commits.** This whole ticket is **one PR**. Branch setup, the single commit, and the PR are handled by the `/t:implement` + `/t:ship` workflow — do **not** add `git commit` steps per task, and do not commit between tasks. (Per the user's subagent-no-commits + conventional-commits workflow.)
- **Running tests:** scope to the directory, e.g. `task test -- tests/integration/link/`. Do **not** run a single integration *file* in isolation — that triggers a known pytest-asyncio session-loop error (see backend `CLAUDE.md`). The whole link directory is fast.
- **Before declaring done:** `task format`, then `task test`, `task lint`, `task typecheck` all green. Keep the container up (`task up`).
- **TDD throughout:** write the failing test, watch it fail, implement minimally, watch it pass.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/upmovies/link/cluster.py` | modify | Add `ClusterPlan`, `build_cluster_request`, `apply_cluster_decisions`, `build_cluster_batch_request`, `_load_events_in_order`; refactor `cluster_film_events` to compose build→complete→apply. |
| `src/upmovies/link/pipeline.py` | modify | Add `_cluster_stage_sequential` / `_cluster_stage_batched`; select on `use_batches`. |
| `tests/integration/link/test_cluster.py` | modify | Tests for build/apply, including the cross-session determinism guard. |
| `tests/integration/link/test_pipeline.py` | modify | Stage-2-aware fakes; batched-Stage-2 request-mapping, parity, and failure-isolation tests. |

No config, migration, env, or FE changes. `link_use_batches` already defaults `True` (`config.py:36`) and already reaches `run_link_ingest` via `ingest_admin.py:95`.

---

## Task 1: `ClusterPlan` + `build_cluster_request` (read half)

**Files:**
- Modify: `src/upmovies/link/cluster.py`
- Test: `tests/integration/link/test_cluster.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/link/test_cluster.py`. The existing imports already include `json`, `datetime`/`UTC`, `select`, `Film`, `Event`/`EventStory`/`Story`, and the `_linked_story` helper — extend the `from upmovies.link.cluster import ...` line to add the new names.

```python
import uuid
from upmovies.link.cluster import (
    ClusterPlan,
    apply_cluster_decisions,
    build_cluster_batch_request,
    build_cluster_request,
    cluster_film_events,
)


async def test_build_cluster_request_returns_none_when_no_unclustered(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    await session.commit()

    assert await build_cluster_request(session, film_id=film.id, recency_days=45) is None


async def test_build_cluster_request_returns_none_for_missing_film(session):
    assert await build_cluster_request(session, film_id=uuid.uuid4(), recency_days=45) is None


async def test_build_cluster_request_builds_payload_and_plan(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1", title="A")
    s2 = await _linked_story(session, film, "https://e/2", title="B")
    await session.commit()

    built = await build_cluster_request(session, film_id=film.id, recency_days=45)
    assert built is not None
    system, messages, plan = built

    assert system[0]["cache_control"] == {"type": "ephemeral"}
    assert "distinct EVENTS" in system[0]["text"]
    payload = json.loads(messages[0]["content"])
    assert payload["film"]["title"] == "Runner"
    assert payload["existing_events"] == []
    assert {s["id"] for s in payload["new_stories"]} == {str(s1.id), str(s2.id)}

    assert isinstance(plan, ClusterPlan)
    assert plan.film_id == film.id
    assert plan.existing_event_ids == []
    assert set(plan.unclustered_story_ids) == {s1.id, s2.id}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/link/`
Expected: the three new tests FAIL with `ImportError`/`cannot import name 'ClusterPlan'` (and the other new names).

- [ ] **Step 3: Implement `ClusterPlan` + `build_cluster_request`**

In `src/upmovies/link/cluster.py`, add imports at the top — `from typing import Any` and extend the existing `from upmovies.llm.client import cached_system_block` to `from upmovies.llm.client import BatchRequest, cached_system_block`. Then add the dataclass (next to `ClusterResult`) and the builder. The builder is the read half lifted verbatim from the current `cluster_film_events` body (the LLM call and writes stay behind for now — Task 3 wires the composition):

```python
@dataclass
class ClusterPlan:
    """What `apply_cluster_decisions` needs to apply an LLM response deterministically,
    even in a fresh session after a batch poll: the existing events in the exact order
    presented to the model (so positional `"existing"` indices map correctly) and the
    unclustered stories to place."""

    film_id: UUID
    existing_event_ids: list[UUID]
    unclustered_story_ids: list[UUID]


async def build_cluster_request(
    session: AsyncSession, *, film_id: UUID, recency_days: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], ClusterPlan] | None:
    """Read half of clustering one film: gather the film, its unclustered linked stories,
    and its recent existing events (+ headlines), and build the cached system block + user
    payload. Returns `None` when there is nothing to cluster (missing film or no unclustered
    stories) — the caller skips it. No writes; no LLM call."""
    film = (await session.execute(select(Film).where(Film.id == film_id))).scalar_one_or_none()
    if film is None:
        return None

    already_clustered = exists().where(EventStory.story_id == Story.id)
    unclustered = (
        (
            await session.execute(
                select(Story).where(
                    Story.film_id == film_id, Story.link_status == "linked", ~already_clustered
                )
            )
        )
        .scalars()
        .all()
    )
    if not unclustered:
        return None

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
        existing_payload.append(
            {
                "event": i,
                "type": event.event_type,
                "confidence": event.confidence,
                "headlines": list(headlines),
            }
        )

    by_id = {str(s.id): s for s in unclustered}
    new_payload = [
        {
            "id": sid,
            "title": s.title,
            "summary": (str(s.raw.get("summary", "")) if isinstance(s.raw, dict) else "")[
                :_SUMMARY_MAX
            ],
        }
        for sid, s in by_id.items()
    ]

    user = {
        "film": {
            "title": film.title,
            "year": film.release_date.year if film.release_date else None,
        },
        "existing_events": existing_payload,
        "new_stories": new_payload,
    }
    system = [cached_system_block(_INSTRUCTIONS)]
    messages = [{"role": "user", "content": json.dumps(user)}]
    plan = ClusterPlan(
        film_id=film_id,
        existing_event_ids=[e.id for e in existing_events],
        unclustered_story_ids=[s.id for s in unclustered],
    )
    return system, messages, plan
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/integration/link/`
Expected: the three new tests PASS. (`build_cluster_batch_request` / `apply_cluster_decisions` are imported but not yet exercised — they don't exist yet, so the import line will still fail. Add them in the next tasks; until then you may temporarily import only `ClusterPlan` and `build_cluster_request` to see green, then restore the full import in Task 2/4. Simpler: implement Tasks 2 and 4 before re-running, since they share the one import line.)

> Note: because Step 1 imports names created in Tasks 2 and 4, the cleanest path is to write Tasks 1–4's test code and implementations together, then run `task test -- tests/integration/link/` once. The steps below are ordered for review; the import line is shared.

---

## Task 2: `apply_cluster_decisions` (write half) + cross-session determinism guard

**Files:**
- Modify: `src/upmovies/link/cluster.py`
- Test: `tests/integration/link/test_cluster.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/link/test_cluster.py` (the `async_sessionmaker` import is needed for the cross-session test):

```python
from sqlalchemy.ext.asyncio import async_sessionmaker


async def test_apply_creates_new_event(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1")
    await session.commit()

    plan = ClusterPlan(film_id=film.id, existing_event_ids=[], unclustered_story_ids=[s1.id])
    raw = json.dumps(
        {"events": [{"existing": None, "type": "trailer", "confidence": "confirmed",
                     "stories": [str(s1.id)]}]}
    )
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.events_created == 1
    assert result.stories_clustered == 1
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 1 and events[0].event_type == "trailer"
    links = (await session.execute(select(EventStory))).scalars().all()
    assert [el.story_id for el in links] == [s1.id]


async def test_apply_attaches_to_existing_by_plan_index(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    first = await _linked_story(session, film, "https://e/1")
    event = Event(film_id=film.id, event_type="casting", confidence="confirmed",
                  occurred_at=datetime.now(UTC))
    session.add(event)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=first.id))
    second = await _linked_story(session, film, "https://e/2")
    await session.commit()

    plan = ClusterPlan(
        film_id=film.id, existing_event_ids=[event.id], unclustered_story_ids=[second.id]
    )
    raw = json.dumps({"events": [{"existing": 1, "stories": [str(second.id)]}]})
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.events_created == 0
    assert result.stories_clustered == 1
    member_ids = {el.story_id for el in (await session.execute(select(EventStory))).scalars().all()}
    assert member_ids == {first.id, second.id}


async def test_apply_skips_invalid_new_event(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1")
    await session.commit()

    plan = ClusterPlan(film_id=film.id, existing_event_ids=[], unclustered_story_ids=[s1.id])
    raw = json.dumps(
        {"events": [{"existing": None, "type": "not-a-type", "confidence": "confirmed",
                     "stories": [str(s1.id)]}]}
    )
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.events_created == 0 and result.stories_clustered == 0
    assert (await session.execute(select(EventStory))).scalars().all() == []


async def test_apply_uses_build_time_event_order_across_sessions(session, test_engine):
    """The crux of the design: apply maps the LLM's positional `existing` index off the
    plan's captured order, NOT a re-derived recency query. We build in session A, flip an
    event's occurred_at (which a re-derived `order_by(occurred_at, id)` would reorder on),
    then apply in a FRESH session B — and assert the index still resolves to the build-time
    event."""
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    e1 = Event(film_id=film.id, event_type="casting", confidence="confirmed",
               occurred_at=datetime(2026, 1, 1, tzinfo=UTC))
    e2 = Event(film_id=film.id, event_type="trailer", confidence="confirmed",
               occurred_at=datetime(2026, 2, 1, tzinfo=UTC))
    session.add_all([e1, e2])
    await session.flush()
    c1 = await _linked_story(session, film, "https://e/c1")
    c2 = await _linked_story(session, film, "https://e/c2")
    session.add_all(
        [EventStory(event_id=e1.id, story_id=c1.id), EventStory(event_id=e2.id, story_id=c2.id)]
    )
    s1 = await _linked_story(session, film, "https://e/s1")
    s2 = await _linked_story(session, film, "https://e/s2")
    await session.commit()

    built = await build_cluster_request(session, film_id=film.id, recency_days=3650)
    assert built is not None
    _system, _messages, plan = built
    assert plan.existing_event_ids == [e1.id, e2.id]  # ordered by occurred_at at build time

    # Flip occurred_at so a re-derived query would now order [e2, e1]; the plan must not change.
    e1.occurred_at = datetime(2026, 3, 1, tzinfo=UTC)
    await session.commit()

    raw = json.dumps(
        {"events": [
            {"existing": 1, "stories": [str(s1.id)]},
            {"existing": None, "type": "casting", "confidence": "rumored", "stories": [str(s2.id)]},
        ]}
    )
    maker = async_sessionmaker(test_engine, expire_on_commit=False)
    async with maker() as b:
        result = await apply_cluster_decisions(b, plan=plan, raw=raw)
        await b.commit()

    assert result.events_created == 1
    assert result.stories_clustered == 2
    async with maker() as c:
        e1_members = (
            await c.execute(select(EventStory.story_id).where(EventStory.event_id == e1.id))
        ).scalars().all()
        e2_members = (
            await c.execute(select(EventStory.story_id).where(EventStory.event_id == e2.id))
        ).scalars().all()
    assert s1.id in e1_members  # plan index 1 → e1 despite the occurred_at flip
    assert s1.id not in e2_members
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/link/`
Expected: the new `apply_*` tests FAIL (`cannot import name 'apply_cluster_decisions'` until implemented).

- [ ] **Step 3: Implement `apply_cluster_decisions` + `_load_events_in_order`**

In `src/upmovies/link/cluster.py`, add the write half (the create/attach logic lifted from the current `cluster_film_events`, but re-loading by the plan's captured IDs):

```python
async def _load_events_in_order(session: AsyncSession, event_ids: list[UUID]) -> list[Event]:
    """Re-load events by id, preserving the given order so positional indices stay stable."""
    if not event_ids:
        return []
    rows = (await session.execute(select(Event).where(Event.id.in_(event_ids)))).scalars().all()
    by_id = {e.id: e for e in rows}
    return [by_id[eid] for eid in event_ids if eid in by_id]


async def apply_cluster_decisions(
    session: AsyncSession, *, plan: ClusterPlan, raw: str
) -> ClusterResult:
    """Write half of clustering one film: re-load the plan's events (in order) and stories
    (by id), parse the LLM JSON, and create new events / attach to existing ones. Re-loading
    by id makes this deterministic across the build→poll→apply session split (batched path)
    and identical to the in-session sequential path. The caller owns the commit."""
    existing_events = await _load_events_in_order(session, plan.existing_event_ids)
    stories = (
        (await session.execute(select(Story).where(Story.id.in_(plan.unclustered_story_ids))))
        .scalars()
        .all()
    )
    by_id = {str(s.id): s for s in stories}

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
                    plan.film_id,
                    etype,
                    conf,
                )
                continue
            occurred = min((by_id[sid].published_at or by_id[sid].fetched_at) for sid in sids)
            event = Event(
                film_id=plan.film_id, event_type=etype, confidence=conf, occurred_at=occurred
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/integration/link/`
Expected: all Task 1 + Task 2 tests PASS (assuming Task 4's `build_cluster_batch_request` is implemented too, since it shares the import line — implement Task 4 before this run if you haven't).

---

## Task 3: Refactor `cluster_film_events` to compose build → complete → apply

**Files:**
- Modify: `src/upmovies/link/cluster.py`
- Test: `tests/integration/link/test_cluster.py` (existing tests are the regression guard)

- [ ] **Step 1: Confirm the existing regression tests**

The existing `test_creates_new_event_for_unclustered_stories`, `test_attaches_to_existing_event`, and `test_noop_when_nothing_unclustered` already cover `cluster_film_events`. They must keep passing after the refactor — that *is* the test for this task. No new test needed.

Run: `task test -- tests/integration/link/`
Expected: those three PASS (against the current implementation, before refactor).

- [ ] **Step 2: Refactor the implementation**

Replace the body of `cluster_film_events` in `src/upmovies/link/cluster.py` with a thin composition of the two halves. The function signature and behavior are unchanged; the inline read/write logic now lives in `build_cluster_request` / `apply_cluster_decisions` (no duplication):

```python
async def cluster_film_events(
    session: AsyncSession,
    *,
    client: Completer,
    model: str,
    film_id: UUID,
    recency_days: int,
) -> ClusterResult:
    built = await build_cluster_request(session, film_id=film_id, recency_days=recency_days)
    if built is None:
        return ClusterResult(0, 0)
    system, messages, plan = built
    raw = await client.complete(
        model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
    return await apply_cluster_decisions(session, plan=plan, raw=raw)
```

Delete the now-duplicated read/write code that previously made up the body (everything between the old `film = ...` lookup and the old `return ClusterResult(...)`). Keep `_extract_json_object`, `_VALID_TYPES`, `_SUMMARY_MAX`, `_MAX_TOKENS`, `_INSTRUCTIONS`, and `ClusterResult`.

- [ ] **Step 3: Run the tests to verify they still pass**

Run: `task test -- tests/integration/link/`
Expected: the three existing `cluster_film_events` tests PASS. `test_noop_when_nothing_unclustered` still asserts `client.calls == []` — `build_cluster_request` returns `None` before any `complete()` call, so the short-circuit holds.

---

## Task 4: `build_cluster_batch_request` wrapper

**Files:**
- Modify: `src/upmovies/link/cluster.py`
- Test: `tests/integration/link/test_cluster.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/link/test_cluster.py`:

```python
async def test_build_cluster_batch_request_wraps_into_batch_request(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1")
    await session.commit()

    built = await build_cluster_batch_request(
        session, custom_id=str(film.id), model="cluster-m", film_id=film.id, recency_days=45
    )
    assert built is not None
    req, plan = built
    assert req.custom_id == str(film.id)
    assert req.model == "cluster-m"
    assert req.max_tokens == 1500  # == cluster._MAX_TOKENS, parity with the sequential path
    assert req.system[0]["cache_control"] == {"type": "ephemeral"}
    assert "distinct EVENTS" in req.system[0]["text"]
    assert plan.film_id == film.id
    assert set(plan.unclustered_story_ids) == {s1.id}


async def test_build_cluster_batch_request_none_when_nothing_to_cluster(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    await session.commit()
    assert (
        await build_cluster_batch_request(
            session, custom_id=str(film.id), model="cluster-m", film_id=film.id, recency_days=45
        )
        is None
    )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/link/`
Expected: FAIL with `cannot import name 'build_cluster_batch_request'`.

- [ ] **Step 3: Implement the wrapper**

In `src/upmovies/link/cluster.py`, add (mirrors `linker.build_batch_request`; keeps `_MAX_TOKENS` encapsulated in this module):

```python
async def build_cluster_batch_request(
    session: AsyncSession, *, custom_id: str, model: str, film_id: UUID, recency_days: int
) -> tuple[BatchRequest, ClusterPlan] | None:
    """Batched-path wrapper: one Message-Batch request for clustering one film, plus the
    `ClusterPlan` to apply its result. `max_tokens` matches the sequential path's `_MAX_TOKENS`
    so the two paths are token-identical. Returns `None` when there is nothing to cluster."""
    built = await build_cluster_request(session, film_id=film_id, recency_days=recency_days)
    if built is None:
        return None
    system, messages, plan = built
    return (
        BatchRequest(
            custom_id=custom_id,
            model=model,
            system=system,
            messages=messages,
            max_tokens=_MAX_TOKENS,
        ),
        plan,
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/link/`
Expected: all `cluster.py` tests PASS (Tasks 1–4).

---

## Task 5: Extract `_cluster_stage_sequential` (behavior-preserving)

**Files:**
- Modify: `src/upmovies/link/pipeline.py`
- Test: `tests/integration/link/test_pipeline.py` (existing tests are the regression guard)

- [ ] **Step 1: Confirm the existing regression tests**

The existing `test_links_then_clusters_recent_pending[False]`, `test_rerun_is_noop_when_fully_processed[False]`, `test_link_window_*[False]`, and `test_flag_off_uses_sequential_only` cover the sequential Stage-2 path. They must keep passing.

Run: `task test -- tests/integration/link/`
Expected: PASS (current implementation).

- [ ] **Step 2: Extract the sequential stage**

In `src/upmovies/link/pipeline.py`, add `_cluster_stage_sequential` (the current Stage-2 per-film loop, lifted verbatim). Place it near `_link_stage_sequential`:

```python
async def _cluster_stage_sequential(
    *,
    session_factory: SessionFactory,
    client: Completer,
    run_id: UUID,
    model: str,
    film_ids: Sequence[UUID],
    recency_days: int,
) -> tuple[int, int]:
    events_created = stories_clustered = 0
    for film_id in film_ids:
        try:
            async with _owned_session(session_factory) as s:
                cluster = await cluster_film_events(
                    s, client=client, model=model, film_id=film_id, recency_days=recency_days
                )
                await s.commit()
            events_created += cluster.events_created
            stories_clustered += cluster.stories_clustered
        except Exception:
            log.exception("clustering failed for film %s", film_id)
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=1)
                await s.commit()
    return events_created, stories_clustered
```

Then in `run_link_ingest`, **keep** the distinct-film selection block (the `film_ids = [...]` query) and **replace** the inline per-film loop (the `events_created = stories_clustered = 0` line through the end of that `for film_id in film_ids:` block) with a call:

```python
    events_created, stories_clustered = await _cluster_stage_sequential(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=cluster_model,
        film_ids=film_ids,
        recency_days=recency_days,
    )
```

Leave the `finalize_run` block below it untouched.

- [ ] **Step 3: Run the tests to verify they still pass**

Run: `task test -- tests/integration/link/`
Expected: all existing pipeline tests PASS unchanged (this is a pure extraction; the `[True]` cases still run Stage-2 sequentially because the flag isn't wired to Stage-2 yet).

---

## Task 6: Make the test fakes Stage-2-aware (backward-compatible prep)

**Files:**
- Modify: `tests/integration/link/test_pipeline.py`

Once Task 7 wires the flag to Stage-2, `complete_batch` will be called a second time per run (for the cluster batch). The existing fakes capture/route only Stage-1; update them now so the change in Task 7 doesn't break them. These edits are backward-compatible: until Task 7, Stage-2 stays sequential, so the new branches lie dormant and the suite stays green.

- [ ] **Step 1: Update `FakeClient`**

In `tests/integration/link/test_pipeline.py`, change `FakeClient.__init__` to add a Stage-2 capture attribute, and `complete_batch` to record Stage-1 vs Stage-2 batches separately (routing by the system prompt). `_decide` already returns the correct shape for both — leave it as-is.

```python
    def __init__(self):
        self.complete_calls: list[dict] = []
        self.batch_requests: list | None = None
        self.cluster_batch_requests: list | None = None

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        reqs = list(requests)
        if reqs and "entity-linking classifier" in reqs[0].system[0]["text"]:
            self.batch_requests = reqs          # Stage-1 link batch
        else:
            self.cluster_batch_requests = reqs  # Stage-2 cluster batch
        return {
            r.custom_id: BatchResult(
                custom_id=r.custom_id, ok=True, text=self._decide(r.system, r.messages)
            )
            for r in reqs
        }
```

- [ ] **Step 2: Update `_TaggedFailBatchClient`**

It currently assumes every batch is a Stage-1 link batch (`json.loads(...)` → a list of stories). A Stage-2 cluster batch payload is a dict, which would crash it. Make it pass Stage-2 batches through to the parent's normal handling:

```python
    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        reqs = list(requests)
        if not (reqs and "entity-linking classifier" in reqs[0].system[0]["text"]):
            return await super().complete_batch(reqs)  # Stage-2 cluster batch: serve normally
        self.batch_requests = reqs
        out = {}
        for r in reqs:
            stories = json.loads(r.messages[0]["content"])
            tainted = any(st["title"].startswith("FAIL") for st in stories)
            if tainted and not self._unparseable:
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id, ok=False, error_type="errored", error_message="boom"
                )
            elif tainted:
                out[r.custom_id] = BatchResult(custom_id=r.custom_id, ok=True, text="not json")
            else:
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id, ok=True, text=self._decide(r.system, r.messages)
                )
        return out
```

- [ ] **Step 3: Run the suite to verify it stays green**

Run: `task test -- tests/integration/link/`
Expected: all existing tests PASS unchanged (no behavior change yet).

---

## Task 7: `_cluster_stage_batched` + flag selection

**Files:**
- Modify: `src/upmovies/link/pipeline.py`
- Test: `tests/integration/link/test_pipeline.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/link/test_pipeline.py`. First, update the now-stale comment in `test_flag_on_uses_batch_for_stage1` (the final line) and add a Stage-2 assertion to it:

```python
    assert client.batch_requests is not None  # Stage 1 went through complete_batch()
    assert _stage1_complete_calls(client) == 0  # no Stage-1 complete() call
    assert client.cluster_batch_requests is not None  # Stage 2 also went through complete_batch()
```

Then add new tests:

```python
async def test_batched_cluster_request_mapping(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all([await _story("https://e/a", published_offset_days=1)])
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    client = FakeClient()
    await _run(session, run_id, use_batches=True, client=client)

    reqs = client.cluster_batch_requests
    assert reqs is not None
    assert {r.custom_id for r in reqs} == {str(film.id)}  # one cluster request per film, keyed by id
    for r in reqs:
        assert r.model == "cluster-m"
        assert r.max_tokens == 1500
        assert r.system[0]["cache_control"] == {"type": "ephemeral"}
        assert "distinct EVENTS" in r.system[0]["text"]


class _ClusterFailBatchClient:
    """Stage-level fake: serves cluster batches, failing the film whose title starts 'FAIL'."""

    def __init__(self):
        self.cluster_batch_requests: list | None = None

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        reqs = list(requests)
        self.cluster_batch_requests = reqs
        out = {}
        for r in reqs:
            payload = json.loads(r.messages[0]["content"])
            if payload["film"]["title"].startswith("FAIL"):
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id, ok=False, error_type="errored", error_message="boom"
                )
            else:
                new_ids = [s["id"] for s in payload["new_stories"]]
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id,
                    ok=True,
                    text=json.dumps(
                        {"events": [{"existing": None, "type": "trailer",
                                     "confidence": "confirmed", "stories": new_ids}]}
                    ),
                )
        return out


async def _linked_unclustered(session, film, url):
    s = Story(source="X", url=url, title="news", link_status="linked", film_id=film.id,
              published_at=datetime.now(UTC), raw={"summary": ""})
    session.add(s)
    await session.flush()
    return s


async def test_batched_cluster_failure_is_isolated_per_film(session):
    from upmovies.link.pipeline import _cluster_stage_batched

    ok_film = Film(tmdb_id=1, title="Runner")
    fail_film = Film(tmdb_id=2, title="FAIL Movie")
    session.add_all([ok_film, fail_film])
    await session.flush()
    ok_story = await _linked_unclustered(session, ok_film, "https://e/ok")
    fail_story = await _linked_unclustered(session, fail_film, "https://e/fail")
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    events_created, stories_clustered = await _cluster_stage_batched(
        session_factory=lambda: session,
        client=_ClusterFailBatchClient(),
        run_id=run_id,
        model="cluster-m",
        film_ids=[ok_film.id, fail_film.id],
        recency_days=45,
    )

    assert events_created == 1
    assert stories_clustered == 1
    ok_events = (
        await session.execute(select(Event).where(Event.film_id == ok_film.id))
    ).scalars().all()
    fail_events = (
        await session.execute(select(Event).where(Event.film_id == fail_film.id))
    ).scalars().all()
    assert len(ok_events) == 1 and len(fail_events) == 0
    members = {el.story_id for el in (await session.execute(select(EventStory))).scalars().all()}
    assert ok_story.id in members and fail_story.id not in members
```

Add the missing imports at the top of `test_pipeline.py`: `from upmovies.news.models import Event, EventStory, Story` (the file already imports `Event` and `Story` — add `EventStory`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/link/`
Expected: `test_batched_cluster_request_mapping` fails (`cluster_batch_requests is None` — Stage-2 not batched yet); `test_batched_cluster_failure_is_isolated_per_film` fails (`cannot import name '_cluster_stage_batched'`); the updated assertion in `test_flag_on_uses_batch_for_stage1` fails.

- [ ] **Step 3: Implement `_cluster_stage_batched` + wire the flag**

In `src/upmovies/link/pipeline.py`:

Extend imports — add `BatchRequest`:
```python
from upmovies.llm.client import BatchRequest
```
and extend the cluster import:
```python
from upmovies.link.cluster import (
    ClusterPlan,
    apply_cluster_decisions,
    build_cluster_batch_request,
    cluster_film_events,
)
```

Add the batched stage (near `_cluster_stage_sequential`):

```python
async def _cluster_stage_batched(
    *,
    session_factory: SessionFactory,
    client: BatchCompleter,
    run_id: UUID,
    model: str,
    film_ids: Sequence[UUID],
    recency_days: int,
) -> tuple[int, int]:
    # Build phase: one read-only session; ORM rows are dropped once serialized, so no session
    # is held open across the batch poll. The per-film plans (tiny UUID lists) are kept.
    requests: list[BatchRequest] = []
    plans: dict[str, ClusterPlan] = {}
    async with _owned_session(session_factory) as s:
        for film_id in film_ids:
            built = await build_cluster_batch_request(
                s, custom_id=str(film_id), model=model, film_id=film_id, recency_days=recency_days
            )
            if built is None:
                continue
            request, plan = built
            requests.append(request)
            plans[request.custom_id] = plan

    if not requests:
        return 0, 0

    try:
        results = await client.complete_batch(requests)
    except Exception:
        log.exception("cluster batch submit of %d films failed", len(requests))
        async with _owned_session(session_factory) as s:
            await record_progress(s, run_id, failed_delta=len(requests))
            await s.commit()
        return 0, 0

    events_created = stories_clustered = 0
    for custom_id, plan in plans.items():
        result = results.get(custom_id)
        try:
            if result is None or not result.ok:
                detail = result.error_type if result else "missing"
                raise RuntimeError(f"cluster film {custom_id} unavailable: {detail}")
            async with _owned_session(session_factory) as s:
                # apply_cluster_decisions calls json.loads; this try/except owns failure isolation.
                applied = await apply_cluster_decisions(s, plan=plan, raw=result.text)
                await s.commit()
            events_created += applied.events_created
            stories_clustered += applied.stories_clustered
        except Exception:
            log.exception("clustering failed for film %s", custom_id)
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=1)
                await s.commit()

    return events_created, stories_clustered
```

Then in `run_link_ingest`, replace the direct `_cluster_stage_sequential(...)` call (added in Task 5) with the flag selection:

```python
    cluster_stage = _cluster_stage_batched if use_batches else _cluster_stage_sequential
    events_created, stories_clustered = await cluster_stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=cluster_model,
        film_ids=film_ids,
        recency_days=recency_days,
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/integration/link/`
Expected: PASS. Note the parity payoff: the existing parametrized `[False, True]` happy-path tests (`test_links_then_clusters_recent_pending`, `test_rerun_is_noop_when_fully_processed`, `test_link_window_of_four_includes_story_past_the_feed_window`) now exercise **batched Stage-2** for the `True` case and assert the *same* concrete event/cluster outcomes as the sequential `False` case — that is the ticket's "same outcomes on a fixed mocked set" criterion, satisfied structurally (both paths share `apply_cluster_decisions`). The Stage-1 `test_batched_failed_chunk_stays_pending_others_commit` and `test_batched_whole_submit_failure_*` also still pass with the Stage-2-aware fakes.

---

## Task 8: Full verification

- [ ] **Step 1: Format**

Run: `task format`
Expected: ruff reformats/leaves files clean.

- [ ] **Step 2: Full test suite**

Run: `task test`
Expected: entire suite green (not just the link directory).

- [ ] **Step 3: Lint**

Run: `task lint`
Expected: `ruff check src tests` clean.

- [ ] **Step 4: Typecheck**

Run: `task typecheck`
Expected: `pyright src tests` clean. (The `cluster_stage = _cluster_stage_batched if use_batches else _cluster_stage_sequential` assignment mirrors the existing Stage-1 `stage = ...` pattern, which pyright already accepts; `client` satisfies both `Completer` and `BatchCompleter` via `LinkClient`.)

---

## Self-review notes (for the implementer)

- **Spec coverage:** sequencing (S1→commit→S2→commit) is preserved because Stage-2 only runs after `run_link_ingest`'s Stage-1 stage returns and its commits are done; the flag (`use_batches`) and one-PR delivery match the spec; deterministic apply via `ClusterPlan` (Task 2's cross-session test); per-film + whole-batch failure isolation (Tasks 6–7); parity (Task 7 Step 4 note). No config/migration/FE — none added.
- **Import-line coupling:** Tasks 1, 2, 4 share one `from upmovies.link.cluster import (...)` line in the test file. Implement those three before the first `task test` run, or temporarily trim the import to only what exists. Tasks are ordered for review clarity, not as hard run-barriers.
- **No new clustering behavior:** the LLM contract (positional `existing` index, JSON shape) is unchanged — only the execution shape changes.
