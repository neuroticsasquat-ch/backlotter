# NEU-460 — Admin Sources tab shows "no source domains yet" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the source-quality domain judge actually populate `news.source_domain` so the admin Sources page lists domains, and backfill the domains already resolved in prod.

**Architecture:** The judge (`judge_domains`) currently sends *all* unknown domains in one LLM call capped at 1024 output tokens; a large batch overruns the cap, the truncated JSON fails to parse, `parse_judge_verdicts` silently returns `{}`, and nothing is inserted (confirmed in prod: `source-gate: resolved 471, judged 0, blocked 0`, 12.4k tokens spent, `source_domain` empty). Fix: chunk the judge into bounded batches, raise the per-call output cap, and log when a chunk yields no verdicts so this never fails silently again. Then add a one-off backfill that judges every already-resolved publisher domain so the page is populated immediately.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async + asyncpg, pytest (pytest-asyncio `auto` mode), Anthropic client wrapper (`upmovies.llm.client`). Judge model: `claude-haiku-4-5`.

## Global Constraints

- **Everything runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python` on the host. Test: `task test -- <path>`. Lint: `task lint`. Format: `task format`. Types: `task typecheck`.
- Before claiming done: `task test`, `task lint`, `task typecheck` all green; run `task format` first.
- Modern type hints (`X | None`, `X | Y`); **no** `from __future__ import annotations`. ruff line length 100.
- TDD: write the failing test first. Mock the LLM with an in-test fake `Completer` (no live network). Integration tests use the `session` / `session_factory` fixtures.
- **Known quirk:** running a *single integration test file* in isolation errors with an asyncio-session-loop warning. Scope integration runs to a directory (`task test -- tests/integration/news`) or run the whole suite.
- Commits: Conventional Commits subject, **no** Linear ID in subject (optional `Refs NEU-460.` in body), **no** `Co-Authored-By`, **no** Claude footer in commits.

---

### Task 1: Chunk the domain judge, raise the output cap, and log silent no-verdict chunks

**Files:**
- Modify: `src/upmovies/news/source_quality.py` (add logging; `_JUDGE_MAX_TOKENS`; new `_JUDGE_BATCH_SIZE`; rewrite `judge_domains`, lines 152, 209-221)
- Test: `tests/unit/news/test_source_judge.py`

**Interfaces:**
- Consumes: `build_judge_request(items)`, `parse_judge_verdicts(raw, domains=...)`, `Completer.complete_with_usage(...)`, `Usage` (frozen dataclass, supports `+`).
- Produces: `judge_domains(*, client, model, items) -> tuple[dict[str, tuple[str, str]], Usage]` — same signature as today, but internally chunks `items` in groups of `_JUDGE_BATCH_SIZE`, merges verdicts, sums usage, and logs a warning for any chunk that returns zero verdicts.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/news/test_source_judge.py`:

```python
import logging


class _RecordingClient:
    """Fake Completer that records each call and answers with a valid verdict array
    covering exactly the domains it was asked about (tier 'acceptable')."""

    def __init__(self):
        self.calls: list[list[dict]] = []

    async def complete_with_usage(
        self, *, model: str, system: list, messages: list, max_tokens: int = 4096
    ):
        items = json.loads(messages[0]["content"])
        self.calls.append(items)
        arr = [{"domain": it["domain"], "tier": "acceptable", "reason": "ok"} for it in items]
        return json.dumps(arr), Usage(input_tokens=10, output_tokens=7)


async def test_judge_domains_chunks_large_batches():
    client = _RecordingClient()
    items = [{"domain": f"d{i}.com", "sample_headline": "h"} for i in range(60)]
    verdicts, usage = await judge_domains(client=client, model="m", items=items)
    # 60 domains / batch size 25 -> 3 calls, each bounded.
    assert len(client.calls) == 3
    assert all(len(call) <= 25 for call in client.calls)
    # All 60 domains judged, verdicts merged across chunks.
    assert len(verdicts) == 60
    assert verdicts["d59.com"] == ("acceptable", "ok")
    # Usage summed across the 3 chunk calls.
    assert usage.output_tokens == 21


async def test_judge_domains_logs_when_a_chunk_yields_no_verdicts(caplog):
    class _OneBadChunk:
        def __init__(self):
            self.n = 0

        async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
            self.n += 1
            items = json.loads(messages[0]["content"])
            if self.n == 1:
                return "truncated junk with no closing bracket [", Usage(output_tokens=5)
            arr = [{"domain": it["domain"], "tier": "low", "reason": "x"} for it in items]
            return json.dumps(arr), Usage(output_tokens=5)

    client = _OneBadChunk()
    items = [{"domain": f"d{i}.com", "sample_headline": "h"} for i in range(30)]
    with caplog.at_level(logging.WARNING):
        verdicts, _ = await judge_domains(client=client, model="m", items=items)
    # Second chunk still merged despite the first failing.
    assert len(verdicts) == 5
    assert any("no verdicts" in r.message for r in caplog.records)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/news/test_source_judge.py -v`
Expected: FAIL — `test_judge_domains_chunks_large_batches` sees `len(client.calls) == 1` (single call today), `test_judge_domains_logs_when_a_chunk_yields_no_verdicts` finds no warning record.

- [ ] **Step 3: Implement chunking + cap + logging**

In `src/upmovies/news/source_quality.py`:

Add logging near the top imports (after `import json`):

```python
import logging
```

Add the module logger after the tldextract constant block (near line 22):

```python
log = logging.getLogger(__name__)
```

Change the cap and add a batch size (replace line 152 `_JUDGE_MAX_TOKENS = 1024`):

```python
_JUDGE_MAX_TOKENS = 4096
# Judge a bounded number of domains per call so the JSON response never overruns the output
# cap (NEU-460: a single all-domains call truncated, failed to parse, and inserted nothing).
_JUDGE_BATCH_SIZE = 25
```

Rewrite `judge_domains` (lines 209-221):

```python
async def judge_domains(
    *, client: Completer, model: str, items: list[dict[str, str]]
) -> tuple[dict[str, tuple[str, str]], Usage]:
    """Judge unknown domains in bounded chunks (`_JUDGE_BATCH_SIZE`) so a large batch never
    overruns the output cap and truncates into unparseable JSON. Returns `{domain: (tier,
    reason)}` merged across chunks plus summed token usage. A chunk that yields no verdicts
    is logged (not silently dropped) and the remaining chunks still run. No-op (`{}`, empty
    Usage) for empty input."""
    if not items:
        return {}, Usage()
    verdicts: dict[str, tuple[str, str]] = {}
    usage = Usage()
    for start in range(0, len(items), _JUDGE_BATCH_SIZE):
        chunk = items[start : start + _JUDGE_BATCH_SIZE]
        system, messages = build_judge_request(chunk)
        raw, chunk_usage = await client.complete_with_usage(
            model=model, system=system, messages=messages, max_tokens=_JUDGE_MAX_TOKENS
        )
        usage = usage + chunk_usage
        domains = {item["domain"] for item in chunk}
        chunk_verdicts = parse_judge_verdicts(raw, domains=domains)
        if not chunk_verdicts:
            log.warning(
                "source-judge: chunk of %d domains produced no verdicts "
                "(unparseable/empty response; raw prefix: %r)",
                len(chunk),
                raw[:200],
            )
        verdicts.update(chunk_verdicts)
    return verdicts, usage
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/news/test_source_judge.py -v`
Expected: PASS (all judge tests, including the two new ones and the existing `test_judge_domains_calls_client_and_parses` / `_empty_is_noop`).

- [ ] **Step 5: Commit**

```bash
git add src/upmovies/news/source_quality.py tests/unit/news/test_source_judge.py
git commit -m "fix(source-quality): chunk domain judge and log empty chunks

The judge sent all unknown domains in one 1024-token call; large batches
truncated into unparseable JSON and inserted nothing. Chunk into batches of
25, raise the output cap to 4096, and warn when a chunk yields no verdicts.

Refs NEU-460."
```

---

### Task 2: Factor the domain→sample-headline mapping into a shared, tested helper

**Files:**
- Modify: `src/upmovies/news/source_quality.py` (add `collect_domain_samples`)
- Modify: `src/upmovies/link/source_stage.py` (use it in step 2, lines 110-118)
- Test: `tests/unit/news/test_source_quality_pure.py`

**Interfaces:**
- Consumes: `domain_for_story(url=..., resolved_url=...)`, `Story` (has `.url`, `.resolved_url`, `.title`).
- Produces: `collect_domain_samples(stories: Iterable[Story]) -> dict[str, str]` — maps each story's gate domain to a sample headline (first seen wins); stories whose domain is `None` (unresolved Google-News) are skipped. Reused by the source stage and the Task 3 backfill.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/news/test_source_quality_pure.py`:

```python
from uuid import uuid4

from upmovies.news.models import Story
from upmovies.news.source_quality import collect_domain_samples


def _story(url, resolved_url, title):
    return Story(id=uuid4(), source="X", url=url, resolved_url=resolved_url, title=title, raw={})


def test_collect_domain_samples_maps_domain_to_first_headline():
    stories = [
        _story("https://news.google.com/rss/x", "https://www.variety.com/a", "Variety one"),
        _story("https://news.google.com/rss/y", "https://variety.com/b", "Variety two"),
        _story("https://www.mshale.com/z", None, "Mshale one"),
        _story("https://news.google.com/rss/unresolved", None, "no domain"),
    ]
    out = collect_domain_samples(stories)
    assert out == {"variety.com": "Variety one", "mshale.com": "Mshale one"}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/news/test_source_quality_pure.py -v`
Expected: FAIL — `ImportError: cannot import name 'collect_domain_samples'`.

- [ ] **Step 3: Implement the helper**

In `src/upmovies/news/source_quality.py`, add after `domain_for_story` (near line 47). Ensure `Iterable` and `Story` are importable — `Iterable` is already imported from `collections.abc`; add `Story` to the top imports (`from upmovies.news.models import SourceDomain, Story`):

```python
def collect_domain_samples(stories: Iterable[Story]) -> dict[str, str]:
    """Map each story's gate domain to a sample headline (first seen wins). Stories whose
    domain is None (an unresolved Google-News redirect) are skipped."""
    out: dict[str, str] = {}
    for st in stories:
        domain = domain_for_story(url=st.url, resolved_url=st.resolved_url)
        if domain and domain not in out:
            out[domain] = st.title
    return out
```

- [ ] **Step 4: Use it in the source stage**

In `src/upmovies/link/source_stage.py`, replace the inline sample-building in step 2 (lines 110-118) so it reads:

```python
    # 2. Re-read the batch (now with resolved_urls), compute domains, judge unknowns.
    async with _owned_session(session_factory) as s:
        stories = await _linked_unclustered(s)
        sample_by_domain = collect_domain_samples(stories)
        all_domains = set(sample_by_domain)
        known = await get_source_domains(s, all_domains)
        unknown = sorted(all_domains - set(known))
```

Add `collect_domain_samples` to the import from `upmovies.news.source_quality` (it already imports `domain_for_story`, `effective_tier`, `get_source_domains`, `judge_domains`, `upsert_judgements`). `domain_for_story` is still used in step 3, so keep it.

- [ ] **Step 5: Run tests to verify green (helper + source stage unchanged behavior)**

Run: `task test -- tests/unit/news tests/integration/link/test_source_stage.py tests/integration/link -v`
Expected: PASS — new pure test passes; `test_source_stage.py::test_judges_unknown_domains_and_blocks` and `::test_resolves_google_urls_before_judging` still pass (behavior unchanged, just DRY).

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/news/source_quality.py src/upmovies/link/source_stage.py tests/unit/news/test_source_quality_pure.py
git commit -m "refactor(source-quality): extract collect_domain_samples helper

Shared by the source-judge stage and the upcoming backfill. No behavior change.

Refs NEU-460."
```

---

### Task 3: Add a backfill entrypoint that judges every already-resolved domain

**Files:**
- Modify: `src/upmovies/link/source_stage.py` (add `backfill_source_domains`)
- Test: `tests/integration/link/test_source_stage.py`

**Interfaces:**
- Consumes: `_owned_session`, `collect_domain_samples`, `get_source_domains`, `judge_domains`, `upsert_judgements`, `Story` (SQLAlchemy select on `Story.resolve_state == "resolved"`).
- Produces: `backfill_source_domains(*, session_factory: SessionFactory, client: Completer, judge_model: str) -> int` — judges all resolved-story domains not already in `source_domain`, upserts them, returns the number of new rows inserted. Idempotent: re-running judges only still-unknown domains.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/link/test_source_stage.py` (mirror the existing `session_factory`/`session` fixtures and the `FakeCompleter` pattern already used in that file — reuse whatever fake `Completer` it defines; if it defines one returning fixed text, add the recording one below):

```python
async def test_backfill_judges_all_resolved_domains(session_factory, session):
    from uuid import uuid4

    from upmovies.link.source_stage import backfill_source_domains
    from upmovies.news.models import Story
    from upmovies.news.source_quality import list_source_domains

    # Two resolved stories on distinct domains + one unresolved (no domain -> skipped).
    session.add_all(
        [
            Story(
                id=uuid4(), source="X", url="https://news.google.com/rss/1",
                resolved_url="https://www.variety.com/a", resolve_state="resolved",
                title="Variety story",
            ),
            Story(
                id=uuid4(), source="X", url="https://www.mshale.com/b",
                resolved_url="https://www.mshale.com/b", resolve_state="resolved",
                title="Mshale story",
            ),
            Story(
                id=uuid4(), source="X", url="https://news.google.com/rss/2",
                resolved_url=None, resolve_state="pending", title="unresolved",
            ),
        ]
    )
    await session.commit()

    class _Client:
        async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
            import json

            from upmovies.llm.client import Usage

            items = json.loads(messages[0]["content"])
            arr = [{"domain": it["domain"], "tier": "acceptable", "reason": "ok"} for it in items]
            return json.dumps(arr), Usage(output_tokens=3)

    judged = await backfill_source_domains(
        session_factory=session_factory, client=_Client(), judge_model="claude-haiku-4-5"
    )
    assert judged == 2
    rows = await list_source_domains(session)
    assert {r.domain for r in rows} == {"variety.com", "mshale.com"}

    # Idempotent: a second run judges nothing new.
    again = await backfill_source_domains(
        session_factory=session_factory, client=_Client(), judge_model="claude-haiku-4-5"
    )
    assert again == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/link -v`
Expected: FAIL — `ImportError: cannot import name 'backfill_source_domains'`.

- [ ] **Step 3: Implement the backfill**

In `src/upmovies/link/source_stage.py`, add (reusing `select`, `Story`, `_owned_session`, and the source-quality helpers already imported; add `collect_domain_samples` to the source_quality import and add `from datetime import UTC, datetime` is already imported):

```python
async def backfill_source_domains(
    *,
    session_factory: SessionFactory,
    client: Completer,
    judge_model: str,
) -> int:
    """One-off: judge every already-resolved publisher domain that has no source_domain row
    yet, so the admin Sources page is populated without waiting for domains to re-resolve
    during future ingest runs (NEU-460). Idempotent — judges only still-unknown domains.
    Returns the number of new rows inserted."""
    async with _owned_session(session_factory) as s:
        stories = list(
            (await s.execute(select(Story).where(Story.resolve_state == "resolved")))
            .scalars()
            .all()
        )
        sample_by_domain = collect_domain_samples(stories)
        known = await get_source_domains(s, set(sample_by_domain))
        unknown = sorted(set(sample_by_domain) - set(known))

    if not unknown:
        return 0
    items = [{"domain": d, "sample_headline": sample_by_domain[d]} for d in unknown]
    verdicts, _usage = await judge_domains(client=client, model=judge_model, items=items)
    async with _owned_session(session_factory) as s:
        judged = await upsert_judgements(s, verdicts, model=judge_model, now=datetime.now(UTC))
        await s.commit()
    return judged
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/link -v`
Expected: PASS — `test_backfill_judges_all_resolved_domains` green; existing source-stage / pipeline tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/upmovies/link/source_stage.py tests/integration/link/test_source_stage.py
git commit -m "feat(source-quality): add backfill_source_domains entrypoint

Judges every already-resolved publisher domain once so the admin Sources page
populates immediately instead of waiting for future ingest runs.

Refs NEU-460."
```

---

### Task 4: Add the runnable backfill script

**Files:**
- Create: `scripts/backfill_source_domains.py`

**Interfaces:**
- Consumes: `get_settings()`, `SessionLocal`, `AnthropicClient`, `backfill_source_domains` (Task 3).

- [ ] **Step 1: Write the script** (modeled on `scripts/diagnose_linking.py`)

```python
"""Backfill news.source_domain by judging every already-resolved publisher domain once.

Fixes NEU-460: the live source-judge stage produced zero rows (a single over-capped judge
call truncated and inserted nothing), so the admin Sources page is empty. Run once after the
judge fix deploys; it is idempotent.

    task shell
    python scripts/backfill_source_domains.py"""

import asyncio

from upmovies.config import get_settings
from upmovies.db import SessionLocal
from upmovies.link.source_stage import backfill_source_domains
from upmovies.llm.client import AnthropicClient


async def main() -> None:
    settings = get_settings()
    async with AnthropicClient(api_key=settings.anthropic_api_key) as client:
        judged = await backfill_source_domains(
            session_factory=SessionLocal,
            client=client,
            judge_model=settings.source_judge_model,
        )
    print(f"backfill_source_domains: judged {judged} new domains")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Verify it imports cleanly (no live run in CI)**

Run: `task test -- tests/unit/news tests/integration/link -v`
Expected: PASS (script itself is exercised via the Task 3 function; this step just confirms the suite is still green).

Run lint/types: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill_source_domains.py
git commit -m "chore(scripts): add backfill_source_domains runner

Refs NEU-460."
```

---

## Deploy / verification (post-merge, run by the user)

Not code — the one-off backfill against prod after the fix deploys:

```bash
ssh <PROD_SSH>
docker exec -it <upmovies-backend-container> python scripts/backfill_source_domains.py
```

Then confirm rows exist and the admin page lists them:

```sql
SELECT count(*), min(llm_tier), max(updated_at) FROM news.source_domain;
```

Going forward, each ingest run's source-judge stage will also populate newly-resolved domains (no longer silently zero).

## Self-Review

- **Spec coverage:** Core fix = Task 1 (chunk + cap 4096 + warn on empty). Backfill = Tasks 3-4. `collect_domain_samples` DRY = Task 2. Deploy step documented.
- **Placeholder scan:** none — every step has concrete code and exact `task test -- <path>` commands.
- **Type consistency:** `judge_domains` signature unchanged; `collect_domain_samples(stories) -> dict[str,str]` used identically in source_stage and backfill; `backfill_source_domains(...) -> int` matches the script call and the test asserts.
- **Note on batch size vs cap:** 25 domains/call at ~40-60 output tokens each (`{"domain","tier","reason"}`) ≈ 1.0-1.5k tokens, comfortably under 4096 — the truncation that caused the bug cannot recur, and the warning is a backstop if it ever does.
