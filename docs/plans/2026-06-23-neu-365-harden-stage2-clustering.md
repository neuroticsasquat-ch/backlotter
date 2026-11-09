# Harden Stage-2 Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop high-volume films producing zero events by replacing the per-story UUID echo in the Stage-2 cluster response with compact integer indices, raising/parameterizing `max_tokens`, deduping duplicate story attachments, and skipping unparseable responses gracefully.

**Architecture:** All clustering logic lives in `src/upmovies/link/cluster.py`, whose pure `build_cluster_request`/`apply_cluster_decisions` halves are shared by both the sequential (`cluster_film_events`) and batched (`build_cluster_batch_request` → pipeline apply) paths — so every fix is structural across both, preserving the NEU-298 parity property. New stories are presented to the model with a 1-based integer id `n` (symmetric with how existing events are already referenced by position); `apply` maps `n` → `ClusterPlan.unclustered_story_ids[n-1]`, the canonical order captured at build time.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async + asyncpg, Pydantic v2 / pydantic-settings, pytest (+ pytest-asyncio auto mode). Anthropic Messages + Batches API via the project's `Completer`/`BatchCompleter` client surface.

## Global Constraints

- **Everything runs in the container via `task`.** Never run `pytest`/`ruff`/`pyright`/`python` on the host. Container must be up: `task up`.
- **Test command is directory-scoped:** `task test -- tests/integration/link/`. Running a *single* integration file/node in isolation triggers a known pytest-asyncio session-loop error — always scope to the `tests/integration/link/` directory so `test_cluster.py`, `test_pipeline.py`, `test_roster.py` collect together.
- **Type hints:** modern `X | None` / `X | Y`. **No** `from __future__ import annotations`. ruff line length 100 (rules E,F,W,I,B,UP).
- **TDD:** write the failing test first; pytest-asyncio is `auto` mode (no `@pytest.mark.asyncio`). Integration tests use the `session` fixture against the test DB.
- **One backend PR**, branch `tom/neu-365-backend-harden-stage-2-clustering-cluster-json-truncates-on`. **Commit once at the end** (Task 5) after the full CI gate is green — do not commit per task (project subagent-driven workflow). Run `task format` before committing; pre-commit hooks delegate into the container, so commit normally (no `--no-verify`).
- **No DB migration, no FE, no new env beyond the one `max_tokens` config knob.**
- **Parity is non-negotiable:** sequential and batched Stage-2 must keep producing identical `Event`/`EventStory` rows. Both call the same `apply_cluster_decisions`.

## Preconditions / Setup

- Work inside `upcoming-movies-backend/` (the umbrella root is not a git repo; the backend is). Verify branch/status first.
- Create the ticket branch from an up-to-date `main` if it does not already exist:
  ```bash
  cd upcoming-movies-backend
  git status            # confirm clean
  git checkout main && git pull
  git checkout -b tom/neu-365-backend-harden-stage-2-clustering-cluster-json-truncates-on
  ```
- Ensure the stack is running: `task up`.

## File Structure

| File | Responsibility | Change |
| -- | -- | -- |
| `src/upmovies/config.py` | settings | **Modify** — add `link_cluster_max_tokens` |
| `src/upmovies/link/cluster.py` | Stage-2 build/apply | **Modify** — integer contract, `max_tokens` param, dedup, parse guard |
| `src/upmovies/link/pipeline.py` | Stage-2 stage orchestration | **Modify** — thread `cluster_max_tokens` |
| `src/upmovies/routers/ingest_admin.py` | link trigger | **Modify** — pass `settings.link_cluster_max_tokens` |
| `tests/integration/link/test_cluster.py` | build/apply tests | **Modify** — integer fixtures, dedup + parse-guard tests, max_tokens param test |
| `tests/integration/link/test_pipeline.py` | pipeline/parity tests | **Modify** — fakes echo `n`, max_tokens assertions, threading test |

---

### Task 1: Configurable cluster `max_tokens`

Raise the cap from 1500 to a 4096 default and expose it as a setting threaded from the router through the pipeline to both cluster paths. Independent of the contract change; lands first as an easy green checkpoint.

**Files:**
- Modify: `src/upmovies/config.py`
- Modify: `src/upmovies/link/cluster.py` (`_MAX_TOKENS` constant, `cluster_film_events`, `build_cluster_batch_request`)
- Modify: `src/upmovies/link/pipeline.py` (`_cluster_stage_sequential`, `_cluster_stage_batched`, `run_link_ingest`)
- Modify: `src/upmovies/routers/ingest_admin.py`
- Test: `tests/integration/link/test_cluster.py`, `tests/integration/link/test_pipeline.py`

**Interfaces:**
- Produces: `cluster_film_events(..., max_tokens: int = 4096)`, `build_cluster_batch_request(..., max_tokens: int = 4096)`, `run_link_ingest(..., cluster_max_tokens: int = 4096)`, `_cluster_stage_sequential(..., cluster_max_tokens: int)`, `_cluster_stage_batched(..., cluster_max_tokens: int)`, `Settings.link_cluster_max_tokens: int`.

- [ ] **Step 1: Write the failing tests**

In `tests/integration/link/test_cluster.py`, update the existing default assertion and add a param-plumbing test. Change the assertion in `test_build_cluster_batch_request_wraps_into_batch_request`:

```python
    assert req.max_tokens == 4096
```

Add a new test below it:

```python
async def test_build_cluster_batch_request_honours_max_tokens(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    await _linked_story(session, film, "https://e/1")
    await session.commit()

    built = await build_cluster_batch_request(
        session,
        custom_id=str(film.id),
        model="cluster-m",
        film_id=film.id,
        recency_days=45,
        max_tokens=9999,
    )
    assert built is not None
    req, _plan = built
    assert req.max_tokens == 9999
```

In `tests/integration/link/test_pipeline.py`, update the default assertion in `test_batched_cluster_request_mapping`:

```python
        assert r.max_tokens == 4096
```

Add a threading test that drives the full pipeline (place it after `test_batched_cluster_request_mapping`):

```python
async def test_run_link_ingest_threads_cluster_max_tokens(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all([await _story("https://e/a", published_offset_days=1)])
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    client = FakeClient()
    await run_link_ingest(
        session_factory=lambda: session,
        client=client,
        run_id=run_id,
        model="link-m",
        cluster_model="cluster-m",
        recency_days=45,
        batch_size=1,
        floor=0.7,
        use_batches=True,
        cluster_max_tokens=7777,
    )

    reqs = client.cluster_batch_requests
    assert reqs is not None
    assert all(r.max_tokens == 7777 for r in reqs)
```

> Note: `test_batched_request_mapping` asserts `r.max_tokens == 2048` for the **Stage-1 link** batch (`linker._MAX_TOKENS`). Leave it unchanged — Task 1 only touches the Stage-2 cluster cap.

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/integration/link/`
Expected: FAIL — `test_build_cluster_batch_request_honours_max_tokens` and `test_run_link_ingest_threads_cluster_max_tokens` error on the unexpected `max_tokens` / `cluster_max_tokens` keyword arguments; the two updated `== 4096` assertions fail (still 1500).

- [ ] **Step 3: Add the config setting**

In `src/upmovies/config.py`, add directly after the `link_use_batches` line:

```python
    link_cluster_max_tokens: int = Field(default=4096, alias="LINK_CLUSTER_MAX_TOKENS")
```

- [ ] **Step 4: Parameterize `max_tokens` in `cluster.py`**

Replace the module constant:

```python
_DEFAULT_MAX_TOKENS = 4096
```

(Remove the old `_MAX_TOKENS = 1500`.) Add a `max_tokens` parameter to both public entry points and use it instead of the constant.

`build_cluster_batch_request` signature + body:

```python
async def build_cluster_batch_request(
    session: AsyncSession,
    *,
    custom_id: str,
    model: str,
    film_id: UUID,
    recency_days: int,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
) -> tuple[BatchRequest, ClusterPlan] | None:
    """Wrap build_cluster_request into a BatchRequest ready for the Anthropic Batch API."""
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
            max_tokens=max_tokens,
        ),
        plan,
    )
```

`cluster_film_events` signature + the `complete` call:

```python
async def cluster_film_events(
    session: AsyncSession,
    *,
    client: Completer,
    model: str,
    film_id: UUID,
    recency_days: int,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
) -> ClusterResult:
    built = await build_cluster_request(session, film_id=film_id, recency_days=recency_days)
    if built is None:
        return ClusterResult(0, 0)
    system, messages, plan = built
    raw = await client.complete(
        model=model,
        system=system,
        messages=messages,
        max_tokens=max_tokens,
    )
    return await apply_cluster_decisions(session, plan=plan, raw=raw)
```

- [ ] **Step 5: Thread `cluster_max_tokens` through `pipeline.py`**

Add `cluster_max_tokens: int` to both stage signatures and pass it down.

In `_cluster_stage_sequential`, add the parameter to the keyword-only signature and update the `cluster_film_events` call:

```python
async def _cluster_stage_sequential(
    *,
    session_factory: SessionFactory,
    client: Completer,
    run_id: UUID,
    model: str,
    film_ids: Sequence[UUID],
    recency_days: int,
    cluster_max_tokens: int,
) -> tuple[int, int]:
    ...
                cluster = await cluster_film_events(
                    s,
                    client=client,
                    model=model,
                    film_id=film_id,
                    recency_days=recency_days,
                    max_tokens=cluster_max_tokens,
                )
```

In `_cluster_stage_batched`, add the parameter and update the `build_cluster_batch_request` call:

```python
async def _cluster_stage_batched(
    *,
    session_factory: SessionFactory,
    client: BatchCompleter,
    run_id: UUID,
    model: str,
    film_ids: Sequence[UUID],
    recency_days: int,
    cluster_max_tokens: int,
) -> tuple[int, int]:
    ...
            built = await build_cluster_batch_request(
                s,
                custom_id=str(film_id),
                model=model,
                film_id=film_id,
                recency_days=recency_days,
                max_tokens=cluster_max_tokens,
            )
```

In `run_link_ingest`, add the parameter (with a default so existing call sites/tests keep working) and pass it to the selected stage:

```python
async def run_link_ingest(
    *,
    session_factory: SessionFactory,
    client: LinkClient,
    run_id: UUID,
    model: str,
    cluster_model: str,
    recency_days: int,
    batch_size: int,
    floor: float,
    use_batches: bool = False,
    cluster_max_tokens: int = 4096,
) -> LinkIngestResult:
    ...
    cluster_stage = _cluster_stage_batched if use_batches else _cluster_stage_sequential
    events_created, stories_clustered = await cluster_stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=cluster_model,
        film_ids=film_ids,
        recency_days=recency_days,
        cluster_max_tokens=cluster_max_tokens,
    )
```

- [ ] **Step 6: Wire the setting in the router**

In `src/upmovies/routers/ingest_admin.py`, add the argument to the `run_link_ingest(...)` call inside `_background_link` (after `use_batches=...`):

```python
                use_batches=settings.link_use_batches,
                cluster_max_tokens=settings.link_cluster_max_tokens,
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `task test -- tests/integration/link/`
Expected: PASS — all link tests green, including the two new max_tokens tests.

---

### Task 2: Compact integer story contract

Replace the per-story UUID echo with a 1-based integer index in the prompt, the `new_stories` payload, and the apply mapping. This is the truncation fix. All existing fixtures that reference stories by UUID migrate to integers in the same task (they break otherwise).

**Files:**
- Modify: `src/upmovies/link/cluster.py` (`_INSTRUCTIONS`, `build_cluster_request`, `apply_cluster_decisions`)
- Test: `tests/integration/link/test_cluster.py`, `tests/integration/link/test_pipeline.py`

**Interfaces:**
- Consumes: `ClusterPlan.unclustered_story_ids` (existing) as the canonical `n → story_id` order.
- Produces: `new_stories` items shaped `{"n": <int>, "title": str, "summary": str}`; model output `"stories"` arrays now hold integers; `apply_cluster_decisions` maps integer `n` → `plan.unclustered_story_ids[n-1]`.

- [ ] **Step 1: Write/migrate the failing tests**

In `tests/integration/link/test_cluster.py`:

Update `test_build_cluster_request_builds_payload_and_plan` — replace the `new_stories` id assertion:

```python
    assert {s["n"] for s in payload["new_stories"]} == {1, 2}
    assert {s["title"] for s in payload["new_stories"]} == {"A", "B"}
```

Migrate every canned `"stories": [str(...)]` to integer indices. For single-unclustered-story cases the index is always `1`:

- `test_creates_new_event_for_unclustered_stories`: `"stories": [str(story.id)]` → `"stories": [1]`
- `test_attaches_to_existing_event`: `"stories": [str(second.id)]` → `"stories": [1]`
- `test_apply_creates_new_event`: `"stories": [str(s1.id)]` → `"stories": [1]`
- `test_apply_attaches_to_existing_by_plan_index`: `"stories": [str(second.id)]` → `"stories": [1]`
- `test_apply_skips_invalid_new_event`: `"stories": [str(s1.id)]` → `"stories": [1]`

For the two-story `test_apply_uses_build_time_event_order_across_sessions`, derive indices from the plan so the test is robust to query order. Replace the `raw = json.dumps({...})` block with:

```python
    n_s1 = plan.unclustered_story_ids.index(s1.id) + 1
    n_s2 = plan.unclustered_story_ids.index(s2.id) + 1
    raw = json.dumps(
        {
            "events": [
                {"existing": 1, "stories": [n_s1]},
                {
                    "existing": None,
                    "type": "casting",
                    "confidence": "rumored",
                    "stories": [n_s2],
                },
            ]
        }
    )
```

In `tests/integration/link/test_pipeline.py`, update the two fakes that echo story refs back. In `FakeClient._decide`, replace the cluster branch:

```python
        new_ns = [s["n"] for s in json.loads(messages[0]["content"])["new_stories"]]
        return json.dumps(
            {
                "events": [
                    {
                        "existing": None,
                        "type": "trailer",
                        "confidence": "confirmed",
                        "stories": new_ns,
                    }
                ]
            }
        )
```

In `_ClusterFailBatchClient.complete_batch`, replace the ok-branch story extraction:

```python
                new_ns = [s["n"] for s in payload["new_stories"]]
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id,
                    ok=True,
                    text=json.dumps(
                        {
                            "events": [
                                {
                                    "existing": None,
                                    "type": "trailer",
                                    "confidence": "confirmed",
                                    "stories": new_ns,
                                }
                            ]
                        }
                    ),
                )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/integration/link/`
Expected: FAIL — `test_build_cluster_request_builds_payload_and_plan` fails on missing `"n"` key; apply tests find no story for integer refs (0 events/0 clustered) because `build`/`apply` still emit/expect UUIDs.

- [ ] **Step 3: Emit integer ids in `build_cluster_request`**

Replace the `by_id` / `new_payload` construction (the block building `new_payload`) with a 1-based enumeration over `unclustered`:

```python
    new_payload = [
        {
            "n": i,
            "title": s.title,
            "summary": (str(s.raw.get("summary", "")) if isinstance(s.raw, dict) else "")[
                :_SUMMARY_MAX
            ],
        }
        for i, s in enumerate(unclustered, start=1)
    ]
```

`plan.unclustered_story_ids` is already `[s.id for s in unclustered]` (unchanged), so `n` and the plan share the exact same order.

- [ ] **Step 4: Update the prompt schema in `_INSTRUCTIONS`**

Replace `_INSTRUCTIONS` with:

```python
_INSTRUCTIONS = """You group a single film's news stories into distinct EVENTS — real beats \
in its life (casting, a trailer, a release-date change, production milestones, etc.) — and \
classify each. You are given the FILM, its EXISTING recent events (numbered from 1), and NEW \
stories to place (each with an integer id "n").

For each new story, either attach it to an existing event (it continues a beat already \
logged) or assign it to a new event (a beat not yet logged). Group new stories that report \
the SAME beat into ONE new event; split different beats into separate events. Five outlets \
reporting the same casting is one event.

New events carry:
- "type": one of announced, casting, production_start, production_wrap, release_date, \
trailer, other
- "confidence": "confirmed" if reported as fact, "rumored" if speculation/unconfirmed.

Return ONLY JSON — no prose, no markdown:
{"events": [{"existing": <existing event number or null>, "type": <type or null>, \
"confidence": "confirmed" | "rumored" | null, "stories": [<story number n>, ...]}]}

When "existing" is a number, attach its "stories" to that event ("type"/"confidence" may \
be null). Otherwise it is a new event and "type"/"confidence" are required. "existing" \
refers to an EXISTING event's number; "stories" lists NEW story numbers "n". Every new \
story's "n" must appear in exactly one group."""
```

- [ ] **Step 5: Map integer ids in `apply_cluster_decisions`**

Replace the `by_id` build (keyed by `str(s.id)`), the `data = json.loads(...)` line, and the per-group `sids` resolution. The story lookup becomes UUID-keyed and the index maps off the canonical plan order:

```python
    by_id = {s.id: s for s in stories}
    story_ids = plan.unclustered_story_ids  # n (1-based) -> story_ids[n - 1]

    data = json.loads(_extract_json_object(raw))

    now = datetime.now(UTC)
    assigned: set[UUID] = set()
    events_created = stories_clustered = 0

    for group in data.get("events", []):
        group_sids: list[UUID] = []
        for n in group.get("stories") or []:
            if not isinstance(n, int) or not (1 <= n <= len(story_ids)):
                continue
            sid = story_ids[n - 1]
            if sid not in by_id or sid in assigned:
                continue
            group_sids.append(sid)
        if not group_sids:
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
            occurred = min((by_id[sid].published_at or by_id[sid].fetched_at) for sid in group_sids)
            event = Event(
                film_id=plan.film_id, event_type=etype, confidence=conf, occurred_at=occurred
            )
            session.add(event)
            await session.flush()
            events_created += 1
        for sid in group_sids:
            session.add(EventStory(event_id=event.id, story_id=sid))
            assigned.add(sid)
            stories_clustered += 1

    return ClusterResult(events_created, stories_clustered)
```

Note: `story_id=sid` is now a `UUID` (no more `UUID(sid)` from a string). The intra-group dedup is deliberately **not** added here — that is Task 3.

- [ ] **Step 6: Run tests to verify they pass**

Run: `task test -- tests/integration/link/`
Expected: PASS — all link tests green, including the parity test `test_links_then_clusters_recent_pending[False/True]` and both batched cluster tests, now driven by integer refs.

---

### Task 3: Intra-group dedup (failure mode 2)

A model that lists the same story number twice within one group must not insert the `(event_id, story_id)` pair twice. Add the intra-group guard and a regression test reproducing the `event_story_pkey` violation.

**Files:**
- Modify: `src/upmovies/link/cluster.py` (`apply_cluster_decisions`)
- Test: `tests/integration/link/test_cluster.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/link/test_cluster.py`:

```python
async def test_apply_dedups_repeated_story_within_group(session):
    """Failure mode 2: a story number repeated inside one group must insert once,
    not violate event_story_pkey."""
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1")
    await session.commit()

    plan = ClusterPlan(film_id=film.id, existing_event_ids=[], unclustered_story_ids=[s1.id])
    raw = json.dumps(
        {
            "events": [
                {
                    "existing": None,
                    "type": "trailer",
                    "confidence": "confirmed",
                    "stories": [1, 1],
                }
            ]
        }
    )
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.stories_clustered == 1
    links = (await session.execute(select(EventStory))).scalars().all()
    assert [el.story_id for el in links] == [s1.id]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `task test -- tests/integration/link/`
Expected: FAIL — `test_apply_dedups_repeated_story_within_group` raises an `IntegrityError`/`UniqueViolationError` on `event_story_pkey` (the duplicate `(event_id, story_id)` insert), exactly reproducing the ticket's failure mode 2.

- [ ] **Step 3: Add the intra-group guard**

In `apply_cluster_decisions`, extend the dedup check to also reject a story already added to the current group:

```python
            if sid not in by_id or sid in assigned or sid in group_sids:
                continue
```

- [ ] **Step 4: Run test to verify it passes**

Run: `task test -- tests/integration/link/`
Expected: PASS — the dupe collapses to a single `EventStory`; `stories_clustered == 1`.

---

### Task 4: Graceful parse-failure guard

An unparseable cluster response should leave the film unclustered (retried next run) and log a warning, not raise. No retry — truncation is fixed structurally in Task 2.

**Files:**
- Modify: `src/upmovies/link/cluster.py` (`apply_cluster_decisions`)
- Test: `tests/integration/link/test_cluster.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/link/test_cluster.py`:

```python
async def test_apply_returns_empty_on_unparseable_response(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1")
    await session.commit()

    plan = ClusterPlan(film_id=film.id, existing_event_ids=[], unclustered_story_ids=[s1.id])
    result = await apply_cluster_decisions(session, plan=plan, raw="not json {")
    await session.commit()

    assert result.events_created == 0 and result.stories_clustered == 0
    assert (await session.execute(select(EventStory))).scalars().all() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `task test -- tests/integration/link/`
Expected: FAIL — `test_apply_returns_empty_on_unparseable_response` raises `json.JSONDecodeError` out of `apply_cluster_decisions`.

- [ ] **Step 3: Add the parse guard**

In `apply_cluster_decisions`, wrap the parse (replace the bare `data = json.loads(_extract_json_object(raw))` line):

```python
    try:
        data = json.loads(_extract_json_object(raw))
    except json.JSONDecodeError:
        log.warning("cluster: unparseable response for film %s", plan.film_id)
        return ClusterResult(0, 0)
```

(`import json` is already at the top of the module, so `json.JSONDecodeError` is available.)

- [ ] **Step 4: Run test to verify it passes**

Run: `task test -- tests/integration/link/`
Expected: PASS — unparseable input returns `ClusterResult(0, 0)`, writes nothing, raises nothing.

---

### Task 5: Full CI gate, commit, and ship

Single commit for the whole change after the complete local CI pipeline is green, then push and open the PR.

**Files:** none (verification + git).

- [ ] **Step 1: Format**

Run: `task format`
Expected: ruff reformats/no changes needed; exits clean.

- [ ] **Step 2: Full test suite**

Run: `task test`
Expected: PASS — entire suite green (not just the link directory).

- [ ] **Step 3: Lint**

Run: `task lint`
Expected: `ruff check src tests` reports no errors.

- [ ] **Step 4: Type-check**

Run: `task typecheck`
Expected: `pyright src tests` reports no errors.

- [ ] **Step 5: Commit, push, open PR**

Stage and commit once (Conventional Commits subject; **no** Linear ID in the subject, optional `Refs NEU-365.` in the body; **no** `🤖 Generated with Claude Code` footer in the commit; **no** `Co-Authored-By`):

```bash
git add -A
git commit -m "fix: harden Stage-2 clustering against truncation and duplicate inserts

Reference new stories by compact 1-based index instead of echoing UUIDs,
raise and parameterize the cluster max_tokens (LINK_CLUSTER_MAX_TOKENS,
default 4096), dedup repeated story refs within a group, and skip
unparseable cluster responses gracefully.

Refs NEU-365."
git push -u origin tom/neu-365-backend-harden-stage-2-clustering-cluster-json-truncates-on
```

Open the PR via the project's ship flow (PR title carries the Linear ID parenthetical, e.g. `fix: harden Stage-2 clustering … (NEU-365)`; the `🤖 Generated with Claude Code` footer goes in the PR **body** only).

Expected: branch pushed; PR open against the integration/release branch; CI green.

---

## Self-Review

**Spec coverage:**
- Compact integer story contract → Task 2 (build emits `n`, instructions updated, apply maps `n` → plan order). ✅
- Configurable `max_tokens` (default 4096, `link_cluster_max_tokens`, threaded) → Task 1. ✅
- Intra-group dedup fixing `event_story_pkey` → Task 3. ✅
- Graceful parse-failure (warning + `(0,0)`, no retry, no failed-metric counting) → Task 4. ✅
- NEU-298 parity preserved + fixtures migrated to integer JSON → Task 2 (Steps 1 & 6 cover the `test_pipeline.py` fakes and the parity test). ✅
- Both sequential and batched paths fixed via shared `apply` → structural in Tasks 1–4. ✅
- No migration / no FE → none added. ✅

**Placeholder scan:** No TBD/TODO; every code step shows the concrete edit and exact `task` command with expected output.

**Type consistency:** `max_tokens`/`cluster_max_tokens: int` defaults (4096) consistent across `cluster.py`, `pipeline.py`, `run_link_ingest`, and the router. `assigned`/`group_sids` typed `set[UUID]`/`list[UUID]`; `EventStory(story_id=sid)` takes the `UUID` directly (no `UUID(sid)`). `_DEFAULT_MAX_TOKENS` replaces `_MAX_TOKENS` at every use site (both `cluster_film_events` and `build_cluster_batch_request`). Stage-1's `linker._MAX_TOKENS == 2048` assertion left untouched.

**Scope:** Single backend PR, four focused changes plus a ship task; no decomposition needed.
