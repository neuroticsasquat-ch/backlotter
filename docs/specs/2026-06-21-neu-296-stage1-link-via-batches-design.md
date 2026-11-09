# Stage-1 Link via Batches API (behind `link_use_batches`) — Design

- **Date:** 2026-06-21
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-backend` — `link` pipeline (Stage 1), `llm` client, `config`
- **Linear:** NEU-296 (one PR, backend) · parent NEU-290 · project *Movies: Ingestion & Feeds* · milestone *Batches API link-cost optimization*
- **Blocked by:** NEU-295 (`AnthropicClient.complete_batch`) — ✅ done (PR #26)
- **Blocks:** NEU-297 (measure batch vs sequential+caching cost; flip default)
- **Design-of-record:** [2026-06-20-ingestion-cadence-recency-architecture-design.md](2026-06-20-ingestion-cadence-recency-architecture-design.md) §"Batches API cost optimization". This document is the per-ticket implementation design for the M3 Stage-1 deliverable.

## What this is

A config-gated alternate execution for **Stage-1 linking only**. When `link_use_batches` is
on, `run_link_ingest` submits all story chunks as a single Message Batch via the already-landed
`AnthropicClient.complete_batch` instead of issuing N sequential `complete()` calls, then applies
the **identical** floor/resolution logic to each chunk's result. The flag defaults **off** — the
proven sequential path stays the default until NEU-297's cost measurement lands and justifies the
flip.

The point of the ticket is *parity*: with the flag on, the batched path must produce the same
per-story outcomes as the sequential path on a fixed mocked response set — including failure
behavior, not just the happy path.

### Out of scope

- Stage-2 clustering via Batches → NEU-298.
- Cost measurement + default flip → NEU-297.
- Any change to the sequential path's observable behavior.
- No migration, no frontend, no new required env.

## Key decision — parity is structural, not hoped-for

The Stage-1 decision logic (parse the JSON array → per-story `about` + `film_id` +
`confidence ≥ floor` resolution → `link_note` assignment → no-decision fallback) currently lives
*inside* `link_story_batch` (`linker.py`), tangled with the `complete()` call. The two execution
shapes differ — sequential is N×(call + apply) interleaved; batched is 1×(build N requests +
submit) then N×(apply) — so they cannot share one function wholesale.

The design therefore **extracts the two reusable pieces into pure functions that both paths call**,
so identical outcomes are a property of the code rather than something kept in sync by hand. A
future change to the floor logic touches one function and cannot silently diverge between paths.

## Config & wiring

- **`config.py`:** add `link_use_batches: bool = Field(default=False, alias="LINK_USE_BATCHES")`.
  No new required env.
- **`routers/ingest_admin.py`:** pass `use_batches=settings.link_use_batches` into the existing
  `run_link_ingest(...)` call (one more kwarg alongside `model`, `cluster_model`, `recency_days`,
  `batch_size`, `floor`).
- **Client Protocol:** the `Completer` Protocol in `linker.py` (today only declares `complete`)
  gains `complete_batch(...)`. The injected `AnthropicClient` already implements both. Existing
  sequential-path test fakes get a `complete_batch` stub so they still satisfy the type.
  `BatchRequest` / `BatchResult` are imported from `upmovies.llm.client`.

## `linker.py` — extract the two shared helpers

```python
def build_link_request(roster, stories) -> tuple[list[dict], list[dict]]:
    system = [cached_system_block(f"{_INSTRUCTIONS}\n\nROSTER:\n{roster.text}")]
    messages = [{"role": "user", "content": json.dumps(_story_payload(stories))}]
    return system, messages

def apply_link_decisions(*, raw, stories, roster, floor) -> BatchLinkResult:
    # the current decision-application block, verbatim:
    # json.loads(_extract_json_array(raw)) → per-story floor/link_note resolution
    # → no-decision fallback → return BatchLinkResult(linked, rejected)
```

`link_story_batch` (sequential, **behavior unchanged**) becomes:
`build_link_request` → `await client.complete(...)` → `apply_link_decisions(...)`. Its existing
tests guard the refactor.

## `pipeline.py` — batched orchestration

`run_link_ingest` gains a `use_batches: bool` parameter and branches Stage 1 into one of two
helpers (extracted for clarity and independent testability), each returning `(linked, rejected)`.
Stage 2 (clustering) and the run finalization are unchanged and run afterward regardless of path.

- **`_link_stage_sequential(...)`** — today's per-chunk loop, lifted out verbatim.
- **`_link_stage_batched(...)`:**
  - **Build phase (one read-only session):** `chunks = _chunks(pending_ids, batch_size)`; for each
    chunk index `i`, load its stories and build
    `BatchRequest(custom_id=str(i), model=model, system=…, messages=…, max_tokens=_MAX_TOKENS)`
    via `build_link_request`. `max_tokens` is pinned to `_MAX_TOKENS` (2048) — the same value the
    sequential path passes — for parity. ORM objects are discarded after the request is built (the
    payload is already serialized into `messages`), so **no sessions are held open during the batch
    poll**.
  - **Submit:** `results = await client.complete_batch(requests)` (poll interval / timeout use the
    method defaults: 15 s / 3600 s — the 3600 s ceiling matches the daily run's ~60-min budget).
  - **Apply phase (per chunk, own session + commit):** for each `custom_id = str(i)`, look up its
    `BatchResult`; if missing or `ok=False` → raise; else `apply_link_decisions(raw=result.text, …)`
    + `record_progress(processed_delta=…)` + commit.

Because both phases iterate the same `chunks` list, the `custom_id` index ↔ chunk alignment is
exact.

## Error handling

| Failure | Behavior |
|---|---|
| One chunk `ok=False` (errored / expired) or its `text` is unparseable | That chunk → `record_progress(failed_delta=len(chunk))`, its stories stay `pending`; other chunks commit. Mirrors the sequential path's per-chunk try/except isolation. |
| A chunk is omitted from the results stream | `complete_batch` pre-seeds every `custom_id` as `BatchResult(ok=False, error_type="missing")`, so it flows through the same failed-chunk path — never silently dropped. |
| Whole-batch submit/poll raises (e.g. `TimeoutError`) | Caught: `record_progress(failed_delta=len(pending_ids))` for all, stories stay `pending`, then proceed to Stage 2 (which finds no newly-linked stories → no-op). The run still finalizes `succeeded` with a failure count — mirrors "one failure never fails the whole run." |
| Re-run (idempotency) | Only `pending` stories inside the recency window are selected; already `linked` / `rejected` stories are untouched — unchanged from today. The next daily run retries anything left `pending`. |

## Testing (TDD; fake client; no live API, per repo convention)

- **Refactor guard:** existing `link_story_batch` tests stay green — they now exercise the
  delegated `apply_link_decisions` and `build_link_request`.
- **Headline parity test:** a fake client implementing **both** `complete` and `complete_batch`,
  returning the **same** canned decisions keyed by the story IDs present in each request payload
  (path-agnostic). Run `run_link_ingest` over the same seeded DB twice — `use_batches=False` then
  `use_batches=True` — and assert identical `Story` rows (`link_status`, `film_id`,
  `link_confidence`, `link_note`, `linked_at` set) **and** identical `LinkIngestResult`. This is
  the ticket's "same per-story outcomes on a fixed mocked response set."
- **Failure isolation:** one chunk returns `ok=False` and one chunk returns unparseable text →
  those stories stay `pending` with `failed_delta` recorded; other chunks commit; a re-run
  reprocesses only the still-`pending` ones (idempotency).
- **Request mapping:** N chunks → N `BatchRequest`s with `custom_id` `"0"…"N-1"`, each carrying its
  chunk's payload and the cached roster system block (assert `cache_control` is present and
  `max_tokens == _MAX_TOKENS`).
- **Whole-submit failure:** `complete_batch` raises → all chunks counted `failed`, Stage 2 still
  runs, the run finalizes `succeeded`.
- **Flag routing:** flag off → `complete_batch` is never called; flag on → `complete` is never
  called for Stage 1.
- `task format` first, then `task test` / `task lint` / `task typecheck` green. Commit normally
  (pre-commit hooks delegate into the container — no `--no-verify`).

## Files touched

- `src/upmovies/config.py` — add `link_use_batches`.
- `src/upmovies/routers/ingest_admin.py` — pass `use_batches=settings.link_use_batches`.
- `src/upmovies/link/linker.py` — extract `build_link_request` + `apply_link_decisions`; extend the
  `Completer` Protocol with `complete_batch`; `link_story_batch` delegates to the helpers.
- `src/upmovies/link/pipeline.py` — `run_link_ingest` gains `use_batches`; add
  `_link_stage_sequential` / `_link_stage_batched`; import `BatchRequest` (and `BatchResult` as
  needed) from `upmovies.llm.client`.
- `tests/unit/link/test_pipeline.py` (and a touch to `test_linker.py` fakes) — parity, failure
  isolation, request mapping, whole-submit failure, and flag-routing tests.

## Delivery

One backend PR on the ticket's branch
(`tom/neu-296-be-stage-1-link-via-batches-api-behind-link_use_batches-flag`). No migration, no FE.
Implement in a Sonnet/high session per the model/effort workflow; this Opus session produced the
design only.
