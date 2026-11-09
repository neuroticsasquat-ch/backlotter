# backlotter: LLM Provider Gateway — design

**Linear project:** [backlotter: LLM Provider Gateway](https://linear.app/neuroticsasquatch/project/backlotter-llm-provider-gateway-c6967a50e83e)
**Repo:** `upcoming-movies-backend`
**Date:** 2026-08-05
**Tickets:** NEU-971 … NEU-985
**Related ADRs:** [0005](../adr/0005-remove-message-batches-path.md) (written), 0006 + 0007 (to be written by NEU-977 / NEU-982)

---

## 1. Purpose and exit criterion

Make model selection a configuration change rather than a code change, across the four
stages (`link`, `cluster`, `summarize`, `source_judge`).

**Exit criterion: capability only.** The gateway exists, DeepInfra and DeepSeek are proven
end-to-end in offline eval runs, and **production stays on Anthropic for all four stages**.
Nothing migrates.

Cost is explicitly **not** the justification. backlotter runs ~$0.31/day — ~$9/month, ~$113/year
— and that total is the **ceiling** on what any migration could save, whatever the replacement
charges. The candidate providers are roughly an order of magnitude cheaper per token, so a full
swap saves on the order of $100/year against the engineering cost of getting there. The
motivation is optionality and instrumentation ahead of the undated-film expansion, which
multiplies volume across every stage.

*(Corrected 2026-08-08, NEU-982: this read "a full swap saves under $10/year", which is
year-for-month — $0.31/day is ~$113/year, so the whole spend is over ten times that figure.
The conclusion is unchanged; the number supporting it was wrong.)*

**Accepted risk:** an adapter with no production canary is unexercised code, and unexercised
code rots. Recorded deliberately, revisit if the expansion changes the economics.

> **Superseded 2026-08-08 by [ADR-0012](../adr/0012-production-runs-on-deepinfra.md) (NEU-1015).** The capability-only exit criterion
> above no longer holds: production now runs all four stages on DeepInfra — `link`, `summarize`
> and `source_judge` on V4-Flash, `cluster` on V4-Pro. The accepted risk immediately above is
> what reversed it. With no users to disrupt and the M2 baseline telemetry already recorded, the
> live run *is* the canary, and it answers cheaply what §11's twelve-cell matrix answers
> expensively. §11 is not run as specified; the per-stage validators remain, as diagnosis rather
> than as a gate. First-party DeepSeek is dropped on operations, not capability — announced price
> increase, and no automatic top-up against a gateway with no failover.

## 2. Starting position

Two scope items commonly assumed missing are already done:

- **Per-stage model config** — `LINK_MODEL`, `CLUSTER_MODEL`, `SOURCE_JUDGE_MODEL`,
  `SUMMARY_MODEL` (`config.py:32-48`). Missing is *provider*, not model.
- **Usage logging** — `ingest.run_llm_usage`: tokens by type + cost per `(run, stage)`.
  Missing is provider, latency, and per-*call* grain.

A shared abstraction also already exists: the `Completer` Protocol (`link/linker.py:126-134`,
`synthesize/summarizer.py:126-136`). The real Anthropic coupling is three specific things —
`cached_system_block`, `complete_batch`, and `pricing.py`'s hardcoded cache multipliers.

## 3. Sequencing

| Milestone | Blocked by |
|---|---|
| M1 — Retire the batch path | nothing |
| M2 — Per-call telemetry | nothing |
| M3 — Provider-neutral request contract | `backlotter: Entity-Linking Candidate Retrieval` |
| M4 — The gateway | M3 |
| M5 — Provider evaluation | M4 |

The cross-project dependency binds **M3 onward only**. Candidate Retrieval rewrites `link`'s
prefix from a ~50k-token roster to "low thousands of tokens plus per-story candidates";
building the neutral caching contract against a prefix shape that is about to be deleted means
building it twice.

**Anticipated consequence:** once the prefix drops to low thousands of tokens it may fall below
every provider's cache floor (Haiku 4.5's is 4096 tokens, `llm/client.py:19-21`), leaving all
four call sites cache-free and the caching contract inert. **That is a success, not a failure** —
keep the contract regardless; it is the right interface and costs little.

## 4. Target module layout

Flat package, matching the `ingest/tmdb/` idiom (`client`, `schemas`, `service`, `upsert`):

```
src/upmovies/llm/
├── __init__.py        re-exports (import x as x, per repo style)
├── types.py           Prompt, Usage, CallResult, Completer Protocol
├── anthropic.py       AnthropicClient  (today's client.py, batch path removed)
├── openai_compat.py   OpenAICompatClient
├── registry.py        provider -> base URL constants
├── retry.py           shared retry policy, used by BOTH adapters
├── gateway.py         Gateway context manager, for_stage()
└── pricing.py         (provider, model) -> Rates
```

`llm/client.py` is retired in favour of `anthropic.py` + `types.py`. Keep `__init__.py`
re-exporting the names call sites already import so the blast radius stays small.

**Hard constraint:** nothing under `llm/` imports from `db` or `sqlalchemy`. The client is
deliberately self-contained (`client.py:1-3`) and that separation is load-bearing for testing.

## 5. Core interfaces

### 5.1 `Prompt` — the neutral request DTO

The contract is **stable content first, byte-identical across calls**. Anthropic caches
explicitly up to a placed `cache_control` breakpoint; DeepInfra and DeepSeek cache
automatically on the longest byte-identical prefix. One invariant satisfies both.

```python
@dataclass(frozen=True)
class Prompt:
    stable_prefix: str            # contractually byte-stable across calls; serialized FIRST
    user: str                     # the varying payload
    max_tokens: int = 4096
    json_object: bool = False     # -> response_format on OpenAI-compat; ignored by Anthropic
```

Each adapter is obligated to place `stable_prefix` first. Anthropic wraps it in a
`cache_control` block; the OpenAI-compatible adapter emits it as the leading system message,
unchanged, letting automatic prefix caching engage.

Builder migration (M3): three of four collapse near-mechanically —
`Prompt(stable_prefix=_INSTRUCTIONS, user=json.dumps(payload))`. `link` is the only one with a
real prefix (`linker.py:182`), and it is *already* shaped correctly: roster in the system
position, daily-changing `as_of_date` payload in the user position.

### 5.2 `CallResult` — what an adapter returns

```python
@dataclass(frozen=True)
class CallResult:
    text: str
    usage: Usage
    latency_ms: int        # TOTAL wall-clock for the logical call, INCLUDING retries
    attempts: int          # >= 1
    ok: bool
    error_type: str | None = None
```

`latency_ms` is deliberately the number the pipeline experiences, since that is what decides
daily-publish viability. `attempts` is separate so retry behaviour stays visible rather than
hidden inside latency.

`Usage` keeps its existing four fields. Cached tokens are stored as **counts, not a boolean** —
Anthropic reports exact read/creation counts; OpenAI-compatible providers that report at all
give `cached_tokens`, also a count. "Cache hit" is a derived predicate.

### 5.3 `Gateway` — per-stage resolution

`run_link_stage` currently opens **one** `AnthropicClient` (`pipeline_run.py:104`) that backs
**three** call sites — `link`, `cluster` and `source_judge` all run inside `run_link_ingest`.
Per-stage providers cannot be threaded through one client instance.

```python
async with Gateway(settings) as gw:
    completer = gw.for_stage("cluster")     # -> Completer bound to that stage's provider
```

One lifecycle, N pooled underlying HTTP clients. Both pipeline signatures take
`gateway: Gateway` in place of `client: Completer`; each stage does one `for_stage` lookup.

**`model` stays an explicit parameter** on the pipeline signatures. Folding it into the gateway
would break `scripts/eval_cluster_diff.py`, whose entire A/B mechanism is
`--model claude-sonnet-4-6` then `--model claude-haiku-4-5` against a fixed corpus. The gateway
accepts per-stage overrides for eval runs.

## 6. Telemetry

`ingest.llm_call`, one row per logical API call. Rationale: **latency is not summable and
cache-hit is not averageable**, so the existing per-`(run, stage)` grain structurally cannot
support provider selection.

Columns: `id`, `run_id` (FK cascade, indexed), `stage` (check-constrained to the same four as
`ck_run_llm_usage_stage`), `provider`, `model`, the four token counts, `latency_ms`, `attempts`,
`ok`, `error_type`, `parse_ok` (nullable), `cost_usd`, `created_at`.

**Seam.** The adapter returns `CallResult`; the *stage* persists the row, since only the stage
knows `run_id` and its own `stage` name. This keeps `llm/` free of DB imports (§4).

`run_llm_usage` is **unchanged** and keeps being written from the in-memory `Usage` sum — not
re-derived as a rollup. Both writes come from the same `Usage` objects, and converting the
aggregate to a view would touch the working `/admin/runs` surface for no gain here.

Volume: order tens to low hundreds of calls/day, ~50k rows/year. No retention policy.

## 7. Pricing

Two changes, both required before a second provider exists:

1. **Rekey `_RATES` on `(provider, model)`.** Keyed on model alone (`pricing.py:32`) it collides
   the first day two hosts serve the same open weights — which is the project's whole premise.
2. **Move cache multipliers into `Rates`**, all required, no defaults:
   `Rates(input_per_mtok, output_per_mtok, cache_write_mult, cache_read_mult)`. Automatic-caching
   providers generally charge no write premium, so Anthropic's `1.25` is wrong by construction
   off-Anthropic. Required-not-defaulted stops a new provider silently inheriting it.

**Preserve** `rates_for` raising `KeyError` on an unknown key (`pricing.py:38-41`) — silent
mispricing is worse than a crash. Keep `_BATCH_DISCOUNT` and `price(..., batch=)` for historical
rows.

**Boot-time validation** (NEU-981) makes the `KeyError` safe: at lifespan startup assert every
configured `(provider, model)` resolves to `Rates` *and* has a credential. Fails the container
rather than a nightly publish. Same class of guard as "`TMDB_API_KEY` must be set or the app
won't boot".

**Rates must be verified against published pricing at implementation time**, not taken from this
spec — `Rates` carries that warning for a reason (`pricing.py:20-21`). Raw token counts remain
the recorded source of truth.

## 8. Config surface

Four new settings, matching the existing explicit/typed/env-aliased idiom:

- `LINK_PROVIDER`, `CLUSTER_PROVIDER`, `SOURCE_JUDGE_PROVIDER`, `SUMMARY_PROVIDER`
- each `Literal["anthropic", "deepinfra", "deepseek"]`, default `"anthropic"` — the `Literal`
  buys provider-name validation at boot for free

Credentials `DEEPINFRA_API_KEY` / `DEEPSEEK_API_KEY` are **optional, default `None`**.
`ANTHROPIC_API_KEY` is `Field(...)` (required, `config.py:31`); adding new keys the same way
would break every deploy that doesn't use them. §7's boot validation is what makes optional safe.

Base URLs are **constants in `registry.py`, not config** — not deployment-varying, and tests
mock at the transport layer.

## 9. Retry policy

Shared across **both** adapters, not merely configured to similar values. If the two paths retry
differently, every latency and coverage comparison measures retry policy and calls it provider
quality.

Bounded exponential backoff with jitter, honour `Retry-After`, same defaults as today (3 retries,
60s timeout — `client.py:113-114`). `httpx.AsyncHTTPTransport(retries=N)` is **not** sufficient:
it retries connection establishment only, not 429/5xx.

This matters more than usual because `_link_stage_sequential` catches per chunk, records
`failed_delta`, and continues (`link/pipeline.py:71-93`). Under-retrying does not surface as an
error — it surfaces as a silently dropped chunk of 15 stories, which an eval run would misread as
"this provider links fewer stories".

**No cross-provider fallback.** Never silently fail over to Anthropic: it buys nothing under a
capability-only exit criterion, and would contaminate evaluation with calls attributed to the
wrong provider. A failing provider means a failing chunk, handled by existing isolation.

## 10. Providers

**DeepInfra** and **DeepSeek** (first-party). backlotter processes public film news and no user
data, so first-party Chinese endpoints are acceptable here — evaluate on latency and reliability
rather than privacy. This differs deliberately from `sundayspin.fm: LLM Provider Gateway`, where
user listening history rules them out.

**Hard selection criterion: the provider must report cached-token counts.** Cost must be
measurable per model per stage or the switch is unfalsifiable. Verify empirically per provider
(field names vary; DeepSeek has historically used `prompt_cache_hit_tokens` /
`prompt_cache_miss_tokens` rather than `prompt_tokens_details.cached_tokens`), alongside whether
`response_format` is genuinely honoured and the observed JSON compliance rate.

## 11. Evaluation

Extend the existing harnesses; do not replace them. `scripts/eval_cluster_diff.py` is already a
model-A/B rig with worked-through corpus-state fidelity guarantees (read-only runs, `story_id`
alignment rather than positional index, one `--reset` up front and none between runs). That
reasoning is stage-specific and would have to be rediscovered three times in a unified script.

`source_judge` is the one stage with **no** validator — NEU-984 adds one.

Report per run alongside each script's quality metric: cost, p50/p95 latency, mean `attempts`,
`parse_ok` rate, cached-token counts.

**`parse_ok` is not quality.** A provider failing to emit parseable JSON is failing at
output-format compliance; reading that as model quality is a category error.

## 12. Non-goals

- **Migrating any stage in production.** Exit criterion is capability only (§1).
- **Unifying the four different parse-failure behaviours.** They differ today — `link` raises
  (`linker.py:204`), `cluster` catches (`:210-211`), `summarize` catches with recovery
  (`summarizer.py:187-214`), `source_judge` returns `{}` and warns (`source_quality.py:209-212`).
  Pre-existing, and `link` failing loudly is a *feature* during eval runs. Record the outcome
  in `parse_ok`; change nothing.
- **Cache read/write ratio alerting.** Moved to `backlotter: Entity-Linking Candidate Retrieval`,
  where the risk lives.
- **LiteLLM.** See ADR-0007 (NEU-982) — the deciding factor is that `pricing.py` deliberately
  raises on unknown models while LiteLLM's bundled tables fall back to zero or stale rates.
- **A repair/retry loop for malformed JSON.** Doubles cost and latency on exactly the calls
  already going badly, and hides the signal being measured.

## 13. Ticket map

| Ticket | Sections |
|---|---|
| NEU-971 delete batch path | §3, ADR-0005 |
| NEU-972 ADR-0005 + amend 0003 | **done** — both written 2026-08-05 |
| NEU-973 CONTEXT.md "Stage" | **done** — written 2026-08-05 |
| NEU-974 `llm_call` schema | §6 |
| NEU-975 record telemetry | §5.2, §6 |
| NEU-976 `Prompt` DTO | §5.1, §4 |
| NEU-977 ADR-0006 | §5.1, §3 |
| NEU-978 rekey pricing | §7 |
| NEU-979 OpenAI-compat adapter | §4, §5.2, §9, §10 |
| NEU-980 Gateway + config | §5.3, §8 |
| NEU-981 boot validation | §7, §8 |
| NEU-982 ADR-0007 | §4, §5.3, §7, §9, §12 |
| NEU-983 provider-aware evals | §11 |
| NEU-984 `validate_source_judge` | §11 |
| NEU-985 run the matrix | §1, §11 |

## 14. Verification

Per `CLAUDE.md`, every ticket lands with `task test`, `task lint`, `task typecheck` green.
Tests mock HTTP with **respx** — never the live network. Migrations: add the model column first
(tests pick it up via `create_all`), then `task makemigration`, review, `task migrate`.
