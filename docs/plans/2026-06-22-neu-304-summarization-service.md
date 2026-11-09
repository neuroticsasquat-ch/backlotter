# Summarization Service (Haiku 4.5, batched, paraphrase-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, DB-free service that turns one `news.event` (as an in-memory `EventInput`) into one neutral 2–3 sentence paraphrase via Haiku 4.5, returning a `SummaryResult` for a later pipeline (NEU-305) to persist.

**Architecture:** A new `synthesize/` package mirroring `link/`. `summarizer.py` holds the input/output DTOs, the paraphrase prompt, a shared request builder (`build_summary_request`), a batched-request wrapper (`build_summary_batch_request`), a response parser (`parse_summary`), and a sequential convenience (`summarize_event`) — plus `Completer`/`BatchCompleter`/`SummaryClient` protocols so the LLM client is injected and tests use fakes. No DB, no ORM, no migration, no router, no cron. The batched *orchestration loop* (build all → `complete_batch` → parse each → upsert) is NEU-305, exactly as `_link_stage_batched` lives in `pipeline.py`, not `linker.py`; this ticket ships the reusable pieces and proves the batched path round-trips at the service level.

**Tech Stack:** Python 3.13, Pydantic-settings, the `anthropic` Messages + Message Batches API via the already-landed `AnthropicClient` (`complete` / `complete_batch`), pytest (pytest-asyncio **auto** mode — no `@pytest.mark.asyncio`), ruff, pyright. All tooling runs in the container via `task` (never raw `pytest`/`ruff`/`pyright` on the host).

**Ticket:** NEU-304 (one PR, backend). Blocked by NEU-303 (`news.event_summary` schema, ✅ merged PR #31). Blocks NEU-305 (`synthesize` pipeline + ingest kind + trigger + cron). Design-of-record: `docs/specs/2026-06-22-neu-304-summarization-service-design.md`.

**Commits / shipping:** This whole plan is a single ticket = single PR. Do **not** add per-step `git commit` calls; commit once at the end via `/t:ship` (run `task format` first, then commit normally — pre-commit hooks delegate into the container, so no `--no-verify`). If running subagent-driven, **strip any commit step from implementer prompts** — the user commits once at the end. Implement in a **Sonnet/high** session per the model/effort workflow; this Opus session produced the design + plan only.

**Out of scope (downstream / later milestones):** the `synthesize` pipeline, stale-event selection, ORM→`EventInput` mapping, and `event_summary` upsert (NEU-305); the `ingest_run.kind` constraint, trigger endpoint, and cron (NEU-305); `catalog.film.slug`, the public read API, and SSR (M2–M4). No migration, no FE, no new **required** env.

---

## Reference: contracts the implementer needs

### `news.event_summary` (landed NEU-303 — what NEU-305 will persist, shown for context only)

`event_id` (uuid PK, FK→`news.event` CASCADE) · `summary` Text · `model` Text · `prompt_version` Text · `source_updated_at` timestamptz · `generated_at` timestamptz default `now()`. **NEU-304 writes nothing** — `SummaryResult` carries `summary`/`model`/`prompt_version`/`source_updated_at`.

### `AnthropicClient` surface (from `src/upmovies/llm/client.py`)

```python
async def complete(self, *, model: str, system: list[dict[str, Any]],
                   messages: list[dict[str, Any]], max_tokens: int = 4096) -> str: ...

async def complete_batch(self, requests: list[BatchRequest], *,
                         poll_interval: float = 15.0, timeout: float = 3600.0,
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
    usage: Usage | None = None
```

`system` is a list of content blocks. The linker wraps its block with `cached_system_block(...)` because its roster prefix is large; **this service uses a plain block** `{"type": "text", "text": _INSTRUCTIONS}` (no `cache_control`) — the instructions are short (sub-minimum cacheable size), so caching would be a no-op.

### House parser idiom (mirror this exactly — from `link/cluster.py`)

```python
def _extract_json_object(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return text
    return text[start : end + 1]
```

---

## File Structure

- **Modify** `src/upmovies/config.py` — add `summary_model` / `summary_use_batches` / `summary_prompt_version` after the `link_use_batches` line.
- **Create** `src/upmovies/synthesize/__init__.py` — re-exports (`import x as x`), populated in Task 5.
- **Create** `src/upmovies/synthesize/summarizer.py` — DTOs, prompt, helpers, build/parse/summarize, protocols.
- **Modify** `tests/unit/test_config.py` — summary-field defaults + overrides.
- **Create** `tests/unit/synthesize/__init__.py` — empty package marker.
- **Create** `tests/unit/synthesize/test_summarizer.py` — all service unit tests.

No migration. No new files outside the above. No new required env.

---

## Task 1: `summary_*` config fields

**Files:**
- Modify: `src/upmovies/config.py`
- Test: `tests/unit/test_config.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/test_config.py`, after `test_settings_link_use_batches_override_from_env` (line 88):

```python
def test_settings_summary_defaults(monkeypatch):
    _set_required(monkeypatch)
    for key in ("SUMMARY_MODEL", "SUMMARY_USE_BATCHES", "SUMMARY_PROMPT_VERSION"):
        monkeypatch.delenv(key, raising=False)
    s = Settings()  # type: ignore[call-arg]
    assert s.summary_model == "claude-haiku-4-5"
    assert s.summary_use_batches is True
    assert s.summary_prompt_version == "1"


def test_settings_summary_overrides_from_env(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.setenv("SUMMARY_MODEL", "claude-sonnet-4-6")
    monkeypatch.setenv("SUMMARY_USE_BATCHES", "false")
    monkeypatch.setenv("SUMMARY_PROMPT_VERSION", "2")
    s = Settings()  # type: ignore[call-arg]
    assert s.summary_model == "claude-sonnet-4-6"
    assert s.summary_use_batches is False
    assert s.summary_prompt_version == "2"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/test_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'summary_model'`.

- [ ] **Step 3: Add the fields**

In `src/upmovies/config.py`, add directly after the `link_use_batches` line (line 36):

```python
    summary_model: str = Field(default="claude-haiku-4-5", alias="SUMMARY_MODEL")
    summary_use_batches: bool = Field(default=True, alias="SUMMARY_USE_BATCHES")
    summary_prompt_version: str = Field(default="1", alias="SUMMARY_PROMPT_VERSION")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/test_config.py -v`
Expected: PASS (both new tests; existing config tests still green).

---

## Task 2: `synthesize` package — DTOs, prompt, `build_summary_request`

**Files:**
- Create: `src/upmovies/synthesize/__init__.py` (empty for now)
- Create: `src/upmovies/synthesize/summarizer.py`
- Create: `tests/unit/synthesize/__init__.py` (empty)
- Test: `tests/unit/synthesize/test_summarizer.py`

- [ ] **Step 1: Create the empty package markers**

Create `src/upmovies/synthesize/__init__.py` with no content (re-exports are added in Task 5):

```python
```

Create `tests/unit/synthesize/__init__.py` with no content:

```python
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/synthesize/test_summarizer.py`:

```python
import json
from datetime import UTC, datetime

import pytest

from upmovies.llm.client import BatchResult
from upmovies.synthesize.summarizer import (
    EventInput,
    StoryInput,
    build_summary_request,
)


def _event(*, stories=None, event_type="casting", film_title="Runner"):
    return EventInput(
        event_type=event_type,
        film_title=film_title,
        source_updated_at=datetime(2026, 6, 22, tzinfo=UTC),
        stories=stories or [StoryInput(title="Big news", dek="A short dek.", source="Deadline")],
    )


class FakeCompleter:
    def __init__(self, response: str):
        self._response = response
        self.calls: list[dict] = []

    async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
        self.calls.append(
            {"model": model, "system": system, "messages": messages, "max_tokens": max_tokens}
        )
        return self._response


class FakeBatchCompleter:
    def __init__(self, response: str):
        self._response = response
        self.requests = None

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        self.requests = list(requests)
        return {
            r.custom_id: BatchResult(custom_id=r.custom_id, ok=True, text=self._response)
            for r in requests
        }


def test_build_summary_request_plain_block_and_payload():
    event = _event(
        stories=[
            StoryInput(title="Casting news", dek="Star joins the film.", source="Variety"),
            StoryInput(title="More", dek="Another report.", source="THR"),
        ]
    )
    system, messages = build_summary_request(event)
    # plain block — NO caching (short prompt, sub-minimum cacheable size)
    assert "cache_control" not in system[0]
    assert "paraphrase" in system[0]["text"].lower()
    payload = json.loads(messages[0]["content"])
    assert payload["film"] == "Runner"
    assert payload["event_type"] == "casting"
    assert [s["source"] for s in payload["stories"]] == ["Variety", "THR"]
    assert payload["stories"][0]["title"] == "Casting news"
    assert payload["stories"][0]["dek"] == "Star joins the film."


def test_build_summary_request_truncates_dek():
    long_dek = "x" * 1000
    _system, messages = build_summary_request(
        _event(stories=[StoryInput(title="t", dek=long_dek, source="Deadline")])
    )
    payload = json.loads(messages[0]["content"])
    assert len(payload["stories"][0]["dek"]) == 500
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.synthesize.summarizer'` (or `ImportError`).

- [ ] **Step 4: Create `summarizer.py` with the DTOs, prompt, payload builder, and request builder**

Create `src/upmovies/synthesize/summarizer.py`:

```python
"""Summarization service: turn one news event (as an in-memory EventInput) into one neutral
2–3 sentence paraphrase via the Anthropic Messages/Batches API. Self-contained (no DB); the
caller maps ORM→EventInput and persists the returned SummaryResult. The LLM client is injected
(Completer / BatchCompleter) so this is unit-testable with fakes."""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from upmovies.llm.client import BatchRequest, BatchResult

_DEK_MAX = 500
_MAX_TOKENS = 256

_INSTRUCTIONS = """You write neutral, factual update blurbs for an upcoming-movies tracker.

You are given one tracked film, the TYPE of news beat being reported, and the stories that \
report it (each a headline, a short dek, and its publication's name). Write ONE update of \
2–3 sentences summarizing this beat for a reader following the film.

Rules:
- Strict paraphrase. State the facts (who / what / when) entirely in your own words. \
Reproduce no phrasing from the headlines or deks — no quoted fragments, no distinctive \
wording lifted verbatim.
- Neutral register. Report what happened plainly; no hype, opinion, clickbait, or \
editorializing.
- Preserve certainty. Never present a report or rumor as established fact. If the sources \
hedge ("reportedly", "is said to"), hedge; if they confirm, state it plainly. Never upgrade \
the sources' level of certainty.
- Stay within the sources. Add no facts, dates, names, or speculation not present in the \
provided material.
- Refer to the film by its title where natural. 2–3 sentences, one paragraph.

Return ONLY a JSON object, no prose or markdown:
{"summary": "<your 2–3 sentence update>"}"""


@dataclass(frozen=True)
class StoryInput:
    title: str
    dek: str
    source: str


@dataclass(frozen=True)
class EventInput:
    event_type: str
    film_title: str
    source_updated_at: datetime
    stories: Sequence[StoryInput]


@dataclass(frozen=True)
class SummaryResult:
    summary: str
    model: str
    prompt_version: str
    source_updated_at: datetime


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


class SummaryClient(Completer, BatchCompleter, Protocol): ...


def _event_payload(event: EventInput) -> dict[str, Any]:
    return {
        "film": event.film_title,
        "event_type": event.event_type,
        "stories": [
            {"title": s.title, "dek": s.dek[:_DEK_MAX], "source": s.source} for s in event.stories
        ],
    }


def build_summary_request(
    event: EventInput,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The plain instructions system block + the JSON event payload — shared by both the
    sequential `complete()` path and the batched `complete_batch()` path. Truncates each dek."""
    system = [{"type": "text", "text": _INSTRUCTIONS}]
    messages = [{"role": "user", "content": json.dumps(_event_payload(event))}]
    return system, messages


def build_summary_batch_request(
    *, custom_id: str, model: str, event: EventInput
) -> BatchRequest:
    """One Message-Batch request for one event. `custom_id` is the event id (the caller
    supplies it). `max_tokens` matches the sequential path's `_MAX_TOKENS` for parity."""
    system, messages = build_summary_request(event)
    return BatchRequest(
        custom_id=custom_id, model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -v`
Expected: PASS — `test_build_summary_request_plain_block_and_payload` and `test_build_summary_request_truncates_dek`.

---

## Task 3: `parse_summary` + `_extract_json_object`

**Files:**
- Modify: `src/upmovies/synthesize/summarizer.py`
- Test: `tests/unit/synthesize/test_summarizer.py`

- [ ] **Step 1: Write the failing tests**

First extend the import block at the top of `tests/unit/synthesize/test_summarizer.py` to add `parse_summary`:

```python
from upmovies.synthesize.summarizer import (
    EventInput,
    StoryInput,
    build_summary_request,
    parse_summary,
)
```

Then add these tests:

```python
def test_parse_summary_extracts_and_strips():
    assert parse_summary('{"summary": "  A neutral update.  "}') == "A neutral update."


def test_parse_summary_tolerates_prose_and_fences():
    raw = 'Sure:\n```json\n{"summary": "Filming wrapped."}\n```'
    assert parse_summary(raw) == "Filming wrapped."


def test_parse_summary_raises_on_empty():
    with pytest.raises(ValueError):
        parse_summary('{"summary": "   "}')


def test_parse_summary_raises_on_missing_key():
    with pytest.raises(ValueError):
        parse_summary('{"note": "no summary here"}')


def test_parse_summary_raises_on_malformed():
    with pytest.raises(json.JSONDecodeError):
        parse_summary("not json at all")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -k parse_summary -v`
Expected: FAIL — `ImportError: cannot import name 'parse_summary'` (it isn't defined yet; the module-level import at the top of the test file fails, so the whole file errors on collection — that's expected).

- [ ] **Step 3: Add `_extract_json_object` and `parse_summary`**

In `src/upmovies/synthesize/summarizer.py`, add after `_event_payload` (and before `build_summary_request`):

```python
def _extract_json_object(text: str) -> str:
    """Pull the JSON object out of a response that may be wrapped in prose/markdown fences."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return text
    return text[start : end + 1]


def parse_summary(raw: str) -> str:
    """Extract the JSON object, read its `summary`, and return it stripped. Raises on
    un-parseable output (`json.JSONDecodeError`) or a missing/empty `summary` (`ValueError`)."""
    obj = json.loads(_extract_json_object(raw))
    summary = obj.get("summary") if isinstance(obj, dict) else None
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError(f"no usable summary in model output: {raw!r}")
    return summary.strip()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -k parse_summary -v`
Expected: PASS — all five `parse_summary` tests (happy/strip, fences, empty→`ValueError`, missing-key→`ValueError`, malformed→`json.JSONDecodeError`).

---

## Task 4: `summarize_event` (sequential path)

**Files:**
- Modify: `src/upmovies/synthesize/summarizer.py`
- Test: `tests/unit/synthesize/test_summarizer.py`

- [ ] **Step 1: Write the failing tests**

First extend the import block to add `summarize_event`:

```python
from upmovies.synthesize.summarizer import (
    EventInput,
    StoryInput,
    build_summary_request,
    parse_summary,
    summarize_event,
)
```

Then add these tests:

```python
async def test_summarize_event_returns_result_with_provenance():
    client = FakeCompleter('{"summary": "The studio confirmed a 2027 release."}')
    event = _event()
    result = await summarize_event(
        client=client, model="claude-haiku-4-5", prompt_version="1", event=event
    )
    assert result.summary == "The studio confirmed a 2027 release."
    assert result.model == "claude-haiku-4-5"
    assert result.prompt_version == "1"
    assert result.source_updated_at == event.source_updated_at
    # the sequential path pins max_tokens for parity with the batched path
    assert client.calls[0]["max_tokens"] == 256


async def test_summarize_event_prompt_includes_every_member_story():
    client = FakeCompleter('{"summary": "ok."}')
    event = _event(
        stories=[
            StoryInput(title="A", dek="da", source="Deadline"),
            StoryInput(title="B", dek="db", source="Variety"),
            StoryInput(title="C", dek="dc", source="THR"),
        ]
    )
    await summarize_event(client=client, model="m", prompt_version="1", event=event)
    payload = json.loads(client.calls[0]["messages"][0]["content"])
    assert [s["title"] for s in payload["stories"]] == ["A", "B", "C"]
    assert [s["source"] for s in payload["stories"]] == ["Deadline", "Variety", "THR"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -k summarize_event -v`
Expected: FAIL — `ImportError: cannot import name 'summarize_event'` (whole file errors on collection — expected).

- [ ] **Step 3: Add `summarize_event`**

In `src/upmovies/synthesize/summarizer.py`, add at the end of the file (after `build_summary_batch_request`):

```python
async def summarize_event(
    *, client: Completer, model: str, prompt_version: str, event: EventInput
) -> SummaryResult:
    """Sequential path: build the request, call `complete` (max_tokens pinned to `_MAX_TOKENS`
    for parity with the batched path), parse the JSON envelope, and bundle the provenance the
    caller persists into `event_summary`."""
    system, messages = build_summary_request(event)
    raw = await client.complete(
        model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
    return SummaryResult(
        summary=parse_summary(raw),
        model=model,
        prompt_version=prompt_version,
        source_updated_at=event.source_updated_at,
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -k summarize_event -v`
Expected: PASS — both `summarize_event` tests.

---

## Task 5: Batched-path parity test + package re-exports

**Files:**
- Modify: `src/upmovies/synthesize/__init__.py`
- Test: `tests/unit/synthesize/test_summarizer.py`

- [ ] **Step 1: Write the failing test**

First extend the import block to add `build_summary_batch_request` (the final import block now holds all six symbols, every one used somewhere in the file):

```python
from upmovies.synthesize.summarizer import (
    EventInput,
    StoryInput,
    build_summary_batch_request,
    build_summary_request,
    parse_summary,
    summarize_event,
)
```

Then add this test:

```python
async def test_batched_path_round_trips_to_same_summary():
    event = _event()
    envelope = '{"summary": "Principal photography has begun."}'
    client = FakeBatchCompleter(envelope)

    req = build_summary_batch_request(custom_id="evt-9", model="m", event=event)
    assert req.custom_id == "evt-9"
    assert req.model == "m"
    assert req.max_tokens == 256
    # parity: same system + messages the sequential builder produces
    system, messages = build_summary_request(event)
    assert req.system == system
    assert req.messages == messages
    assert "cache_control" not in req.system[0]

    results = await client.complete_batch([req])
    assert client.requests[0].custom_id == "evt-9"
    result = results["evt-9"]
    assert result.ok
    # batched path yields the identical parsed summary as the sequential path
    assert parse_summary(result.text) == "Principal photography has begun."
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -k batched_path -v`
Expected: PASS immediately — `build_summary_batch_request` already exists in `summarizer.py` (Task 2 source) and `parse_summary` from Task 3, so once the import is added the test is green. It documents the batched-path parity contract NEU-305 relies on. (This is the rare task whose test is green on first run because the production code already landed in earlier tasks — that's intentional; the test exists to lock the contract.)

- [ ] **Step 3: Populate the package re-exports**

Overwrite `src/upmovies/synthesize/__init__.py` with the public API (matching the `import x as x` idiom in `link/__init__.py`):

```python
from upmovies.synthesize.summarizer import BatchCompleter as BatchCompleter
from upmovies.synthesize.summarizer import Completer as Completer
from upmovies.synthesize.summarizer import EventInput as EventInput
from upmovies.synthesize.summarizer import StoryInput as StoryInput
from upmovies.synthesize.summarizer import SummaryClient as SummaryClient
from upmovies.synthesize.summarizer import SummaryResult as SummaryResult
from upmovies.synthesize.summarizer import (
    build_summary_batch_request as build_summary_batch_request,
)
from upmovies.synthesize.summarizer import build_summary_request as build_summary_request
from upmovies.synthesize.summarizer import parse_summary as parse_summary
from upmovies.synthesize.summarizer import summarize_event as summarize_event
```

- [ ] **Step 4: Verify the package imports cleanly**

Run: `task test -- tests/unit/synthesize/ -v`
Expected: PASS — the full `synthesize` unit suite (Tasks 2–5) is green; the new `__init__.py` imports resolve.

---

## Task 6: Full green + ship

**Files:** none (verification + ship)

- [ ] **Step 1: Format**

Run: `task format`
Expected: ruff reformats `src` + `tests`; a re-run is clean. (Watch the long `_INSTRUCTIONS` triple-quoted string and the line-continuations — keep lines ≤ 100 chars.)

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: `ruff check src tests` clean. Confirm no unused imports (e.g. `SummaryClient`/`BatchCompleter` are exported from `__init__.py`, so they are "used" even though `summarize_event` only types `Completer`).

- [ ] **Step 3: Typecheck**

Run: `task typecheck`
Expected: `pyright src tests` clean. The fakes in the test file structurally satisfy `Completer` / `BatchCompleter`; `summarize_event` types its client as `Completer`.

- [ ] **Step 4: Full repo test pass**

Run: `task test`
Expected: green across the whole suite. (Per the backend CLAUDE.md, run the whole suite — a single *integration* file in isolation can error on a pytest-asyncio session-loop quirk; these are unit tests, but still confirm the full suite.)

- [ ] **Step 5: Ship**

Per the project flow, commit once and open the PR with `/t:ship` (it sets the branch — `tom/neu-304-backend-summarization-service-haiku-45-batched-paraphrase` — runs `/commit-msg` + `/pr-desc`, and targets the release branch). Do **not** commit per-task. Run `task format` first; commit normally (pre-commit hooks delegate into the container — no `--no-verify`).

---

## Self-Review (completed during authoring)

- **Spec coverage:** `EventInput`/`StoryInput`/`SummaryResult` DTOs (Task 2) · plain (uncached) instructions block (Task 2; asserted in `test_build_summary_request_plain_block_and_payload`) · payload carries film/event_type/each story's title/dek/source (Task 2) · dek truncated to `_DEK_MAX=500` (Task 2) · JSON-envelope parse with prose/fence tolerance + raises on missing/empty/malformed (Task 3) · sequential `summarize_event` returning provenance with `max_tokens=256` parity (Task 4) · multi-story prompt includes every member story (Task 4) · `build_summary_batch_request` carries custom_id/model/`max_tokens=256` and is byte-identical to the sequential request, round-tripping through a fake `complete_batch` (Task 5) · three config fields with `summary_use_batches` default **True** + overrides (Task 1) · `task format`/`lint`/`typecheck`/`test` green (Task 6). Every spec section maps to a task; the batched *orchestration loop* and `event_summary` upsert are explicitly NEU-305.
- **Placeholder scan:** none — every code/test step shows complete code and exact `task` commands. The `<your 2–3 sentence update>` token lives inside the prompt string (intentional model-facing template), not the plan.
- **Type consistency:** `build_summary_request(event) -> (system, messages)` is consumed identically by `build_summary_batch_request` and `summarize_event`. `EventInput`/`StoryInput`/`SummaryResult` field names match across the module and tests (`source_updated_at` echoed verbatim into `SummaryResult`). `parse_summary(raw) -> str` is called by both `summarize_event` and the Task 5 batched test. `_MAX_TOKENS=256`/`_DEK_MAX=500` are referenced consistently. Protocols (`Completer`/`BatchCompleter`/`SummaryClient`) mirror `linker.py`; the injected `AnthropicClient` satisfies `SummaryClient`.
- **TDD note (import ordering):** Task 2's test import block references **only** what Task 2 defines (`EventInput`/`StoryInput`/`build_summary_request`), so Task 2 ends green. Each later task's failing-test step first **extends** that import block with the symbol it introduces — `parse_summary` (Task 3), `summarize_event` (Task 4), `build_summary_batch_request` (Task 5). Until that symbol exists in `summarizer.py`, importing it makes the whole file error on collection — that `ImportError` is the expected red step (runs scope with `-k` to keep the signal focused). By Task 6 every one of the six imports is used somewhere in the file, so `task lint` is clean.
