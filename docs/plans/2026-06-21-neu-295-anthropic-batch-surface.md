# AnthropicClient Batch Surface (`complete_batch`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `complete_batch` surface to `AnthropicClient` that submits one Message Batch, polls to terminal, and returns per-request results keyed by `custom_id` — without losing successes when individual requests fail.

**Architecture:** Extend the existing `llm/client.py` wrapper (today only `complete()`). Two frozen dataclasses (`BatchRequest`, `BatchResult`) frame the in/out shapes. `complete_batch` maps requests → SDK batch params (preserving the `cached_system_block` roster prefix), creates one batch, polls `messages.batches.retrieve` until `processing_status == "ended"` against a monotonic deadline, then streams `messages.batches.results` and maps each entry to a `BatchResult`. Every input `custom_id` is pre-seeded so a missing result surfaces as an error rather than silently dropping.

**Tech Stack:** Python 3.13, `anthropic>=0.49` (async `AsyncAnthropic`, Message Batches API), pytest + respx (HTTP-level mocking, no live API), ruff, pyright. All tooling runs in the container via `task`.

**Ticket:** NEU-295 (one PR, backend). Blocks NEU-296. Design-of-record: `docs/specs/2026-06-20-ingestion-cadence-recency-architecture-design.md` §"Batches API cost optimization".

**Commits / shipping:** This whole plan is a single ticket = single PR. Do **not** add per-step `git commit` calls; commit once at the end via the project's `/t:ship` flow (`task format` first, then commit normally — pre-commit hooks delegate into the container, no `--no-verify`). Implement in a Sonnet/high session per the model/effort workflow.

**Out of scope (downstream tickets):** wiring into `run_link_ingest` and the `link_use_batches` flag (NEU-296), the cost measurement + default flip (NEU-297), Stage-2 clustering via batches (NEU-298).

---

## File Structure

- **Modify:** `src/upmovies/llm/client.py` — add `BatchRequest`, `BatchResult`, a `_concat_text` helper (used by both `complete` and `complete_batch`), a module-level `_to_result` mapper, and the `complete_batch` method. Refactor `complete()` to reuse `_concat_text` (covered by an existing test).
- **Modify:** `src/upmovies/llm/__init__.py` — re-export `BatchRequest` and `BatchResult` using the `import x as x` pattern.
- **Modify (extend):** `tests/unit/llm/test_client.py` — add batch tests alongside the existing `complete` tests; add respx URL constants and JSON builders.

No new files. No migrations. No config changes (poll/timeout are method params with defaults).

---

## Reference: exact SDK + API shapes (read before Task 2)

The async SDK call sequence `complete_batch` uses:

```python
batch = await self._client.messages.batches.create(requests=[{"custom_id": ..., "params": {...}}])
# batch.id, batch.processing_status in {"in_progress", "canceling", "ended"}
batch = await self._client.messages.batches.retrieve(batch.id)   # poll until "ended"
decoder = await self._client.messages.batches.results(batch.id)  # async-iterable JSONL decoder
async for entry in decoder:
    entry.custom_id            # str
    entry.result.type          # "succeeded" | "errored" | "canceled" | "expired"
    entry.result.message       # Message (when succeeded); .content is a list of blocks
    entry.result.error.error   # APIError object (when errored); .type, .message
```

HTTP endpoints (what respx mocks — the SDK builds the `/results` path itself, so `results_url` only signals readiness):

- `POST https://api.anthropic.com/v1/messages/batches`
- `GET  https://api.anthropic.com/v1/messages/batches/{id}`          (retrieve)
- `GET  https://api.anthropic.com/v1/messages/batches/{id}/results`  (JSONL stream)

Results JSONL line shapes:

```json
{"custom_id":"req-0","result":{"type":"succeeded","message":{"id":"m","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}}
{"custom_id":"req-1","result":{"type":"errored","error":{"type":"error","error":{"type":"invalid_request_error","message":"boom"}}}}
```

---

## Task 1: Dataclasses + `complete_batch` empty-input guard

**Files:**
- Modify: `src/upmovies/llm/client.py`
- Modify: `src/upmovies/llm/__init__.py`
- Test: `tests/unit/llm/test_client.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/llm/test_client.py` (imports at top of file):

```python
from upmovies.llm.client import AnthropicClient, BatchRequest, BatchResult, cached_system_block


@respx.mock
async def test_complete_batch_empty_requests_returns_empty_and_makes_no_calls():
    create_route = respx.post("https://api.anthropic.com/v1/messages/batches")
    async with AnthropicClient(api_key="test-key") as c:
        out = await c.complete_batch([])
    assert out == {}
    assert not create_route.called
```

- [ ] **Step 2: Run test to verify it fails**

Run: `task test -- tests/unit/llm/test_client.py -v`
Expected: FAIL — `ImportError: cannot import name 'BatchRequest'` (and `complete_batch` undefined).

- [ ] **Step 3: Write minimal implementation**

In `src/upmovies/llm/client.py`, update the imports and add the dataclasses + helper + an empty-guard `complete_batch`:

```python
import asyncio
import time
from dataclasses import dataclass
from typing import Any

from anthropic import AsyncAnthropic


def cached_system_block(text: str) -> dict[str, Any]:
    """A system content block marked for ephemeral prompt caching. Put the stable prefix
    (e.g. the film roster) in one of these so repeated calls reuse the cached tokens."""
    return {"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}


def _concat_text(blocks: list[Any]) -> str:
    """Concatenate the text of an Anthropic response's content blocks."""
    return "".join(block.text for block in blocks if block.type == "text")


@dataclass(frozen=True)
class BatchRequest:
    """One request in a Message Batch. Mirrors `complete()`'s args plus a `custom_id`.
    `system` carries the `cached_system_block(...)` prefix so the roster stays cacheable."""

    custom_id: str
    model: str
    system: list[dict[str, Any]]
    messages: list[dict[str, Any]]
    max_tokens: int = 4096


@dataclass(frozen=True)
class BatchResult:
    """One request's outcome. `text` is set when `ok`; otherwise `error_type` /
    `error_message` describe the failure (errored / expired / canceled / missing)."""

    custom_id: str
    ok: bool
    text: str = ""
    error_type: str | None = None
    error_message: str | None = None
```

Then add the method to `AnthropicClient` (just the empty guard for now — full body lands in Task 2):

```python
    async def complete_batch(
        self,
        requests: list[BatchRequest],
        *,
        poll_interval: float = 15.0,
        timeout: float = 3600.0,
    ) -> dict[str, BatchResult]:
        """Submit one Message Batch, poll to terminal, return per-request results keyed by
        `custom_id`. A failed request surfaces as `BatchResult(ok=False, ...)` and never
        loses the other requests' results."""
        if not requests:
            return {}
        raise NotImplementedError  # replaced in Task 2
```

In `src/upmovies/llm/__init__.py`, add the re-exports:

```python
from upmovies.llm.client import AnthropicClient as AnthropicClient
from upmovies.llm.client import BatchRequest as BatchRequest
from upmovies.llm.client import BatchResult as BatchResult
from upmovies.llm.client import cached_system_block as cached_system_block
```

- [ ] **Step 4: Run test to verify it passes**

Run: `task test -- tests/unit/llm/test_client.py -v`
Expected: PASS for `test_complete_batch_empty_requests_returns_empty_and_makes_no_calls`. The existing `complete` tests still pass (the `_concat_text` refactor in Step 5 is what keeps `complete` consistent — do it now).

- [ ] **Step 5: Refactor `complete()` to reuse `_concat_text`**

Replace the return line of the existing `complete()` method:

```python
        return _concat_text(resp.content)
```

Run: `task test -- tests/unit/llm/test_client.py -v`
Expected: PASS — `test_complete_returns_text_and_sends_cache_control` and `test_complete_concatenates_text_blocks` still green (they guard this refactor).

---

## Task 2: Submit + poll-to-ended + collect succeeded results

**Files:**
- Modify: `src/upmovies/llm/client.py`
- Test: `tests/unit/llm/test_client.py`

- [ ] **Step 1: Add respx constants and JSON builders to the test module**

Add near the top of `tests/unit/llm/test_client.py` (after the existing `MESSAGES_URL`):

```python
BATCHES_URL = "https://api.anthropic.com/v1/messages/batches"
BATCH_ID = "msgbatch_1"
RETRIEVE_URL = f"{BATCHES_URL}/{BATCH_ID}"
RESULTS_URL = f"{BATCHES_URL}/{BATCH_ID}/results"


def _batch(status: str, results_url: str | None = None) -> dict:
    return {
        "id": BATCH_ID,
        "type": "message_batch",
        "processing_status": status,
        "request_counts": {
            "processing": 0, "succeeded": 0, "errored": 0, "canceled": 0, "expired": 0,
        },
        "ended_at": None,
        "created_at": "2026-06-21T00:00:00Z",
        "expires_at": "2026-06-22T00:00:00Z",
        "archived_at": None,
        "cancel_initiated_at": None,
        "results_url": results_url,
    }


def _succeeded_line(custom_id: str, text: str) -> dict:
    return {
        "custom_id": custom_id,
        "result": {
            "type": "succeeded",
            "message": {
                "id": "msg_x", "type": "message", "role": "assistant",
                "model": "claude-haiku-4-5",
                "content": [{"type": "text", "text": text}],
                "stop_reason": "end_turn", "stop_sequence": None,
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        },
    }


def _errored_line(custom_id: str, etype: str, message: str) -> dict:
    return {
        "custom_id": custom_id,
        "result": {
            "type": "errored",
            "error": {"type": "error", "error": {"type": etype, "message": message}},
        },
    }


def _jsonl(*lines: dict) -> str:
    return "\n".join(json.dumps(line) for line in lines)


def _req(custom_id: str) -> BatchRequest:
    return BatchRequest(
        custom_id=custom_id,
        model="claude-haiku-4-5",
        system=[cached_system_block("ROSTER")],
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=16,
    )
```

- [ ] **Step 2: Write the failing test**

```python
@respx.mock
async def test_complete_batch_polls_to_ended_and_collects_succeeded():
    respx.post(BATCHES_URL).mock(
        return_value=httpx.Response(200, json=_batch("in_progress"))
    )
    respx.get(RETRIEVE_URL).mock(
        side_effect=[
            httpx.Response(200, json=_batch("in_progress")),
            httpx.Response(200, json=_batch("ended", results_url=RESULTS_URL)),
        ]
    )
    respx.get(RESULTS_URL).mock(
        return_value=httpx.Response(
            200,
            text=_jsonl(
                _succeeded_line("req-0", "alpha"),
                _succeeded_line("req-1", "beta"),
            ),
            headers={"content-type": "application/x-jsonl"},
        )
    )

    async with AnthropicClient(api_key="test-key") as c:
        out = await c.complete_batch([_req("req-0"), _req("req-1")], poll_interval=0)

    assert set(out) == {"req-0", "req-1"}
    assert out["req-0"] == BatchResult(custom_id="req-0", ok=True, text="alpha")
    assert out["req-1"] == BatchResult(custom_id="req-1", ok=True, text="beta")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `task test -- tests/unit/llm/test_client.py::test_complete_batch_polls_to_ended_and_collects_succeeded -v`
Expected: FAIL — `NotImplementedError`.

- [ ] **Step 4: Write the implementation**

Replace the `complete_batch` body (everything after the empty guard) in `src/upmovies/llm/client.py`:

```python
    async def complete_batch(
        self,
        requests: list[BatchRequest],
        *,
        poll_interval: float = 15.0,
        timeout: float = 3600.0,
    ) -> dict[str, BatchResult]:
        """Submit one Message Batch, poll to terminal, return per-request results keyed by
        `custom_id`. A failed request surfaces as `BatchResult(ok=False, ...)` and never
        loses the other requests' results."""
        if not requests:
            return {}

        batch = await self._client.messages.batches.create(
            requests=[
                {
                    "custom_id": r.custom_id,
                    "params": {
                        "model": r.model,
                        "max_tokens": r.max_tokens,
                        "system": r.system,
                        "messages": r.messages,
                    },
                }
                for r in requests
            ]
        )

        deadline = time.monotonic() + timeout
        while batch.processing_status != "ended":
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"batch {batch.id} did not reach 'ended' within {timeout}s"
                )
            await asyncio.sleep(poll_interval)
            batch = await self._client.messages.batches.retrieve(batch.id)

        # Pre-seed every custom_id so an omitted result surfaces instead of silently dropping.
        results: dict[str, BatchResult] = {
            r.custom_id: BatchResult(
                custom_id=r.custom_id,
                ok=False,
                error_type="missing",
                error_message="no result returned for request",
            )
            for r in requests
        }

        decoder = await self._client.messages.batches.results(batch.id)
        async for entry in decoder:
            results[entry.custom_id] = _to_result(entry)
        return results
```

And add the module-level mapper (next to `_concat_text`):

```python
def _to_result(entry: Any) -> BatchResult:
    """Map one batch results-stream entry to a `BatchResult`."""
    result = entry.result
    if result.type == "succeeded":
        return BatchResult(
            custom_id=entry.custom_id, ok=True, text=_concat_text(result.message.content)
        )
    if result.type == "errored":
        err = result.error.error
        return BatchResult(
            custom_id=entry.custom_id,
            ok=False,
            error_type=err.type,
            error_message=err.message,
        )
    # "canceled" | "expired"
    return BatchResult(custom_id=entry.custom_id, ok=False, error_type=result.type)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `task test -- tests/unit/llm/test_client.py::test_complete_batch_polls_to_ended_and_collects_succeeded -v`
Expected: PASS. (If the SDK version iterates results without the `await` on `.results(...)`, the red test reveals it — drop the `await` so it reads `decoder = self._client.messages.batches.results(batch.id)`. The `anthropic>=0.49` async client uses the awaited form above.)

---

## Task 3: Surface errored / missing results (no silent drops)

**Files:**
- Modify: `src/upmovies/llm/client.py` (already done in Task 2 — this task is test-only verification)
- Test: `tests/unit/llm/test_client.py`

- [ ] **Step 1: Write the failing test**

```python
@respx.mock
async def test_complete_batch_surfaces_errored_and_missing_results():
    respx.post(BATCHES_URL).mock(
        return_value=httpx.Response(200, json=_batch("in_progress"))
    )
    respx.get(RETRIEVE_URL).mock(
        return_value=httpx.Response(200, json=_batch("ended", results_url=RESULTS_URL))
    )
    # Stream returns a success for req-0 and an error for req-1; req-2 is omitted entirely.
    respx.get(RESULTS_URL).mock(
        return_value=httpx.Response(
            200,
            text=_jsonl(
                _succeeded_line("req-0", "ok-text"),
                _errored_line("req-1", "invalid_request_error", "boom"),
            ),
            headers={"content-type": "application/x-jsonl"},
        )
    )

    async with AnthropicClient(api_key="test-key") as c:
        out = await c.complete_batch(
            [_req("req-0"), _req("req-1"), _req("req-2")], poll_interval=0
        )

    assert out["req-0"].ok is True and out["req-0"].text == "ok-text"

    assert out["req-1"].ok is False
    assert out["req-1"].error_type == "invalid_request_error"
    assert out["req-1"].error_message == "boom"

    # Omitted from the stream → surfaced as a "missing" error, not dropped.
    assert out["req-2"].ok is False
    assert out["req-2"].error_type == "missing"
```

- [ ] **Step 2: Run test to verify it passes**

Run: `task test -- tests/unit/llm/test_client.py::test_complete_batch_surfaces_errored_and_missing_results -v`
Expected: PASS (behavior already implemented in Task 2: `_to_result` handles `errored`, and the pre-seeded dict handles the omitted `req-2`).

If it FAILS, fix `_to_result` / the pre-seed loop in `client.py` until green — do not edit the test to match a wrong implementation.

---

## Task 4: Overall timeout

**Files:**
- Modify: `src/upmovies/llm/client.py` (already done in Task 2 — test-only verification)
- Test: `tests/unit/llm/test_client.py`

- [ ] **Step 1: Write the failing test**

```python
@respx.mock
async def test_complete_batch_raises_timeout_when_never_ends():
    respx.post(BATCHES_URL).mock(
        return_value=httpx.Response(200, json=_batch("in_progress"))
    )
    # Retrieve would keep returning in_progress, but timeout=0 trips the deadline first.
    respx.get(RETRIEVE_URL).mock(
        return_value=httpx.Response(200, json=_batch("in_progress"))
    )

    async with AnthropicClient(api_key="test-key") as c:
        with pytest.raises(TimeoutError):
            await c.complete_batch([_req("req-0")], poll_interval=0, timeout=0)
```

Add `import pytest` to the test module if not already present.

- [ ] **Step 2: Run test to verify it passes**

Run: `task test -- tests/unit/llm/test_client.py::test_complete_batch_raises_timeout_when_never_ends -v`
Expected: PASS — the `time.monotonic() >= deadline` guard raises `TimeoutError` before the batch ever reports `ended`.

---

## Task 5: Cache-control preserved in submitted batch params

**Files:**
- Modify: `src/upmovies/llm/client.py` (no change expected — characterization test)
- Test: `tests/unit/llm/test_client.py`

- [ ] **Step 1: Write the failing test**

```python
@respx.mock
async def test_complete_batch_preserves_cache_control_in_request_params():
    create_route = respx.post(BATCHES_URL).mock(
        return_value=httpx.Response(200, json=_batch("ended", results_url=RESULTS_URL))
    )
    respx.get(RESULTS_URL).mock(
        return_value=httpx.Response(
            200,
            text=_jsonl(_succeeded_line("req-0", "x")),
            headers={"content-type": "application/x-jsonl"},
        )
    )

    async with AnthropicClient(api_key="test-key") as c:
        await c.complete_batch([_req("req-0")], poll_interval=0)

    body = json.loads(create_route.calls.last.request.content)
    params = body["requests"][0]["params"]
    assert params["model"] == "claude-haiku-4-5"
    assert params["max_tokens"] == 16
    assert params["system"][0]["text"] == "ROSTER"
    assert params["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert params["messages"] == [{"role": "user", "content": "hi"}]
```

Note: this test returns `"ended"` straight from `create` (no poll needed) — the loop is skipped and results stream immediately.

- [ ] **Step 2: Run test to verify it passes**

Run: `task test -- tests/unit/llm/test_client.py::test_complete_batch_preserves_cache_control_in_request_params -v`
Expected: PASS — `complete_batch` passes each request's `system` (built with `cached_system_block`) straight into `params`, so the ephemeral `cache_control` block is on the wire.

---

## Task 6: Full green + final review

**Files:** none (verification)

- [ ] **Step 1: Format**

Run: `task format`
Expected: ruff reformats; re-run is clean.

- [ ] **Step 2: Full test suite**

Run: `task test -- tests/unit/llm/test_client.py -v`
Expected: all `complete` and `complete_batch` tests PASS.

- [ ] **Step 3: Lint**

Run: `task lint`
Expected: `ruff check src tests` clean (watch for unused imports; `import x as x` re-export pattern in `__init__.py` avoids F401).

- [ ] **Step 4: Typecheck**

Run: `task typecheck`
Expected: `pyright src tests` clean. The SDK's batch result union is dynamic; `_to_result(entry: Any)` and the `requests=[...]` dict payload avoid SDK-type friction. If pyright flags the `messages.batches.create(requests=...)` dict payload, add a narrow `# type: ignore[arg-type]` consistent with the existing `complete()` ignores — do not loosen the dataclass types.

- [ ] **Step 5: Full repo test pass (catch cross-suite breakage)**

Run: `task test`
Expected: green. (Single integration files in isolation can error on a session-loop quirk — run the whole suite, per the backend CLAUDE.md.)

- [ ] **Step 6: Ship**

Per the project flow, commit once and open the PR with `/t:ship` (it sets the branch, runs `/commit-msg` + `/pr-desc`, and targets the release/base branch). Do not commit per-task.

---

## Self-Review (completed during authoring)

- **Spec coverage:** `complete_batch(requests) -> dict[custom_id, ...]` (Task 2) · `messages.batches.{create,retrieve,results}` (Task 2 reference + impl) · cached roster prefix preserved (Task 5) · poll interval + overall timeout (Task 4, method params) · per-request errors surfaced, not dropped (Task 3) · mocked batches client, no live API (respx throughout) · `task test/lint/typecheck` green (Task 6). All spec bullets map to a task.
- **Intentional deviation from the ticket text:** the ticket illustrates the return as `dict[custom_id, str]`; this plan returns `dict[custom_id, BatchResult]` so a failed request never discards the batch's successes (approved in brainstorming). Reconcile the NEU-295 ticket description to match.
- **Placeholder scan:** none — every code/test step shows complete code; the only `raise NotImplementedError` is a deliberate Task-1 stub replaced in Task 2.
- **Type consistency:** `BatchRequest`/`BatchResult` field names and `complete_batch` signature are identical across Tasks 1–5; `_concat_text` and `_to_result` signatures match their call sites.
