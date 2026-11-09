# Link Cost Measurement (batch vs sequential+caching) + Flip Default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a re-runnable harness that measures the real token cost of the two Stage-1 link paths (sequential+caching vs batched) against a locally-ingested corpus, record the numbers in the design-of-record spec, and flip `link_use_batches` to default-true if batches win net by a clear margin.

**Architecture:** Surface token usage from the LLM client with purely-additive changes (`Usage` dataclass, `complete_with_usage`, `BatchResult.usage`) — no existing return type changes, so `linker`/`cluster`/`pipeline` are untouched. A self-contained script (`scripts/measure_link_cost.py`) builds requests through the **same** production helpers (`build_roster`, `build_link_request`, `build_batch_request`, `_chunks`), drives both Stage-1 shapes against the live API with cold-cache-per-run isolation (a unique nonce prepended to the cached roster block), prices each path's measured token split, and prints a comparison table. The harness never writes link decisions, so both paths run on the identical pending set with no DB reset.

**Tech Stack:** Python 3.13, async SQLAlchemy 2 + asyncpg, Pydantic-settings, `anthropic` SDK (Messages + Message Batches), pytest (pytest-asyncio auto mode) with **respx** for HTTP mocking, ruff, pyright. All tooling runs in the container via `task` (no host Python).

**Ticket:** NEU-297 (one PR, backend + docs). Blocked by NEU-296 (Stage-1 batched path, ✅ merged PR #27). Blocks NEU-298 (Stage-2 batching). Design-of-record: `docs/specs/2026-06-22-neu-297-link-cost-measurement-design.md` and `docs/specs/2026-06-20-ingestion-cadence-recency-architecture-design.md` §"Batches API cost optimization".

**Commits / shipping:** This whole plan is a single ticket = single PR. Do **not** add per-step `git commit` calls; commit once at the end via `/t:ship` (`task format` first, then commit normally — pre-commit hooks delegate into the container, no `--no-verify`). Implement in a Sonnet/high session per the model/effort workflow.

**Out of scope (downstream / not this PR):** Stage-2 clustering via batches and its cost (NEU-298); any behavior change to `run_link_ingest`/`linker`/`cluster`/`pipeline`; live API calls in CI; new required env.

---

## Reference: current shapes (read before Task 1)

From `src/upmovies/llm/client.py` (today):

```python
@dataclass(frozen=True)
class BatchResult:
    custom_id: str
    ok: bool
    text: str = ""
    error_type: str | None = None
    error_message: str | None = None

async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
    resp = await self._client.messages.create(model=model, system=system, messages=messages, max_tokens=max_tokens)
    return _concat_text(resp.content)
```

The Anthropic SDK response/message `.usage` object always carries `input_tokens` and `output_tokens`, and carries `cache_read_input_tokens` / `cache_creation_input_tokens` that are `None` when no caching occurred. `_to_result` (the batch results mapper) has `result.message.usage` available on a succeeded entry.

Production helpers reused by the harness (all already present):
- `upmovies.link.roster.build_roster(session) -> Roster`; `Roster` is a frozen dataclass with `.text` and `.entries`.
- `upmovies.link.linker.build_link_request(roster, stories) -> (system, messages)`, `build_batch_request(*, custom_id, model, roster, stories) -> BatchRequest`, and `_MAX_TOKENS = 2048`.
- `upmovies.link.pipeline._chunks(seq, size) -> list[list[UUID]]`.
- Pending selection predicate (from `run_link_ingest`): `Story.link_status == "pending"` AND `func.coalesce(Story.published_at, Story.fetched_at) >= cutoff`.
- `upmovies.db.SessionLocal`; `upmovies.config.get_settings()` (fields: `anthropic_api_key`, `link_model`, `link_batch_size`, `link_recency_days`).

---

## File Structure

- **Modify** `src/upmovies/llm/client.py` — add `Usage` dataclass (+ `from_sdk`, `__add__`); add `complete_with_usage`; `complete` delegates to it; add `usage` field to `BatchResult`; populate it in `_to_result`.
- **Create** `scripts/measure_link_cost.py` — the measurement harness (pricing + report pure functions, the two measure functions, DB selection, CLI `main`).
- **Modify** `tests/unit/llm/test_client.py` — usage-mapping + delegation + batch-usage tests; make `_message_response` accept an optional usage block.
- **Create** `tests/unit/scripts/__init__.py` and `tests/unit/scripts/test_measure_link_cost.py` — pure tests (`price`, `format_report`, `Usage` math) + orchestration tests with a fake client.
- **Create** `tests/integration/scripts/__init__.py` and `tests/integration/scripts/test_corpus_selection.py` — DB test that `select_corpus` matches the pipeline's pending predicate.
- **Modify (after the run)** `docs/specs/2026-06-20-ingestion-cadence-recency-architecture-design.md` — record results + decision.
- **Modify (after the run, iff justified)** `src/upmovies/config.py` — flip `link_use_batches` default to `True`.

No migration. No FE. No new required env.

---

## Task 1: `Usage` dataclass (mapping + summation)

**Files:**
- Modify: `src/upmovies/llm/client.py`
- Test: `tests/unit/llm/test_client.py`

- [ ] **Step 1: Write the failing tests**

Add to the top of `tests/unit/llm/test_client.py` — extend the import and add a `types` import:

```python
import types
```
```python
from upmovies.llm.client import (
    AnthropicClient,
    BatchRequest,
    BatchResult,
    Usage,
    cached_system_block,
)
```

Then add these pure tests (no respx needed) at the end of the file:

```python
def test_usage_from_sdk_maps_all_four_fields():
    sdk = types.SimpleNamespace(
        input_tokens=100,
        output_tokens=20,
        cache_read_input_tokens=80,
        cache_creation_input_tokens=5,
    )
    u = Usage.from_sdk(sdk)
    assert u == Usage(
        input_tokens=100, output_tokens=20, cache_read_input_tokens=80, cache_creation_input_tokens=5
    )


def test_usage_from_sdk_defaults_missing_cache_fields_to_zero():
    sdk = types.SimpleNamespace(
        input_tokens=10, output_tokens=3, cache_read_input_tokens=None, cache_creation_input_tokens=None
    )
    u = Usage.from_sdk(sdk)
    assert u.cache_read_input_tokens == 0
    assert u.cache_creation_input_tokens == 0
    assert u.input_tokens == 10
    assert u.output_tokens == 3


def test_usage_add_sums_componentwise():
    a = Usage(input_tokens=1, output_tokens=2, cache_read_input_tokens=3, cache_creation_input_tokens=4)
    b = Usage(input_tokens=10, output_tokens=20, cache_read_input_tokens=30, cache_creation_input_tokens=40)
    assert a + b == Usage(
        input_tokens=11, output_tokens=22, cache_read_input_tokens=33, cache_creation_input_tokens=44
    )


def test_usage_sum_with_zero_start():
    items = [Usage(input_tokens=1), Usage(input_tokens=2), Usage(input_tokens=3)]
    assert sum(items, Usage()).input_tokens == 6
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/llm/test_client.py -v`
Expected: FAIL — `ImportError: cannot import name 'Usage'`.

- [ ] **Step 3: Add the `Usage` dataclass**

In `src/upmovies/llm/client.py`, add directly **above** the `BatchRequest` dataclass:

```python
@dataclass(frozen=True)
class Usage:
    """Token counts for one Messages/Batch call. Cache fields are 0 when no caching
    occurred. `__add__` lets callers `sum(usages, Usage())` across many calls."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            cache_read_input_tokens=self.cache_read_input_tokens + other.cache_read_input_tokens,
            cache_creation_input_tokens=(
                self.cache_creation_input_tokens + other.cache_creation_input_tokens
            ),
        )

    @classmethod
    def from_sdk(cls, usage: Any) -> "Usage":
        return cls(
            input_tokens=getattr(usage, "input_tokens", 0) or 0,
            output_tokens=getattr(usage, "output_tokens", 0) or 0,
            cache_read_input_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
            cache_creation_input_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
        )
```

(`Any` and `dataclass` are already imported at the top of the file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/llm/test_client.py -v`
Expected: PASS — the four new `Usage` tests pass; existing client tests stay green.

---

## Task 2: `complete_with_usage` + `complete` delegates

**Files:**
- Modify: `src/upmovies/llm/client.py`
- Test: `tests/unit/llm/test_client.py`

- [ ] **Step 1: Make `_message_response` accept an optional usage block, then write the failing test**

In `tests/unit/llm/test_client.py`, replace the existing `_message_response` helper with:

```python
def _message_response(
    blocks: list[dict[str, str]], usage: dict | None = None
) -> httpx.Response:
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
            "usage": usage or {"input_tokens": 10, "output_tokens": 3},
        },
    )
```

Then add this test:

```python
@respx.mock
async def test_complete_with_usage_returns_text_and_usage():
    respx.post(MESSAGES_URL).mock(
        return_value=_message_response(
            [{"type": "text", "text": "hi there"}],
            usage={
                "input_tokens": 12,
                "output_tokens": 4,
                "cache_read_input_tokens": 900,
                "cache_creation_input_tokens": 100,
            },
        )
    )
    async with AnthropicClient(api_key="test-key") as c:
        text, usage = await c.complete_with_usage(
            model="claude-haiku-4-5",
            system=[cached_system_block("ROSTER")],
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=16,
        )
    assert text == "hi there"
    assert usage == Usage(
        input_tokens=12, output_tokens=4, cache_read_input_tokens=900, cache_creation_input_tokens=100
    )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/llm/test_client.py::test_complete_with_usage_returns_text_and_usage -v`
Expected: FAIL — `AttributeError: 'AnthropicClient' object has no attribute 'complete_with_usage'`.

- [ ] **Step 3: Add `complete_with_usage`, make `complete` delegate**

In `src/upmovies/llm/client.py`, replace the existing `complete` method with both methods:

```python
    async def complete_with_usage(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
    ) -> tuple[str, Usage]:
        """Like `complete` but also returns the call's token `Usage` (incl. cache reads/
        writes). The measurement harness uses this; production callers use `complete`."""
        resp = await self._client.messages.create(
            model=model,
            system=system,  # type: ignore[arg-type]
            messages=messages,  # type: ignore[arg-type]
            max_tokens=max_tokens,
        )
        return _concat_text(resp.content), Usage.from_sdk(resp.usage)

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
        text, _ = await self.complete_with_usage(
            model=model, system=system, messages=messages, max_tokens=max_tokens
        )
        return text
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/llm/test_client.py -v`
Expected: PASS — the new test passes AND the existing `test_complete_returns_text_and_sends_cache_control` / `test_complete_concatenates_text_blocks` stay green (delegation is behavior-preserving; the cache-control request body is unchanged).

---

## Task 3: `BatchResult.usage` populated in `_to_result`

**Files:**
- Modify: `src/upmovies/llm/client.py`
- Test: `tests/unit/llm/test_client.py`

- [ ] **Step 1: Add usage to the batch test fixtures and write the failing test**

In `tests/unit/llm/test_client.py`, replace `_succeeded_line` so it accepts an optional usage block:

```python
def _succeeded_line(custom_id: str, text: str, usage: dict | None = None) -> dict:
    return {
        "custom_id": custom_id,
        "result": {
            "type": "succeeded",
            "message": {
                "id": "msg_x",
                "type": "message",
                "role": "assistant",
                "model": "claude-haiku-4-5",
                "content": [{"type": "text", "text": text}],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": usage or {"input_tokens": 1, "output_tokens": 1},
            },
        },
    }
```

Then add this test:

```python
@respx.mock
async def test_complete_batch_populates_usage_on_success():
    respx.post(BATCHES_URL).mock(return_value=httpx.Response(200, json=_batch("in_progress")))
    respx.get(RETRIEVE_URL).mock(
        side_effect=[
            httpx.Response(200, json=_batch("ended", results_url=RESULTS_URL)),
            httpx.Response(200, json=_batch("ended", results_url=RESULTS_URL)),
        ]
    )
    respx.get(RESULTS_URL).mock(
        return_value=httpx.Response(
            200,
            text=_jsonl(
                _succeeded_line(
                    "req-0",
                    "alpha",
                    usage={
                        "input_tokens": 7,
                        "output_tokens": 2,
                        "cache_read_input_tokens": 500,
                        "cache_creation_input_tokens": 50,
                    },
                ),
                _errored_line("req-1", "invalid_request_error", "boom"),
            ),
            headers={"content-type": "application/x-jsonl"},
        )
    )

    async with AnthropicClient(api_key="test-key") as c:
        out = await c.complete_batch([_req("req-0"), _req("req-1")], poll_interval=0)

    assert out["req-0"].usage == Usage(
        input_tokens=7, output_tokens=2, cache_read_input_tokens=500, cache_creation_input_tokens=50
    )
    # Errored entry has no usage.
    assert out["req-1"].usage is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/llm/test_client.py::test_complete_batch_populates_usage_on_success -v`
Expected: FAIL — `TypeError: BatchResult.__init__() got an unexpected keyword argument 'usage'`.

- [ ] **Step 3: Add the field and populate it**

In `src/upmovies/llm/client.py`, add the `usage` field to `BatchResult` (after `error_message`):

```python
@dataclass(frozen=True)
class BatchResult:
    """One request's outcome. `text` is set when `ok`; otherwise `error_type` /
    `error_message` describe the failure (errored / expired / canceled / missing).
    `usage` carries the call's token counts when `ok`, else `None`."""

    custom_id: str
    ok: bool
    text: str = ""
    error_type: str | None = None
    error_message: str | None = None
    usage: Usage | None = None
```

Then in `_to_result`, populate `usage` on the succeeded branch:

```python
    if result.type == "succeeded":
        return BatchResult(
            custom_id=entry.custom_id,
            ok=True,
            text=_concat_text(result.message.content),
            usage=Usage.from_sdk(result.message.usage),
        )
```

(The errored / fall-through branches stay as they are — `usage` defaults to `None`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/llm/test_client.py -v`
Expected: PASS — the new test passes; existing batch tests (which compare `BatchResult(custom_id=..., ok=True, text=...)`) still pass because `usage` defaults to `None` and those success fixtures use the default usage that maps to a non-`None` `Usage` — **note:** the existing `test_complete_batch_polls_to_ended_and_collects_succeeded` asserts `out["req-0"] == BatchResult(custom_id="req-0", ok=True, text="alpha")`, which will now FAIL because the result carries a populated `usage`. Update those two equality assertions in that test to ignore usage by comparing fields instead:

```python
    assert out["req-0"].custom_id == "req-0" and out["req-0"].ok and out["req-0"].text == "alpha"
    assert out["req-1"].custom_id == "req-1" and out["req-1"].ok and out["req-1"].text == "beta"
```

Re-run `task test -- tests/unit/llm/test_client.py -v`. Expected: PASS across the file.

---

## Task 4: Harness pricing + report (pure functions)

Create the harness module with its imports, the rate model, and the two pure functions. The DB/CLI/measure functions come in Tasks 5–6; this task establishes the file and the unit-testable cost math.

**Files:**
- Create: `scripts/measure_link_cost.py`
- Create: `tests/unit/scripts/__init__.py`
- Test: `tests/unit/scripts/test_measure_link_cost.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/scripts/__init__.py` (empty file).

Create `tests/unit/scripts/test_measure_link_cost.py`:

```python
from upmovies.llm.client import Usage
from scripts.measure_link_cost import Rates, format_report, price

RATES = Rates(input_per_mtok=1.00, output_per_mtok=5.00)


def test_price_full_rates_sequential():
    # 1,000,000 uncached input @ $1 + 1,000,000 output @ $5 = $6.00
    u = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
    assert price(u, RATES, batch=False) == 6.0


def test_price_cache_multipliers():
    # cache write = 1.25x input, cache read = 0.10x input
    u = Usage(cache_creation_input_tokens=1_000_000, cache_read_input_tokens=1_000_000)
    # 1.25 + 0.10 = $1.35
    assert price(u, RATES, batch=False) == 1.35


def test_price_batch_halves_total():
    u = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
    assert price(u, RATES, batch=True) == 3.0


def test_format_report_includes_totals_and_decision_fields():
    seq = [Usage(input_tokens=100, output_tokens=10, cache_read_input_tokens=900, cache_creation_input_tokens=100)]
    bat = [Usage(input_tokens=1000, output_tokens=10, cache_read_input_tokens=0, cache_creation_input_tokens=1000)]
    report = format_report(seq, bat, RATES)
    assert "cache_read_input_tokens" in report
    assert "cache_creation_input_tokens" in report
    assert "sequential" in report.lower()
    assert "batched" in report.lower()
    # both per-path mean dollar figures appear
    assert "$" in report
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/scripts/test_measure_link_cost.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.measure_link_cost'` (or `ImportError`).

- [ ] **Step 3: Create the harness module with imports, rates, and the pure functions**

Create `scripts/measure_link_cost.py`:

```python
"""Measure the real cost of the two Stage-1 link paths (sequential+caching vs batched) on
a locally-ingested corpus, using real Anthropic API calls. Records nothing to the DB.

Precondition: run a real tmdb + feeds ingest locally first so the DB holds a representative
`pending` corpus. Then, in the container:

    task shell
    python scripts/measure_link_cost.py --repeats 3            # full corpus
    python scripts/measure_link_cost.py --repeats 3 --limit 300  # spend-capped smoke run

Paste the printed markdown block into
`docs/specs/2026-06-20-ingestion-cadence-recency-architecture-design.md` §Batches.
"""

import argparse
import asyncio
import logging
import time
from dataclasses import dataclass, replace
from uuid import UUID, uuid4

from sqlalchemy import func, select

from upmovies.config import get_settings
from upmovies.db import SessionLocal
from upmovies.link.linker import _MAX_TOKENS, build_batch_request, build_link_request
from upmovies.link.pipeline import _chunks
from upmovies.link.roster import Roster, build_roster
from upmovies.llm.client import AnthropicClient, BatchResult, Usage
from upmovies.news.models import Story

log = logging.getLogger("measure_link_cost")

# Cache pricing multipliers (relative to base input): 5-min ephemeral write = 1.25x, read = 0.10x.
_CACHE_WRITE_MULT = 1.25
_CACHE_READ_MULT = 0.10
_BATCH_DISCOUNT = 0.50


@dataclass(frozen=True)
class Rates:
    """Per-million-token USD rates. VERIFY against https://www.anthropic.com/pricing before
    trusting the $ figures — raw token counts are the recorded source of truth."""

    input_per_mtok: float
    output_per_mtok: float


# Claude Haiku 4.5 (the link model). VERIFY current rates before trusting $ output.
HAIKU_4_5 = Rates(input_per_mtok=1.00, output_per_mtok=5.00)


def price(usage: Usage, rates: Rates, *, batch: bool) -> float:
    """Dollar cost of `usage` at `rates`. Cache writes cost 1.25x base input, cache reads
    0.10x; the batch path applies a flat 50% discount on the whole total."""
    base_in = rates.input_per_mtok / 1_000_000
    out = rates.output_per_mtok / 1_000_000
    cost = (
        usage.input_tokens * base_in
        + usage.cache_creation_input_tokens * base_in * _CACHE_WRITE_MULT
        + usage.cache_read_input_tokens * base_in * _CACHE_READ_MULT
        + usage.output_tokens * out
    )
    return cost * (_BATCH_DISCOUNT if batch else 1.0)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def format_report(seq_runs: list[Usage], batch_runs: list[Usage], rates: Rates) -> str:
    """A human table + a markdown block (ready to paste into the spec) comparing the two
    paths. Reports per-run and mean tokens and $, plus the cache_creation:cache_read split."""
    seq_total = sum(seq_runs, Usage())
    bat_total = sum(batch_runs, Usage())
    seq_mean_cost = _mean([price(u, rates, batch=False) for u in seq_runs])
    bat_mean_cost = _mean([price(u, rates, batch=True) for u in batch_runs])

    def _fields(u: Usage) -> str:
        return (
            f"input_tokens={u.input_tokens} output_tokens={u.output_tokens} "
            f"cache_read_input_tokens={u.cache_read_input_tokens} "
            f"cache_creation_input_tokens={u.cache_creation_input_tokens}"
        )

    lines = [
        "## Link cost measurement",
        "",
        f"- runs per path: sequential={len(seq_runs)}, batched={len(batch_runs)}",
        f"- sequential totals: {_fields(seq_total)}",
        f"- batched totals:    {_fields(bat_total)}",
        f"- sequential mean $/run (full rates):  ${seq_mean_cost:.4f}",
        f"- batched mean $/run (50% batch disc.): ${bat_mean_cost:.4f}",
    ]
    if seq_mean_cost > 0:
        delta = (seq_mean_cost - bat_mean_cost) / seq_mean_cost * 100
        lines.append(f"- batched vs sequential: {delta:+.1f}% (positive = batched cheaper)")
    lines += [
        "",
        "| path | input | output | cache_read | cache_creation | mean $/run |",
        "|---|---|---|---|---|---|",
        f"| sequential | {seq_total.input_tokens} | {seq_total.output_tokens} | "
        f"{seq_total.cache_read_input_tokens} | {seq_total.cache_creation_input_tokens} | "
        f"${seq_mean_cost:.4f} |",
        f"| batched | {bat_total.input_tokens} | {bat_total.output_tokens} | "
        f"{bat_total.cache_read_input_tokens} | {bat_total.cache_creation_input_tokens} | "
        f"${bat_mean_cost:.4f} |",
    ]
    return "\n".join(lines)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/scripts/test_measure_link_cost.py -v`
Expected: PASS — `price` math (full, cache multipliers, batch discount) and `format_report` (contains both paths, token field names, `$`) all pass.

---

## Task 5: Harness measurement functions (sequential + batched)

Add the two functions that drive each Stage-1 shape against an injected client, summing `Usage`. They take in-memory chunks of `Story` so they unit-test without a DB.

**Files:**
- Modify: `scripts/measure_link_cost.py`
- Test: `tests/unit/scripts/test_measure_link_cost.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/scripts/test_measure_link_cost.py`:

```python
import json
from uuid import uuid4

from upmovies.link.roster import Roster, RosterEntry
from upmovies.news.models import Story
from scripts.measure_link_cost import measure_batched, measure_sequential


def _roster(film_id):
    entry = RosterEntry(
        film_id=film_id, title="Runner", original_title=None, year=2026, overview=None, genres=[]
    )
    return Roster(entries=[entry], text='#1 "Runner" (2026)')


def _story(title="A headline"):
    return Story(id=uuid4(), source="X", url=f"https://e/{uuid4()}", title=title, raw={"summary": ""})


class _FakeUsageClient:
    """Returns a fixed `Usage` per call on both surfaces, recording what was sent."""

    def __init__(self, usage: Usage):
        self._usage = usage
        self.complete_calls = 0
        self.batch_requests = None

    async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
        self.complete_calls += 1
        return "[]", self._usage

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0):
        self.batch_requests = list(requests)
        return {
            r.custom_id: BatchResult(custom_id=r.custom_id, ok=True, text="[]", usage=self._usage)
            for r in requests
        }


async def test_measure_sequential_sums_usage_across_chunks():
    u = Usage(input_tokens=10, output_tokens=2, cache_read_input_tokens=5, cache_creation_input_tokens=1)
    client = _FakeUsageClient(u)
    chunks = [[_story()], [_story()], [_story()]]  # 3 chunks
    total = await measure_sequential(client, _roster(uuid4()), chunks, model="link-m")
    assert client.complete_calls == 3
    assert total == Usage(
        input_tokens=30, output_tokens=6, cache_read_input_tokens=15, cache_creation_input_tokens=3
    )


async def test_measure_batched_sums_usage_and_builds_requests():
    u = Usage(input_tokens=10, output_tokens=2, cache_read_input_tokens=5, cache_creation_input_tokens=1)
    client = _FakeUsageClient(u)
    chunks = [[_story()], [_story()]]  # 2 chunks
    total = await measure_batched(client, _roster(uuid4()), chunks, model="link-m")
    assert {r.custom_id for r in client.batch_requests} == {"0", "1"}
    for r in client.batch_requests:
        assert r.max_tokens == 2048  # == linker._MAX_TOKENS, parity with the sequential path
        assert r.system[0]["cache_control"] == {"type": "ephemeral"}
        assert "entity-linking classifier" in r.system[0]["text"]
    assert total == Usage(
        input_tokens=20, output_tokens=4, cache_read_input_tokens=10, cache_creation_input_tokens=2
    )


async def test_measure_batched_skips_failed_chunks():
    u = Usage(input_tokens=10, output_tokens=2)

    class _PartialFail(_FakeUsageClient):
        async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0):
            self.batch_requests = list(requests)
            out = {}
            for i, r in enumerate(requests):
                if i == 0:
                    out[r.custom_id] = BatchResult(custom_id=r.custom_id, ok=False, error_type="errored")
                else:
                    out[r.custom_id] = BatchResult(custom_id=r.custom_id, ok=True, text="[]", usage=self._usage)
            return out

    client = _PartialFail(u)
    chunks = [[_story()], [_story()]]
    total = await measure_batched(client, _roster(uuid4()), chunks, model="link-m")
    # Only the second (ok) chunk's usage counts.
    assert total == Usage(input_tokens=10, output_tokens=2)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/scripts/test_measure_link_cost.py -v`
Expected: FAIL — `ImportError: cannot import name 'measure_batched'` (and `measure_sequential`).

- [ ] **Step 3: Implement the two measure functions**

In `scripts/measure_link_cost.py`, add (after `format_report`):

```python
async def measure_sequential(
    client, roster: Roster, chunks: list[list[Story]], *, model: str
) -> Usage:
    """Drive the sequential Stage-1 shape: one `complete_with_usage` per chunk, reusing the
    production request builder. Cache warms naturally over calls 2..N (same `roster`)."""
    total = Usage()
    for chunk in chunks:
        system, messages = build_link_request(roster, chunk)
        _, usage = await client.complete_with_usage(
            model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
        )
        total += usage
    return total


async def measure_batched(
    client, roster: Roster, chunks: list[list[Story]], *, model: str
) -> Usage:
    """Drive the batched Stage-1 shape: N `build_batch_request`s submitted as one batch.
    Sums usage over succeeded chunks; logs and skips any failed chunk."""
    requests = [
        build_batch_request(custom_id=str(i), model=model, roster=roster, stories=chunk)
        for i, chunk in enumerate(chunks)
    ]
    results = await client.complete_batch(requests)
    total = Usage()
    for i in range(len(chunks)):
        result = results.get(str(i))
        if result is None or not result.ok or result.usage is None:
            detail = result.error_type if result else "missing"
            log.warning("batched chunk %d unavailable (%s) — excluded from totals", i, detail)
            continue
        total += result.usage
    return total
```

Note the `model` keyword is passed positionally-free (the tests call `measure_sequential(client, roster, chunks, model="link-m")`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/scripts/test_measure_link_cost.py -v`
Expected: PASS — sequential sums across 3 chunks (3 `complete_with_usage` calls); batched builds `custom_id` `"0"`/`"1"` with the cached block + `max_tokens=2048` and sums usage; failed chunks are skipped.

---

## Task 6: Harness DB selection + CLI `main`

Add the DB-facing corpus selection and the orchestrating `main`. The corpus query is verified by an integration test against the pipeline's exact predicate; `main` itself is run manually (Task 8) and is not unit-tested.

**Files:**
- Modify: `scripts/measure_link_cost.py`
- Create: `tests/integration/scripts/__init__.py`
- Test: `tests/integration/scripts/test_corpus_selection.py`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/scripts/__init__.py` (empty file).

Create `tests/integration/scripts/test_corpus_selection.py`:

```python
from datetime import UTC, datetime, timedelta

from upmovies.news.models import Story
from scripts.measure_link_cost import select_corpus


async def _story(url, *, offset_days, status="pending"):
    now = datetime.now(UTC)
    return Story(
        source="X",
        url=url,
        title="Runner news",
        published_at=now - timedelta(days=offset_days),
        link_status=status,
        raw={"summary": ""},
    )


async def test_select_corpus_returns_pending_in_window_only(session):
    session.add_all(
        [
            await _story("https://e/in", offset_days=1),                 # pending, in window
            await _story("https://e/old", offset_days=10),               # pending, out of window
            await _story("https://e/linked", offset_days=1, status="linked"),  # not pending
        ]
    )
    await session.commit()

    ids = await select_corpus(session, recency_days=4, limit=None)

    rows = {
        s.url: s.id
        for s in (await session.execute(select(Story))).scalars().all()
    }
    assert ids == [rows["https://e/in"]]


async def test_select_corpus_respects_limit(session):
    session.add_all(
        [
            await _story("https://e/a", offset_days=1),
            await _story("https://e/b", offset_days=1),
            await _story("https://e/c", offset_days=1),
        ]
    )
    await session.commit()
    ids = await select_corpus(session, recency_days=4, limit=2)
    assert len(ids) == 2
```

Add the missing import at the top of that test file:

```python
from sqlalchemy import select
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/scripts/`
Expected: FAIL — `ImportError: cannot import name 'select_corpus'`.
(Scope to the directory, not a single file — a lone integration file errors on the pytest-asyncio session-loop quirk per the backend CLAUDE.md.)

- [ ] **Step 3: Implement `select_corpus`, `_load_chunk`, and `main`**

In `scripts/measure_link_cost.py`, add (after the measure functions):

```python
async def select_corpus(session, recency_days: int, limit: int | None) -> list[UUID]:
    """The same pending predicate `run_link_ingest` uses: `pending` stories whose
    coalesce(published_at, fetched_at) is within `recency_days`. `ORDER BY id` for a stable
    set; optional `limit` caps spend."""
    cutoff = datetime.now(UTC) - timedelta(days=recency_days)
    stmt = (
        select(Story.id)
        .where(
            Story.link_status == "pending",
            func.coalesce(Story.published_at, Story.fetched_at) >= cutoff,
        )
        .order_by(Story.id)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    rows = await session.execute(stmt)
    return [row[0] for row in rows.all()]


async def _load_chunk(session, ids: list[UUID]) -> list[Story]:
    return list((await session.execute(select(Story).where(Story.id.in_(ids)))).scalars().all())


async def _amain(args: argparse.Namespace) -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()
    model = settings.link_model

    async with SessionLocal() as s:
        roster = await build_roster(s)
        ids = await select_corpus(s, settings.link_recency_days, args.limit)
        chunk_id_lists = _chunks(ids, settings.link_batch_size)
        chunks = [await _load_chunk(s, cids) for cids in chunk_id_lists]

    n_chunks = len(chunks)
    print(
        f"corpus: {len(ids)} stories, {n_chunks} chunks (batch_size={settings.link_batch_size}), "
        f"model={model}, repeats={args.repeats}"
    )
    print(
        f"pre-flight: ~{n_chunks * args.repeats} sequential calls + {args.repeats} batches "
        f"of {n_chunks} requests each"
    )
    if n_chunks == 0:
        print("no pending stories in window — run a tmdb+feeds ingest first. Aborting.")
        return

    seq_runs: list[Usage] = []
    batch_runs: list[Usage] = []
    async with AnthropicClient(api_key=settings.anthropic_api_key) as client:
        for r in range(args.repeats):
            # Cold-cache isolation: a unique nonce per path per repeat → each run starts cold
            # (faithful to the daily cron) while caching still works intra-run. Separate
            # nonces for seq vs batch so one path never reads the other's warmed cache.
            seq_roster = replace(roster, text=f"RUN {uuid4()}\n{roster.text}")
            t0 = time.monotonic()
            seq = await measure_sequential(client, seq_roster, chunks, model=model)
            seq_secs = time.monotonic() - t0
            seq_runs.append(seq)
            print(f"[repeat {r + 1}] sequential done in {seq_secs:.1f}s")

            batch_roster = replace(roster, text=f"RUN {uuid4()}\n{roster.text}")
            t0 = time.monotonic()
            bat = await measure_batched(client, batch_roster, chunks, model=model)
            batch_secs = time.monotonic() - t0
            batch_runs.append(bat)
            print(
                f"[repeat {r + 1}] batched done in {batch_secs:.1f}s "
                f"(daily budget ~3600s)"
            )

    print()
    print(format_report(seq_runs, batch_runs, HAIKU_4_5))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Measure batch vs sequential+caching link cost.")
    parser.add_argument("--repeats", type=int, default=3, help="runs per path (default 3)")
    parser.add_argument("--limit", type=int, default=None, help="cap stories (spend guard)")
    asyncio.run(_amain(parser.parse_args()))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/scripts/`
Expected: PASS — `select_corpus` returns only the in-window pending story and honors `limit`.

---

## Task 7: Full green

**Files:** none (verification)

- [ ] **Step 1: Format**

Run: `task format`
Expected: ruff reformats; a re-run is clean.

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: `ruff check src tests` clean. Note: importing `_MAX_TOKENS` and `_chunks` (leading-underscore names) into the harness is intentional and fine; if ruff flags an unused import in `scripts/measure_link_cost.py` (e.g. `BatchResult` is only referenced in tests, not the module), remove it from the module.

- [ ] **Step 3: Typecheck**

Run: `task typecheck`
Expected: `pyright src tests` clean. The measure functions type their `client` param loosely (duck-typed) — if pyright wants a type, annotate as `client` with no annotation is acceptable in a script, or import and use `LinkClient` from `upmovies.link.linker`. The harness `scripts/` dir is included in `pyright src tests`? Confirm `scripts/` is type-checked; if it is and complains, add precise annotations rather than `# type: ignore`.

- [ ] **Step 4: Full repo test pass**

Run: `task test`
Expected: green across the whole suite (run the whole suite — per the backend CLAUDE.md, a single integration file in isolation can error on a pytest-asyncio session-loop quirk).

---

## Task 8: Run the measurement, record results, flip if justified, ship

This is the deliverable's data-gathering + decision. It uses real API spend and is done manually (not in CI).

**Files:**
- Modify: `docs/specs/2026-06-20-ingestion-cadence-recency-architecture-design.md`
- Modify (iff justified): `src/upmovies/config.py`

- [ ] **Step 1: Populate a representative local corpus**

Bring the stack up and run a real ingest so the DB holds a representative `pending` set (the harness reads it; it does not ingest). Using the admin trigger endpoints (machine auth = `ADMIN_TOKEN`):

```bash
task up
# tmdb roster, then feeds with per_film on (mirrors the daily pipeline)
curl -fsS -X POST "http://localhost:8000/admin/ingest/tmdb" -H "Authorization: Bearer $ADMIN_TOKEN"
curl -fsS -X POST "http://localhost:8000/admin/ingest/feeds?per_film=true" -H "Authorization: Bearer $ADMIN_TOKEN"
# poll /admin/runs (cookie-admin) or wait for the runs to finish
```

Expected: a few thousand `pending` stories across ~tens-to-hundreds of films (cf. the 2026-06-20 test: ~2k in the 2-day window). A `--limit` smoke run can validate wiring first to cap spend.

- [ ] **Step 2: Smoke-run the harness (spend-capped), then the full run**

```bash
task shell
python scripts/measure_link_cost.py --repeats 1 --limit 30   # wiring + sane numbers, tiny spend
python scripts/measure_link_cost.py --repeats 3              # the real measurement
```

Expected: the pre-flight line prints the corpus/chunk counts and projected call volume; each repeat prints sequential/batched wall-clock; the final markdown block prints per-path tokens (incl. `cache_read` / `cache_creation`), mean `$`, and the `batched vs sequential %`.

- [ ] **Step 3: Sanity-check the cache split before trusting the number**

Confirm the mechanism is visible: sequential should be **cache_read-heavy** (one write on chunk 1, reads after), batched should show **more cache_creation** (concurrent writes). If sequential shows ~zero `cache_read`, the prefix isn't caching (check the cached block / nonce); if batched shows the *same* read-heavy split as sequential, runs aren't isolated (the nonce isn't landing). Verify the rate constants in `Rates` / `HAIKU_4_5` against current Anthropic pricing — token counts are truth; `$` is only as good as the table.

- [ ] **Step 4: Record results in the design-of-record spec**

Paste the harness markdown block into
`docs/specs/2026-06-20-ingestion-cadence-recency-architecture-design.md` under the
"Batches API cost optimization" section, with: the corpus descriptor (N stories, N chunks, model, date), the rate table used, batch wall-clock vs the ~60-min budget, the cache_creation:cache_read split per path, and a one-line **decision + rationale**.

- [ ] **Step 5: Apply the flip rule**

Flip `link_use_batches` default `False → True` in `src/upmovies/config.py` **iff** batched mean `$` < sequential mean `$` by a clear margin beyond the run-to-run spread AND the batch finished within the ~60-min budget. The edit:

```python
    link_use_batches: bool = Field(default=True, alias="LINK_USE_BATCHES")
```

Otherwise leave it `False` and record the reason in the spec. (If you flip it, add/adjust the `test_config.py` default test so it asserts the new default — search `link_use_batches` there.)

- [ ] **Step 6: Final green + ship**

Run: `task format && task lint && task typecheck && task test` — all green.
Then ship the single PR via the project flow:

```
/t:ship
```

It sets the ticket branch (`tom/neu-297-be-measure-batch-vs-sequentialcaching-link-cost-flip-default`), runs `/commit-msg` + `/pr-desc`, and targets the base branch. Commit once — do not commit per task.

---

## Self-Review (completed during authoring)

- **Spec coverage:** `Usage` surface on the client (Tasks 1–3) ✔ · `complete()` untouched for production via delegation (Task 2) ✔ · `BatchResult.usage` additive (Task 3) ✔ · harness reuses `build_roster`/`build_link_request`/`build_batch_request`/`_chunks`/`_MAX_TOKENS` (Tasks 5–6) ✔ · pricing with cache multipliers + 50% batch discount (Task 4) ✔ · cold-cache-per-run nonce via `replace(roster, text=…)`, separate nonces per path (Task 6) ✔ · 3× repeats + alternating order + wall-clock vs budget (Task 6) ✔ · spend guard `--limit` + pre-flight estimate (Tasks 6, 8) ✔ · Stage-1-only scope (no Stage-2 batching) ✔ · record results + flip rule in the same PR (Task 8) ✔ · no-live-API-in-tests, respx/fakes only (Tasks 1–6) ✔ · `task test/lint/typecheck/format` green (Task 7) ✔.
- **Placeholder scan:** none — every code/test step shows complete code and exact commands. The `Rates`/`HAIKU_4_5` numbers are concrete with an explicit VERIFY comment (token counts are the recorded truth), not placeholders.
- **Type consistency:** `Usage` fields/`from_sdk`/`__add__` are identical across client.py (Task 1) and all call sites (Tasks 3–6). `measure_sequential(client, roster, chunks, *, model)` / `measure_batched(client, roster, chunks, *, model)` signatures match their tests (Task 5) and `_amain` calls (Task 6). `price(usage, rates, *, batch)` and `format_report(seq_runs, batch_runs, rates)` match Task 4 tests. `select_corpus(session, recency_days, limit)` matches Task 6 test. `Rates(input_per_mtok, output_per_mtok)` consistent everywhere.
- **Known follow-up flagged in-task:** Task 3 Step 4 explicitly updates the two pre-existing `BatchResult(...)` equality assertions that the new `usage` field would otherwise break — caught rather than left to surprise the implementer.
```