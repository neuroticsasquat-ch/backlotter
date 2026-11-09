# Milestone — LLM Cost & Token Efficiency

- **Project:** *Movies: Content Quality* · **Milestone:** *LLM Cost & Token Efficiency* (new)
- **Team:** Neuroticsasquatch (NEU) · **Lead/assignee:** Tom Boone
- **Date:** 2026-06-24
- **Status:** Design approved in brainstorming. Linear milestone + tickets are created from this spec; per-ticket implementation plans follow (one plan per implementable ticket, T1–T6). Linear IDs are backfilled into the ticket table below once created.
- **Scope:** 6 implementable tickets (T1–T6) under one tracking Story (T0). All backend except T2 (frontend admin display).

## Background — what triggered this

Three days of pipeline work (multiple runs/day, plus repeated re-linking/re-synthesis of the same stories while tuning prompts) cost **$35.60** in Claude credits. An audit of the LLM call path found the spend is **structural input-token cost** (the same context re-sent many times), not over-generation — output is already lean everywhere. Two things make the spend hard to manage today:

1. **There is no production cost visibility.** `complete()` computes `Usage` then throws it away (`src/upmovies/llm/client.py:144`); the batch paths read only `BatchResult.text` and ignore `BatchResult.usage` (`src/upmovies/link/pipeline.py:143`, `src/upmovies/synthesize/pipeline.py:204`). Run records (`ingest.IngestRun`) track processed/failed counts but no tokens or dollars. We cannot currently attribute the $35.60 to a stage.
2. **The cost-reducing machinery may not be doing what it looks like it's doing** — see Findings.

### The pipeline (where tokens go)

| Stage | Code | Model | Cached prefix | Per-call input | Output |
|---|---|---|---|---|---|
| **Link** (classify stories vs. roster) | `link/linker.py` | `claude-haiku-4-5` | instructions + **full film roster** (`linker.py:118`) | a chunk of `LINK_BATCH_SIZE` (=15) stories: `id`,`title`,`summary≤500` | small JSON / story |
| **Cluster** (group linked stories → events) | `link/cluster.py` | `claude-sonnet-4-6` | instructions only | 1 film + ≤25 existing events + new stories | small JSON |
| **Summarize** (one-sentence blurb) | `synthesize/summarizer.py` | `claude-haiku-4-5` | **none** (`summarizer.py:139`) | 1 event + its stories (`dek≤500`) | ≤256 tok, 1 sentence |

Link and summarize default to the **Batch API** (`config.py`: `link_use_batches=True`, `summary_use_batches=True`; the link flag drives **both** the link and cluster stages — `run_link_ingest(..., use_batches=...)` in `link/pipeline.py`). SDK: `anthropic>=0.49`.

### Findings (the levers)

- **F0 — No production telemetry.** As above. *Foundational; everything else is measurement-gated on it.*
- **F1 — Two of three "cached" prefixes may never cache.** Prompt caching only engages above a per-model minimum prefix: **Haiku 4.5 = 4096 tokens, Sonnet 4.6 = 2048 tokens** (below the floor, `cache_control` silently no-ops with `cache_creation_input_tokens: 0`).
  - **Cluster** caches only its instruction block (a few hundred tokens) — below Sonnet's 2048 floor → **never a hit.** The `cached_system_block(...)` wrap in `link/cluster.py` is dead.
  - **Link** caches `instructions + roster` (`linker.py:118`); prefix = **~15 193 tokens** — well above Haiku's 4096 floor. **Verified 2026-06-24** (NEU-377): call 1 `cache_creation=15 193`, call 2 `cache_read=15 193`. Caching fires on the sequential path; batch path re-writes (F2).
- **F2 — Batch and cache partially conflict.** Within one batch, sub-requests are processed concurrently, and a cache entry is only readable once the first response starts streaming — so the shared roster tends to be re-written rather than read across chunks. The batch path's reliable win is the flat 50% discount; the cache-read savings the code is designed around may largely not materialize there. The **sequential** path writes the roster once and reads it at ~0.1× thereafter. Which is cheaper per stage is an empirical question.
- **F3 — The link roster is the whole catalog, re-sent per 15-story chunk.** Each chunk carries every film's title, original title, year, genres, and a 240-char overview (`link/roster.py`, `_OVERVIEW_MAX=240`). Smaller chunks ⇒ more roster repetitions; the per-film overview dominates roster size.
- **F4 — Haiku vs Sonnet on cluster.** Cluster runs on `claude-sonnet-4-6` (3× Haiku's input and output price). It is the most reasoning-heavy stage, so Sonnet may be justified — but it is untested against Haiku.

### Corrected misconceptions (do NOT do these — they look like savings but aren't)

- **Lowering `max_tokens` does not reduce cost.** You are billed for tokens *generated*, not the ceiling. `max_tokens` only guards against truncation (and affects rate-limit reservation). Leave the existing values (`linker.py:19`=2048, `cluster` default 4096, `summarizer.py:15`=256) as correctness guards.
- **Caching the summary instructions would silently no-op.** The summary instruction block (~700 tokens) is far below Haiku's 4096-token cache floor; marking it `cache_control` writes nothing. The summary-input lever is prompt *content*, and that was already addressed for content-quality reasons in **NEU-359 / NEU-368** — so it is explicitly **out of scope** here (see Out of scope).

## Goal & definition of done

Cut Claude API spend on the link → cluster → summarize pipeline **without regressing** the content-quality bar the project just raised.

**Done when:**

1. Every ingest run reports per-stage token counts (input / output / cache_read / cache_creation) and an estimated dollar cost, persisted on the run and visible in the admin runs view (T1, T2).
2. Prompt caching is provably firing where it can, and dead cache markers are removed (T3).
3. The cheaper of batch / sequential is selected per stage from measured numbers (T4).
4. The two quality-risk tuning changes (roster trim + batch size; Haiku-for-cluster) have **shipped or been explicitly rejected** with evidence from the eval harness (T5, T6).

## Approach — measure first, then tune (gated, not blind)

The rejected alternative is to trim the roster / swap to Haiku immediately. We reject it because there is no production cost baseline to measure against and the project is acutely quality-sensitive. The milestone is three layers:

1. **Foundation:** production telemetry (T1, T2). You cannot optimize what you cannot see, and it is the acceptance evidence for everything below it.
2. **Safe structural fixes** (no quality risk): remove the dead cluster cache marker / confirm link caching (T3); choose batch-vs-sequential per stage from data (T4).
3. **Quality-gated tuning** (regression risk): roster trim + batch size (T5); Haiku-for-cluster (T6). Each gated on the existing eval harness.

## Cross-cutting design

### Shared pricing helper

`scripts/measure_link_cost.py` already encodes the cost math: per-model `Rates`, `_CACHE_WRITE_MULT = 1.25`, `_CACHE_READ_MULT = 0.10`, `_BATCH_DISCOUNT = 0.50`, and a `price(usage, rates, *, batch)` function. T1 lifts this into a small shared module (e.g. `src/upmovies/llm/pricing.py`) so the measurement script and production telemetry compute identical dollars from one source of truth. The script is refactored to import the shared helper (no behaviour change).

### Telemetry capture & persistence (T1)

- **Capture:** production currently calls `client.complete(...)`, which discards usage. Switch the production consumers to surface usage — either call `complete_with_usage(...)` (sequential) and aggregate `BatchResult.usage` (batch), or thread a usage sink through the pipelines. Aggregate per stage (link / cluster / summarize) across all calls in a run.
- **Persist:** attach the aggregate to `ingest.IngestRun` (`src/upmovies/ingest/models.py:11`) — exact shape (new columns vs. a small per-stage child table vs. a JSON column) is a T1 plan decision; an Alembic migration is required. A recording helper sits alongside `create_run` / `record_progress` / `finalize_run` (`src/upmovies/ingest/runs.py`).
- **Expose:** through `routers/admin_runs.py` (`/admin/runs`) so the data reaches the API the admin UI already consumes.

### Admin display (T2)

Render the persisted per-stage tokens + dollars in `pages/AdminIngest.tsx` via `src/api/runs.ts` (frontend repo). Pure display of T1's data.

### Quality gate (T5, T6)

- **Link (T5):** gate on `scripts/validate_linking.py` (with `export_link_validation_draft.py` / `propose_validation_labels.py` / `diagnose_linking.py` as the supporting validation toolchain). Capture a baseline on the current `claude-haiku-4-5` + roster + `LINK_BATCH_SIZE=15`, then require no link-accuracy regression after the change.
- **Cluster (T6):** the validation toolchain is link-oriented; a dedicated cluster evaluator may not exist. The T6 plan must first confirm what cluster-accuracy signal is available and either (a) reuse the validation fixture for cluster decisions or (b) define a lightweight before/after cluster-diff gate. **Flag explicitly if no usable cluster gate exists** — do not ship a `cluster_model` swap on vibes.

## Tickets

> Labels: `backend` / `frontend` + `Improvement`; `Story` on T0. Assignee Tom Boone. Each ticket links back to this spec. Linear IDs filled in after creation.

| Ticket | NEU ID | Repo | Summary | Blocked by |
|---|---|---|---|---|
| **T0** | NEU-374 | — | *(Story, tracking)* Per-run LLM cost telemetry | — |
| **T1** | NEU-375 | backend | Capture + persist per-stage token usage & cost on `IngestRun` | — |
| **T2** | NEU-376 | frontend | Show per-run token + cost in admin runs view | NEU-375 |
| **T3** | NEU-377 | backend | Repair prompt-cache effectiveness | NEU-375 |
| **T4** | NEU-378 | backend | Choose batch-vs-sequential per stage from measured cost | NEU-375 |
| **T5** | NEU-379 | backend | Cut link input tokens: roster trim + larger batch size | NEU-375 |
| **T6** | NEU-380 | backend | Spike: evaluate Haiku for clustering | NEU-375 |

### T0 — *(Story)* Per-run LLM cost telemetry

Tracking parent for the cross-stack telemetry work (T1 backend + T2 frontend), mirroring the NEU-363 split pattern. No PR, no implementation plan.

### T1 — [backend] Capture + persist per-stage token usage & cost on `IngestRun`

**Problem:** F0 — production discards `Usage`, so per-run cost is invisible.
**Scope:** shared pricing helper (lift from `measure_link_cost.py`); capture usage on both sequential and batch paths; aggregate per stage; persist on `IngestRun` (+ migration); expose via `/admin/runs`. Refactor the measurement script onto the shared helper.
**Key files:** `llm/client.py` (Usage already exists, lines 24–51), `link/pipeline.py`, `synthesize/pipeline.py`, `ingest/models.py:11`, `ingest/runs.py`, `routers/admin_runs.py`, new `llm/pricing.py`, `scripts/measure_link_cost.py`.
**Acceptance:** a completed run row carries input/output/cache_read/cache_creation tokens + estimated $ per stage; values reachable via the run API; unit/integration tests cover capture + aggregation + persistence; full CI green.
**Blocked by:** none. **Blocks:** T2, T3, T4, T5, T6.

### T2 — [frontend] Show per-run token + cost in admin runs view

**Problem:** T1's data needs to be visible to be useful.
**Scope:** display per-stage tokens + $ per run in `pages/AdminIngest.tsx`, typed through `api/runs.ts`.
**Acceptance:** admin runs view shows per-stage tokens + dollar cost for each run; FE CI green (tsc + eslint + vitest).
**Blocked by:** T1. **Blocks:** none.

### T3 — [backend] Repair prompt-cache effectiveness

**Per-stage cache behaviour (NEU-377):** **link** = cacheable iff prefix > 4096 tok (Haiku); **cluster** = not cacheable (per-film payload, instructions under Sonnet's 2048 floor) — marker removed; **summarize** = not cacheable (instructions under Haiku's 4096 floor) — plain block.

**Problem:** F1 — cluster's cached block is below Sonnet's 2048-token floor (never hits); link caching above Haiku's 4096 floor is unverified.
**Scope:** remove or restructure the dead `cached_system_block(...)` in `link/cluster.py`; confirm (via T1 telemetry) that link produces `cache_read > 0`; document expected cache behaviour per stage. If link's prefix is under the 4096 floor, record that and the remediation options (this informs T5's roster work) rather than forcing a change here.
**Key files:** `link/cluster.py`, `link/linker.py:118`, `llm/client.py:13-16`.
**Acceptance:** no dead cache markers remain; T1 telemetry confirms link cache reads on a real run (or the absence is documented with cause); tests green.
**Blocked by:** T1 (needs telemetry to verify). **Blocks:** none.

### T4 — [backend] Choose batch-vs-sequential per stage from measured cost

**Problem:** F2 — batch (flat 50% off) vs sequential (cache reads) is currently a blanket default, not a measured choice; one `use_batches` flag drives both link and cluster.
**Scope:** use T1 telemetry + `measure_link_cost.py` to determine the cheaper path per stage; introduce per-stage path selection where today the link flag covers link+cluster; set defaults from the data and document the decision.
**Key files:** `config.py`, `link/pipeline.py` (`run_link_ingest` use_batches threading), `synthesize/pipeline.py`, `routers/ingest_admin.py`.
**Acceptance:** each stage's default path is set from measured numbers and documented; the path remains overridable by config; tests cover the new config surface.
**Blocked by:** T1. **Blocks:** none.

**T4 result (measured 2026-06-24):** all three stages are cheaper **batched** — the current defaults are confirmed, no flips.

| stage | model | method | sequential $/run | batched $/run | chosen | flag default |
|---|---|---|---|---|---|---|
| link | claude-haiku-4-5 | `measure_link_cost.py` A/B (3 repeats, 300-story smoke) | $0.2602 | **$0.2118** | batched | `LINK_USE_BATCHES=True` |
| cluster | claude-sonnet-4-6 | telemetry, one batched link run (191 stories → 14 events) | — (n/a) | **$0.2004** | batched | `CLUSTER_USE_BATCHES=True` |
| summarize | claude-haiku-4-5 | telemetry, one batched synthesize run (63 events) | — (n/a) | **$0.2533** | batched | `SUMMARY_USE_BATCHES=True` |

Notes:
- **Link** is the only genuinely empirical case (it has a real ~15k-token cached prefix per NEU-377). Measured A/B: batched is **18.6% cheaper** — the flat 50% batch discount beats the sequential cache reads, even though caching demonstrably works (sequential `cache_read≈289k`, `cache_creation≈15k`).
- **Cluster** and **summarize** were confirmed with a single batched run each (not a full A/B), per the link-focused measurement scope. The decisive observation is that both recorded `cache_read=0` **and** `cache_creation=0`: cluster's prefix is below Sonnet's 2048-token cache floor (NEU-377 removed its dead cache markers) and summarize carries no cache markers at all. With zero caching on either path, the sequential path pays full price for the same input the batched path gets at 50% off — so batched is cheaper by construction. No sequential A/B was run for these two (cost/scope); the structural argument + zero-cache telemetry stand in for it.
- All three paths remain env-overridable (`LINK_USE_BATCHES` / `CLUSTER_USE_BATCHES` / `SUMMARY_USE_BATCHES`). $/run figures are workload-dependent (corpus sizes noted above), not absolute.

### T5 — [backend] Cut link input tokens: roster trim + larger batch size

**Problem:** F3 — the full catalog roster ships once per 15-story chunk; overview text dominates.
**Scope:** trim the roster (shorten `_OVERVIEW_MAX`, and/or drop low-value fields — measure which fields actually aid disambiguation) and raise `LINK_BATCH_SIZE` so the roster ships fewer times. Both changes measured for input-token reduction via T1 and **gated on `validate_linking.py`** (no link-accuracy regression vs baseline).
**Key files:** `link/roster.py` (`_OVERVIEW_MAX=240`, `_render`), `config.py` (`LINK_BATCH_SIZE=15`), `link/linker.py`.
**Acceptance:** measured link input-token reduction; no regression vs the captured `validate_linking.py` baseline; changes documented with before/after token + accuracy numbers.
**Blocked by:** T1 (measure) + eval harness. **Blocks:** none.

### T6 — [backend][spike] Evaluate Haiku for clustering

**Problem:** F4 — cluster on Sonnet is 3× Haiku price; untested whether Haiku holds quality.
**Scope:** confirm a usable cluster-accuracy gate first (see Quality gate); eval `claude-haiku-4-5` vs `claude-sonnet-4-6` on clustering; if quality holds, switch `cluster_model`; otherwise reject with documented evidence.
**Key files:** `config.py` (`cluster_model`), `link/cluster.py`, validation toolchain.
**Acceptance:** eval result documented; `cluster_model` switched (with the ~3× cluster saving measured via T1) **or** explicitly kept on Sonnet with evidence; no cluster-accuracy regression if switched.
**Blocked by:** T1 + eval harness. **Blocks:** none.

**T6 result (measured 2026-06-24): HOLD on Sonnet — do NOT switch cluster to Haiku.**

- **Gate (Finding A confirmed):** no cluster-accuracy ground truth exists (`event_group` populated = 0; only 15 clusterable multi-story beats in the fixture — too thin to label). So the gate is the **Branch (b) Sonnet-vs-Haiku cluster diff** (`scripts/eval_cluster_diff.py`), PASS = all four no-material-regression rules hold.
- **Corpus:** 138 films / 2,332 unclustered linked stories (a real tmdb+feeds+link ingest, then events reset). The harness is **read-only per film** (builds each film's cluster request, calls the model, does not apply decisions), so both models saw an identical corpus with zero pre-existing events; the diff aligns stories by `story_id`, not positional index.
- **Result — gate FAILS (3 of 4 rules):**

  | rule | threshold | result |
  |---|---|---|
  | 1 granularity | ±1/film ≥90%, total ±10% | **FAIL** — Haiku 436 events vs Sonnet 380 (**+15%**); per-film within-±1 87% |
  | 2 attach/new agreement | ≥90% | PASS — 96.3% |
  | 3 no catastrophic merges | 0 | **FAIL** — 52 cases |
  | 4 type/confidence | ≥85% | **FAIL** — 73.9% |
  | *supplementary:* pairwise co-grouping | — | 82.3% (~18% of pairs grouped differently) |

- **Fairness check (is it just the pathological high-volume films?): no — the divergence is broad.** Stratified by film size: small (≤10 stories) Haiku +20% events / 90.8% pairwise; medium (11–30) +17% / 86.9%; large (>30) +6% / 81.8%. Haiku **systematically over-splits beats** in *every* stratum, including the easy ≤10-story films. Large films are bimodal (some 95–98% agreement, several collapse to 47–76%), but the over-splitting holds even where clustering is unambiguous.
- **Cost that was on the table (and rejected):** cluster has **zero caching** on both models (instruction block below Sonnet's 2048 *and* Haiku's 4096 cache floor — F1 / NEU-377), so the saving is the clean per-token ratio: Sonnet $3/$15 vs Haiku $1/$5 = **exactly 3× (~67%)**. Anchor: NEU-378's Sonnet cluster run cost $0.2004 → ~$0.067 on Haiku. Real, but not worth a broad clustering regression — and Haiku's over-splitting would *add* downstream summarize cost (more events → more `event_summary` rows) and a noisier feed.
- **Decision:** **HOLD `cluster_model = claude-sonnet-4-6`.** No code change. The diff measures agreement with the validated incumbent, not absolute correctness (no ground truth exists), so this is "materially diverges from baseline with no evidence Haiku is better" → the conservative no-blind-swap call. Revisit only with (a) a real cluster-accuracy gate (labeled `event_group` ground truth) and/or (b) cluster-prompt tuning to curb Haiku's over-splitting. `CLUSTER_MODEL` remains env-overridable for ad-hoc retests. Harness: `scripts/eval_cluster_diff.py` (branch `tom/neu-380-backend-spike-evaluate-haiku-for-clustering`).

## Dependencies & sequencing

```
T1 ──▶ T2  (admin display)
  ├──▶ T3  (verify/repair cache)        [safe]
  ├──▶ T4  (batch vs sequential)        [safe]
  ├──▶ T5  (roster trim + batch size)   [eval-gated]
  └──▶ T6  (Haiku-for-cluster spike)    [eval-gated]
```

T1 is the only hard blocker. T3/T4 can proceed in parallel once T1 lands; T5/T6 additionally need an eval baseline. Each ticket is one PR (1-PR-1-repo); ship and pause per the per-task PR workflow.

## Out of scope

- **Re-touching the summary prompt for tokens** — NEU-359 / NEU-368 already tightened it for content quality; the summary instruction block is below Haiku's cache floor anyway, so there is no cheap caching win. Marginal upside, real risk of re-opening settled wording.
- **Lowering `max_tokens`** — not a cost lever (billed on generated tokens); the current values are correctness guards.
- **Structured-output / tool-use migration** of the JSON envelopes — a behaviour change, not a cost change; not pursued here.
- **Model upgrades** beyond the specific Haiku-for-cluster test (T6).
- **The MVP Quality Bar milestone** — separate concern; this milestone must not regress it, which is exactly what the T5/T6 gates enforce.

## Risks

- **Cache verification depends on real runs.** T3's confirmation needs a live ingest with telemetry (real key, real tokens). Acceptable — it is a one-off check, and T1 makes it cheap to read.
- **Batch concurrency hides cache behaviour.** If T4 finds batches dominate, the roster-trim win (T5) shifts from "cheap cache reads" to "fewer full-price sends" — the levers interact. T1 telemetry + the per-stage measurement keep this honest.
- **No cluster eval gate.** T6 may surface that cluster accuracy isn't currently measurable; the plan must handle that branch (define a gate or hold the change) rather than swap models blind.

## References

- Audit call sites: `llm/client.py` (`Usage` 24–51, `complete` 133–147, `complete_batch` 149–201, `cached_system_block` 13–16); `link/linker.py:118`; `link/roster.py`; `link/cluster.py`; `synthesize/summarizer.py:17,139`; `synthesize/pipeline.py:55-69,204`; `link/pipeline.py:143`; `config.py:30-42`.
- Telemetry targets: `ingest/models.py:11`, `ingest/runs.py`, `routers/admin_runs.py:18`; FE `pages/AdminIngest.tsx`, `api/runs.ts`.
- Cost math: `scripts/measure_link_cost.py`. Eval: `scripts/validate_linking.py` (+ `export_link_validation_draft.py`, `propose_validation_labels.py`, `diagnose_linking.py`).
- Related shipped tickets: NEU-297 (link cost measurement), NEU-359 / NEU-368 (summary prompt tightening), NEU-278 / NEU-279 (validation fixture / metrics harness).
- Cache floors & batch/cache interaction: Anthropic prompt-caching guidance (Haiku 4.5 = 4096-token min, Sonnet 4.6 = 2048-token min; concurrent requests pay write price).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
