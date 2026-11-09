# NEU-273: Anthropic client wrapper + config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the entity-linking config and a thin async Anthropic Messages wrapper (with prompt-cache support) that the link/cluster services will use.

**Architecture:** A minimal `AnthropicClient` async context manager over the `anthropic` SDK, exposing one `complete()` call that takes system content blocks (one marked for ephemeral prompt caching via a `cached_system_block` helper) and returns the response text. New config: a **required** `ANTHROPIC_API_KEY` plus the link/cluster model + floor + window + batch knobs. The wrapper builds nothing domain-specific — the roster and prompts belong to NEU-274/277.

**Tech Stack:** `anthropic` Python SDK (async), pydantic-settings, pytest + respx (mocks the SDK's underlying httpx calls — the repo convention; never hit the live API).

**Repo:** `upcoming-movies-backend` · **Branch:** `tom/neu-273-be-anthropic-client-wrapper-config` · **Spec:** `docs/specs/2026-06-19-entity-linking-clustering-design.md`

> **Commit/PR convention (this project):** No per-step commits. Implement the ticket, run the full check suite, then the user commits once (Conventional Commits, no Linear ID in subject) and opens the PR. All commands run in the container via `task`. **Dependency changes require `task build`; the new required env requires `task up` to recreate the container.**

---

## File Structure

- **Modify** `pyproject.toml` — add the `anthropic` dependency.
- **Modify** `src/upmovies/config.py` — add `ANTHROPIC_API_KEY` (required) + `link_model`, `cluster_model`, `link_confidence_floor`, `link_recency_days`, `link_batch_size`.
- **Modify** `docker-compose.yml`, `.env`, `.env.example` — supply `ANTHROPIC_API_KEY` so the app + tests still boot (the field is required, and `db.py` calls `get_settings()` at import).
- **Create** `src/upmovies/llm/__init__.py` — re-export `AnthropicClient`, `cached_system_block`.
- **Create** `src/upmovies/llm/client.py` — the wrapper.
- **Create** `tests/unit/llm/__init__.py`, `tests/unit/llm/test_client.py` — respx-mocked wrapper tests.

---

### Task 1: Dependency + config + env wiring

> Do this first: `ANTHROPIC_API_KEY` is a **required** setting and `db.py` reads settings at import, so the app (and the whole test suite) won't boot until the env is wired.

**Files:**
- Modify: `pyproject.toml`
- Modify: `src/upmovies/config.py`
- Modify: `docker-compose.yml`, `.env`, `.env.example`

- [ ] **Step 1: Add the dependency**

In `pyproject.toml`, add to `[project].dependencies` (use the latest release — this floor is just a minimum, per the project's no-stale-pins rule):

```toml
    "anthropic>=0.49",
```

- [ ] **Step 2: Add the settings**

In `src/upmovies/config.py`, add inside `Settings` (after the `tmdb_*` block):

```python
    anthropic_api_key: str = Field(..., alias="ANTHROPIC_API_KEY")
    link_model: str = Field(default="claude-haiku-4-5", alias="LINK_MODEL")
    cluster_model: str = Field(default="claude-sonnet-4-6", alias="CLUSTER_MODEL")
    link_confidence_floor: float = Field(default=0.7, alias="LINK_CONFIDENCE_FLOOR")
    link_recency_days: int = Field(default=45, alias="LINK_RECENCY_DAYS")
    link_batch_size: int = Field(default=15, alias="LINK_BATCH_SIZE")
```

- [ ] **Step 3: Wire the env so the app/tests boot**

In `docker-compose.yml`, in the `upmovies-backend` service `environment:` block, add a line next to `TMDB_API_KEY` (placeholder fallback keeps dev/test booting without a real key; tests mock the API):

```yaml
      ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-test-anthropic-key}"
```

Add `ANTHROPIC_API_KEY=test-anthropic-key` to `.env` (replace with a real key locally when you run the NEU-279 baseline) and add a placeholder line `ANTHROPIC_API_KEY=` to `.env.example`, mirroring the existing `TMDB_API_KEY` entries.

> **Prod note:** the real `ANTHROPIC_API_KEY` secret must be set in the prod (Coolify) env before this ships, or the service won't boot.

- [ ] **Step 4: Rebuild + recreate the container**

Run: `task build` (reinstalls deps, incl. `anthropic`) then `task up` (recreates the container so the new required env loads).

- [ ] **Step 5: Verify the app still boots with the new required setting**

Run: `task test -- tests/unit/test_config.py`
Expected: PASS. (If `test_config.py` constructs `Settings(...)` from an explicit env subset rather than the process env, add `ANTHROPIC_API_KEY` to that subset.)

---

### Task 2: The `AnthropicClient` wrapper (TDD)

**Files:**
- Create: `tests/unit/llm/__init__.py` (empty)
- Create: `tests/unit/llm/test_client.py`
- Create: `src/upmovies/llm/__init__.py`
- Create: `src/upmovies/llm/client.py`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/llm/__init__.py` (empty file) and `tests/unit/llm/test_client.py`:

```python
import json

import httpx
import respx

from upmovies.llm.client import AnthropicClient, cached_system_block

MESSAGES_URL = "https://api.anthropic.com/v1/messages"


def _message_response(blocks: list[dict[str, str]]) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "claude-haiku-4-5",
            "content": blocks,
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 3},
        },
    )


@respx.mock
async def test_complete_returns_text_and_sends_cache_control():
    route = respx.post(MESSAGES_URL).mock(
        return_value=_message_response([{"type": "text", "text": "hello"}])
    )
    async with AnthropicClient(api_key="test-key") as c:
        out = await c.complete(
            model="claude-haiku-4-5",
            system=[cached_system_block("ROSTER")],
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=16,
        )
    assert out == "hello"
    body = json.loads(route.calls.last.request.content)
    assert body["model"] == "claude-haiku-4-5"
    assert body["system"][0]["text"] == "ROSTER"
    assert body["system"][0]["cache_control"] == {"type": "ephemeral"}


@respx.mock
async def test_complete_concatenates_text_blocks():
    respx.post(MESSAGES_URL).mock(
        return_value=_message_response(
            [{"type": "text", "text": "foo"}, {"type": "text", "text": "bar"}]
        )
    )
    async with AnthropicClient(api_key="test-key") as c:
        out = await c.complete(
            model="claude-haiku-4-5",
            system=[cached_system_block("X")],
            messages=[{"role": "user", "content": "hi"}],
        )
    assert out == "foobar"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/llm/test_client.py`
Expected: FAIL — `upmovies.llm.client` does not exist.

- [ ] **Step 3: Implement the wrapper**

Create `src/upmovies/llm/client.py`:

```python
"""Thin async wrapper over the Anthropic Messages API with prompt caching. Self-contained
(no DB); callers pass system content blocks + messages and get the response text back.
Mirrors the TMDB client's shape: an async context manager that returns plain data."""

from typing import Any

from anthropic import AsyncAnthropic


def cached_system_block(text: str) -> dict[str, Any]:
    """A system content block marked for ephemeral prompt caching. Put the stable prefix
    (e.g. the film roster) in one of these so repeated calls reuse the cached tokens."""
    return {"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}


class AnthropicClient:
    """Async context manager over `AsyncAnthropic`. One call surface: `complete`."""

    def __init__(self, api_key: str, *, max_retries: int = 3, timeout: float = 60.0):
        self._client = AsyncAnthropic(api_key=api_key, max_retries=max_retries, timeout=timeout)

    async def __aenter__(self) -> "AnthropicClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._client.close()

    async def complete(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
    ) -> str:
        """One Messages call. `system` is a list of content blocks — use
        `cached_system_block` for the cacheable prefix. Returns the concatenated text of
        the response content blocks."""
        resp = await self._client.messages.create(
            model=model,
            system=system,
            messages=messages,  # type: ignore[arg-type]
            max_tokens=max_tokens,
        )
        return "".join(block.text for block in resp.content if block.type == "text")
```

Create `src/upmovies/llm/__init__.py`:

```python
from upmovies.llm.client import AnthropicClient as AnthropicClient
from upmovies.llm.client import cached_system_block as cached_system_block
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/llm/test_client.py`
Expected: PASS (2 tests). If the installed SDK rejects the stub response (stricter schema), extend `_message_response`'s JSON to satisfy it (e.g. add `"container": null`) — keep the assertions.

---

## Final verification (before handing off to commit)

- [ ] `task format`
- [ ] `task lint` — clean
- [ ] `task typecheck` — clean (the `complete()` `messages` arg is annotated with a local `# type: ignore[arg-type]`; if pyright wants the SDK's `MessageParam` type instead, import and use it)
- [ ] `task test` — full suite green
- [ ] Hand off: the user commits (e.g. `feat: add anthropic client wrapper + entity-linking config`) and opens the PR for NEU-273.

---

## Self-Review

- **Spec coverage:** Matches the NEU-273 scope and the spec's "Config (`config.py`)" block — `ANTHROPIC_API_KEY` (required), `link_model`/`cluster_model`, `link_confidence_floor` (0.7 start), `link_recency_days` (45), `link_batch_size` (15) — plus a prompt-cache-capable client wrapper. The roster/prompt design is correctly deferred to NEU-274.
- **Placeholders:** None — concrete code, commands, and env lines throughout.
- **Type consistency:** `AnthropicClient(api_key=...)`, `cached_system_block(text) -> dict`, and `complete(*, model, system, messages, max_tokens) -> str` are used identically in the test and the implementation. Settings field names match their aliases.
- **Risk noted:** respx intercepts the SDK's internal httpx calls (same mechanism as the TMDB client tests); the wrapper stays minimal so NEU-274 can layer the structured-output contract on top.
