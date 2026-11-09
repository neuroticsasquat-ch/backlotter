# NEU-494 — Release-date restatement guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministically drop a `release_date` event whose claimed date equals a date the film has already held for more than a threshold, so a promo/roundup restating an established date can't create a duplicate release-date beat.

**Architecture:** The model extracts `claimed_date` per release_date event; code compares it to `film.release_date` and, when equal, checks how long we've held that date via NEU-493's `field_changed_at("release_date")` (falling back to `film.created_at`). Established > N days → drop; recently set → keep (may be the genuine announcement). Deterministic in Python; the LLM only extracts the date.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async), PostgreSQL, Anthropic Sonnet (clusterer), pytest + pytest-asyncio (auto mode).

## Global Constraints

- **DEPENDS ON NEU-493 (merged):** uses `field_changed_at` from `upmovies.catalog.queries` and the `catalog.film_field_change` table/trigger. Implement this only after NEU-493 is on the branch base.
- **Everything runs in Docker via `task`.** Never run `pytest`/`ruff`/`pyright`/`alembic`/`python` on the host. Container up (`task up`).
- **Type hints:** modern `X | None`. **No** `from __future__ import annotations`. **Lint:** ruff, line length 100. **TDD:** failing test first; pytest-asyncio `auto`.
- **Integration-test isolation quirk:** scope to the directory — `task test -- tests/integration/link/`.
- **No schema change** in this ticket (claimed_date is not persisted; `film.created_at` and the NEU-493 table already exist).
- **Commits:** implementer tasks do **NOT** commit — human commits the whole NEU-494 change once at the end after `task format`. Branch: `tom/neu-494-deterministic-release-date-restatement-guard-cluster`.
- **Coordinate with NEU-492:** both touch the new-event branch of `apply_cluster_decisions`. This ticket's release_date block goes right after `is_stale_stage`; if NEU-492 (casting block) has already merged, place this block adjacent to it (they're mutually exclusive by `etype`). Rebase-resolve if needed.

---

### Task 1: `claimed_date` extraction (cluster contract)

**Files:**
- Modify: `src/upmovies/link/cluster.py` (`ClusterGroup`, `parse_cluster_groups`, `_INSTRUCTIONS`)
- Test: `tests/unit/link/test_cluster_pure.py`

**Interfaces:**
- Produces: `ClusterGroup.claimed_date: date | None` — the release date a story asserts, parsed from an ISO `YYYY-MM-DD` string (None if absent/unparseable).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/link/test_cluster_pure.py`:

```python
def test_parse_reads_claimed_date_for_release_date_events():
    from datetime import date

    from upmovies.link.cluster import parse_cluster_groups

    raw = (
        '{"events": [{"existing": null, "type": "release_date", "confidence": "confirmed", '
        '"region": "US", "claimed_date": "2027-06-30", "stories": [1]}]}'
    )
    groups = parse_cluster_groups(raw, n_stories=1)
    assert groups is not None and groups[0].claimed_date == date(2027, 6, 30)


def test_parse_bad_claimed_date_is_none():
    from upmovies.link.cluster import parse_cluster_groups

    raw = (
        '{"events": [{"existing": null, "type": "release_date", "confidence": "confirmed", '
        '"claimed_date": "sometime 2027", "stories": [1]}]}'
    )
    groups = parse_cluster_groups(raw, n_stories=1)
    assert groups is not None and groups[0].claimed_date is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: FAIL — `ClusterGroup` has no `claimed_date`.

- [ ] **Step 3: Add `claimed_date` to `ClusterGroup`**

```python
@dataclass
class ClusterGroup:
    existing: int | None
    event_type: str | None
    confidence: str | None
    story_indices: list[int]
    region: str | None = None
    claimed_date: date | None = None
```

(If NEU-492 already added `cast`, keep it — just add `claimed_date` alongside.)

- [ ] **Step 4: Parse `claimed_date`**

In `parse_cluster_groups`, before building the `ClusterGroup`, add (note `date` is already imported in `cluster.py`):

```python
        claimed_raw = group.get("claimed_date")
        claimed_date = None
        if isinstance(claimed_raw, str):
            try:
                claimed_date = date.fromisoformat(claimed_raw)
            except ValueError:
                claimed_date = None
```

and pass `claimed_date=claimed_date` to the constructor.

- [ ] **Step 5: Update the prompt contract**

In `_INSTRUCTIONS`, add `"claimed_date"` to the return-JSON block:

```python
{"events": [{"existing": <existing event number or null>, "type": <type or null>, \
"confidence": "confirmed" | "rumored" | null, "region": <ISO 3166-1 alpha-2 or null>, \
"claimed_date": <YYYY-MM-DD or null>, \
"stories": [<story number n>, ...]}]}
```

Add one line to the release_date section (after the existing "A 'release_date' event requires…" paragraph):

```
For a "release_date" event, put the exact date the story asserts in "claimed_date" as \
YYYY-MM-DD (null if the story gives no concrete date). For every non-release_date event, null.
```

- [ ] **Step 6: Run tests + lint/typecheck**

Run: `task test -- tests/unit/link/test_cluster_pure.py && task format && task lint && task typecheck`
Expected: PASS, no errors.

---

### Task 2: Restatement drop + config knob + threading

**Files:**
- Modify: `src/upmovies/config.py` (`link_release_restate_days`)
- Modify: `src/upmovies/link/cluster.py` (`ClusterPlan.film_created_at`, set it in `build_cluster_request`; `field_changed_at` import; `release_restate_days` param on `cluster_film_events` + `apply_cluster_decisions`; the drop)
- Modify: `src/upmovies/link/pipeline.py` (thread `release_restate_days` through `_cluster_stage_sequential`, `_cluster_stage_batched`, `run_link_ingest`)
- Modify: `src/upmovies/routers/ingest_admin.py` (pass `settings.link_release_restate_days`)
- Test: `tests/integration/link/test_cluster.py`, `tests/unit/test_config.py`

**Interfaces:**
- Consumes: `field_changed_at(session, film_id, "release_date")` (NEU-493), `ClusterGroup.claimed_date` (Task 1).
- Produces: `apply_cluster_decisions(..., release_restate_days: int = 7)` drops a release_date group whose `claimed_date == plan.film_release_date` and whose date is established > `release_restate_days` days ago (`link_note="release-date-restated"`); `ClusterPlan.film_created_at: datetime | None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/link/test_cluster.py` (add `field_changed_at`'s dependency by importing `apply_cluster_decisions`, `ClusterPlan` — already imported; also `from upmovies.catalog.models import FilmFieldChange`):

```python
async def _apply_release_date(session, *, film, claimed, film_created_at, run_date,
                              restate_days=7):
    story = await _linked_story(session, film, "https://e/rd", title="release date news")
    await session.flush()
    plan = ClusterPlan(
        film_id=film.id,
        existing_event_ids=[],
        unclustered_story_ids=[story.id],
        film_status=film.status,
        film_release_date=film.release_date,
        film_created_at=film_created_at,
        run_date=run_date,
    )
    raw = json.dumps(
        {"events": [{"existing": None, "type": "release_date", "confidence": "confirmed",
                     "claimed_date": claimed, "stories": [1]}]}
    )
    return await apply_cluster_decisions(
        session, plan=plan, raw=raw, release_restate_days=restate_days
    )


async def test_release_date_restatement_of_established_date_drops(session):
    film = Film(tmdb_id=1, title="OK Madam 2", release_date=date(2026, 8, 12))
    session.add(film)
    await session.flush()
    result = await _apply_release_date(
        session, film=film, claimed="2026-08-12",
        film_created_at=datetime(2026, 1, 1, tzinfo=UTC), run_date=date(2026, 7, 4),
    )
    assert result.events_created == 0
    assert result.stories_rejected == 1
    ev = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert ev == []


async def test_release_date_recently_set_is_kept(session):
    film = Film(tmdb_id=1, title="OK Madam 2", release_date=date(2026, 8, 12))
    session.add(film)
    await session.flush()
    result = await _apply_release_date(
        session, film=film, claimed="2026-08-12",
        film_created_at=datetime(2026, 7, 2, tzinfo=UTC), run_date=date(2026, 7, 4),
    )
    assert result.events_created == 1  # date set 2 days ago (< 7) → may be the real announcement


async def test_release_date_changed_date_is_kept(session):
    film = Film(tmdb_id=1, title="OK Madam 2", release_date=date(2026, 8, 12))
    session.add(film)
    await session.flush()
    result = await _apply_release_date(
        session, film=film, claimed="2026-09-01",
        film_created_at=datetime(2026, 1, 1, tzinfo=UTC), run_date=date(2026, 7, 4),
    )
    assert result.events_created == 1  # different date → genuine change


async def test_release_date_null_claim_is_kept(session):
    film = Film(tmdb_id=1, title="OK Madam 2", release_date=date(2026, 8, 12))
    session.add(film)
    await session.flush()
    result = await _apply_release_date(
        session, film=film, claimed=None,
        film_created_at=datetime(2026, 1, 1, tzinfo=UTC), run_date=date(2026, 7, 4),
    )
    assert result.events_created == 1  # no parseable date → unchanged behavior


async def test_release_date_uses_field_changed_at_over_created_at(session):
    film = Film(tmdb_id=1, title="OK Madam 2", release_date=date(2026, 8, 12))
    session.add(film)
    await session.flush()
    # Film row is fresh (created_at ~ now), but we learned this date 33 days ago.
    session.add(FilmFieldChange(
        film_id=film.id, field="release_date",
        old_value=None, new_value="2026-08-12", changed_at=datetime(2026, 6, 1, tzinfo=UTC),
    ))
    await session.flush()
    result = await _apply_release_date(
        session, film=film, claimed="2026-08-12",
        film_created_at=datetime(2026, 7, 3, tzinfo=UTC), run_date=date(2026, 7, 4),
    )
    assert result.events_created == 0  # established 33 days ago per field_changed_at → drop
    assert result.stories_rejected == 1
```

Update `tests/unit/test_config.py` (`test_settings_summary_defaults` or a dedicated link-defaults test) to assert the new knob:

```python
    assert s.link_release_restate_days == 7
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/integration/link/ tests/unit/test_config.py`
Expected: FAIL — `ClusterPlan` has no `film_created_at`; `apply_cluster_decisions` has no `release_restate_days`; knob missing.

- [ ] **Step 3: Add the config knob**

In `src/upmovies/config.py`, next to `link_singular_dedup_days`:

```python
    link_release_restate_days: int = Field(default=7, alias="LINK_RELEASE_RESTATE_DAYS")
```

- [ ] **Step 4: Add `film_created_at` to `ClusterPlan` and populate it**

In `src/upmovies/link/cluster.py`, extend the dataclass:

```python
@dataclass
class ClusterPlan:
    film_id: UUID
    existing_event_ids: list[UUID]
    unclustered_story_ids: list[UUID]
    film_status: str | None = None
    film_release_date: date | None = None
    run_date: date | None = None
    film_created_at: datetime | None = None
```

In `build_cluster_request`, add `film_created_at=film.created_at` to the `ClusterPlan(...)` construction.

- [ ] **Step 5: Import `field_changed_at` and add `release_restate_days` params**

Add the import in `cluster.py`:

```python
from upmovies.catalog.queries import field_changed_at
```

Add `release_restate_days: int = 7` to both `apply_cluster_decisions(...)` and `cluster_film_events(...)` signatures, and pass it through in `cluster_film_events`'s call to `apply_cluster_decisions`:

```python
    return await apply_cluster_decisions(
        session, plan=plan, raw=raw, unresolved_tier=unresolved_tier,
        dedup_days=dedup_days, release_restate_days=release_restate_days,
    ), usage
```

- [ ] **Step 6: Add the drop in `apply_cluster_decisions`**

In the new-event branch, right **after** the `if is_stale_stage(...)` block (and adjacent to NEU-492's casting block if present), add:

```python
            if (
                etype == "release_date"
                and group.claimed_date is not None
                and plan.film_release_date is not None
                and group.claimed_date == plan.film_release_date
            ):
                established = await field_changed_at(session, plan.film_id, "release_date")
                baseline = established or plan.film_created_at
                if baseline is not None and (as_of_date - baseline.date()).days > release_restate_days:
                    for sid in group_sids:
                        story = by_id[sid]
                        story.link_status = "rejected"
                        story.film_id = None
                        story.link_confidence = None
                        story.link_note = "release-date-restated"
                        assigned.add(sid)
                        stories_rejected += 1
                    continue
```

- [ ] **Step 7: Thread `release_restate_days` through the pipeline**

In `src/upmovies/link/pipeline.py`, mirror `dedup_days` exactly:
- `_cluster_stage_sequential(...)`: add param `release_restate_days: int = 7`; add `release_restate_days=release_restate_days,` to the `cluster_film_events(...)` call.
- `_cluster_stage_batched(...)`: add param `release_restate_days: int = 7`; add `release_restate_days=release_restate_days,` to the `apply_cluster_decisions(...)` call.
- `run_link_ingest(...)`: add param `release_restate_days: int = 7`; add `release_restate_days=release_restate_days,` to the `cluster_stage(...)` call.

In `src/upmovies/routers/ingest_admin.py`, at the `run_link_ingest(...)` call (next to `dedup_days=settings.link_singular_dedup_days,`), add:

```python
                release_restate_days=settings.link_release_restate_days,
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `task test -- tests/integration/link/ tests/unit/test_config.py`
Expected: PASS (all five release_date tests + config).

- [ ] **Step 9: Full suite + lint + typecheck**

Run: `task format && task lint && task typecheck && task test`
Expected: all green.

---

## Wrap-up (human, once)

- [ ] Confirm NEU-493 is present on the branch base (`field_changed_at` importable, `catalog.film_field_change` migrated).
- [ ] Full local CI green: `task format && task lint && task typecheck && task test`; `alembic heads` shows one head (no new migration in this ticket).
- [ ] Commit on `tom/neu-494-deterministic-release-date-restatement-guard-cluster` via `/commit-msg` (e.g. `feat(link): drop restated release-date events for established dates`), no Linear ID in subject, no footer/Co-Authored-By.
- [ ] Open PR via `/pr-desc`; title `feat(link): drop restated release-date events for established dates (NEU-494)`; `🤖 Generated with Claude Code` footer in the PR body only.

## Self-review notes (coverage vs. spec Part C)

- **C1 `claimed_date` extraction** → Task 1. **C2 deterministic drop** (established-date compare via `field_changed_at` with `created_at` baseline, recency knob, changed-date keep, null passthrough) → Task 2.
- **No schema change** — consumes NEU-493's table + helper. Dependency asserted in Global Constraints and Wrap-up.
- Type consistency: `ClusterGroup.claimed_date: date | None`, `ClusterPlan.film_created_at: datetime | None`, `release_restate_days: int` threaded identically to `dedup_days` across `cluster_film_events` / `apply_cluster_decisions` / `pipeline.py` / `ingest_admin.py`.
