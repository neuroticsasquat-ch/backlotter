# Stage-1 Link via Batches API (`link_use_batches`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind a default-off `link_use_batches` config flag, run Stage-1 linking through one Message Batch (`AnthropicClient.complete_batch`) instead of N sequential `complete()` calls, producing the identical per-story outcomes — including failure behavior.

**Architecture:** Extract the two reusable pieces of `link_story_batch` (`build_link_request`, `apply_link_decisions`) into pure functions so both execution paths call the *same* code — parity is structural, not hand-maintained. `run_link_ingest` gains a `use_batches` param and dispatches Stage 1 to one of two helpers (`_link_stage_sequential`, the lifted-out current loop; `_link_stage_batched`, the new path that builds all N `BatchRequest`s up front, submits one batch, then applies each chunk's result in its own session+commit with the same per-chunk failure isolation). Stage 2 (clustering) and run finalization are untouched.

**Tech Stack:** Python 3.13, async SQLAlchemy 2, Pydantic-settings, `anthropic` Message Batches API (`complete_batch` from NEU-295), pytest (pytest-asyncio auto mode), ruff, pyright. All tooling runs in the container via `task`.

**Ticket:** NEU-296 (one PR, backend). Blocked by NEU-295 (`complete_batch`, ✅ merged PR #26). Blocks NEU-297 (cost measurement + default flip). Design-of-record: `docs/specs/2026-06-21-neu-296-stage1-link-via-batches-design.md`.

**Commits / shipping:** This whole plan is a single ticket = single PR. Do **not** add per-step `git commit` calls; commit once at the end via the project's `/t:ship` flow (`task format` first, then commit normally — pre-commit hooks delegate into the container, no `--no-verify`). Implement in a Sonnet/high session per the model/effort workflow.

**Out of scope (downstream tickets):** the cost measurement + default flip (NEU-297); Stage-2 clustering via batches (NEU-298); any change to the sequential path's observable behavior.

---

## Reference: the `complete_batch` contract (read before Task 3)

From `src/upmovies/llm/client.py` (landed in NEU-295):

```python
async def complete_batch(
    self, requests: list[BatchRequest], *, poll_interval: float = 15.0, timeout: float = 3600.0,
) -> dict[str, BatchResult]: ...

@dataclass(frozen=True)
class BatchRequest:
    custom_id: str
    model: str
    system: list[dict[str, Any]]
    messages: list[dict[str, Any]]
    max_tokens: int = 4096

@dataclass(frozen=True)
class BatchResult:
    custom_id: str
    ok: bool
    text: str = ""
    error_type: str | None = None
    error_message: str | None = None
```

Key behaviors this plan relies on: `complete_batch` returns a `BatchResult` **per `custom_id`**; a failed request surfaces as `ok=False` (never raises per-request); and every input `custom_id` is pre-seeded, so an omitted result comes back as `ok=False, error_type="missing"` rather than vanishing.

---

## File Structure

- **Modify** `src/upmovies/config.py` — add the `link_use_batches` flag.
- **Modify** `src/upmovies/link/linker.py` — extract `build_link_request`, `apply_link_decisions`, `build_batch_request`; add `BatchCompleter` + `LinkClient` protocols; `link_story_batch` delegates to the helpers. Import `BatchRequest`/`BatchResult`.
- **Modify** `src/upmovies/link/pipeline.py` — `run_link_ingest` gains `use_batches`; add `_link_stage_sequential` + `_link_stage_batched`; widen the client type to `LinkClient`.
- **Modify** `src/upmovies/routers/ingest_admin.py` — pass `use_batches=settings.link_use_batches`.
- **Modify** `tests/unit/test_config.py` — flag default + override tests.
- **Modify** `tests/unit/link/test_linker.py` — direct tests for the extracted helpers (existing tests guard the refactor).
- **Modify** `tests/integration/link/test_pipeline.py` — upgrade `FakeClient` with `complete_batch`; parametrize the existing tests over `use_batches` (the parity proof); add failure-isolation, whole-submit-failure, request-mapping, and flag-routing tests.

No new files. No migration. No new required env.

---

## Task 1: `link_use_batches` config flag

**Files:**
- Modify: `src/upmovies/config.py`
- Test: `tests/unit/test_config.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/test_config.py` (after `test_settings_ingestion_overrides_from_env`):

```python
def test_settings_link_use_batches_defaults_false(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.delenv("LINK_USE_BATCHES", raising=False)
    s = Settings()  # type: ignore[call-arg]
    assert s.link_use_batches is False


def test_settings_link_use_batches_override_from_env(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.setenv("LINK_USE_BATCHES", "true")
    s = Settings()  # type: ignore[call-arg]
    assert s.link_use_batches is True
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/test_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'link_use_batches'`.

- [ ] **Step 3: Add the field**

In `src/upmovies/config.py`, add directly after the `link_batch_size` line (line 35):

```python
    link_use_batches: bool = Field(default=False, alias="LINK_USE_BATCHES")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/test_config.py -v`
Expected: PASS (both new tests; existing config tests still green).

---

## Task 2: Extract pure helpers in `linker.py` + client protocols

This is a behavior-preserving refactor. The existing `tests/unit/link/test_linker.py` tests guard `link_story_batch` end-to-end; they must stay green. We add direct tests for the two extracted functions.

**Files:**
- Modify: `src/upmovies/link/linker.py`
- Test: `tests/unit/link/test_linker.py`

- [ ] **Step 1: Write the failing tests for the extracted helpers**

Add to `tests/unit/link/test_linker.py`. First extend the imports at the top:

```python
from upmovies.link.linker import (
    apply_link_decisions,
    build_batch_request,
    build_link_request,
    link_story_batch,
)
```

Then add these tests (they reuse the file's existing `_roster` and `_story` helpers):

```python
def test_build_link_request_uses_cached_roster_and_story_payload():
    system, messages = build_link_request(_roster(uuid4()), [_story(title="Runner news")])
    assert system[0]["cache_control"] == {"type": "ephemeral"}
    assert "Runner" in system[0]["text"]
    payload = json.loads(messages[0]["content"])
    assert payload[0]["title"] == "Runner news"


def test_apply_link_decisions_links_about_high_confidence():
    film_id = uuid4()
    story = _story()
    raw = json.dumps([{"id": str(story.id), "film": 1, "confidence": 0.95, "reason": "about"}])
    result = apply_link_decisions(raw=raw, stories=[story], roster=_roster(film_id), floor=0.7)
    assert result.linked == 1
    assert story.link_status == "linked"
    assert story.film_id == film_id


def test_build_batch_request_carries_custom_id_and_cached_block():
    req = build_batch_request(
        custom_id="3", model="link-m", roster=_roster(uuid4()), stories=[_story()]
    )
    assert req.custom_id == "3"
    assert req.model == "link-m"
    assert req.max_tokens == 2048
    assert req.system[0]["cache_control"] == {"type": "ephemeral"}
```

The existing `_story` helper hardcodes the title; give it an optional `title` so the first test can assert on it. Replace the existing `_story` definition with:

```python
def _story(title="A headline", summary=""):
    return Story(
        id=uuid4(), source="X", url=f"https://e/{uuid4()}", title=title, raw={"summary": summary}
    )
```

(That signature is unchanged from today except `title` already defaulted — no behavior change; it's listed here so the engineer confirms the default exists.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/link/test_linker.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_link_request'` (and the other new names).

- [ ] **Step 3: Refactor `linker.py` — extract helpers, add protocols**

In `src/upmovies/link/linker.py`:

Update the imports near the top (the file already imports `cached_system_block`):

```python
from upmovies.llm.client import BatchRequest, BatchResult, cached_system_block
```

Replace the existing `Completer` Protocol with the three protocols:

```python
class Completer(Protocol):
    async def complete(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int = ...,
    ) -> str: ...


class BatchCompleter(Protocol):
    async def complete_batch(
        self,
        requests: list[BatchRequest],
        *,
        poll_interval: float = ...,
        timeout: float = ...,
    ) -> dict[str, BatchResult]: ...


class LinkClient(Completer, BatchCompleter, Protocol): ...
```

Add the two pure helpers (place them just above `link_story_batch`):

```python
def build_link_request(
    roster: Roster, stories: Sequence[Story]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The cached roster system block + the JSON story payload — shared by both the
    sequential `complete()` path and the batched `complete_batch()` path."""
    system = [cached_system_block(f"{_INSTRUCTIONS}\n\nROSTER:\n{roster.text}")]
    messages = [{"role": "user", "content": json.dumps(_story_payload(stories))}]
    return system, messages


def build_batch_request(
    *, custom_id: str, model: str, roster: Roster, stories: Sequence[Story]
) -> BatchRequest:
    """One Message-Batch request for a story chunk. `max_tokens` matches the sequential
    path's `_MAX_TOKENS` so the two paths are token-identical."""
    system, messages = build_link_request(roster, stories)
    return BatchRequest(
        custom_id=custom_id, model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )


def apply_link_decisions(
    *, raw: str, stories: Sequence[Story], roster: Roster, floor: float
) -> BatchLinkResult:
    """Apply the classifier's JSON decisions to each Story in place: floor/resolution rules
    plus the no-decision fallback. Identical for both execution paths."""
    decisions = json.loads(_extract_json_array(raw))  # raises on un-parseable output

    by_id = {str(s.id): s for s in stories}
    now = datetime.now(UTC)
    decided: set[str] = set()
    linked = rejected = 0

    for decision in decisions:
        sid = str(decision.get("id"))
        story = by_id.get(sid)
        if story is None:
            continue
        decided.add(sid)
        film_id = roster.film_id_for_index(decision.get("film"))
        reason = decision.get("reason")
        try:
            confidence = float(decision.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0

        story.linked_at = now
        if reason == "about" and film_id is not None and confidence >= floor:
            story.link_status = "linked"
            story.film_id = film_id
            story.link_confidence = confidence
            story.link_note = None
            linked += 1
        else:
            story.link_status = "rejected"
            story.film_id = None
            story.link_confidence = None
            if reason == "about" and film_id is not None and confidence < floor:
                story.link_note = "below-floor"
            elif reason == "mention":
                story.link_note = "mention"
            else:
                story.link_note = "no-match"
            rejected += 1

    for sid, story in by_id.items():
        if sid not in decided:
            log.warning("linker returned no decision for story %s", sid)
            story.link_status = "rejected"
            story.link_note = "no-decision"
            story.linked_at = now
            rejected += 1

    return BatchLinkResult(linked, rejected)
```

Replace the body of `link_story_batch` (keep its signature, with `client: Completer`) so it delegates:

```python
async def link_story_batch(
    *,
    client: Completer,
    model: str,
    roster: Roster,
    stories: Sequence[Story],
    floor: float,
) -> BatchLinkResult:
    if not stories:
        return BatchLinkResult(0, 0)
    system, messages = build_link_request(roster, stories)
    raw = await client.complete(
        model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
    return apply_link_decisions(raw=raw, stories=stories, roster=roster, floor=floor)
```

Add `Roster` to the roster import if it isn't already imported by name:

```python
from upmovies.link.roster import Roster
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/link/test_linker.py -v`
Expected: PASS — the three new helper tests AND all seven existing `link_story_batch` tests (they now exercise the delegated helpers, guarding parity of the refactor).

---

## Task 3: Batched Stage-1 core + parity (parametrize existing pipeline tests)

This task adds `use_batches` to `run_link_ingest`, the two stage helpers, and upgrades the integration `FakeClient` to serve both paths — then proves parity by running the existing pipeline tests under **both** flag values.

**Files:**
- Modify: `src/upmovies/link/pipeline.py`
- Test: `tests/integration/link/test_pipeline.py`

- [ ] **Step 1: Upgrade the integration test infrastructure**

In `tests/integration/link/test_pipeline.py`, extend the imports:

```python
import pytest

from upmovies.llm.client import BatchResult
```

Replace the existing `FakeClient` and `_run` with these (the routing logic moves into a shared `_decide`, and `complete_batch` reuses it so both paths make identical decisions):

```python
class FakeClient:
    """Serves both paths. `complete` (sequential Stage 1 + Stage 2) and `complete_batch`
    (batched Stage 1) route on the same `_decide` so outcomes are path-identical."""

    def __init__(self):
        self.complete_calls: list[dict] = []
        self.batch_requests: list | None = None

    async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
        self.complete_calls.append({"system": system, "messages": messages})
        return self._decide(system, messages)

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        self.batch_requests = list(requests)
        return {
            r.custom_id: BatchResult(
                custom_id=r.custom_id, ok=True, text=self._decide(r.system, r.messages)
            )
            for r in requests
        }

    def _decide(self, system, messages) -> str:
        if "entity-linking classifier" in system[0]["text"]:
            stories = json.loads(messages[0]["content"])
            return json.dumps(
                [{"id": s["id"], "film": 1, "confidence": 0.95, "reason": "about"} for s in stories]
            )
        new_ids = [s["id"] for s in json.loads(messages[0]["content"])["new_stories"]]
        return json.dumps(
            {
                "events": [
                    {
                        "existing": None,
                        "type": "trailer",
                        "confidence": "confirmed",
                        "stories": new_ids,
                    }
                ]
            }
        )


async def _run(session, run_id, *, recency_days=45, use_batches=False, batch_size=10, client=None):
    return await run_link_ingest(
        session_factory=lambda: session,
        client=client or FakeClient(),
        run_id=run_id,
        model="link-m",
        cluster_model="cluster-m",
        recency_days=recency_days,
        batch_size=batch_size,
        floor=0.7,
        use_batches=use_batches,
    )
```

Also give the `_story` helper a `title` parameter (needed by later failure tests; default keeps existing tests unchanged):

```python
async def _story(url, *, published_offset_days, status="pending", title="Runner news"):
    now = datetime.now(UTC)
    return Story(
        source="X",
        url=url,
        title=title,
        published_at=now - timedelta(days=published_offset_days),
        link_status=status,
        raw={"summary": ""},
    )
```

- [ ] **Step 2: Parametrize the three existing tests over `use_batches` (the parity proof)**

Add `@pytest.mark.parametrize("use_batches", [False, True])` above each of the three existing tests, add a `use_batches` parameter to each signature, and thread it into the `_run(...)` call. The bodies and assertions are otherwise unchanged — identical assertions passing under both flags **is** the parity guarantee.

For `test_links_then_clusters_recent_pending`:

```python
@pytest.mark.parametrize("use_batches", [False, True])
async def test_links_then_clusters_recent_pending(session, use_batches):
```
and change its `_run` call to:
```python
    result = await _run(session, run_id, use_batches=use_batches)
```

For `test_rerun_is_noop_when_fully_processed`:

```python
@pytest.mark.parametrize("use_batches", [False, True])
async def test_rerun_is_noop_when_fully_processed(session, use_batches):
```
and change its `_run` call to:
```python
    result = await _run(session, run_id, use_batches=use_batches)
```

For `test_link_window_of_four_includes_story_past_the_feed_window`:

```python
@pytest.mark.parametrize("use_batches", [False, True])
async def test_link_window_of_four_includes_story_past_the_feed_window(session, use_batches):
```
and change its `_run` call to:
```python
    result = await _run(session, run_id, recency_days=4, use_batches=use_batches)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `task test -- tests/integration/link/test_pipeline.py -v`
Expected: FAIL — `TypeError: run_link_ingest() got an unexpected keyword argument 'use_batches'`.

- [ ] **Step 4: Implement the dispatch + the two stage helpers**

In `src/upmovies/link/pipeline.py`, update the imports:

```python
from upmovies.link.linker import (
    BatchCompleter,
    Completer,
    LinkClient,
    apply_link_decisions,
    build_batch_request,
    link_story_batch,
)
from upmovies.link.roster import Roster, build_roster
```

Add the two stage helpers (place them above `run_link_ingest`). `_link_stage_sequential` is today's Stage-1 loop lifted verbatim:

```python
async def _link_stage_sequential(
    *,
    session_factory: SessionFactory,
    client: Completer,
    run_id: UUID,
    model: str,
    roster: Roster,
    pending_ids: Sequence[UUID],
    batch_size: int,
    floor: float,
) -> tuple[int, int]:
    linked = rejected = 0
    for batch_ids in _chunks(pending_ids, batch_size):
        try:
            async with _owned_session(session_factory) as s:
                stories = (
                    (await s.execute(select(Story).where(Story.id.in_(batch_ids)))).scalars().all()
                )
                batch = await link_story_batch(
                    client=client, model=model, roster=roster, stories=list(stories), floor=floor
                )
                await record_progress(s, run_id, processed_delta=batch.linked + batch.rejected)
                await s.commit()
            linked += batch.linked
            rejected += batch.rejected
        except Exception:
            log.exception("link batch of %d stories failed", len(batch_ids))
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=len(batch_ids))
                await s.commit()
    return linked, rejected


async def _link_stage_batched(
    *,
    session_factory: SessionFactory,
    client: BatchCompleter,
    run_id: UUID,
    model: str,
    roster: Roster,
    pending_ids: Sequence[UUID],
    batch_size: int,
    floor: float,
) -> tuple[int, int]:
    chunks = _chunks(pending_ids, batch_size)

    # Build phase: one read-only session; ORM rows are dropped once serialized into requests,
    # so no session is held open across the (possibly long) batch poll.
    requests = []
    async with _owned_session(session_factory) as s:
        for i, batch_ids in enumerate(chunks):
            stories = (
                (await s.execute(select(Story).where(Story.id.in_(batch_ids)))).scalars().all()
            )
            requests.append(
                build_batch_request(
                    custom_id=str(i), model=model, roster=roster, stories=list(stories)
                )
            )

    if not requests:
        return 0, 0

    try:
        results = await client.complete_batch(requests)
    except Exception:
        # Whole-batch submit/poll failed: count all chunks failed, leave stories pending.
        log.exception("link batch submit of %d stories failed", len(pending_ids))
        async with _owned_session(session_factory) as s:
            await record_progress(s, run_id, failed_delta=len(pending_ids))
            await s.commit()
        return 0, 0

    linked = rejected = 0
    for i, batch_ids in enumerate(chunks):
        result = results.get(str(i))
        try:
            if result is None or not result.ok:
                detail = result.error_type if result else "missing"
                raise RuntimeError(f"batch chunk {i} unavailable: {detail}")
            async with _owned_session(session_factory) as s:
                stories = (
                    (await s.execute(select(Story).where(Story.id.in_(batch_ids)))).scalars().all()
                )
                applied = apply_link_decisions(
                    raw=result.text, stories=list(stories), roster=roster, floor=floor
                )
                await record_progress(
                    s, run_id, processed_delta=applied.linked + applied.rejected
                )
                await s.commit()
            linked += applied.linked
            rejected += applied.rejected
        except Exception:
            log.exception("link batch chunk %d of %d stories failed", i, len(batch_ids))
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=len(batch_ids))
                await s.commit()

    return linked, rejected
```

Now update `run_link_ingest`: widen the client type to `LinkClient`, add the `use_batches` param, and replace the inline Stage-1 loop (the `linked = rejected = 0` block and its `for batch_ids in _chunks(...)` loop) with a dispatch. The signature and Stage-1 region become:

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
) -> LinkIngestResult:
    async with _owned_session(session_factory) as s:
        roster = await build_roster(s)

    cutoff = datetime.now(UTC) - timedelta(days=recency_days)
    async with _owned_session(session_factory) as s:
        result = await s.execute(
            select(Story.id).where(
                Story.link_status == "pending",
                func.coalesce(Story.published_at, Story.fetched_at) >= cutoff,
            )
        )
        pending_ids = [row[0] for row in result.all()]

    stage = _link_stage_batched if use_batches else _link_stage_sequential
    linked, rejected = await stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=model,
        roster=roster,
        pending_ids=pending_ids,
        batch_size=batch_size,
        floor=floor,
    )
```

Everything from `# --- Stage 2:` onward stays exactly as it is today.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/integration/link/test_pipeline.py -v`
Expected: PASS — all three tests now pass under **both** `use_batches=False` and `use_batches=True` (6 parametrized cases). Identical assertions under both flags = parity proven.

---

## Task 4: Failure isolation (bad chunk stays pending, others commit)

Verifies the per-chunk `try/except` in `_link_stage_batched` (implemented in Task 3).

**Files:**
- Test: `tests/integration/link/test_pipeline.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/link/test_pipeline.py`. These use a client that fails only the chunk containing a story titled `"FAIL ..."`, so the assertion is independent of pending-row ordering:

```python
class _TaggedFailBatchClient(FakeClient):
    """Fails (or corrupts) the batched chunk whose payload contains a 'FAIL'-titled story."""

    def __init__(self, *, unparseable=False):
        super().__init__()
        self._unparseable = unparseable

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        self.batch_requests = list(requests)
        out = {}
        for r in requests:
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


@pytest.mark.parametrize("unparseable", [False, True])
async def test_batched_failed_chunk_stays_pending_others_commit(session, unparseable):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all(
        [
            await _story("https://e/good", published_offset_days=1, title="Runner news"),
            await _story("https://e/bad", published_offset_days=1, title="FAIL news"),
        ]
    )
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    # batch_size=1 → one chunk per story, so exactly the 'FAIL' chunk fails.
    result = await _run(
        session,
        run_id,
        use_batches=True,
        batch_size=1,
        client=_TaggedFailBatchClient(unparseable=unparseable),
    )

    assert result.linked == 1
    rows = {
        s.url: s
        for s in (
            await session.execute(select(Story), execution_options={"populate_existing": True})
        )
        .scalars()
        .all()
    }
    assert rows["https://e/good"].link_status == "linked"
    assert rows["https://e/bad"].link_status == "pending"  # untouched → next run retries

    run = (
        await session.execute(
            select(IngestRun).where(IngestRun.id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert run.status == "succeeded"
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `task test -- tests/integration/link/test_pipeline.py -k batched_failed_chunk -v`
Expected: PASS for both `unparseable=False` (an `ok=False` chunk) and `unparseable=True` (a chunk whose text fails `json.loads`). The good chunk commits; the bad chunk's story stays `pending`; the run finalizes `succeeded`.

If it FAILS, fix `_link_stage_batched` in `pipeline.py` until green — do not edit the test to match a wrong implementation.

---

## Task 5: Whole-batch submit failure

Verifies the `try/except` around `complete_batch` itself.

**Files:**
- Test: `tests/integration/link/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/link/test_pipeline.py`:

```python
class _RaisingBatchClient(FakeClient):
    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        raise TimeoutError("batch never reached 'ended'")


async def test_batched_whole_submit_failure_leaves_pending_and_run_succeeds(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all([await _story("https://e/x", published_offset_days=1)])
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    result = await _run(session, run_id, use_batches=True, client=_RaisingBatchClient())

    assert result.linked == 0 and result.rejected == 0
    rows = (
        (await session.execute(select(Story), execution_options={"populate_existing": True}))
        .scalars()
        .all()
    )
    assert rows[0].link_status == "pending"

    run = (
        await session.execute(
            select(IngestRun).where(IngestRun.id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert run.status == "succeeded"  # Stage 2 still ran; one failure never fails the run
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `task test -- tests/integration/link/test_pipeline.py -k whole_submit_failure -v`
Expected: PASS — `complete_batch` raising is caught, all stories stay `pending`, Stage 2 runs (no linked stories → no-op), and the run finalizes `succeeded`.

---

## Task 6: Request mapping (custom_id, cache_control, max_tokens)

Verifies the `BatchRequest`s submitted carry the right shape.

**Files:**
- Test: `tests/integration/link/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/link/test_pipeline.py`:

```python
async def test_batched_request_mapping(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all(
        [
            await _story("https://e/a", published_offset_days=1),
            await _story("https://e/b", published_offset_days=1),
        ]
    )
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    client = FakeClient()
    await _run(session, run_id, use_batches=True, batch_size=1, client=client)

    reqs = client.batch_requests
    assert reqs is not None
    assert {r.custom_id for r in reqs} == {"0", "1"}  # custom_id = chunk index
    for r in reqs:
        assert r.max_tokens == 2048  # == linker._MAX_TOKENS, for parity with the sequential path
        assert r.system[0]["cache_control"] == {"type": "ephemeral"}
        assert "entity-linking classifier" in r.system[0]["text"]
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `task test -- tests/integration/link/test_pipeline.py -k request_mapping -v`
Expected: PASS — two chunks → `custom_id` `"0"`/`"1"`, each carrying the cached roster block and `max_tokens=2048`.

---

## Task 7: Flag routing (each path uses only its own client surface for Stage 1)

**Files:**
- Test: `tests/integration/link/test_pipeline.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/link/test_pipeline.py`:

```python
def _stage1_complete_calls(client) -> int:
    return sum(
        1 for c in client.complete_calls if "entity-linking classifier" in c["system"][0]["text"]
    )


async def test_flag_off_uses_sequential_only(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all([await _story("https://e/x", published_offset_days=1)])
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    client = FakeClient()
    await _run(session, run_id, use_batches=False, client=client)

    assert client.batch_requests is None  # complete_batch never called
    assert _stage1_complete_calls(client) == 1  # Stage 1 went through complete()


async def test_flag_on_uses_batch_for_stage1(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all([await _story("https://e/x", published_offset_days=1)])
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    client = FakeClient()
    await _run(session, run_id, use_batches=True, client=client)

    assert client.batch_requests is not None  # Stage 1 went through complete_batch()
    assert _stage1_complete_calls(client) == 0  # no Stage-1 complete() call
    # (Stage 2 clustering still uses complete(); that's expected and out of scope here.)
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `task test -- tests/integration/link/test_pipeline.py -k "flag_off or flag_on" -v`
Expected: PASS — flag off routes Stage 1 through `complete`; flag on routes it through `complete_batch` and makes zero Stage-1 `complete` calls.

---

## Task 8: Wire the flag through the trigger

**Files:**
- Modify: `src/upmovies/routers/ingest_admin.py`

- [ ] **Step 1: Pass the setting into `run_link_ingest`**

In `src/upmovies/routers/ingest_admin.py`, inside `_background_link`, add `use_batches` to the `run_link_ingest(...)` call (after the `floor=` line):

```python
                floor=settings.link_confidence_floor,
                use_batches=settings.link_use_batches,
```

- [ ] **Step 2: Verify the trigger suite still passes**

Run: `task test -- tests/integration/routers/test_link_admin.py -v`
Expected: PASS — default flag is `False`, so the trigger's observable behavior is unchanged. (The flag's effect is covered by the pipeline-level tests in Tasks 3–7.)

---

## Task 9: Full green + ship

**Files:** none (verification + ship)

- [ ] **Step 1: Format**

Run: `task format`
Expected: ruff reformats; a re-run is clean.

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: `ruff check src tests` clean. Watch for unused imports (e.g. confirm `Completer` is still referenced in `pipeline.py` via `_link_stage_sequential`).

- [ ] **Step 3: Typecheck**

Run: `task typecheck`
Expected: `pyright src tests` clean. `AnthropicClient` structurally satisfies `LinkClient` (it has both `complete` and `complete_batch`); the unit linker fakes only need `complete` since `link_story_batch` still types its client as `Completer`.

- [ ] **Step 4: Full repo test pass**

Run: `task test`
Expected: green across the whole suite. (Per the backend CLAUDE.md, run the whole suite — a single integration file in isolation can error on a pytest-asyncio session-loop quirk.)

- [ ] **Step 5: Ship**

Per the project flow, commit once and open the PR with `/t:ship` (it sets the branch — `tom/neu-296-be-stage-1-link-via-batches-api-behind-link_use_batches-flag` — runs `/commit-msg` + `/pr-desc`, and targets the base branch). Do not commit per-task.

---

## Self-Review (completed during authoring)

- **Spec coverage:** `link_use_batches` flag default false (Task 1) · `run_link_ingest` Stage 1 branches to the batched path (Task 3) · N requests built up front, `custom_id` = chunk index, cached roster block per request (Tasks 3, 6) · identical floor/resolution via shared `apply_link_decisions` (Task 2; parity proven in Task 3) · idempotency / already-decided untouched (Task 3 rerun test, Task 4) · per-chunk failure isolation incl. `ok=False`/unparseable/missing (Task 4) and whole-submit failure (Task 5) · `max_tokens` parity (Task 6) · flag routing (Task 7) · trigger wiring (Task 8) · `task test/lint/typecheck` green (Task 9). Every spec section maps to a task.
- **Placeholder scan:** none — every code/test step shows complete code and exact commands.
- **Type consistency:** `build_link_request` / `build_batch_request` / `apply_link_decisions` signatures match between linker.py (Task 2) and their pipeline.py call sites (Task 3). `_link_stage_sequential` / `_link_stage_batched` both return `tuple[int, int]` and are called identically in `run_link_ingest`. Protocols: `link_story_batch` keeps `client: Completer`; `_link_stage_batched` takes `BatchCompleter`; `run_link_ingest` takes `LinkClient`. The integration `FakeClient` implements both `complete` and `complete_batch`, satisfying `LinkClient`.
- **Intentional test-design note:** failure tests key "badness" on a `FAIL`-prefixed story title rather than `custom_id`, because the pending-story selection has no `ORDER BY` — chunk ordering is not guaranteed, so the assertion must be order-independent.
```