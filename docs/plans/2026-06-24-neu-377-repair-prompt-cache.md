# NEU-377 — Repair Prompt-Cache Effectiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead prompt-cache marker on the CLUSTER stage (its `cached_system_block(...)` wrap can never produce a cache hit, because the cluster instruction block is a few hundred tokens — far below Sonnet 4.6's 2048-token cache floor — and the per-call payload is per-film, so there is no shared prefix worth caching). Then, as a separate manual owner step, VERIFY whether the LINK stage's `instructions + roster` prefix actually clears Haiku 4.5's 4096-token cache floor using the per-stage telemetry shipped by NEU-375, and DOCUMENT the per-stage cache behaviour so future tuning (NEU-379) has a recorded baseline.

**Architecture:** Two-part change in the backend repo. Part 1 is a small structural code change in `link/cluster.py`: stop wrapping the cluster instructions in `cached_system_block(...)` and instead emit a plain `{"type": "text", "text": _INSTRUCTIONS}` system block — exactly the shape `synthesize/summarizer.py:139` already uses for its (non-cacheable) instruction block. Three existing tests assert the cluster system block carries `cache_control` and must be flipped to assert its *absence* (mirroring `tests/unit/synthesize/test_summarizer.py:60`). No schema, no migration, no config change, no new public symbols. Part 2 is a manual/owner verification + documentation task (real Anthropic key, token cost) — not a CI step. Part 3 records the per-stage cache-behaviour reasoning as code comments + a spec note. The LINK side (`link/linker.py:118`) is deliberately **left untouched** — its `cached_system_block` wrap is correct in intent; whether it fires is what Part 2 measures.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 (async), pydantic-settings, pytest (pytest-asyncio auto mode). **All tooling runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python`/`alembic` on the host.

## Global Constraints

- **One backend PR**, on branch `tom/neu-377-backend-repair-prompt-cache-effectiveness`.
- **Container-only tooling:** `task test`, `task lint`, `task typecheck`, `task format` (they `docker compose exec` into `upmovies-backend`). Keep the container up (`task up`). Scope tests with `task test -- <path>`.
- **Pre-commit hooks delegate into Docker** — commit normally, **no `--no-verify`**. Run `task format` *before* staging so the format-check hook passes.
- **Before claiming done:** `task test`, `task lint`, `task typecheck` all green (and `task format` applied).
- **Modern type hints** (`X | None`, `X | Y`); **no** `from __future__ import annotations`. ruff line length 100, rules E,F,W,I,B,UP. **TDD** — write/adjust the failing test first.
- **Commit message:** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-377.` in body), **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. Prefer `/commit-msg`.
- **Do NOT touch `link/linker.py`** — the link `cached_system_block` wrap (line 118) stays. This ticket only *removes* the cluster marker and *measures* the link one.
- **Dependency (treat as given):** NEU-375 has shipped per-(run, stage) LLM usage telemetry. After a real ingest run, token usage is persisted in the `ingest.run_llm_usage` table (columns include `stage`, `model`, `batched`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `cost_usd`) and exposed on `GET /admin/runs` and `GET /admin/runs/{id}` as `llm_usage[]`. Task 2 reads this; it does not build it.

### Domain facts (encode these — they drive the whole ticket)

- Prompt caching only engages above a **per-model minimum prefix length**: **Haiku 4.5 = 4096 tokens, Sonnet 4.6 = 2048 tokens**. Below the floor, `cache_control` silently **no-ops** — the call reports `cache_creation_input_tokens = 0` and `cache_read_input_tokens = 0`, so you pay full input price and the marker is dead weight.
- **CLUSTER** (`cluster_model = claude-sonnet-4-6`) wraps **only** its instruction block (`_INSTRUCTIONS`, a few hundred tokens) in `cached_system_block(...)` at `link/cluster.py:184`. That is **below Sonnet's 2048 floor → never a hit.** The cluster per-call payload is per-film (one film + ≤25 existing events + new stories) and is **not a shared prefix across calls**, so there is nothing cacheable to recover by restructuring. Removing the marker is the safe structural fix.
- **LINK** (`link_model = claude-haiku-4-5`) caches `instructions + full film roster` (`link/linker.py:118`). Whether it clears Haiku's **4096 floor** depends on roster size and is **UNVERIFIED**. Task 2 verifies it from a real run's telemetry.
- **SUMMARIZE** (`claude-haiku-4-5`) already uses a **plain** (un-cached) system block (`synthesize/summarizer.py:139`) — its ~700-token instruction block is below Haiku's 4096 floor, so caching it would no-op. Correct as-is; this ticket only documents that fact.

---

### Task 1: Remove the dead cluster cache marker (code + tests)

The cluster instruction block is below Sonnet's 2048-token cache floor and the per-call payload is per-film (no shared prefix), so `cached_system_block(...)` on the cluster system block can never produce a cache hit. Replace it with a plain text system block, mirroring `synthesize/summarizer.py`. Three existing tests assert the cluster block carries `cache_control` and must be inverted.

**Files:**
- Modify: `src/upmovies/link/cluster.py` (line 184 `system = [cached_system_block(_INSTRUCTIONS)]` → plain block; the `cached_system_block` import on line 18 becomes unused and must be dropped to avoid ruff F401).
- Modify: `tests/integration/link/test_cluster.py` (line 156 in `test_build_cluster_request_builds_payload_and_plan`; line 355 in `test_build_cluster_batch_request_wraps_into_batch_request`).
- Modify: `tests/integration/link/test_pipeline.py` (line 403, inside the batch-cluster request-mapping assertion loop).

**Interfaces:**
- Consumes: nothing new (no upstream tasks).
- Produces: **no new symbols**. `build_cluster_request`, `build_cluster_batch_request`, `cluster_film_events`, `apply_cluster_decisions`, `ClusterPlan`, `ClusterResult` signatures are **unchanged**. The only observable change is the **shape of the cluster system block**: it loses its `cache_control` key (was `{"type": "text", "text": ..., "cache_control": {"type": "ephemeral"}}`, becomes `{"type": "text", "text": ...}`). The `"text"` field content (the `_INSTRUCTIONS` string) is unchanged, so the `"distinct EVENTS" in system[0]["text"]` assertions stay valid.

- [ ] **Step 1: Create the work branch**

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
git checkout main && git pull
git checkout -b tom/neu-377-backend-repair-prompt-cache-effectiveness
```

- [ ] **Step 2: Confirm the container is up**

```bash
task up
```

Expected: `upmovies-backend` container running (needed for all `task` targets).

- [ ] **Step 3: Confirm the current (pre-change) behaviour is what we expect**

Establish the red baseline by reading the three test sites that currently *require* `cache_control`. Run them green first so you know the inversion in Step 4 is what flips them:

```bash
task test -- tests/integration/link/test_cluster.py::test_build_cluster_request_builds_payload_and_plan tests/integration/link/test_cluster.py::test_build_cluster_batch_request_wraps_into_batch_request
```

Expected: **PASS** — these currently assert `system[0]["cache_control"] == {"type": "ephemeral"}` against the existing `cached_system_block` wrap, so they pass before any change. (This step documents the starting state; it is not the failing test.)

- [ ] **Step 4: Invert the three cluster cache assertions (write the failing tests first)**

The TDD red step: change the three assertions to require the **absence** of `cache_control`, mirroring `tests/unit/synthesize/test_summarizer.py:60` (`assert "cache_control" not in system[0]`). Keep the adjacent `"distinct EVENTS"` text assertion exactly as-is.

In `tests/integration/link/test_cluster.py`, in `test_build_cluster_request_builds_payload_and_plan` (line ~156), change:

```python
    assert system[0]["cache_control"] == {"type": "ephemeral"}
    assert "distinct EVENTS" in system[0]["text"]
```

to:

```python
    # NEU-377: cluster instructions are below Sonnet's 2048-tok cache floor and the
    # per-call payload is per-film (no shared prefix), so the block is intentionally
    # un-cached — a plain {"type": "text", "text": ...} block with no cache_control.
    assert "cache_control" not in system[0]
    assert "distinct EVENTS" in system[0]["text"]
```

In the same file, in `test_build_cluster_batch_request_wraps_into_batch_request` (line ~355), change:

```python
    assert req.system[0]["cache_control"] == {"type": "ephemeral"}
    assert "distinct EVENTS" in req.system[0]["text"]
```

to:

```python
    assert "cache_control" not in req.system[0]
    assert "distinct EVENTS" in req.system[0]["text"]
```

In `tests/integration/link/test_pipeline.py`, inside the batch-cluster request-mapping loop (line ~403), change:

```python
        assert r.system[0]["cache_control"] == {"type": "ephemeral"}
        assert "distinct EVENTS" in r.system[0]["text"]
```

to:

```python
        assert "cache_control" not in r.system[0]
        assert "distinct EVENTS" in r.system[0]["text"]
```

> Do **not** touch the LINK assertions in `test_pipeline.py` (line ~330, `"entity-linking classifier"`) — those still require `cache_control` and stay green. Likewise leave `tests/unit/link/test_linker.py` and `tests/unit/scripts/test_measure_link_cost.py` untouched.

- [ ] **Step 5: Run the inverted tests to verify they fail**

```bash
task test -- tests/integration/link/test_cluster.py::test_build_cluster_request_builds_payload_and_plan tests/integration/link/test_cluster.py::test_build_cluster_batch_request_wraps_into_batch_request
```

Expected: **FAIL** — both error on `assert "cache_control" not in system[0]` because the source still wraps the block in `cached_system_block`, so `cache_control` is still present. (You can also run the `test_pipeline.py` batch assertion via the whole `tests/integration/link/` directory; per the repo gotcha, a single integration *file* in isolation can raise a pytest-asyncio session-loop warning, so prefer scoping to specific node-ids or the directory.)

- [ ] **Step 6: Make the cluster system block plain**

In `src/upmovies/link/cluster.py`, at line ~184, change:

```python
    system = [cached_system_block(_INSTRUCTIONS)]
```

to:

```python
    # NEU-377: the cluster instruction block is a few hundred tokens — below Sonnet
    # 4.6's 2048-token prompt-cache floor — and the per-call payload is per-film with no
    # shared prefix, so cache_control here can never produce a hit. Emit a plain system
    # block (mirrors synthesize/summarizer.py) rather than carry a dead cache marker.
    system = [{"type": "text", "text": _INSTRUCTIONS}]
```

- [ ] **Step 7: Drop the now-unused import**

In `src/upmovies/link/cluster.py`, line 18, change:

```python
from upmovies.llm.client import BatchRequest, cached_system_block
```

to:

```python
from upmovies.llm.client import BatchRequest
```

(`cached_system_block` was only used at line 184; with that gone, leaving the import trips ruff F401. `BatchRequest` is still used by `build_cluster_batch_request`.)

- [ ] **Step 8: Run the inverted tests to verify they pass**

```bash
task test -- tests/integration/link/test_cluster.py::test_build_cluster_request_builds_payload_and_plan tests/integration/link/test_cluster.py::test_build_cluster_batch_request_wraps_into_batch_request
```

Expected: **PASS** — the cluster system block is now a plain `{"type": "text", "text": ...}` block with no `cache_control`, and the `"distinct EVENTS"` text assertion still holds.

- [ ] **Step 9: Run the full link/cluster test surface**

```bash
task test -- tests/integration/link tests/unit/link
```

Expected: **PASS** — including `tests/integration/link/test_pipeline.py`'s batch-cluster mapping (line ~403, now asserting no `cache_control`), with the LINK-side cache assertions (line ~330) still green and untouched.

- [ ] **Step 10: Run the full suite, then lint/typecheck/format**

```bash
task test
task format
task lint
task typecheck
```

Expected: `task test` green across the suite (no other site depends on the cluster block carrying `cache_control` — verified by the grep in this plan's research); `task lint` reports no F401 for the dropped import; `task typecheck` clean; `task format` leaves files unchanged (re-run `task lint` if it rewrote anything). If `task lint` flags the new inline comments for line length, wrap them to ≤100 chars.

---

### Task 2: Verify LINK caching on a real run + document the finding (manual / owner step)

This is a **manual, owner-run** verification — **not** a CI step and **not** a code change. It needs a real Anthropic key and incurs token cost, so it is Tom's pass, gated on NEU-375 being merged (telemetry must exist to read). The question it answers: does the LINK stage's `instructions + roster` prefix clear Haiku 4.5's 4096-token cache floor in production? If yes, `cache_read_input_tokens > 0` on the link stage. If no (prefix under the floor), record that and the remediation options rather than forcing a change here — the roster-trim ticket **NEU-379** is the place that can raise/restructure the prefix.

**Files:**
- Modify (documentation only): `docs/specs/2026-06-24-llm-cost-token-efficiency-design.md` — record the measured outcome under Finding **F1** (the LINK bullet, currently "Unverified today"). No source-code change in this task.

**Interfaces:**
- Consumes: NEU-375's `ingest.run_llm_usage` table and the `llm_usage[]` field on `GET /admin/runs` / `GET /admin/runs/{id}`.
- Produces: a recorded conclusion (LINK caches / does not cache, with the numbers) that informs NEU-379. No symbols, no schema.

- [ ] **Step 1: Confirm NEU-375 telemetry is present before measuring**

This task is meaningless without telemetry. Confirm the table and API field exist (read-only check; safe to run anytime):

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
git log --oneline main | grep -i "telemetry\|run_llm_usage\|per-stage" | head
task shell -c "alembic history | head -40"   # the NEU-375 migration that adds ingest.run_llm_usage should appear
```

Expected: the NEU-375 migration adding `ingest.run_llm_usage` is in history. If it is **not** merged yet, **stop** — this task is blocked on NEU-375 and must wait. (Task 1 is independent and can still ship.)

- [ ] **Step 2: Run a real `link` ingest (real key, real cost)**

With a real `ANTHROPIC_API_KEY` configured and the catalog/news tables populated as for a normal preview run, trigger the link stage so the link → cluster path actually calls Anthropic and NEU-375 records per-stage usage. Use the existing admin trigger (the same one the cron uses), e.g.:

```bash
# machine-facing admin trigger (ADMIN_TOKEN bearer). Adjust host/path to the local admin API.
curl -s -X POST "$BACKEND_URL/admin/ingest/link" -H "Authorization: Bearer $ADMIN_TOKEN"
# poll the run to completion via the same admin surface, then capture the run id
```

> To force the **sequential** (non-batch) link path for a cleaner cache-read signal (the batch path can re-write rather than read the shared prefix — spec Finding F2), set `LINK_USE_BATCHES=false` for this run before triggering (e.g. via the env on the container per the localdev notes). Note which path you used in the write-up — it changes how to read the numbers.

Expected: one `ingest.IngestRun` reaches a terminal state with `link` (and `cluster`) rows in `ingest.run_llm_usage`.

- [ ] **Step 3: Read the link stage's cache columns**

Read the per-stage usage off the run, either via the admin API or directly from the table.

Via API:

```bash
curl -s "$BACKEND_URL/admin/runs/<run-id>" -H "<session cookie / admin auth>" | jq '.llm_usage[] | select(.stage=="link")'
```

Or directly (read-only SQL in the container):

```bash
task shell -c "psql \"$DATABASE_URL\" -c \"select stage, model, batched, input_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd from ingest.run_llm_usage where run_id = '<run-id>' order by stage;\""
```

Expected: a `link` row with concrete `cache_read_input_tokens` / `cache_creation_input_tokens` values.

- [ ] **Step 4: Interpret and record the conclusion**

Decision rule:

- **`cache_read_input_tokens > 0` on the link stage → caching IS firing.** The `instructions + roster` prefix clears Haiku's 4096-token floor. Record the input / cache_read / cache_creation numbers as the confirmed baseline. No further change in this ticket.
- **`cache_read_input_tokens == 0` (and `cache_creation_input_tokens == 0`) → caching is NOT firing.** Two sub-cases:
  - *Prefix under the 4096 floor* (small catalog → small roster): the marker no-ops exactly like cluster's did. **Do not** remove the link marker here (unlike cluster, the link prefix *is* a genuine shared prefix and will start caching once the roster grows or is restructured). Instead **document** that the win is gated on roster size and hand the remediation to **NEU-379** (roster trim is the lever that changes prefix size/shape).
  - *Batch path re-writing the prefix* (you ran with `LINK_USE_BATCHES=true`): `cache_creation_input_tokens` will be non-zero while `cache_read_input_tokens` stays ~0 across concurrent sub-requests (spec Finding F2). Re-run with `LINK_USE_BATCHES=false` (Step 2 note) to get the sequential read signal before concluding. The batch-vs-sequential economics are **NEU-378**'s call, not this ticket's.

Write the outcome into `docs/specs/2026-06-24-llm-cost-token-efficiency-design.md`, updating the F1 LINK bullet from "Unverified today" to the measured result — include the run id, the path used (batch/sequential), and the four token counts. Example phrasing for the "caching fires" case:

```markdown
  - **Link** caches `instructions + roster` (`linker.py:118`); **VERIFIED 2026-06-DD**
    (run `<run-id>`, sequential path): link stage reported
    `cache_read_input_tokens=<N>` (> 0) against `input_tokens=<M>` →
    the prefix clears Haiku 4.5's 4096-token floor and caching fires. Baseline recorded.
```

And for the "does not fire / under floor" case:

```markdown
  - **Link** caches `instructions + roster` (`linker.py:118`); **VERIFIED 2026-06-DD**
    (run `<run-id>`, sequential path): `cache_read_input_tokens=0` and
    `cache_creation_input_tokens=0` → the `instructions + roster` prefix is under
    Haiku 4.5's 4096-token floor, so `cache_control` currently no-ops. The link marker
    is kept (the prefix is a genuine shared prefix that will cache once larger);
    raising/restructuring the prefix is deferred to **NEU-379** (roster trim).
```

- [ ] **Step 5: Commit the spec update (docs-only)**

```bash
cd /Users/trb74/projects/upcoming-movies   # spec lives in the umbrella docs/, not the repo
git add docs/specs/2026-06-24-llm-cost-token-efficiency-design.md
# /commit-msg, or:
git commit -m "docs: record link-stage prompt-cache verification

Update F1 with the measured link-stage cache_read/cache_creation numbers
from a real ingest run; note remediation deferred to NEU-379 if under floor.

Refs NEU-377."
```

> If the umbrella `docs/` is not a tracked git location, capture the finding wherever the project keeps its notes (a short note in the backend repo's `docs/` is an acceptable fallback) — the point is that the conclusion + numbers are recorded, not lost in a terminal.

---

### Task 3: Document expected per-stage cache behaviour (code comments + spec)

Make the cache reasoning discoverable at the call sites so a future reader does not re-introduce a dead marker (or wrongly "fix" the link one). This is a tiny, no-behaviour documentation task that can ride in the **same PR as Task 1** (Task 1 already adds the cluster comment in Step 6; this task adds the matching notes for link and the shared helper, plus a one-paragraph spec summary).

**Files:**
- Modify: `src/upmovies/llm/client.py` — extend the `cached_system_block` docstring (lines 13–16) with the per-model floor + per-stage applicability note.
- Modify: `src/upmovies/link/linker.py` — add a one-line comment at `build_link_request` (line ~118) recording that link caching is conditional on prefix > 4096 tok (verified per NEU-377 Task 2).
- Modify (documentation): `docs/specs/2026-06-24-llm-cost-token-efficiency-design.md` — a short "Per-stage cache behaviour (NEU-377)" note if not already implied by the F1 update in Task 2.

**Interfaces:** documentation only — no symbols, no signatures, no behaviour. Public APIs unchanged.

- [ ] **Step 1: Extend the `cached_system_block` docstring**

In `src/upmovies/llm/client.py`, lines 13–16, change the docstring to record the floors so the helper documents its own limits:

```python
def cached_system_block(text: str) -> dict[str, Any]:
    """A system content block marked for ephemeral prompt caching. Put the stable prefix
    (e.g. the film roster) in one of these so repeated calls reuse the cached tokens.

    Caching only engages above a per-model prefix floor: Haiku 4.5 = 4096 tokens,
    Sonnet 4.6 = 2048 tokens. Below the floor `cache_control` silently no-ops
    (cache_creation_input_tokens == 0). Per stage (NEU-377): LINK uses this and caches
    iff `instructions + roster` exceeds 4096 tok; CLUSTER does NOT (per-film payload,
    instructions under 2048 — uses a plain block); SUMMARIZE does NOT (instructions
    under 4096 — uses a plain block)."""
    return {"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}
```

- [ ] **Step 2: Annotate the link build site**

In `src/upmovies/link/linker.py`, at `build_link_request` (line ~118), add a comment above the `system = [...]` line:

```python
    # Cacheable iff `instructions + roster` > Haiku 4.5's 4096-tok floor; otherwise this
    # no-ops (cache_creation=0). Verified per-run via NEU-375 telemetry (NEU-377 Task 2).
    system = [cached_system_block(f"{_INSTRUCTIONS}\n\nROSTER:\n{roster.text}")]
```

(Do not change the line itself — the link marker stays; only the comment is added.)

- [ ] **Step 3: Add the per-stage summary to the spec (if not already covered by Task 2)**

In `docs/specs/2026-06-24-llm-cost-token-efficiency-design.md`, ensure the per-stage cache rule is stated once, plainly (the F1 update in Task 2 Step 4 may already carry it — if so, this is a no-op). A one-liner is enough:

> Per-stage cache behaviour (NEU-377): **link** = cacheable iff prefix > 4096 tok (Haiku); **cluster** = not cacheable (per-film payload, instructions under Sonnet's 2048 floor) — marker removed; **summarize** = not cacheable (instructions under Haiku's 4096 floor) — plain block.

- [ ] **Step 4: Re-run quality gates after the doc/comment edits**

```bash
task format
task lint
task typecheck
task test
```

Expected: all green. The docstring/comment edits are comment-only and add no behaviour; ruff line-length (100) is the only realistic failure — wrap any long comment lines.

- [ ] **Step 5: Commit Task 1 + Task 3 together**

Tasks 1 and 3 are one code PR. Generate the message with `/commit-msg`, or:

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
git add src/upmovies/link/cluster.py src/upmovies/link/linker.py src/upmovies/llm/client.py \
  tests/integration/link/test_cluster.py tests/integration/link/test_pipeline.py
git commit -m "refactor: drop dead cluster prompt-cache marker; document per-stage cache floors

The cluster instruction block is below Sonnet 4.6's 2048-token cache floor and
the per-call payload is per-film (no shared prefix), so cache_control there can
never produce a hit. Emit a plain system block instead (mirroring summarizer),
and record the per-model floors + per-stage cache applicability at the call
sites. Link's cache marker is unchanged (its prefix is a genuine shared prefix;
whether it clears Haiku's 4096 floor is verified separately via telemetry).

Refs NEU-377."
git push -u origin tom/neu-377-backend-repair-prompt-cache-effectiveness
```

(No `🤖` footer and no `Co-Authored-By` in the commit — repo convention. The footer belongs only in the PR body, via `/pr-desc`. The Task 2 docs commit, if the spec lives in the umbrella `docs/`, is a separate commit in the umbrella repo and is not part of this PR.)

---

## Self-review

- **Spec coverage (T3 scope):** "remove or restructure the dead `cached_system_block(...)` in `link/cluster.py`" → Task 1 (plain block, mirrors summarizer; import dropped). "confirm (via T1 telemetry) that link produces `cache_read > 0`" → Task 2 (manual owner run, reads `ingest.run_llm_usage` / `llm_usage[]`). "document expected cache behaviour per stage" → Task 3 (docstring + link comment + spec note). "If link's prefix is under the 4096 floor, record that and the remediation options (this informs T5's roster work) rather than forcing a change here" → Task 2 Step 4 (under-floor branch → keep marker, defer to NEU-379). Acceptance "no dead cache markers remain" → Task 1; "T1 telemetry confirms link cache reads on a real run (or the absence is documented with cause)" → Task 2; "tests green" → Task 1 Steps 9–10, Task 3 Step 4.
- **Exact change site (unambiguous):** the single dead marker is `src/upmovies/link/cluster.py:184` → `system = [cached_system_block(_INSTRUCTIONS)]`; the import to drop is `src/upmovies/link/cluster.py:18`. `grep -n cached_system_block src/upmovies/link/cluster.py` returns exactly those two lines and nothing else.
- **Test inversion completeness:** grep across `tests/` for cluster `cache_control` assertions returns exactly three sites — `tests/integration/link/test_cluster.py:156`, `:355`, and `tests/integration/link/test_pipeline.py:403` — all three are flipped in Task 1 Step 4. The LINK sites (`test_pipeline.py:330`, `test_linker.py:91/116/139`, `test_measure_link_cost.py:118`) keep `cache_control` and are explicitly left untouched.
- **No-touch guarantees:** `link/linker.py:118` keeps its `cached_system_block` (only a comment added in Task 3); no schema, no migration, no config change; no public signatures change; the cluster `_INSTRUCTIONS` text is unchanged so `"distinct EVENTS" in system[0]["text"]` assertions stay valid.
- **Placeholder scan:** none. `<run-id>`, `<N>`, `<M>`, `$BACKEND_URL`, `$ADMIN_TOKEN`, `2026-06-DD` in Task 2 are intentional runtime values for a manual owner step, not plan gaps.
- **Manual vs CI separation:** Task 2 is clearly marked manual/owner (real key, token cost), gated on NEU-375 merge, and is a docs-only commit in the umbrella repo — it is not a CI step and not a merge blocker for the Task 1 code PR.
