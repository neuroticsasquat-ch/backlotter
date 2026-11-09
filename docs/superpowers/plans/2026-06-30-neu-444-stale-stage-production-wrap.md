# NEU-444 — Gate stale `production_wrap` events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop old, re-surfaced wrap stories from spawning brand-new "Production wrap" events by adding `production_wrap` to the existing stale-stage clustering gate.

**Architecture:** A film in `"Post Production"` or `"Released"` has by definition already wrapped, so a *new* `production_wrap` event for it is stale. NEU-367 already rejects early-production beats (`announced`/`casting`/`production_start`) for wrapped/released films in `link/cluster.py` via `is_stale_stage()`; this adds `production_wrap` to that same set. The gate fires only on the new-event branch — attach-to-existing is untouched.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async), pytest (pytest-asyncio auto mode), ruff, pyright. Everything runs in the container via `task` — never run `pytest`/`ruff`/`pyright`/`python` on the host.

## Global Constraints

- **Repo:** `upcoming-movies-backend`. Branch (from Linear): `tom/neu-444-bug-old-stories-getting-classified-by-ingestor-as-new`.
- **All tooling runs in the container via `task`.** Source is bind-mounted (live edits); no dependency change here, so no `task build`.
- **TDD:** write the failing test first.
- **Integration tests must be run as a directory/suite, never a single file** (known pytest-asyncio session-loop quirk).
- **Before claiming done:** `task test`, `task lint`, `task typecheck` all green (`task format` reformats).
- **Commits:** Conventional Commits subject; **no** Linear ID in subject (optional `Refs NEU-444.` in body); **no** `🤖 Generated with Claude Code` footer; **no** `Co-Authored-By`.
- **Scope is exactly `production_wrap`.** Do NOT add `trailer` or `release_date` to the gate. No DB migration, config, DTO, public-surface, or frontend change.

---

### Task 1: Add `production_wrap` to the stale-stage gate

**Files:**
- Modify: `src/upmovies/link/cluster.py:37` (the `_STALE_EVENT_TYPES` set) and the `is_stale_stage` docstring at `src/upmovies/link/cluster.py:41-44`
- Test (modify): `tests/unit/link/test_cluster.py`
- Test (modify): `tests/integration/link/test_cluster.py`

**Interfaces:**
- Consumes: existing `is_stale_stage(event_type: str, film_status: str | None) -> bool`; existing `apply_cluster_decisions(session, *, plan: ClusterPlan, raw: str) -> ClusterResult`; existing `ClusterPlan(film_id, existing_event_ids, unclustered_story_ids, film_status)`; existing integration-test helper `_linked_story(session, film, url)`.
- Produces: no new public symbols — only a widened gate. After this task, `is_stale_stage("production_wrap", "Post Production")` returns `True`; a new `production_wrap` cluster group on a wrapped/released film is rejected with `link_note="stale-stage:production_wrap"`.

- [ ] **Step 1: Update the unit tests to expect `production_wrap` to be stale (failing test)**

In `tests/unit/link/test_cluster.py`, move `production_wrap` out of the never-stale list and into the two early-stage lists. The file in full becomes:

```python
import pytest

from upmovies.link.cluster import is_stale_stage


@pytest.mark.parametrize(
    "event_type", ["announced", "casting", "production_start", "production_wrap"]
)
@pytest.mark.parametrize("status", ["Post Production", "Released"])
def test_early_stage_on_wrapped_film_is_stale(event_type, status):
    assert is_stale_stage(event_type, status) is True


@pytest.mark.parametrize(
    "event_type", ["announced", "casting", "production_start", "production_wrap"]
)
@pytest.mark.parametrize("status", ["In Production", "Planned", "Rumored", None])
def test_early_stage_on_unwrapped_film_is_not_stale(event_type, status):
    assert is_stale_stage(event_type, status) is False


@pytest.mark.parametrize("event_type", ["trailer", "release_date", "other"])
@pytest.mark.parametrize("status", ["Post Production", "Released", "In Production", None])
def test_non_early_stage_types_are_never_stale(event_type, status):
    assert is_stale_stage(event_type, status) is False
```

- [ ] **Step 2: Run the unit tests and verify they fail**

Run: `task test -- tests/unit/link/test_cluster.py`
Expected: FAIL — `test_early_stage_on_wrapped_film_is_stale[...-production_wrap]` asserts `True` but the current gate returns `False` for `production_wrap`.

- [ ] **Step 3: Add `production_wrap` to the gate set and update the docstring**

In `src/upmovies/link/cluster.py`, change line 37:

```python
_STALE_EVENT_TYPES = {"announced", "casting", "production_start", "production_wrap"}
```

And update the `is_stale_stage` docstring (lines 41-44) to enumerate the new beat:

```python
def is_stale_stage(event_type: str, film_status: str | None) -> bool:
    """A new event is 'stale-stage' when an early-or-mid production beat (casting/announced/
    production_start/production_wrap) is reported for a film that has already wrapped or
    released. A film in Post Production has by definition already wrapped, so a fresh
    production_wrap event for it is stale (NEU-444, extending NEU-367). Such events are
    dropped at clustering. NULL/unknown status is never stale."""
    return event_type in _STALE_EVENT_TYPES and film_status in _WRAPPED_STATUSES
```

- [ ] **Step 4: Run the unit tests and verify they pass**

Run: `task test -- tests/unit/link/test_cluster.py`
Expected: PASS (all parametrizations).

- [ ] **Step 5: Add integration tests for the apply-path rejection (failing test)**

In `tests/integration/link/test_cluster.py`, add these two tests next to the existing stale-stage tests (after `test_apply_rejects_stale_stage_new_event`, ~line 500). They reuse the file's existing imports (`json`, `select`, `Film`, `Event`, `EventStory`, `Story`, `ClusterPlan`, `apply_cluster_decisions`) and the `_linked_story` helper:

```python
async def test_apply_rejects_stale_production_wrap_new_event(session):
    film = Film(tmdb_id=1, title="Brand New Day", status="Post Production")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/wrap")
    await session.commit()

    plan = ClusterPlan(
        film_id=film.id,
        existing_event_ids=[],
        unclustered_story_ids=[s1.id],
        film_status="Post Production",
    )
    raw = json.dumps(
        {
            "events": [
                {
                    "existing": None,
                    "type": "production_wrap",
                    "confidence": "confirmed",
                    "stories": [1],
                }
            ]
        }
    )
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.events_created == 0
    assert result.stories_rejected == 1
    assert (
        await session.execute(select(Event).where(Event.film_id == film.id))
    ).scalars().all() == []
    refreshed = (await session.execute(select(Story).where(Story.id == s1.id))).scalar_one()
    assert refreshed.link_status == "rejected"
    assert refreshed.film_id is None
    assert refreshed.link_note == "stale-stage:production_wrap"


async def test_apply_keeps_production_wrap_on_in_production_film(session):
    film = Film(tmdb_id=1, title="Runner", status="In Production")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/wrap")
    await session.commit()

    plan = ClusterPlan(
        film_id=film.id,
        existing_event_ids=[],
        unclustered_story_ids=[s1.id],
        film_status="In Production",
    )
    raw = json.dumps(
        {
            "events": [
                {
                    "existing": None,
                    "type": "production_wrap",
                    "confidence": "confirmed",
                    "stories": [1],
                }
            ]
        }
    )
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.events_created == 1 and result.stories_rejected == 0
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 1 and events[0].event_type == "production_wrap"
```

- [ ] **Step 6: Run the integration link tests and verify they pass**

Run: `task test -- tests/integration/link/`
Expected: PASS, including the two new tests (run the whole directory, not the single file — known quirk).

- [ ] **Step 7: Run the full suite + lint + typecheck**

Run:
```bash
task format
task test
task lint
task typecheck
```
Expected: all green. (Confirms no other test depended on `production_wrap` being non-stale.)

- [ ] **Step 8: Commit**

```bash
git add src/upmovies/link/cluster.py tests/unit/link/test_cluster.py tests/integration/link/test_cluster.py
git commit -m "fix: gate stale production_wrap events on wrapped films

Re-surfaced old wrap stories (Google News reports its re-surface date as
pubDate) spawned brand-new Production wrap events on already-wrapped films.
Add production_wrap to the stale-stage clustering gate so a new wrap event
on a Post Production/Released film is rejected, reusing NEU-367's machinery.

Refs NEU-444."
```

---

## Self-Review

**Spec coverage:**
- "Add `production_wrap` to `_STALE_EVENT_TYPES` + docstring" → Task 1, Step 3. ✓
- "Tests mirroring NEU-367": new-event rejected on Post Production / Released → Task 1 Step 5 (`test_apply_rejects_stale_production_wrap_new_event`; the unit test covers `Released` via parametrize). ✓ production_wrap on In Production / NULL allowed → Task 1 Step 5 (`test_apply_keeps_production_wrap_on_in_production_film`) + unit `test_early_stage_on_unwrapped_film_is_not_stale`. ✓ `is_stale_stage` unit assertions extended → Task 1 Step 1. ✓
- Out-of-scope items (no `trailer`/`release_date`, no migration/config/DTO/FE) → Global Constraints. ✓

**Placeholder scan:** none — all steps carry exact code, paths, and commands.

**Type/name consistency:** `is_stale_stage`, `_STALE_EVENT_TYPES`, `_WRAPPED_STATUSES`, `ClusterPlan(film_id, existing_event_ids, unclustered_story_ids, film_status)`, `apply_cluster_decisions(session, *, plan, raw)`, `ClusterResult.events_created/stories_rejected/stories_clustered`, `_linked_story(session, film, url)`, `link_note="stale-stage:production_wrap"` — all match the current code at `src/upmovies/link/cluster.py` and the existing tests in `tests/integration/link/test_cluster.py`. ✓
