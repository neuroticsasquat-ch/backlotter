# NEU-367 — Linker recall: reject promotional/interview/stale-stage pieces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop ~18% of non-news events from polluting the stream — drop the ~53 "stale-stage" events (early-production beats on already-wrapped films) with a deterministic Stage-2 gate, push interview/enthusiasm pieces to `not-news` with a strengthened Stage-1 prompt, and hide the residual-hype `other` catch-all from the public surface.

**Architecture:** Two complementary mechanisms plus a read-side hide. (1) A deterministic gate in Stage-2 clustering: when the model assigns an early-stage `event_type` (`announced`/`casting`/`production_start`) to a film already in `Post Production`/`Released`, don't create the event — reject its stories (`link_status="rejected"`, `link_note="stale-stage:<type>"`), mirroring NEU-358's Stage-1 not-news rejection at the stage where `event_type` finally exists. (2) Strengthen the Stage-1 linker prompt's `not-news` bullet with interview/enthusiasm headline patterns. (3) A single read-side predicate excludes `event_type="other"` from every public-event surface. No DB migration.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async + asyncpg, Pydantic v2, FastAPI, pytest (pytest-asyncio `auto` mode), ruff, pyright. Everything runs in the container via `task` — **never** run `pytest`/`ruff`/`pyright`/`python`/`alembic` on the host.

## Global Constraints

- **One ticket = one PR.** Branch `tom/neu-367-backend-linker-recall-reject-promotionalinterviewstale-stage`.
- **Commits:** Conventional Commits subject; **no** Linear ID in the subject (optional `Refs NEU-367.` in the body); **no** `Co-Authored-By`; **no** `🤖 Generated with Claude Code` footer in commits. If executed via subagent-driven-development, implementer subagents do **not** commit — the user commits once at the end.
- **Run everything via `task`** (`task test`, `task lint`, `task typecheck`, `task format`); they `docker compose exec` into `upmovies-backend`. Keep the container up (`task up`). Run `task format` before committing. Pre-commit hooks delegate into Docker — commit normally, **never** `--no-verify`.
- **Integration-test quirk:** running a *single* integration file in isolation throws a pytest-asyncio session-loop warning (known repo quirk). Scope integration runs to a **directory** (`task test -- tests/integration/link`, `task test -- tests/integration/routers`) or run the whole suite. Unit files (`tests/unit/...`) are safe to run alone.
- **No DB migration** — the gate reuses existing columns (`link_status`, `link_note`, `film_id`, `link_confidence`); the `other`-hide is read-only; new dataclass fields are in-memory only.
- **Modern type hints** (`X | None`, `X | Y`); **no** `from __future__ import annotations`; ruff line length 100.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/upmovies/link/cluster.py` | `is_stale_stage` helper + constants; `ClusterPlan.film_status`; `ClusterResult.stories_rejected`; gate branch in `apply_cluster_decisions`; `build_cluster_request` captures status | 1, 2 |
| `src/upmovies/link/pipeline.py` | thread `stories_rejected` through the cluster stages into the run detail | 3 |
| `src/upmovies/link/linker.py` | strengthen the `not-news` bullet in `_INSTRUCTIONS` | 4 |
| `src/upmovies/public/service.py` | `_visible_events()` predicate applied to every public-event query | 5 |
| `tests/fixtures/link/validation_set.json` | curated interview/reaction `not-news` rows | 6 |
| `tests/unit/link/test_cluster.py` *(new)* | `is_stale_stage` truth table | 1 |
| `tests/integration/link/test_cluster.py` | gate behavior + status capture | 2 |
| `tests/integration/link/test_pipeline.py` | `stories_rejected` threading | 3 |
| `tests/unit/link/test_linker.py` | prompt-wording guard | 4 |
| `tests/integration/routers/test_public_{feed,feed_grouped,films,sitemap}.py` | `other`-hide | 5 |
| `tests/unit/link/test_validation.py` | curated-row guard | 6 |

---

## Task 1: `is_stale_stage` pure helper

**Files:**
- Modify: `src/upmovies/link/cluster.py` (add constants + helper near the existing `_VALID_TYPES`, ~line 31)
- Test: `tests/unit/link/test_cluster.py` *(new file)*

**Interfaces:**
- Produces: `is_stale_stage(event_type: str, film_status: str | None) -> bool` — `True` iff `event_type ∈ {"announced","casting","production_start"}` **and** `film_status ∈ {"Post Production","Released"}`. Module constants `_STALE_EVENT_TYPES` and `_WRAPPED_STATUSES`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/link/test_cluster.py`:

```python
import pytest

from upmovies.link.cluster import is_stale_stage


@pytest.mark.parametrize("event_type", ["announced", "casting", "production_start"])
@pytest.mark.parametrize("status", ["Post Production", "Released"])
def test_early_stage_on_wrapped_film_is_stale(event_type, status):
    assert is_stale_stage(event_type, status) is True


@pytest.mark.parametrize("event_type", ["announced", "casting", "production_start"])
@pytest.mark.parametrize("status", ["In Production", "Planned", "Rumored", None])
def test_early_stage_on_unwrapped_film_is_not_stale(event_type, status):
    assert is_stale_stage(event_type, status) is False


@pytest.mark.parametrize("event_type", ["trailer", "release_date", "production_wrap", "other"])
@pytest.mark.parametrize("status", ["Post Production", "Released", "In Production", None])
def test_non_early_stage_types_are_never_stale(event_type, status):
    assert is_stale_stage(event_type, status) is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_cluster.py`
Expected: FAIL — `ImportError: cannot import name 'is_stale_stage'`.

- [ ] **Step 3: Implement the helper**

In `src/upmovies/link/cluster.py`, directly below the `_VALID_TYPES = {...}` block (it ends at line 31), add:

```python
_STALE_EVENT_TYPES = {"announced", "casting", "production_start"}
_WRAPPED_STATUSES = {"Post Production", "Released"}


def is_stale_stage(event_type: str, film_status: str | None) -> bool:
    """A new event is 'stale-stage' when an early-production beat (casting/announced/
    production_start) is reported for a film that has already wrapped or released. Such
    events are dropped at clustering (NEU-367). NULL/unknown status is never stale."""
    return event_type in _STALE_EVENT_TYPES and film_status in _WRAPPED_STATUSES
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_cluster.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
task format
git add src/upmovies/link/cluster.py tests/unit/link/test_cluster.py
git commit -m "feat(link): add is_stale_stage production-stage helper

Refs NEU-367."
```

---

## Task 2: Reject stale-stage events at Stage-2 clustering

**Files:**
- Modify: `src/upmovies/link/cluster.py` (`ClusterResult`, `ClusterPlan`, `build_cluster_request`, `apply_cluster_decisions`)
- Test: `tests/integration/link/test_cluster.py` (append)

**Interfaces:**
- Consumes: `is_stale_stage` (Task 1); existing `apply_cluster_decisions(session, *, plan, raw)`, `build_cluster_request(...)`, `ClusterPlan`, `ClusterResult`, and the test helpers `FakeClient` / `_linked_story` already in `test_cluster.py`.
- Produces:
  - `ClusterResult.stories_rejected: int` (default `0`, last field).
  - `ClusterPlan.film_status: str | None` (default `None`, last field), populated by `build_cluster_request` from the loaded `Film`.
  - `apply_cluster_decisions`: a **new** event group whose `type` is stale for `plan.film_status` creates **no** `Event`; each of its stories is set `link_status="rejected"`, `film_id=None`, `link_confidence=None`, `link_note=f"stale-stage:{etype}"` and counted in `stories_rejected`. Attach-to-existing groups are unaffected.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/link/test_cluster.py` (imports already cover `Film`, `Story`, `Event`, `EventStory`, `ClusterPlan`, `apply_cluster_decisions`, `build_cluster_request`, `select`, `datetime`, `UTC`, `json`):

```python
async def test_build_cluster_request_captures_film_status(session):
    film = Film(tmdb_id=1, title="Runner", status="Post Production")
    session.add(film)
    await session.flush()
    await _linked_story(session, film, "https://e/1")
    await session.commit()

    built = await build_cluster_request(session, film_id=film.id, recency_days=45)
    assert built is not None
    _system, _messages, plan = built
    assert plan.film_status == "Post Production"


async def test_apply_rejects_stale_stage_new_event(session):
    film = Film(tmdb_id=1, title="Starfighter", status="Post Production")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1")
    await session.commit()

    plan = ClusterPlan(
        film_id=film.id,
        existing_event_ids=[],
        unclustered_story_ids=[s1.id],
        film_status="Post Production",
    )
    raw = json.dumps(
        {"events": [{"existing": None, "type": "casting", "confidence": "confirmed", "stories": [1]}]}
    )
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.events_created == 0
    assert result.stories_clustered == 0
    assert result.stories_rejected == 1
    assert (
        await session.execute(select(Event).where(Event.film_id == film.id))
    ).scalars().all() == []
    assert (await session.execute(select(EventStory))).scalars().all() == []
    refreshed = (await session.execute(select(Story).where(Story.id == s1.id))).scalar_one()
    assert refreshed.link_status == "rejected"
    assert refreshed.film_id is None
    assert refreshed.link_confidence is None
    assert refreshed.link_note == "stale-stage:casting"


async def test_apply_keeps_late_stage_event_on_wrapped_film(session):
    film = Film(tmdb_id=1, title="Starfighter", status="Post Production")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1")
    await session.commit()

    plan = ClusterPlan(
        film_id=film.id,
        existing_event_ids=[],
        unclustered_story_ids=[s1.id],
        film_status="Post Production",
    )
    raw = json.dumps(
        {"events": [{"existing": None, "type": "trailer", "confidence": "confirmed", "stories": [1]}]}
    )
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.events_created == 1 and result.stories_rejected == 0
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 1 and events[0].event_type == "trailer"


async def test_apply_keeps_early_stage_event_on_unwrapped_film(session):
    film = Film(tmdb_id=1, title="Runner", status="In Production")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1")
    await session.commit()

    plan = ClusterPlan(
        film_id=film.id,
        existing_event_ids=[],
        unclustered_story_ids=[s1.id],
        film_status="In Production",
    )
    raw = json.dumps(
        {"events": [{"existing": None, "type": "casting", "confidence": "confirmed", "stories": [1]}]}
    )
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.events_created == 1 and result.stories_rejected == 0


async def test_apply_does_not_gate_attach_to_existing(session):
    film = Film(tmdb_id=1, title="Starfighter", status="Post Production")
    session.add(film)
    await session.flush()
    first = await _linked_story(session, film, "https://e/1")
    event = Event(
        film_id=film.id, event_type="casting", confidence="confirmed", occurred_at=datetime.now(UTC)
    )
    session.add(event)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=first.id))
    second = await _linked_story(session, film, "https://e/2")
    await session.commit()

    plan = ClusterPlan(
        film_id=film.id,
        existing_event_ids=[event.id],
        unclustered_story_ids=[second.id],
        film_status="Post Production",
    )
    raw = json.dumps({"events": [{"existing": 1, "stories": [1]}]})
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.stories_rejected == 0 and result.stories_clustered == 1
    member_ids = {el.story_id for el in (await session.execute(select(EventStory))).scalars().all()}
    assert member_ids == {first.id, second.id}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/link`
Expected: FAIL — `ClusterPlan` rejects `film_status=`, `ClusterResult` has no `stories_rejected`, and the gate isn't applied (a `casting` event would be created).

- [ ] **Step 3: Extend `ClusterResult` and `ClusterPlan`**

In `src/upmovies/link/cluster.py`, change the two dataclasses (lines 60-70):

```python
@dataclass
class ClusterResult:
    events_created: int
    stories_clustered: int
    stories_rejected: int = 0


@dataclass
class ClusterPlan:
    film_id: UUID
    existing_event_ids: list[UUID]
    unclustered_story_ids: list[UUID]
    film_status: str | None = None
```

- [ ] **Step 4: Populate `film_status` in `build_cluster_request`**

In `build_cluster_request`, the `ClusterPlan(...)` construction (lines 166-170) becomes:

```python
    plan = ClusterPlan(
        film_id=film_id,
        existing_event_ids=[e.id for e in existing_events],
        unclustered_story_ids=[s.id for s in unclustered],
        film_status=film.status,
    )
```

- [ ] **Step 5: Add the gate branch in `apply_cluster_decisions`**

In `apply_cluster_decisions`, change the counters initializer (line 210) from:

```python
    events_created = stories_clustered = 0
```

to:

```python
    events_created = stories_clustered = stories_rejected = 0
```

Then, inside the `else` (new-event) branch, **after** the `type`/`confidence` validation `continue` and **before** `occurred = min(...)` (between lines 237 and 238), insert:

```python
            if is_stale_stage(etype, plan.film_status):
                for sid in group_sids:
                    story = by_id[sid]
                    story.link_status = "rejected"
                    story.film_id = None
                    story.link_confidence = None
                    story.link_note = f"stale-stage:{etype}"
                    assigned.add(sid)
                    stories_rejected += 1
                continue
```

Finally change the return (line 250) from `return ClusterResult(events_created, stories_clustered)` to:

```python
    return ClusterResult(events_created, stories_clustered, stories_rejected)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `task test -- tests/integration/link`
Expected: PASS — new gate tests green; the existing cluster + pipeline tests still green (the `ClusterResult(0, 0)` literals in `test_cluster.py` and `cluster.py` remain valid because `stories_rejected` defaults to `0`).

- [ ] **Step 7: Commit**

```bash
task format
git add src/upmovies/link/cluster.py tests/integration/link/test_cluster.py
git commit -m "feat(link): reject stale-stage events at Stage-2 clustering

Refs NEU-367."
```

---

## Task 3: Thread `stories_rejected` into the run detail

**Files:**
- Modify: `src/upmovies/link/pipeline.py` (`_cluster_stage_sequential`, `_cluster_stage_batched`, `run_link_ingest`)
- Test: `tests/integration/link/test_pipeline.py` (update two spots)

**Interfaces:**
- Consumes: `ClusterResult.stories_rejected` (Task 2).
- Produces: `_cluster_stage_sequential` / `_cluster_stage_batched` return a **3-tuple** `(events_created, stories_clustered, stories_rejected)`; `run_link_ingest` includes the stale-stage rejected count in the `finalize_run` detail string.

- [ ] **Step 1: Update the failing tests**

`test_pipeline.py` has a direct call that unpacks the cluster-stage tuple. At the line that reads `events_created, stories_clustered = await _cluster_stage_batched(` (≈ line 500), change the unpack and add an assertion:

```python
    events_created, stories_clustered, stories_rejected = await _cluster_stage_batched(
```

…and after the existing `assert stories_clustered == 1` (≈ line 511) add:

```python
    assert stories_rejected == 0
```

In the full-pipeline detail test (the assertion at ≈ line 129 reading `assert run.detail and "linked 1" in run.detail and "1 events" in run.detail`), extend it to:

```python
    assert (
        run.detail
        and "linked 1" in run.detail
        and "1 events" in run.detail
        and "stale-stage rejected" in run.detail
    )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/link`
Expected: FAIL — the 3-value unpack raises `ValueError: not enough values to unpack` (stage still returns a 2-tuple) and `"stale-stage rejected"` is absent from the detail.

- [ ] **Step 3: Update `_cluster_stage_sequential`**

In `src/upmovies/link/pipeline.py`, in `_cluster_stage_sequential`: change the initializer and the accumulation and the return.

Initializer (line 168):

```python
    events_created = stories_clustered = stories_rejected = 0
```

Accumulation block (after `await s.commit()` inside the try, lines 181-182):

```python
            events_created += cluster.events_created
            stories_clustered += cluster.stories_clustered
            stories_rejected += cluster.stories_rejected
```

Return (line 188):

```python
    return events_created, stories_clustered, stories_rejected
```

- [ ] **Step 4: Update `_cluster_stage_batched`**

In `_cluster_stage_batched`: the two early returns `return 0, 0` (the `if not requests:` guard ≈ line 222 and the submit-failure `except` ≈ line 231) both become:

```python
        return 0, 0, 0
```

The initializer (line 233):

```python
    events_created = stories_clustered = stories_rejected = 0
```

The accumulation (after `await s.commit()`, lines 243-244):

```python
            events_created += applied.events_created
            stories_clustered += applied.stories_clustered
            stories_rejected += applied.stories_rejected
```

The final return (line 251):

```python
    return events_created, stories_clustered, stories_rejected
```

- [ ] **Step 5: Update `run_link_ingest`**

The cluster-stage call (line 314) unpacks the new third value, and the detail string includes it. Change:

```python
    events_created, stories_clustered = await cluster_stage(
```

to:

```python
    events_created, stories_clustered, stories_rejected = await cluster_stage(
```

and the `finalize_run` detail (lines 328-332) to:

```python
            detail=(
                f"linked {linked}, rejected {rejected}; "
                f"{events_created} events from {stories_clustered} stories "
                f"({stories_rejected} stale-stage rejected)"
            ),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `task test -- tests/integration/link`
Expected: PASS — `tests/integration/link/test_pipeline.py` and `test_cluster.py` all green.

- [ ] **Step 7: Commit**

```bash
task format
git add src/upmovies/link/pipeline.py tests/integration/link/test_pipeline.py
git commit -m "feat(link): report stale-stage rejections in the link run detail

Refs NEU-367."
```

---

## Task 4: Strengthen the Stage-1 linker prompt

**Files:**
- Modify: `src/upmovies/link/linker.py` (`_INSTRUCTIONS`, the `not-news` bullet, lines 33-39)
- Test: `tests/unit/link/test_linker.py` (append)

**Interfaces:**
- Consumes: nothing new — the `not-news` reason and `reaction`/`interview-quote` categories already exist (NEU-358).
- Produces: a sharper `not-news` definition. No JSON-contract change, no version field. A guard test pins the key new phrases so they aren't accidentally dropped.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/link/test_linker.py`:

```python
def test_instructions_warn_against_interview_enthusiasm_headlines():
    from upmovies.link.linker import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    assert "teases" in lowered
    assert "reacts to" in lowered
    assert "no new production fact" in lowered
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_linker.py -k interview_enthusiasm`
Expected: FAIL — the phrases aren't in the current prompt.

- [ ] **Step 3: Rewrite the `not-news` bullet**

In `src/upmovies/link/linker.py`, replace the `- "not-news":` bullet (lines 33-39) with (keep the surrounding `\` line-continuation style exactly; each guarded phrase stays on a single source line):

```python
- "not-news": the story is primarily about a tracked film but announces nothing new about \
its production. Do NOT link these. Core test: if it reports no NEW production fact, it is \
not-news even when it is unmistakably about the film. Examples: cast/crew enthusiasm, \
praise, or fan and social-media reactions; interview color about working on the project — \
headlines where a cast member "teases", "reacts to", or "opens up on" the film, says they \
"can't wait" or are "excited for" it, or anything framed as "ahead of its release"; \
"everything we know so far" roundups and aggregators with no new information; talent \
comments on plot points that are not a formal announcement; streaming-platform or \
catalogue moves of an existing title; and any story whose news value is entirely \
downstream of an earlier beat.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_linker.py`
Expected: PASS — the guard plus all existing linker tests (the `not-news` branch tests, the `build_batch_request` cached-block test) stay green; the opening prompt line is unchanged.

- [ ] **Step 5: Commit**

```bash
task format
git add src/upmovies/link/linker.py tests/unit/link/test_linker.py
git commit -m "feat(link): sharpen the not-news prompt against interview/enthusiasm pieces

Refs NEU-367."
```

---

## Task 5: Hide `other` events from the public surface

**Files:**
- Modify: `src/upmovies/public/service.py` (predicate + 6 query sites across 5 functions)
- Test: `tests/integration/routers/test_public_feed.py`, `test_public_feed_grouped.py`, `test_public_films.py`, `test_public_sitemap.py`

**Interfaces:**
- Produces: module-level `_HIDDEN_EVENT_TYPES = ("other",)` and `_visible_events()` returning the SQL predicate `Event.event_type.notin_(_HIDDEN_EVENT_TYPES)`, applied to: `get_film_detail` summarized-events, `get_feed` (count **and** rows), `get_feed_grouped` `base`, `get_film_index` `has_summary`, `get_sitemap_films`. Arc-stage queries are intentionally left unfiltered (`other` has no arc mapping).

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/routers/test_public_feed.py` (it already imports `UTC, datetime`):

```python
async def test_feed_excludes_other_events(client, make_film, add_event):
    film = await make_film(slug="mixed-2026")
    await add_event(
        film=film, event_type="casting", summary="shown", created_at=datetime(2026, 6, 1, tzinfo=UTC)
    )
    await add_event(
        film=film, event_type="other", summary="hidden", created_at=datetime(2026, 6, 2, tzinfo=UTC)
    )

    body = (await client.get("/feed")).json()
    assert body["total"] == 1
    assert [i["event_type"] for i in body["items"]] == ["casting"]
```

Append to `tests/integration/routers/test_public_films.py` (it already imports `UTC, date, datetime`):

```python
async def test_detail_excludes_other_events(client, make_film, add_event):
    film = await make_film(slug="mixed-detail-2026")
    await add_event(film=film, event_type="casting", summary="Casting.")
    await add_event(film=film, event_type="other", summary="Misc.")

    body = (await client.get("/films/mixed-detail-2026")).json()
    assert [e["event_type"] for e in body["events"]] == ["casting"]


async def test_index_excludes_film_with_only_other_events(client, make_film, add_event):
    shown = await make_film(slug="real-2026")
    await add_event(film=shown, event_type="casting", summary="s")
    other_only = await make_film(slug="otheronly-2026")
    await add_event(film=other_only, event_type="other", summary="s")

    slugs = [i["slug"] for i in (await client.get("/films")).json()["items"]]
    assert slugs == ["real-2026"]
```

Append to `tests/integration/routers/test_public_sitemap.py` (it already imports `UTC, date, datetime`):

```python
async def test_sitemap_excludes_film_with_only_other_events(client, make_film, add_event):
    other_only = await make_film(slug="otheronly-sitemap-2026")
    await add_event(film=other_only, event_type="other", summary="s")

    r = await client.get("/sitemap.xml")
    assert "otheronly-sitemap-2026" not in r.text
```

In `tests/integration/routers/test_public_feed_grouped.py`, **replace** the existing `test_grouped_other_only_day_surfaces_other` (the last test, lines 186-198 — it encodes the old "`other` is visible" behavior) with:

```python
async def test_grouped_other_only_day_is_hidden(client, make_film, add_event):
    film = await make_film(slug="other-2026")
    await add_event(
        film=film,
        event_type="other",
        summary="misc",
        created_at=datetime(2026, 6, 1, tzinfo=UTC),
    )

    body = (await client.get("/feed/grouped")).json()
    assert body["items"] == []
    assert body["total"] == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/routers`
Expected: FAIL — the new exclusion tests fail (and the rewritten grouped test fails) because `other` events are still surfaced.

- [ ] **Step 3: Add the predicate helper**

In `src/upmovies/public/service.py`, after the imports and before `_release_year` (line 24), add:

```python
_HIDDEN_EVENT_TYPES = ("other",)


def _visible_events():
    """SQL predicate: an event reaches the public surface unless its type is hidden.

    `other` is the uncategorized catch-all where residual hype lands (NEU-367); it is
    hidden from users but kept in the table (reversible)."""
    return Event.event_type.notin_(_HIDDEN_EVENT_TYPES)
```

- [ ] **Step 4: Apply the predicate to every public-event query**

`get_film_index` — the `has_summary` exists subquery (lines 44-49); change its `.where(...)`:

```python
    has_summary = (
        select(Event.id)
        .join(EventSummary, EventSummary.event_id == Event.id)
        .where(Event.film_id == Film.id, _visible_events())
        .exists()
    )
```

`get_film_detail` — the `summarized` query (lines 96-103); change its `.where(...)`:

```python
    summarized = (
        await session.execute(
            select(Event, EventSummary.summary)
            .join(EventSummary, EventSummary.event_id == Event.id)
            .where(Event.film_id == film.id, _visible_events())
            .order_by(Event.occurred_at.asc(), Event.id.asc())
        )
    ).all()
```

(Leave the `all_event_types` query at lines 88-93 unchanged — it feeds `arc_stage` only and `other` has no arc mapping.)

`get_sitemap_films` — the join query (lines 155-163); add a `.where(...)` before `.group_by`:

```python
    rows = (
        await session.execute(
            select(Film.slug, func.max(Event.created_at))
            .join(Event, Event.film_id == Film.id)
            .join(EventSummary, EventSummary.event_id == Event.id)
            .where(_visible_events())
            .group_by(Film.id, Film.slug)
            .order_by(Film.slug.asc())
        )
    ).all()
```

`get_feed` — the count (lines 168-174) and the rows (lines 175-185); add `_visible_events()` to each `.where(Film.slug.is_not(None))`:

```python
    total = await session.scalar(
        select(func.count())
        .select_from(Event)
        .join(EventSummary, EventSummary.event_id == Event.id)
        .join(Film, Film.id == Event.film_id)
        .where(Film.slug.is_not(None), _visible_events())
    )
    rows = (
        await session.execute(
            select(Event, EventSummary.summary, Film.slug, Film.title)
            .join(EventSummary, EventSummary.event_id == Event.id)
            .join(Film, Film.id == Event.film_id)
            .where(Film.slug.is_not(None), _visible_events())
            .order_by(Event.created_at.desc(), Event.id.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
```

`get_feed_grouped` — the `base` select (lines 231-245); change its `.where(...)`:

```python
        .where(Film.slug.is_not(None), _visible_events())
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/integration/routers`
Expected: PASS — the four new/updated tests green; all other public-router tests (feed ordering, detail chronology, index, sitemap, grouped) still green.

- [ ] **Step 6: Commit**

```bash
task format
git add src/upmovies/public/service.py tests/integration/routers/test_public_feed.py tests/integration/routers/test_public_feed_grouped.py tests/integration/routers/test_public_films.py tests/integration/routers/test_public_sitemap.py
git commit -m "feat(public): hide 'other' events from the public surface

Refs NEU-367."
```

---

## Task 6: Seed curated interview/reaction fixture rows

**Files:**
- Modify: `tests/fixtures/link/validation_set.json` (add 4 rows)
- Test: `tests/unit/link/test_validation.py` (append a guard)

**Interfaces:**
- Consumes: `load_validation_set` + the NEU-358 `is_production_news` / `exclusion_category` schema.
- Produces: 4 curated `about` + `is_production_news: false` rows mirroring the ticket's flagged interview/reaction headlines, categorized `interview-quote` / `reaction`. The `tmdb_id`s reuse films already present in the fixture (the CI guard checks schema + category; Tom swaps in the real Starfighter/Spaceballs ids during his manual relabel pass).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/link/test_validation.py`:

```python
def test_fixture_has_neu367_interview_reaction_rows():
    items = load_validation_set(_FIXTURE)
    by_url = {it.url: it for it in items}
    neu367_urls = [
        "https://example.test/neu367/starfighter-amy-adams-teases-excitement",
        "https://example.test/neu367/starfighter-matt-smith-opens-up-role",
        "https://example.test/neu367/anya-taylor-joy-reacts-to-casting",
        "https://example.test/neu367/lewis-pullman-working-with-dad",
    ]
    for url in neu367_urls:
        assert url in by_url, f"missing curated row {url}"
        it = by_url[url]
        assert it.relation == "about"
        assert it.is_production_news is False
        assert it.exclusion_category in {"interview-quote", "reaction"}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_validation.py -k neu367`
Expected: FAIL — the curated rows aren't in the fixture yet.

- [ ] **Step 3: Add the 4 curated rows**

Append these 4 objects to the top-level array in `tests/fixtures/link/validation_set.json` (mind the comma after the current final element):

```json
    {
      "url": "https://example.test/neu367/starfighter-amy-adams-teases-excitement",
      "source": "Mshale",
      "title": "Amy Adams TEASES Her Excitement For Star Wars: Starfighter Ahead Of Its Release",
      "summary": "The actor shares how thrilled she is for fans to finally see the film, with no new production detail.",
      "relation": "about",
      "expected_film_tmdb_id": 1003596,
      "event_type": null,
      "event_group": null,
      "is_production_news": false,
      "exclusion_category": "interview-quote"
    },
    {
      "url": "https://example.test/neu367/starfighter-matt-smith-opens-up-role",
      "source": "SuperHeroHype",
      "title": "Star Wars: Matt Smith Opens Up On His 'Interesting Guy Or Girl' Starfighter Role",
      "summary": "Smith discusses what drew him to the part in a wide-ranging interview; no casting or production news.",
      "relation": "about",
      "expected_film_tmdb_id": 1003596,
      "event_type": null,
      "event_group": null,
      "is_production_news": false,
      "exclusion_category": "interview-quote"
    },
    {
      "url": "https://example.test/neu367/anya-taylor-joy-reacts-to-casting",
      "source": "Collider",
      "title": "Anya Taylor-Joy Reacts To Her Lord Of The Rings Casting: 'A Dream Come True'",
      "summary": "The actor responds with delight to fan reaction over her casting — a reaction, not an announcement.",
      "relation": "about",
      "expected_film_tmdb_id": 1090869,
      "event_type": null,
      "event_group": null,
      "is_production_news": false,
      "exclusion_category": "reaction"
    },
    {
      "url": "https://example.test/neu367/lewis-pullman-working-with-dad",
      "source": "JoBlo",
      "title": "Lewis Pullman On Getting The Chance To Work With His Dad On The Spaceballs Sequel",
      "summary": "Pullman reflects on sharing the screen with his father — biographical interview color, no new beat.",
      "relation": "about",
      "expected_film_tmdb_id": 969681,
      "event_type": null,
      "event_group": null,
      "is_production_news": false,
      "exclusion_category": "interview-quote"
    }
```

If unsure the JSON is well-formed, validate inside the container: `task shell` then `python -c "import json; json.load(open('tests/fixtures/link/validation_set.json'))"`.

- [ ] **Step 4: Run the validation tests to verify they pass**

Run: `task test -- tests/unit/link/test_validation.py`
Expected: PASS — the new `neu367` guard plus the existing `test_fixture_has_curated_not_news_rows` (≥6 excluded rows, all five categories) stay green.

- [ ] **Step 5: Commit**

```bash
task format
git add tests/fixtures/link/validation_set.json tests/unit/link/test_validation.py
git commit -m "test(link): seed curated interview/reaction not-news rows

Refs NEU-367."
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `task test`
Expected: PASS — entire suite green, no regressions.

- [ ] **Step 2: Lint, typecheck, format**

Run: `task lint` then `task typecheck` then `task format`
Expected: lint + typecheck clean; `format` makes no further changes (if it does, re-stage and add a `style:` commit or amend).

- [ ] **Step 3: Confirm no migration and no stray files**

Run: `git status --porcelain`
Expected: only the files touched by Tasks 1-6 — **no** new Alembic version file (this ticket adds no migration).

- [ ] **Step 4: Hand off**

Stop. The PR is ready for the user to open against `main` from branch `tom/neu-367-backend-linker-recall-reject-promotionalinterviewstale-stage`. The user then runs the manual sign-off pass (not a merge blocker): reset recent `linked → pending`, widen `LINK_RECENCY_DAYS`, re-link, re-synthesize, and re-scan the preview to confirm the ~53 stale-stage + interview events drop and the `other` events disappear from the public surface.

---

## Self-review notes (coverage vs spec)

- **§1 Stage-2 gate** (`is_stale_stage`, `ClusterPlan.film_status`, reject-and-null branch, `ClusterResult.stories_rejected`) → Tasks 1-2; run accounting → Task 3. ✓ (3 evidenced types × {Post Production, Released}; attach-to-existing untouched; NULL status safe.)
- **§2 Stage-1 prompt strengthening** (interview/enthusiasm negatives, "no NEW production fact" test, no contract/version change) → Task 4. ✓
- **§3 `other`-hide** (one predicate across all 5 public-event sites; arc-stage untouched) → Task 5; includes flipping the old `test_grouped_other_only_day_surfaces_other`. ✓
- **§4 Eval** (curated interview/reaction rows; NEU-358 curated-rows + Tom's-manual-pass split) → Task 6. ✓
- **No DB migration / no `link_prompt_version` / no Stage-1 status-in-roster / `production_wrap` & `In Production` not gated** → respected throughout; verified in Task 7 Step 3.
- **Out of scope** (`summarizer.py`/NEU-368, retroactive re-link, Tom's sign-off run) → noted in Task 7 Step 4.
- **Type consistency:** `is_stale_stage(event_type, film_status)`, `ClusterPlan.film_status`, `ClusterResult.stories_rejected`, `_visible_events()` used identically across all tasks. ✓
