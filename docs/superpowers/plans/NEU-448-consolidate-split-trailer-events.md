# NEU-448 Consolidate Split Trailer Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the clusterer from splitting one trailer/first-look rollout into multiple events, and stop trailer-anticipation coverage from being typed `trailer`.

**Architecture:** A deterministic windowed dedup guardrail inside `apply_cluster_decisions` (`link/cluster.py`) force-attaches a model-proposed *new* `trailer`/`first_look` event to an existing same-type event whose `occurred_at` is within a recency window, instead of creating a duplicate. A new `LINK_SINGULAR_DEDUP_DAYS` config knob (default 14) is threaded to the apply function exactly like the existing `unresolved_tier`. Two cluster-prompt edits reinforce consolidation and reclassify anticipation as `other`. All changes live in `config.py` + `link/cluster.py` (+ threading in `link/pipeline.py` and `routers/ingest_admin.py`).

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, Pydantic v2 / pydantic-settings, pytest (pytest-asyncio auto mode), ruff, pyright. Everything runs in the container via `task` targets — never invoke `pytest`/`ruff`/`pyright`/`python` on the host.

## Global Constraints

- Run all tooling through `task` (container): `task test`, `task lint`, `task typecheck`, `task format`. All three of test/lint/typecheck must be green before a task is done; `task format` reformats.
- Modern type hints (`X | None`, `X | Y`); **no** `from __future__ import annotations`. ruff line length 100.
- TDD: write the failing test first, watch it fail, then implement.
- Integration tests use the `session` fixture against the test DB and are **scoped to their directory** (`tests/integration/link/`) — a single integration file run in isolation errors with a pytest-asyncio session-loop warning (known quirk). Run `task test -- tests/integration/link/` or the full suite, never one integration file alone.
- Commit messages: Conventional Commits subject, **no** Linear ID in subject (optional `Refs NEU-448.` in body), **no** `🤖` footer, **no** `Co-Authored-By`.
- No DB migration, no DTO/frontend change, no Stage-1 linker change.

---

### Task 1: Config knob `LINK_SINGULAR_DEDUP_DAYS`

**Files:**
- Modify: `src/upmovies/config.py:40` (add field after `link_cluster_attach_limit`)
- Test: `tests/unit/test_config.py`

**Interfaces:**
- Produces: `Settings.link_singular_dedup_days: int` (default `14`, env alias `LINK_SINGULAR_DEDUP_DAYS`). Consumed by Task 2's `_background_link` threading.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/test_config.py` (mirror the existing `test_settings_link_batch_size_default` / `..._override_from_env` pair; the `_settings(monkeypatch)` / env-setting helper already used in that file — copy the exact pattern from the neighbouring tests, which set required env vars then construct `Settings`):

```python
def test_settings_link_singular_dedup_days_default(monkeypatch):
    _set_required_env(monkeypatch)
    settings = Settings()
    assert settings.link_singular_dedup_days == 14


def test_settings_link_singular_dedup_days_override_from_env(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setenv("LINK_SINGULAR_DEDUP_DAYS", "7")
    settings = Settings()
    assert settings.link_singular_dedup_days == 7
```

> If the file uses a differently-named helper to seed required env (e.g. inline `monkeypatch.setenv` for `DATABASE_URL`/`ADMIN_TOKEN`/`TMDB_API_KEY`/`ANTHROPIC_API_KEY`), copy that exact setup from an adjacent test in the same file rather than `_set_required_env`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/test_config.py -k singular_dedup`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'link_singular_dedup_days'`.

- [ ] **Step 3: Add the config field**

In `src/upmovies/config.py`, immediately after line 40 (`link_cluster_attach_limit`):

```python
    link_singular_dedup_days: int = Field(default=14, alias="LINK_SINGULAR_DEDUP_DAYS")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `task test -- tests/unit/test_config.py -k singular_dedup`
Expected: PASS (2 passed).

- [ ] **Step 5: Lint + typecheck + commit**

Run: `task format && task lint && task typecheck`
Expected: clean.

```bash
git add src/upmovies/config.py tests/unit/test_config.py
git commit -m "feat(config): add LINK_SINGULAR_DEDUP_DAYS knob

Refs NEU-448."
```

---

### Task 2: Deterministic windowed dedup guardrail in `apply_cluster_decisions`

**Files:**
- Modify: `src/upmovies/link/cluster.py` — import (line 10), new constant (near line 46), `apply_cluster_decisions` (lines 343–452), `cluster_film_events` (lines 484–493)
- Modify: `src/upmovies/link/pipeline.py` — `_cluster_stage_sequential` (line 175), `_cluster_stage_batched` (line 215, apply call at 269), `run_link_ingest` (signature ~line 290, cluster-stage call ~line 383)
- Modify: `src/upmovies/routers/ingest_admin.py` — `_background_link` `run_link_ingest(...)` call (~line 90)
- Test: `tests/integration/link/test_cluster.py`

**Interfaces:**
- Consumes: `Settings.link_singular_dedup_days` (Task 1).
- Produces:
  - `apply_cluster_decisions(session, *, plan, raw, unresolved_tier="acceptable", dedup_days=14) -> ClusterResult`
  - `cluster_film_events(session, *, client, model, film_id, attach_limit, max_tokens=_DEFAULT_MAX_TOKENS, unresolved_tier="acceptable", dedup_days=14, run_date) -> tuple[ClusterResult, Usage]`
  - Module constant `_SINGULAR_BEAT_TYPES = {"trailer", "first_look"}`.
- Behaviour: when the model returns a *new* event (`existing is None`) whose `type` is in `_SINGULAR_BEAT_TYPES`, and the film has an existing (or same-pass) event of that type whose `occurred_at.date() >= plan.run_date - dedup_days`, the group's stories attach to that event instead of creating a duplicate.

- [ ] **Step 1: Write the failing integration tests**

Add to `tests/integration/link/test_cluster.py`. Reuse the file's existing `FakeClient` and `_linked_story` helpers (already defined at the top). Add one local helper for seeding a pre-existing event, then five tests:

```python
async def _existing_event(session, film, *, event_type, occurred_at, url):
    ev = Event(
        film_id=film.id,
        event_type=event_type,
        confidence="confirmed",
        occurred_at=occurred_at,
    )
    session.add(ev)
    await session.flush()
    seed = Story(
        source="X",
        url=url,
        title=f"seed {event_type}",
        link_status="linked",
        film_id=film.id,
        published_at=occurred_at,
        raw={"summary": ""},
    )
    session.add(seed)
    await session.flush()
    session.add(EventStory(event_id=ev.id, story_id=seed.id))
    await session.flush()
    return ev


async def test_new_trailer_merges_into_recent_existing_trailer(session):
    film = Film(tmdb_id=201, title="FF")
    session.add(film)
    await session.flush()
    ev = await _existing_event(
        session, film, event_type="trailer",
        occurred_at=datetime(2025, 12, 30, tzinfo=UTC), url="https://e/seed",
    )
    await _linked_story(session, film, "https://e/new", title="trailer released")
    await session.commit()

    client = FakeClient(
        {"events": [{"existing": None, "type": "trailer", "confidence": "confirmed", "stories": [1]}]}
    )
    result, _usage = await cluster_film_events(
        session, client=client, model="m", film_id=film.id,
        attach_limit=45, dedup_days=14, run_date=date(2026, 1, 1),
    )
    await session.commit()

    assert result.events_created == 0
    assert result.stories_clustered == 1
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 1
    links = (await session.execute(select(EventStory).where(EventStory.event_id == ev.id))).scalars().all()
    assert len(links) == 2


async def test_new_trailer_outside_window_stays_separate(session):
    film = Film(tmdb_id=202, title="FF2")
    session.add(film)
    await session.flush()
    await _existing_event(
        session, film, event_type="trailer",
        occurred_at=datetime(2025, 11, 1, tzinfo=UTC), url="https://e/seed2",
    )
    await _linked_story(session, film, "https://e/new2", title="trailer released")
    await session.commit()

    client = FakeClient(
        {"events": [{"existing": None, "type": "trailer", "confidence": "confirmed", "stories": [1]}]}
    )
    result, _usage = await cluster_film_events(
        session, client=client, model="m", film_id=film.id,
        attach_limit=45, dedup_days=14, run_date=date(2026, 1, 1),
    )
    await session.commit()

    assert result.events_created == 1
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 2


async def test_new_first_look_merges_into_recent_existing_first_look(session):
    film = Film(tmdb_id=203, title="FF3")
    session.add(film)
    await session.flush()
    await _existing_event(
        session, film, event_type="first_look",
        occurred_at=datetime(2025, 12, 30, tzinfo=UTC), url="https://e/seed3",
    )
    await _linked_story(session, film, "https://e/new3", title="concept art")
    await session.commit()

    client = FakeClient(
        {"events": [{"existing": None, "type": "first_look", "confidence": "confirmed", "stories": [1]}]}
    )
    result, _usage = await cluster_film_events(
        session, client=client, model="m", film_id=film.id,
        attach_limit=45, dedup_days=14, run_date=date(2026, 1, 1),
    )
    await session.commit()

    assert result.events_created == 0
    assert result.stories_clustered == 1


async def test_duplicate_casting_within_window_not_merged(session):
    film = Film(tmdb_id=204, title="FF4")
    session.add(film)
    await session.flush()
    await _existing_event(
        session, film, event_type="casting",
        occurred_at=datetime(2025, 12, 30, tzinfo=UTC), url="https://e/seed4",
    )
    await _linked_story(session, film, "https://e/new4", title="new actor joins")
    await session.commit()

    client = FakeClient(
        {"events": [{"existing": None, "type": "casting", "confidence": "confirmed", "stories": [1]}]}
    )
    result, _usage = await cluster_film_events(
        session, client=client, model="m", film_id=film.id,
        attach_limit=45, dedup_days=14, run_date=date(2026, 1, 1),
    )
    await session.commit()

    assert result.events_created == 1
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 2


async def test_two_new_trailer_groups_collapse_in_one_pass(session):
    film = Film(tmdb_id=205, title="FF5")
    session.add(film)
    await session.flush()
    await _linked_story(session, film, "https://e/a", title="trailer surfaced")
    await _linked_story(session, film, "https://e/b", title="trailer released")
    await session.commit()

    client = FakeClient(
        {"events": [
            {"existing": None, "type": "trailer", "confidence": "confirmed", "stories": [1]},
            {"existing": None, "type": "trailer", "confidence": "confirmed", "stories": [2]},
        ]}
    )
    result, _usage = await cluster_film_events(
        session, client=client, model="m", film_id=film.id,
        attach_limit=45, dedup_days=14, run_date=date(2026, 1, 1),
    )
    await session.commit()

    assert result.events_created == 1
    assert result.stories_clustered == 2
    events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert len(events) == 1
```

> Note on story numbering: `build_cluster_request` selects only *unclustered* linked stories (those with no `EventStory` row), so the seeded event's story is excluded and the single new story is `n=1`. In the two-group test both new stories are unclustered → `n=1`, `n=2`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/link/test_cluster.py -k "merge or window or collapse or not_merged"`
Expected: FAIL — `cluster_film_events()` got an unexpected keyword argument `dedup_days` (and, once that's added, the merge assertions fail because a duplicate event is still created).

- [ ] **Step 3: Add the import and constant**

In `src/upmovies/link/cluster.py` line 10, add `timedelta` (NEU-372 removed it; the guardrail needs it again):

```python
from datetime import UTC, date, datetime, timedelta
```

Near line 46, beside `_STALE_EVENT_TYPES`, add:

```python
_SINGULAR_BEAT_TYPES = {"trailer", "first_look"}
```

- [ ] **Step 4: Add `dedup_days` to `apply_cluster_decisions` and implement the guardrail**

Change the signature (line 343):

```python
async def apply_cluster_decisions(
    session: AsyncSession,
    *,
    plan: ClusterPlan,
    raw: str,
    unresolved_tier: str = "acceptable",
    dedup_days: int = 14,
) -> ClusterResult:
```

After `as_of_date = plan.run_date or now.date()` (line 383), seed the dedup targets from existing in-window same-type events:

```python
    window_floor = as_of_date - timedelta(days=dedup_days)
    dedup_targets: dict[str, Event] = {}
    for ev in existing_events:
        if ev.event_type in _SINGULAR_BEAT_TYPES and ev.occurred_at.date() >= window_floor:
            prev = dedup_targets.get(ev.event_type)
            if prev is None or ev.occurred_at > prev.occurred_at:
                dedup_targets[ev.event_type] = ev
```

In the new-event branch, replace the event-creation block (current lines 433–446, from `conf = downgrade_confidence(...)` through `events_created += 1`) with a guardrail check that either force-attaches to a target or creates and registers a new singular event:

```python
            target = dedup_targets.get(etype) if etype in _SINGULAR_BEAT_TYPES else None
            if target is not None:
                event = target
                event.updated_at = now
            else:
                conf = downgrade_confidence(
                    conf, best_tier((_tier_for(sid) for sid in group_sids), default=unresolved_tier)
                )
                occurred = min(
                    (by_id[sid].published_at or by_id[sid].fetched_at) for sid in group_sids
                )
                event = Event(
                    film_id=plan.film_id,
                    event_type=etype,
                    confidence=conf,
                    occurred_at=occurred,
                    region=group.region if etype == "release_date" else None,
                )
                session.add(event)
                await session.flush()
                events_created += 1
                if etype in _SINGULAR_BEAT_TYPES:
                    dedup_targets[etype] = event
```

Leave the shared `for sid in group_sids: session.add(EventStory(...))` loop (current lines 447–450) unchanged — both the attach and merge paths fall through to it.

- [ ] **Step 5: Thread `dedup_days` through `cluster_film_events`**

In `cluster_film_events` (line 484) add the param and pass it to `apply_cluster_decisions`. Signature:

```python
async def cluster_film_events(
    session: AsyncSession,
    *,
    client: Completer,
    model: str,
    film_id: UUID,
    attach_limit: int,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
    unresolved_tier: str = "acceptable",
    dedup_days: int = 14,
    run_date: date,
) -> tuple[ClusterResult, Usage]:
```

Find the `apply_cluster_decisions(...)` call inside `cluster_film_events` and add `dedup_days=dedup_days` to it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `task test -- tests/integration/link/test_cluster.py`
Expected: PASS (the five new tests plus all pre-existing cluster tests still green).

- [ ] **Step 7: Thread `dedup_days` through the pipeline and admin router**

In `src/upmovies/link/pipeline.py`:

`_cluster_stage_sequential` (line 175) — add `dedup_days: int = 14` to the keyword args (next to `unresolved_tier`), and add `dedup_days=dedup_days` to its `cluster_film_events(...)` call (~line 199).

`_cluster_stage_batched` (line 215) — add `dedup_days: int = 14` to the keyword args, and add `dedup_days=dedup_days` to the `apply_cluster_decisions(...)` call (line 269–270).

`run_link_ingest` (signature ~line 290) — add `dedup_days: int = 14` alongside `unresolved_tier`, and add `dedup_days=dedup_days` to the `cluster_stage(...)` call (~line 383, next to `unresolved_tier=unresolved_tier`).

In `src/upmovies/routers/ingest_admin.py`, `_background_link` (~line 90) `run_link_ingest(...)` call — add:

```python
                dedup_days=settings.link_singular_dedup_days,
```

- [ ] **Step 8: Run full suite + lint + typecheck**

Run: `task test && task format && task lint && task typecheck`
Expected: all green (the threading is additive with defaults, so existing pipeline tests are unaffected).

- [ ] **Step 9: Commit**

```bash
git add src/upmovies/link/cluster.py src/upmovies/link/pipeline.py src/upmovies/routers/ingest_admin.py tests/integration/link/test_cluster.py
git commit -m "fix(cluster): deterministically merge duplicate trailer/first_look events

Force-attach a model-proposed new trailer/first_look event to an existing
same-type event within LINK_SINGULAR_DEDUP_DAYS instead of creating a
duplicate. Prevents one trailer rollout from splitting across events.

Refs NEU-448."
```

---

### Task 3: Cluster prompt — anticipation → `other`, reinforce consolidation

**Files:**
- Modify: `src/upmovies/link/cluster.py` — `_INSTRUCTIONS` string (lines 75–130)

**Interfaces:**
- Consumes: nothing new. Produces: no signature change — prompt text only. No automated content assertion (prompt-wording tests are brittle and were deliberately avoided in NEU-359/NEU-368); correctness is verified by a manual re-cluster run (see Step 3).

- [ ] **Step 1: Strengthen the `trailer` definition (anticipation → `other`)**

In `_INSTRUCTIONS`, replace the `trailer` bullet (lines 88–89) with a version that excludes anticipation:

```python
- "trailer" means a promotional VIDEO that has been RELEASED for the public to watch right \
now (a trailer or teaser the audience can view today). Naming cast does not change this. \
Coverage that a trailer is merely COMING — "expected to arrive", "will drop", "teased", \
"coming soon", with no watchable video yet — is NOT a trailer; classify it as "other".
```

- [ ] **Step 2: Reinforce same-beat consolidation**

Immediately after the existing paragraph that ends "Five outlets reporting the same casting is one event." (line 83), append one sentence:

```python
A single trailer or first-look reveal reported across several days by many outlets is ONE \
event — attach later stories to the existing event rather than opening a new one.
```

- [ ] **Step 3: Verify no test regressions from the prompt change**

The prompt is not asserted verbatim by any test, but confirm the suite is still green (some integration tests build the payload and may substring-check instructions):

Run: `task test -- tests/integration/link tests/unit/link`
Expected: PASS. If any test asserts a now-changed substring of `_INSTRUCTIONS`, update that assertion to the new wording.

Then run `task format && task lint && task typecheck` — expected clean.

> **Manual verification (Tom's pass, not a merge blocker — real Anthropic key, token cost):** re-cluster the NEU-448 film's stories in localdev and confirm the 3 real trailer stories collapse to one `trailer` event, the Doctor-Doom reveal stays a separate `first_look`, and the "expected to arrive soon" story is typed `other` (hidden from the public feed via NEU-367's `_visible_events`). Drive via `docker exec -w /app upmovies_backend python ...` mirroring the documented re-link/re-synth flow. Because clustering is idempotent, cleaning the 4 already-recorded events requires resetting those stories to unclustered first.

- [ ] **Step 4: Commit**

```bash
git add src/upmovies/link/cluster.py
git commit -m "fix(cluster): classify trailer-anticipation as other, reinforce consolidation

Refs NEU-448."
```

---

## Self-Review

**Spec coverage:**
- Component 1 (windowed dedup guardrail) → Task 2 (import+constant, guardrail in `apply_cluster_decisions`, threading). ✓
- Component 2.1 (anticipation → `other`) → Task 3 Step 1. ✓
- Component 2.2 (reinforce consolidation) → Task 3 Step 2. ✓
- Component 3 (`LINK_SINGULAR_DEDUP_DAYS` knob + threading) → Task 1 (field) + Task 2 Steps 5,7 (threading). ✓
- Acceptance criteria (3 trailers collapse / first_look separate / anticipation `other` / distinct later trailer separate) → Task 2 tests (collapse, first_look, outside-window separate) + Task 3 manual pass (anticipation typing, LLM-driven). ✓
- Testing plan (windowed merge, outside-window separate, first_look, casting-not-merged, in-pass dup) → Task 2 Step 1 (five tests). ✓
- Scope/non-goals (no migration, no FE, no Stage-1, no self-heal) → honoured; self-heal caveat surfaced in Task 3 Step 3. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps. The one soft reference — copy the required-env helper from an adjacent config test — is because the helper name is file-local and unknown; the concrete env vars needed are listed. ✓

**Type consistency:** `dedup_days: int = 14` identical across `apply_cluster_decisions`, `cluster_film_events`, `_cluster_stage_sequential`, `_cluster_stage_batched`, `run_link_ingest`; `settings.link_singular_dedup_days` matches the Task 1 field name; `_SINGULAR_BEAT_TYPES` referenced consistently. ✓
