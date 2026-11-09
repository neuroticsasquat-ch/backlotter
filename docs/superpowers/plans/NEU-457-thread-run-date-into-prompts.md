# Thread Run Date into LINK / CLUSTER / SUMMARIZE Prompts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pipeline's run date (`datetime.now(UTC).date()`, rendered `YYYY-MM-DD`) present as an `as_of_date` field in the LINK, CLUSTER, and SUMMARIZE prompt payloads, so downstream temporal-bug fixes (NEU-453/449/451) have a "today" anchor to reason from.

**Architecture:** Capture `run_date` once at the top of each orchestrator (`run_link_ingest`, `run_synthesize_ingest`) and thread it down through both the sequential and batched stage helpers into each prompt builder. The date is injected as a new key in each prompt's **user-message JSON** (not the system block), keeping every system block byte-stable so LINK's prompt cache is preserved. Each system `_INSTRUCTIONS` constant gains one neutral sentence pointing at the field. SUMMARIZE's persisted `prompt_version` default is bumped so existing summaries regenerate with the date-aware prompt.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, Pydantic v2 / pydantic-settings, pytest (pytest-asyncio `auto`), ruff, pyright. Everything runs in the container via `task` (no host Python).

## Global Constraints

- **Everything runs in the container via `task`** — never run `pytest`/`ruff`/`pyright` on the host. Scope tests with `task test -- tests/unit/...`.
- **Run integration tests as a directory/suite, not a single file** (known pytest-asyncio session-loop quirk). Unit tests may be scoped to a file.
- **Before "done": `task test`, `task lint`, `task typecheck` all green; run `task format` (ruff reformats).**
- Modern type hints `X | None`, `X | Y`. **No** `from __future__ import annotations`. ruff line length 100.
- **TDD** — write the failing test first. Mock LLM clients with the existing capture-based fakes; never hit the network.
- **Single backend PR** on the `tom/neu-457-thread-current-run-date-into-link-cluster-summarize-prompts` branch. No migration, no DTO/public-shape change, no frontend change.
- **Commits/PR are handled once at the end** (Task 4) per this project's workflow — implementer subagents do not commit per-task.
- **The run date is day-granular, rendered `run_date.isoformat()` → `"YYYY-MM-DD"`.** It is distinct from `EventInput.source_updated_at`; never derive one from the other.
- **The three neutral instruction sentences are plumbing only** — no bug-specific thresholds/logic (those belong to NEU-453/449/451).

---

## File Structure

- `src/upmovies/synthesize/summarizer.py` — SUMMARIZE prompt builders + entry (`_event_payload`, `build_summary_request`, `build_summary_batch_request`, `summarize_event`, `_INSTRUCTIONS`).
- `src/upmovies/synthesize/pipeline.py` — `run_synthesize_ingest` captures `run_date`; `_summary_stage_sequential` / `_summary_stage_batched` thread it.
- `src/upmovies/config.py` — bump `summary_prompt_version` default `"4"` → `"5"`.
- `src/upmovies/link/linker.py` — LINK builders + entry (`build_link_request`, `build_batch_request`, `link_story_batch`, `_INSTRUCTIONS`); wrap user payload array → object.
- `src/upmovies/link/cluster.py` — CLUSTER builders + entry (`assemble_cluster_payload`, `build_cluster_request`, `build_cluster_batch_request`, `cluster_film_events`, `_INSTRUCTIONS`).
- `src/upmovies/link/pipeline.py` — `run_link_ingest` captures one `run_date`; `_link_stage_*` and `_cluster_stage_*` thread it.
- Tests: `tests/unit/synthesize/test_summarizer.py`, `tests/unit/link/test_linker.py`, `tests/unit/link/test_cluster_pure.py`.

---

## Task 1: SUMMARIZE — thread run_date + prompt-version bump

**Files:**
- Modify: `src/upmovies/synthesize/summarizer.py`
- Modify: `src/upmovies/synthesize/pipeline.py`
- Modify: `src/upmovies/config.py:46`
- Test: `tests/unit/synthesize/test_summarizer.py`

**Interfaces:**
- Produces:
  - `build_summary_request(event: EventInput, run_date: date) -> tuple[list[dict], list[dict]]`
  - `build_summary_batch_request(*, custom_id: str, model: str, event: EventInput, run_date: date) -> BatchRequest`
  - `summarize_event(*, client, model: str, prompt_version: str, event: EventInput, run_date: date) -> tuple[SummaryResult, Usage]`
  - `_event_payload(event: EventInput, run_date: date) -> dict[str, Any]` (adds `"as_of_date"`)
  - `_summary_stage_sequential(...)` / `_summary_stage_batched(...)` each gain a `run_date: date` keyword param.
- Consumes: nothing from other tasks (fully self-contained; `run_synthesize_ingest` owns its own `run_date`).

- [ ] **Step 1: Write the failing test**

In `tests/unit/synthesize/test_summarizer.py`, change the datetime import to include `date`:

```python
from datetime import UTC, date, datetime
```

Update the existing `build_summary_request(...)` call in `test_build_summary_request_plain_block_and_payload` to pass a run date and assert it lands in the payload plus a pointer sentence in the instructions. Replace the body from the `system, messages = ...` line onward with:

```python
    system, messages = build_summary_request(event, date(2026, 6, 25))
    # plain block — NO caching (short prompt, sub-minimum cacheable size)
    assert "cache_control" not in system[0]
    assert "paraphrase" in system[0]["text"].lower()
    assert "as_of_date" in system[0]["text"]  # instructions point at the field
    payload = json.loads(messages[0]["content"])
    assert payload["as_of_date"] == "2026-06-25"
    assert payload["film"] == "Runner"
    assert payload["event_type"] == "casting"
    assert [s["source"] for s in payload["stories"]] == ["Variety", "THR"]
    assert payload["stories"][0]["title"] == "Casting news"
    assert payload["stories"][0]["dek"] == "Star joins the film."
```

Also add a focused new test right after it:

```python
def test_build_summary_batch_request_carries_as_of_date():
    system, messages = build_summary_request(_event(), date(2026, 6, 25))
    assert json.loads(messages[0]["content"])["as_of_date"] == "2026-06-25"
    req = build_summary_batch_request(
        custom_id="e1", model="m", event=_event(), run_date=date(2026, 6, 25)
    )
    assert json.loads(req.messages[0]["content"])["as_of_date"] == "2026-06-25"
```

Then update **every other** call in this file so the suite compiles — any `build_summary_request(<event>)` becomes `build_summary_request(<event>, date(2026, 6, 25))`; any `build_summary_batch_request(...)` / `summarize_event(...)` call gains `run_date=date(2026, 6, 25)`. (Known sites: `test_build_summary_request_truncates_dek`, the assistant-prefill test, and any `summarize_event` call.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -q`
Expected: FAIL — `build_summary_request()` takes 1 positional arg but 2 given / `as_of_date` KeyError.

- [ ] **Step 3: Implement — summarizer.py**

Add `date` to the datetime import at the top of `src/upmovies/synthesize/summarizer.py` (e.g. `from datetime import date, datetime`).

`_event_payload` (line 126) — accept `run_date` and add the field as the first key:

```python
def _event_payload(event: EventInput, run_date: date) -> dict[str, Any]:
    return {
        "as_of_date": run_date.isoformat(),
        "film": event.film_title,
        "event_type": event.event_type,
        # ...existing keys unchanged...
    }
```

`build_summary_request` (line 195):

```python
def build_summary_request(
    event: EventInput, run_date: date
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The plain instructions system block + the JSON event payload — shared by both the
    sequential `complete()` path and the batched `complete_batch()` path. Truncates each dek."""
    system = [{"type": "text", "text": _INSTRUCTIONS}]
    messages = [
        {"role": "user", "content": json.dumps(_event_payload(event, run_date))},
        {"role": "assistant", "content": _PREFILL},
    ]
    return system, messages
```

`build_summary_batch_request` (line 209):

```python
def build_summary_batch_request(
    *, custom_id: str, model: str, event: EventInput, run_date: date
) -> BatchRequest:
    system, messages = build_summary_request(event, run_date)
    return BatchRequest(
        custom_id=custom_id, model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
```

`summarize_event` (line 218):

```python
async def summarize_event(
    *, client: Completer, model: str, prompt_version: str, event: EventInput, run_date: date
) -> tuple[SummaryResult, Usage]:
    system, messages = build_summary_request(event, run_date)
    # ...rest of body unchanged...
```

Append this sentence to the `_INSTRUCTIONS` constant (line 38 block) — put it just above the `Return ONLY a JSON object` line:

```
- The payload includes `as_of_date`, today's date (UTC). Use it to get tense and relative \
dates right — do not describe something that happened on or before this date as if it were in \
the future.
```

- [ ] **Step 4: Implement — pipeline.py threading**

In `src/upmovies/synthesize/pipeline.py`:

Add `run_date: date` as a keyword param to both `_summary_stage_sequential` (line 139) and `_summary_stage_batched` (line 173). Ensure `date` is imported (`from datetime import ..., date, ...` — the module already imports from datetime for other uses; add `date`, and `UTC` if not present).

In `_summary_stage_sequential`, pass it to `summarize_event` (line 152):

```python
            result, usage = await summarize_event(
                client=client,
                model=model,
                prompt_version=prompt_version,
                event=pe.event_input,
                run_date=run_date,
            )
```

In `_summary_stage_batched`, pass it into the request builder (line 187):

```python
    requests = [
        build_summary_batch_request(
            custom_id=str(pe.event_id), model=model, event=pe.event_input, run_date=run_date
        )
        for pe in pending
    ]
```

In `run_synthesize_ingest` (line 233), capture the date and pass it to the selected stage (line 250):

```python
    run_date = datetime.now(UTC).date()
    stage = _summary_stage_batched if use_batches else _summary_stage_sequential
    new, refreshed, failed, summary_usage = await stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=model,
        prompt_version=prompt_version,
        pending=pending,
        run_date=run_date,
    )
```

- [ ] **Step 5: Bump the prompt version**

In `src/upmovies/config.py:46`, change the default so stored summaries regenerate with the date-aware prompt:

```python
    summary_prompt_version: str = Field(default="5", alias="SUMMARY_PROMPT_VERSION")
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -q`
Expected: PASS.

- [ ] **Step 7: Format + typecheck this slice**

Run: `task format && task typecheck`
Expected: no ruff diffs left, pyright clean. (Do not commit — see Task 4.)

---

## Task 2: LINK — thread run_date + wrap user payload

**Files:**
- Modify: `src/upmovies/link/linker.py`
- Modify: `src/upmovies/link/pipeline.py` (`run_link_ingest`, `_link_stage_sequential`, `_link_stage_batched`)
- Test: `tests/unit/link/test_linker.py`

**Interfaces:**
- Produces:
  - `build_link_request(roster: Roster, stories: Sequence[Story], run_date: date) -> tuple[list[dict], list[dict]]` — user message is now `{"as_of_date": "YYYY-MM-DD", "stories": [...]}`.
  - `build_batch_request(*, custom_id, model, roster, stories, run_date: date) -> BatchRequest`
  - `link_story_batch(*, client, model, roster, stories, floor, run_date: date) -> tuple[BatchLinkResult, Usage]`
  - **In `run_link_ingest`: a local `run_date = datetime.now(UTC).date()`** — Task 3 reuses this same variable for the cluster stage.
  - `_link_stage_sequential(...)` / `_link_stage_batched(...)` each gain `run_date: date`.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing test**

In `tests/unit/link/test_linker.py`, add `date` to the datetime imports (add a `from datetime import date` if the file has no datetime import yet). Rewrite `test_build_link_request_uses_cached_roster_and_story_payload` (the payload-shape test) so the user message is the new wrapped object:

```python
def test_build_link_request_uses_cached_roster_and_story_payload():
    roster = _roster()  # existing helper in this file
    stories = _stories()  # existing helper in this file
    system, messages = build_link_request(roster, stories, date(2026, 6, 25))
    # cached roster system block unchanged apart from the constant's new sentence
    assert system[0]["cache_control"] == {"type": "ephemeral"}
    payload = json.loads(messages[0]["content"])
    assert payload["as_of_date"] == "2026-06-25"
    assert isinstance(payload["stories"], list)
    assert payload["stories"][0]["id"] == str(stories[0].id)
```

> If the existing test constructs `roster`/`stories` inline rather than via helpers, keep that construction and only change the `build_link_request(...)` call and the `payload = ...` assertions to match the wrapped shape (`payload["stories"]` instead of a bare list).

Update every other `build_link_request(...)` / `build_batch_request(...)` / `link_story_batch(...)` call in the file to pass the run date (positional `date(2026, 6, 25)` for `build_link_request`, `run_date=date(2026, 6, 25)` for the keyword-only builders). Leave `test_roster_is_sent_as_cached_system_block` asserting on `system[0]` — it stays valid.

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_linker.py -q`
Expected: FAIL — `build_link_request()` missing `run_date` / `payload` is a list, not a dict (`as_of_date` KeyError).

- [ ] **Step 3: Implement — linker.py**

Add `date` to the datetime import at the top of `src/upmovies/link/linker.py`.

`build_link_request` (line 128) — wrap the story payload into an object:

```python
def build_link_request(
    roster: Roster, stories: Sequence[Story], run_date: date
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The cached roster system block + the JSON story payload — shared by both the
    sequential `complete()` path and the batched `complete_batch()` path."""
    system = [cached_system_block(f"{_INSTRUCTIONS}\n\nROSTER:\n{roster.text}")]
    payload = {"as_of_date": run_date.isoformat(), "stories": _story_payload(stories)}
    messages = [{"role": "user", "content": json.dumps(payload)}]
    return system, messages
```

`build_batch_request` (line 140):

```python
def build_batch_request(
    *, custom_id: str, model: str, roster: Roster, stories: Sequence[Story], run_date: date
) -> BatchRequest:
    system, messages = build_link_request(roster, stories, run_date)
    return BatchRequest(
        custom_id=custom_id, model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
```

`link_story_batch` (line 211):

```python
async def link_story_batch(
    *,
    client: Completer,
    model: str,
    roster: Roster,
    stories: Sequence[Story],
    floor: float,
    run_date: date,
) -> tuple[BatchLinkResult, Usage]:
    if not stories:
        return BatchLinkResult(0, 0), Usage()
    system, messages = build_link_request(roster, stories, run_date)
    # ...rest unchanged...
```

Update the `_INSTRUCTIONS` constant (line 22 block): describe the wrapping object and the field. Add this paragraph just above the `Return ONLY a JSON array` line:

```
The input is a JSON object `{"as_of_date": <YYYY-MM-DD>, "stories": [...]}`. `as_of_date` is \
the date this run executed (UTC); treat it as "today" when judging how recent or stale a \
story is. Classify every story in `stories`.
```

- [ ] **Step 4: Implement — pipeline.py threading (link stages only)**

In `src/upmovies/link/pipeline.py` (it already imports `UTC, datetime, timedelta`; add `date`):

Add `run_date: date` as a keyword param to `_link_stage_sequential` (line 57) and `_link_stage_batched` (line 92).

In `_link_stage_sequential`, pass it to `link_story_batch` (line 76):

```python
                batch, usage = await link_story_batch(
                    client=client,
                    model=model,
                    roster=roster,
                    stories=list(stories),
                    floor=floor,
                    run_date=run_date,
                )
```

In `_link_stage_batched`, pass it to `build_batch_request` (line 114):

```python
            requests.append(
                build_batch_request(
                    custom_id=str(i),
                    model=model,
                    roster=roster,
                    stories=list(stories),
                    run_date=run_date,
                )
            )
```

In `run_link_ingest` (line 272), capture the run date next to the existing `cutoff` (line 293) and pass it into the link stage call (line 304):

```python
    run_date = datetime.now(UTC).date()
    cutoff = datetime.now(UTC) - timedelta(days=recency_days)
```

```python
    stage = _link_stage_batched if use_batches else _link_stage_sequential
    linked, rejected, link_usage = await stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=model,
        roster=roster,
        pending_ids=pending_ids,
        batch_size=batch_size,
        floor=floor,
        run_date=run_date,
    )
```

(The `_cluster_stage_*` call later in this function is untouched here — Task 3 wires it.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/unit/link/test_linker.py -q`
Expected: PASS.

- [ ] **Step 6: Format + typecheck this slice**

Run: `task format && task typecheck`
Expected: clean. (Do not commit — see Task 4.)

---

## Task 3: CLUSTER — thread run_date

**Files:**
- Modify: `src/upmovies/link/cluster.py`
- Modify: `src/upmovies/link/pipeline.py` (`_cluster_stage_sequential`, `_cluster_stage_batched`, and the cluster-stage call in `run_link_ingest`)
- Test: `tests/unit/link/test_cluster_pure.py`

**Interfaces:**
- Produces:
  - `assemble_cluster_payload(*, film_title, film_year, existing_payload, new_payload, run_date: date) -> tuple[list[dict], list[dict]]` — user object gains `"as_of_date"`.
  - `build_cluster_request(session, *, film_id, attach_limit, run_date: date) -> ... | None`
  - `build_cluster_batch_request(session, *, custom_id, model, film_id, attach_limit, max_tokens=..., run_date: date) -> ... | None`
  - `cluster_film_events(session, *, client, model, film_id, attach_limit, max_tokens=..., unresolved_tier=..., run_date: date) -> tuple[ClusterResult, Usage]`
  - `_cluster_stage_sequential(...)` / `_cluster_stage_batched(...)` each gain `run_date: date`.
- Consumes: the `run_date` local created in `run_link_ingest` by **Task 2**.

- [ ] **Step 1: Write the failing test**

In `tests/unit/link/test_cluster_pure.py`, add `date` to the imports (`from datetime import date`). Update the pure-assembly test that calls `assemble_cluster_payload(...)` to pass `run_date` and assert the field. Add these assertions to the existing test (and pass the new kwarg in its `assemble_cluster_payload(...)` call):

```python
    system, messages = assemble_cluster_payload(
        film_title="Runner",
        film_year=2026,
        existing_payload=[],
        new_payload=[{"n": 1, "title": "t", "dek": "d", "source": "Deadline"}],
        run_date=date(2026, 6, 25),
    )
    # system stays exactly the instructions constant (only its text changed)
    assert system == [{"type": "text", "text": _INSTRUCTIONS}]
    user = json.loads(messages[0]["content"])
    assert user["as_of_date"] == "2026-06-25"
    assert user["film"] == {"title": "Runner", "year": 2026}
```

> Match the existing test's argument values where it already builds a payload; only add `run_date=` and the `as_of_date` assertion if the test already covers `film`/`new_stories`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_cluster_pure.py -q`
Expected: FAIL — `assemble_cluster_payload()` missing `run_date` / `as_of_date` KeyError.

- [ ] **Step 3: Implement — cluster.py**

Add `date` to the datetime import at the top of `src/upmovies/link/cluster.py`.

`assemble_cluster_payload` (line 176) — accept `run_date`, add the field first:

```python
def assemble_cluster_payload(
    *,
    film_title: str,
    film_year: int | None,
    existing_payload: list[dict[str, Any]],
    new_payload: list[dict[str, Any]],
    run_date: date,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Pure prompt assembly shared by build_cluster_request (production) and the
    validate_clustering harness. No DB, no LLM."""
    user: dict[str, Any] = {
        "as_of_date": run_date.isoformat(),
        "film": {"title": film_title, "year": film_year},
        "existing_events": existing_payload,
        "new_stories": new_payload,
    }
    system = [{"type": "text", "text": _INSTRUCTIONS}]
    messages = [{"role": "user", "content": json.dumps(user)}]
    return system, messages
```

`build_cluster_request` (line 196) — accept `run_date` and forward it to `assemble_cluster_payload`:

```python
async def build_cluster_request(
    session: AsyncSession,
    *,
    film_id: UUID,
    attach_limit: int,
    run_date: date,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], ClusterPlan] | None:
```

At its `assemble_cluster_payload(...)` call inside the function (~line 276), add `run_date=run_date` to the kwargs.

`build_cluster_batch_request` (line 399) — accept `run_date`, forward to `build_cluster_request`:

```python
async def build_cluster_batch_request(
    session: AsyncSession,
    *,
    custom_id: str,
    model: str,
    film_id: UUID,
    attach_limit: int,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
    run_date: date,
) -> tuple[BatchRequest, ClusterPlan] | None:
    built = await build_cluster_request(
        session, film_id=film_id, attach_limit=attach_limit, run_date=run_date
    )
    # ...rest unchanged...
```

`cluster_film_events` (line 425) — accept `run_date`, forward to `build_cluster_request`:

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
    run_date: date,
) -> tuple[ClusterResult, Usage]:
    built = await build_cluster_request(
        session, film_id=film_id, attach_limit=attach_limit, run_date=run_date
    )
    # ...rest unchanged...
```

Append this sentence to the `_INSTRUCTIONS` constant (line 63 block), just above the `Return ONLY JSON` line:

```
The payload includes `as_of_date`, today's date (UTC). Use it to reason about whether an \
event is recent, upcoming, or already past.
```

> If `validate_clustering` (a non-production harness) also calls `assemble_cluster_payload`, update that call to pass `run_date=` (e.g. a fixed date or `datetime.now(UTC).date()`); grep for other callers before finishing.

- [ ] **Step 4: Implement — pipeline.py threading (cluster stages)**

In `src/upmovies/link/pipeline.py`:

Add `run_date: date` as a keyword param to `_cluster_stage_sequential` (line 164) and `_cluster_stage_batched` (line 202).

In `_cluster_stage_sequential`, pass it to `cluster_film_events` (line 180):

```python
                cluster, usage = await cluster_film_events(
                    s,
                    client=client,
                    model=model,
                    film_id=film_id,
                    attach_limit=attach_limit,
                    max_tokens=cluster_max_tokens,
                    unresolved_tier=unresolved_tier,
                    run_date=run_date,
                )
```

In `_cluster_stage_batched`, pass it to `build_cluster_batch_request` (line 219):

```python
            built = await build_cluster_batch_request(
                s,
                custom_id=str(film_id),
                model=model,
                film_id=film_id,
                attach_limit=attach_limit,
                max_tokens=cluster_max_tokens,
                run_date=run_date,
            )
```

In `run_link_ingest`, add `run_date=run_date` to the `cluster_stage(...)` call (line 367) — reusing the local `run_date` created in Task 2:

```python
    cluster_stage = _cluster_stage_batched if cluster_use_batches else _cluster_stage_sequential
    events_created, stories_clustered, stories_rejected, cluster_usage = await cluster_stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=cluster_model,
        film_ids=film_ids,
        attach_limit=attach_limit,
        cluster_max_tokens=cluster_max_tokens,
        unresolved_tier=unresolved_tier,
        run_date=run_date,
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/unit/link/test_cluster_pure.py -q`
Expected: PASS.

- [ ] **Step 6: Format + typecheck this slice**

Run: `task format && task typecheck`
Expected: clean. (Do not commit — see Task 4.)

---

## Task 4: Full verification + single commit / PR

**Files:** none (verification + git only).

- [ ] **Step 1: Run the full suite**

Run: `task test`
Expected: all green. If any integration test that exercises the link/synthesize pipelines calls these builders/stages directly with positional/keyword args, fix the call to pass `run_date` (grep `build_link_request(`, `build_summary_request(`, `assemble_cluster_payload(`, `link_story_batch(`, `cluster_film_events(`, `build_cluster_batch_request(`, `build_summary_batch_request(`, `build_batch_request(` across `tests/` and `src/` for any missed caller).

- [ ] **Step 2: Lint + typecheck the whole tree**

Run: `task lint && task typecheck`
Expected: clean.

- [ ] **Step 3: Format**

Run: `task format`
Expected: no remaining diffs after re-running `task lint`.

- [ ] **Step 4: Commit + open the single PR**

On the `tom/neu-457-…` branch, commit all changes (Conventional Commits subject, **no** Linear ID in subject, **no** footer, **no** `Co-Authored-By`) and open one PR. Suggested:

```bash
git add -A
git commit -m "feat: thread pipeline run date into LINK/CLUSTER/SUMMARIZE prompts

Injects an as_of_date field into all three prompt payloads and bumps
SUMMARY_PROMPT_VERSION so summaries regenerate with the date-aware prompt.

Refs NEU-457."
```

PR title: `feat: thread run date into LINK/CLUSTER/SUMMARIZE prompts (NEU-457)` — include the `🤖 Generated with Claude Code` footer in the PR **body** only.

---

## Self-Review

**Spec coverage:**
- Run date present in each prompt → Tasks 1 (SUMMARIZE), 2 (LINK), 3 (CLUSTER), each asserting `as_of_date` in the user payload. ✔
- `datetime.now(UTC).date()` captured at pipeline entry, one shared value for LINK+CLUSTER → Task 2 creates the local, Task 3 reuses it; SUMMARIZE captures its own in Task 1. ✔
- Injection in user payload, system blocks byte-stable, LINK cache preserved → Tasks assert on `system[0]`/`cache_control`; date only added to user JSON. ✔
- One neutral instruction sentence per prompt → verbatim strings in Steps 3 of each task. ✔
- LINK array→object wrap → Task 2 Step 3 + test. ✔
- `SUMMARY_PROMPT_VERSION` `"4"`→`"5"` → Task 1 Step 5 (+ its regeneration effect). ✔
- Both sequential and batched paths threaded → each task threads both `_*_stage_sequential` and `_*_stage_batched`. ✔
- Tests updated for the three capture-based suites → Steps 1 of each task. ✔
- Single PR, no migration/DTO/frontend → Task 4. ✔

**Placeholder scan:** No TBD/TODO; every code step shows real code. The two `>` notes ("if the existing test constructs…", "if validate_clustering also calls…") are guarded instructions to match existing shapes, not deferrals — the primary path is fully specified.

**Type consistency:** `run_date: date` (rendered via `run_date.isoformat()`) is used uniformly across all builders, entries, and stage helpers. `build_link_request` / `build_summary_request` take `run_date` positionally; the keyword-only builders (`build_batch_request`, `build_summary_batch_request`, `build_cluster_batch_request`, `assemble_cluster_payload`, `cluster_film_events`, `link_story_batch`, `build_cluster_request`) take it as a keyword — consistent with each function's existing call convention.
