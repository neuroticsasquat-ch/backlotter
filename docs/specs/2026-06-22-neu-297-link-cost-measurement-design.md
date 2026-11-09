# Measure Batch vs Sequential+Caching Link Cost; Flip Default — Design

- **Date:** 2026-06-22
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-backend` — `llm` client (usage surface), `scripts/` (measurement harness), `config` (the flip)
- **Linear:** NEU-297 (one PR, backend + docs) · parent NEU-290 · project *Movies: Ingestion & Feeds* · milestone *Batches API link-cost optimization*
- **Blocked by:** NEU-296 (Stage-1 link via Batches behind `link_use_batches`) — ✅ done (PR #27)
- **Blocks:** NEU-298 (Stage-2 clustering via Batches) — the measurement/decision gates the follow-on
- **Design-of-record:** [2026-06-20-ingestion-cadence-recency-architecture-design.md](2026-06-20-ingestion-cadence-recency-architecture-design.md) §"Batches API cost optimization". This document is the per-ticket implementation design for the M3 measurement deliverable.

## What this is

A re-runnable **measurement harness** that quantifies the real cost of the two Stage-1 link
execution shapes — sequential (`complete()` + prompt caching) vs batched (`complete_batch()`) —
against a locally-ingested representative corpus, using **real Anthropic API calls** (the only way
to get true `cache_read` / `cache_creation` token counts; they cannot be mocked). It records the
numbers into the design-of-record spec and, **if batches win net by a clear margin, flips
`link_use_batches` to default-true** in the same PR.

The ticket exists because the win is not assumable. Batch fan-out runs requests concurrently, so the
cached roster prefix may be **written** to cache repeatedly (each concurrent request a cold write)
rather than **read** — partially offsetting the flat 50% batch discount. The sequential path, by
contrast, warms the cache on call 1 and reads it on calls 2..N (~85–90% off the roster tokens on
those calls), but pays full list price. Net winner depends on the roster-token share per request —
so we measure rather than assume.

### Out of scope

- **Stage-2 clustering** (Sonnet, per-film) batching and its cost → NEU-298. The harness measures
  **Stage-1 link only** — the only stage `link_use_batches` gates today.
- Any change to the observable behavior of `run_link_ingest` / `linker` / `cluster` / `pipeline`.
- Live API calls in CI (the measurement run is manual, by design).
- New required env (reuses the existing `ANTHROPIC_API_KEY` / `link_*` settings).
- The operational `tmdb` + `feeds` ingest that populates the corpus — a documented precondition,
  not code in this PR.

## Key decision — measure a faithful re-creation, via the shared request builders

The harness does **not** run `run_link_ingest` itself, and it does **not** add a stateful usage
side-channel to the "returns plain data" client. Instead it drives the two Stage-1 shapes directly,
building every request through the **same shared helpers production uses** — `build_roster`,
`build_link_request`, `build_batch_request`, `_chunks`, `settings.link_model`, and
`linker._MAX_TOKENS` (2048). Because the request payloads come from the exact same functions, the
token shape — and therefore the cache×batch interaction the ticket measures — is faithful to
production. What the harness omits (the DB read/commit orchestration of `run_link_ingest`) does not
affect token cost.

Two consequences that make this the right call:

1. **No DB mutation.** The harness only *reads* `pending` stories and fires LLM calls; it never
   writes link decisions. So both paths run on the **identical** pending set with no reset dance.
2. **Client changes stay purely additive.** No return-type changes ripple through `linker` /
   `cluster` / `pipeline` / their fakes.

## Client changes (`src/upmovies/llm/client.py`) — all additive

1. **`Usage` frozen dataclass** — `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
   `cache_creation_input_tokens`; with `__add__` (sum across calls) and a `from_sdk(usage)` mapper
   that defaults the cache fields to 0 when the SDK returns `None`.
2. **`complete_with_usage(*, model, system, messages, max_tokens=4096) -> tuple[str, Usage]`** —
   does what `complete()` does today and additionally returns `Usage.from_sdk(resp.usage)`.
   **`complete()` is refactored to delegate** to it and return only the text, so its two production
   callers (`linker.py:185`, `cluster.py:153`) are untouched.
3. **`BatchResult` gains `usage: Usage | None = None`** (additive field). `_to_result` populates it
   from `result.message.usage` on a succeeded entry; it stays `None` on errored / missing entries.
   Existing `BatchResult(...)` constructions in tests still compile.

No existing return type changes; nothing in `linker` / `cluster` / `pipeline` needs to move.

## The harness (`scripts/measure_link_cost.py`)

Follows the repo script convention (`scripts/export_link_validation_draft.py`): an async `main()`
run in the container via `task shell` → `python scripts/measure_link_cost.py`, wiring
`SessionLocal`, `get_settings()`, and `AnthropicClient(api_key=settings.anthropic_api_key)`.

**Precondition (documented in the docstring):** run a real `tmdb` + `feeds` ingest locally first so
the DB holds a representative `pending` corpus (~2k stories / ~97 films, per the 2026-06-20
full-pipeline test). The harness only reads `pending` stories; it does not ingest.

Built from small, independently-testable pieces:

| Piece | Responsibility | Purity |
|---|---|---|
| `select_corpus(s, recency_days, limit)` | Same predicate as `run_link_ingest`: `link_status == "pending"` ∧ `coalesce(published_at, fetched_at) >= cutoff`, `ORDER BY id`, optional `limit` (spend cap). Returns `list[UUID]`. | reads DB |
| `_load_chunk(s, ids)` | Load `Story` rows for one chunk (chunks from the real `_chunks(ids, link_batch_size)`). | reads DB |
| `measure_sequential(client, roster, chunks, model, nonce)` | Per chunk → `build_link_request` → `complete_with_usage` → accumulate `Usage`. Reproduces natural cache warming over calls 2..N. | live API |
| `measure_batched(client, roster, chunks, model, nonce)` | `build_batch_request(custom_id=str(i), …)` for all chunks → one `complete_batch` → sum `BatchResult.usage`. Records wall-clock and the per-chunk cache_creation-vs-cache_read split. | live API |
| `price(usage, rates, *, batch)` | Token counts × rate table; `batch=True` applies the flat 50%. | pure |
| `format_report(seq_runs, batch_runs, rates)` | Per-run + mean tokens/$ table, plus a markdown block ready to paste into the spec. | pure |

**Reuse, not reimplementation:** roster via `build_roster`; requests via
`build_link_request` / `build_batch_request`; chunking via `pipeline._chunks` (imported as-is — a
module-private import is acceptable in a script; promote to a public helper only if preferred);
model = `settings.link_model`; `max_tokens` pinned to `linker._MAX_TOKENS` (2048). Requests are
therefore identical to production.

**Spend guardrails:** a `--limit N` story cap (default: full corpus) and a **pre-flight estimate** —
the harness counts chunks and prints projected request volume before firing, so a full run is never
a surprise. Token counts are the recorded source of truth; `$` is a derived, recomputable estimate.

## Pricing & cost model

Cost is derived from each path's **own** measured token split, via an explicit rate table:

| Token category | Rate (relative to base input) | Notes |
|---|---|---|
| `input_tokens` (uncached) | 1.0× base | |
| `cache_creation_input_tokens` | 1.25× base | 5-min ephemeral cache **write** |
| `cache_read_input_tokens` | 0.1× base | cache **read** |
| `output_tokens` | output rate | |
| **Batch path** | **× 0.50 on all of the above** | flat Batches API discount |

- The rate table is an explicit, **dated, source-cited constant** at the top of the harness
  (`# Claude Haiku 4.5 pricing, <URL>, verified YYYY-MM-DD`), overridable so a price change is a
  one-line edit.
- **Raw token counts are the recorded source of truth; `$` is a recomputable estimate.** Current
  public Haiku 4.5 rates must be verified against live Anthropic pricing before the dollar figures
  are trusted. The token breakdown stands regardless of price drift.
- Each path priced with its own split is the whole mechanism: sequential trends cache_read-heavy
  (cheap reads after call 1) at full price; batched may trend cache_creation-heavy (concurrent
  writes at 1.25×) but with the 50% discount. The report surfaces the split, not just the bottom
  line.

## Methodology — what makes the number trustworthy

- **Cold-cache isolation between runs, via a per-run nonce.** The roster cache TTL is ~5 min, so
  without isolation one path warms a cache the other reads — biasing the result in either direction.
  Fix: prepend a unique one-line nonce (`RUN <uuid>\n`) **inside** the cached system block, unique
  per measured run. Each run then starts **cold** — faithful to a daily cron where yesterday's cache
  has expired — while still exercising intra-run caching (every call in a run shares the nonce → one
  cache entry, so sequential's calls 2..N still read). The nonce's handful of tokens are identical
  across both paths and negligible. *(Alternative, if a zero-prefix-change measurement is preferred:
  sleep out the >5-min TTL between runs — slower and flakier; the nonce is recommended.)*
- **Repeats to expose noise:** run each path **3×** (configurable), **alternating** seq/batch per
  repeat to spread time-of-day API variance. Report per-run values + mean. The spread *is* the noise
  band the flip rule compares against.
- **Recorded into the design-of-record spec** (`2026-06-20-ingestion-cadence-recency-architecture-design.md`,
  §Batches): per path — `input` / `output` / `cache_read` / `cache_creation` tokens, the
  **cache_creation : cache_read ratio** (the crux the ticket names), total `$`, batch wall-clock vs
  the ~60-min budget, and the corpus descriptor (N stories, N chunks, model, date). Plus the
  decision + rationale.

## The flip rule (success criterion)

Flip `link_use_batches` default `False → True` (a one-line `config.py` edit) **iff**:

1. batched **mean `$` < sequential mean `$` by a clear margin that exceeds the observed noise
   band**, AND
2. the batch **completed within the daily run's ~60-min budget**.

Otherwise leave the default `False` and record why. Latency is a pass/fail gate (does the batch
finish in budget), not a tradeoff to weigh against dollars — the daily pass is not latency-sensitive.
A within-noise or marginal saving does not justify flipping, because the batched path carries real
operational complexity (async submit/poll, extra failure modes); the design-of-record frames the
default as "keep the proven sequential path until the measurement *justifies* the flip." The harness
records the numbers; the flip is a human-confirmed one-liner gated on the recorded result.

## Testing (TDD; no live API in tests — fakes only, per repo convention)

- **Client (`tests/unit/llm/test_client.py`, extend):** add `cache_read_input_tokens` /
  `cache_creation_input_tokens` to the existing `_message_response` and `_succeeded_line` usage
  blocks (respx-mocked HTTP), then assert: `Usage.from_sdk` maps all four fields and defaults
  missing cache fields to 0; `complete_with_usage` returns `(text, Usage)`; `complete` still returns
  the bare `str` (delegation is behavior-preserving); `BatchResult.usage` is populated on a
  succeeded line and `None` on an errored / missing one; `Usage.__add__` sums.
- **Harness (`tests/unit/scripts/test_measure_link_cost.py`, new):** `price()` math — full rates vs
  50% batch, cache write/read multipliers (pure); `format_report()` emits the expected token/$ rows
  + markdown (pure); `measure_sequential` / `measure_batched` against a `FakeClient` (canned text +
  canned `Usage`) sum correctly, and the batched path builds N requests with `custom_id` `"0"…"N-1"`,
  the cached roster block, and `max_tokens == 2048`.
- The **live measurement run is manual** — it *is* the data-gathering step — never in CI.
- `task format` first, then `task test` / `task lint` / `task typecheck` green. Commit normally
  (pre-commit hooks delegate into the container — no `--no-verify`).

## Files touched

**This PR (code + docs):**

- `src/upmovies/llm/client.py` — add `Usage`, `complete_with_usage`; `complete` delegates;
  `BatchResult.usage`; `_to_result` populates usage.
- `scripts/measure_link_cost.py` — the harness (new).
- `tests/unit/llm/test_client.py` — usage-capture tests.
- `tests/unit/scripts/test_measure_link_cost.py` (+ `tests/unit/scripts/__init__.py`) — pure +
  orchestration tests (new).
- `docs/specs/2026-06-20-ingestion-cadence-recency-architecture-design.md` — record the results
  table + decision (after the manual run).
- `src/upmovies/config.py` — flip `link_use_batches` default to `True` **iff** the result justifies
  it (else unchanged, with the reason recorded).

No migration. No FE. No new required env.

## Delivery

One backend PR on the ticket's branch
(`tom/neu-297-be-measure-batch-vs-sequentialcaching-link-cost-flip-default`). The sequence inside the
PR: land the client usage surface + harness + tests (all green) → run a local `tmdb`+`feeds` ingest
→ run the harness → paste numbers into the design-of-record spec → flip the default if justified →
ship via `/t:ship`. Implement in a Sonnet/high session per the model/effort workflow; this Opus
session produced the design only.
