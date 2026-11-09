# Ingestion Cadence & Feed-Source Architecture — Design

- **Date:** 2026-06-20
- **Status:** Draft (pending Linear scoping)
- **Component:** `upcoming-movies-backend` — `news` feed pipeline, ingestion scheduling, `link` pipeline cost
- **Linear:** project *Movies: Ingestion & Feeds*. Milestones: *Film-category feeds* (NEU-291) · *Cadence split (hourly ingest / daily link)* (story NEU-289 → NEU-292/293/294) · *Batches API link-cost optimization* (story NEU-290 → NEU-295/296/297/298)
- **Builds on:** [2026-06-20-feed-recency-hygiene-design.md](2026-06-20-feed-recency-hygiene-design.md), [2026-06-20-per-film-google-news-implementation-design.md](2026-06-20-per-film-google-news-implementation-design.md), [2026-06-19-entity-linking-clustering-design.md](2026-06-19-entity-linking-clustering-design.md)

## What this is

A set of ingestion-layer changes surfaced by the first full end-to-end pipeline test
(truncate → TMDB → feeds → link) on 2026-06-20. The pipeline *works* — 235 films, 11.8K
stories, 575 stories linked across 97 films with zero failures — but the test exposed three
structural issues in **how and how often we pull stories**, none of which the linking layer
can fix:

1. **Capped trade feeds rotate faster than our 24h pull.** The trade RSS feeds return only
   the most recent ~10–20 items each. High-volume publishers (Deadline, Variety, THR) push
   far more film-relevant posts than that per day, so anything published *and scrolled off*
   between two daily ingests is lost forever. A daily cadence structurally drops trade
   stories.
2. **Whole-site feeds flood the linker with non-film noise.** We ingest `deadline.com/feed/`
   et al. — the *entire site* (TV, music, awards, business, theater, obituaries). Every
   off-topic story is then shipped to Haiku to classify and reject, burning tokens on
   content we could have filtered at the source for free.
3. **Daily ingestion couples two cadences that want to differ.** The expensive LLM link pass
   only needs to run once a day, but feed *ingestion* needs to run far more often to beat
   feed rotation.

The fix is three independent workstreams: **swap whole-site feeds for film-category feeds**
(cut noise at source), **split ingestion cadence from linking cadence** (hourly feeds, daily
link), and **move the daily link pass to the Batches API** (50% cost). This document is the
design; per-ticket TDD implementation plans go in `docs/plans/` during the Linear scoping
pass, consistent with the Entity-Linking work.

## Decisions

| Question | Decision |
|---|---|
| Trade feed sources | **Switch whole-site → film-category feeds** for Deadline, Variety, THR, /Film (all verified live, see Supporting data). Collider & ScreenRant (Valnet CMS) expose no category feed at the obvious paths — **keep whole-site**, flagged for later taxonomy work. Empire is already a film-centric aggregator — unchanged. |
| Ingestion cadence | **Hourly** for the light feed set (trade category feeds + the 4 broad Google queries) — ~11 requests/run. This beats the ~10–20-item feed cap. |
| Per-film Google queries | **Stay daily.** A single film rarely publishes faster than its feed window, so per-film queries are *not* rotation-vulnerable; and 235 films × hourly ≈ 5.6K Google requests/day risks throttling/CAPTCHA (the fetcher already aborts the per-film phase on a block). |
| Linking cadence | **Unchanged — once daily.** Ingestion frequency is decoupled from it. |
| De-duplication | Rely on the **existing unique-`url` constraint + `ON CONFLICT DO NOTHING`**. This makes hourly re-pulls of an overlapping `when:Nd` window free and idempotent — no schema change needed. |
| Recency windows | Shrink both: feed ingest gate `FEED_RECENCY_DAYS` 14 → **3**; link window `LINK_RECENCY_DAYS` 45 → **4** (kept ≥ feed window, with a 1-day margin, so a story published near the window edge but ingested late still links). |
| Link pass cost | **Migrate the daily link pass to the Batches API** (flat 50% discount), and **measure** the interaction with prompt caching rather than assuming it strictly wins (see Batches workstream). |

## Architecture — two scheduled jobs

Today: one GitHub Actions workflow (`daily-ingest.yml`, cron `0 9 * * *`) runs
`tmdb → feeds → link` sequentially, trigger-then-poll against the prod API. We split it:

```
 hourly-feeds.yml  (cron '0 * * * *')
   └─ POST /admin/ingest/feeds?per_film=false
        └─ Phase A only: trade category feeds + 4 broad Google queries
           (~11 requests; dedup on url → near-free re-pulls)

 daily-pipeline.yml  (cron '0 9 * * *')   [renamed from daily-ingest.yml]
   └─ POST /admin/ingest/tmdb            → refresh catalog.film (roster)
   └─ POST /admin/ingest/feeds?per_film=true
        └─ Phase A (trade+broad, mostly deduped) + Phase B (per-film, 235 queries)
   └─ POST /admin/ingest/link            → daily LLM link + cluster pass
```

Key properties:

- **No "per-film-only" code path is needed.** The existing `run_feeds_ingest` already runs
  Phase A (trade+broad) unconditionally and Phase B (per-film) only when `per_film_enabled`.
  Hourly runs with `per_film=false` (Phase A only); the daily run uses `per_film=true`
  (Phase A again — cheap, fully deduped — plus Phase B). The only API change is making
  `per_film` an **invocation-level override**, not just a global setting.
- **Idempotency comes for free** from the unique-`url` index. The hourly job re-fetching the
  same `when:3d` Google window every hour inserts only genuinely new URLs.
- **Concurrency guard:** the daily job at 09:00 collides with the hourly job at 09:00. Put
  both workflows in a shared Actions `concurrency` group (`group: upmovies-ingest`,
  `cancel-in-progress: false`) so they queue rather than run two `feeds` ingests at once.
  (Dedup makes a double-run safe but wasteful; the group avoids it.)

## Feed-source changes (`news/feeds.py`)

Replace the `_TRADE_FEEDS` URLs with film-category feeds where they exist. **Every candidate
URL must be re-verified at implementation** — feed paths 404 readily (cf. Empire's dead
`/movies/news/feed/`), and a swap to a 404 silently zeroes that source.

| Source | Current (whole-site) | New (film-category) | Verified 2026-06-20 |
|---|---|---|---|
| Deadline | `deadline.com/feed/` | `deadline.com/v/film/feed/` | ✅ 200, RSS, items |
| Variety | `variety.com/feed/` | `variety.com/v/film/feed/` | ✅ 200, RSS, items |
| The Hollywood Reporter | `hollywoodreporter.com/feed/` | `hollywoodreporter.com/c/movies/feed/` | ✅ 200, RSS, items |
| /Film | `slashfilm.com/feed/` | `slashfilm.com/category/movies/feed/` | ✅ 200, XML, items |
| Collider | `collider.com/feed/` | — (no category feed found) | keep whole-site, flag |
| ScreenRant | `screenrant.com/feed/` | — (no category feed found) | keep whole-site, flag |
| Empire | (aggregator) | unchanged | n/a |

The 4 broad Google queries (`movie casting`, `movie release date`, `movie trailer`,
`movie greenlight`) stay — they're already movie-scoped by the literal word "movie" — but
they remain the most 100-result-cap-prone source (see below) and are candidates for future
removal once per-film coverage is proven sufficient (Deferred).

## Recency model (`config.py`)

The link query gates on `coalesce(published_at, fetched_at)`. With hourly ingest + daily
linking, the windows must satisfy: **link window ≥ feed window ≥ (ingest gap + publish lag)**.

| Setting | Old | New | Rationale |
|---|---|---|---|
| `FEED_RECENCY_DAYS` | 14 | **3** | Sets the `when:Nd` Google filter + the `published_at` ingest gate. 3 days covers the hourly cadence with generous margin. |
| `LINK_RECENCY_DAYS` | 45 | **4** | Must be ≥ feed window so every ingested story is link-eligible at the daily run; the +1 margin absorbs the daily-run timing offset and clock skew, closing the "ingested-but-never-linked" race. |

This formalizes the operational model the test validated: a tiny window plus frequent
ingestion converges fast, and stories older than ~3 days are either pre-app or already in
the corpus from a prior pass.

## API change — feeds trigger

`POST /admin/ingest/feeds` gains an optional `per_film` query parameter that overrides
`settings.feeds_per_film_enabled` for that invocation:

- `per_film=false` → Phase A only (hourly job).
- `per_film=true` → Phase A + Phase B (daily job).
- omitted → falls back to the configured default (current behavior).

`trigger_feeds` passes the resolved value into `_background_feeds → run_feeds_ingest`
(which already takes `per_film_enabled`). No change to the fetcher's internals.

## Batches API cost optimization

Migrate the daily **Stage-1 link** pass from sequential `messages.create` calls to the
**Message Batches API** (`client.messages.batches.create` → poll `retrieve` → `results`).
The daily link pass is not latency-sensitive (it runs once, off a cron, with a ~60-min
budget), so it's an ideal batch workload: flat **50% discount** on all tokens, batches
typically complete well within an hour, and the API supports prompt caching inside a batch.

Implementation shape:

- Extend the `AnthropicClient` wrapper (currently only `complete()`) with a batch surface —
  e.g. `complete_batch(requests) -> dict[custom_id, text]` wrapping
  `messages.batches.{create,retrieve,results}`, with `custom_id = story-batch index`.
- `run_link_ingest` Stage 1 builds all N batch requests up front (each = the cached roster
  system block + one story batch), submits one batch, polls to terminal, then applies the
  floor logic + mutates story state per result — **identical resolution rules** to the
  sequential path (`about` + `film_id` + `confidence ≥ floor` → linked; else rejected with
  the same `link_note`). Idempotency and the no-decision fallback are preserved.
- **Stage 2 (clustering, Sonnet, per-film) extension:** the per-film cluster calls are
  mutually independent and can also be batched — but they depend on Stage-1 results being
  committed first (they read `linked` stories). So: batch Stage 1 → await → commit → batch
  Stage 2 → await → commit. Scope Stage-1 batching as the primary deliverable; Stage-2
  batching as a follow-on in the same milestone.

**Caveat to measure, not assume.** Prompt caching and batch fan-out interact non-trivially:
a cache entry only becomes readable once the first response begins, so N batch requests with
the same roster prefix running concurrently may each *write* the cache rather than read it,
eroding the caching win that the current sequential path enjoys (~85–90% off the roster
tokens on calls 2..N). The batch discount is a flat 50% on everything; sequential caching
saves a lot but only on the roster portion. Net cost depends on the roster-token share of
each request. **The milestone includes a measurement task: compare measured cost of
(sequential + caching) vs (batch + whatever caching survives) on a representative run before
committing to batches as the default.** Gate the switch behind a `link_use_batches` config
flag (default keeping the proven sequential path until the measurement lands).

### Measurement results (NEU-297, 2026-06-22)

**Corpus:** 300 stories, 20 chunks (batch_size=15), model=claude-haiku-4-5, 3 repeats.
**Rates used:** Haiku 4.5 — $1.00/MTok input, $5.00/MTok output (verify against current Anthropic pricing; token counts below are the authoritative source of truth).
**Run date:** 2026-06-22. Nonce isolation: unique UUID prefix per path per repeat (each run starts cold; cache warms within a run only).

## Link cost measurement

- runs per path: sequential=3, batched=3
- sequential mean per run: input_tokens=108997 output_tokens=18069 cache_read_input_tokens=290187 cache_creation_input_tokens=15273
- batched mean per run:    input_tokens=108997 output_tokens=18728 cache_read_input_tokens=162911 cache_creation_input_tokens=142542
- sequential mean $/run (full rates):  $0.2475
- batched mean $/run (50% batch disc.): $0.1986
- batched vs sequential: +19.8% (positive = batched cheaper)

| path | mean input | mean output | mean cache_read | mean cache_creation | mean $/run |
|---|---|---|---|---|---|
| sequential | 108997 | 18069 | 290187 | 15273 | $0.2475 |
| batched | 108997 | 18728 | 162911 | 142542 | $0.1986 |

**Cache split interpretation:** Sequential achieves near-perfect cache warming — only 1 chunk writes the roster cache (cache_creation ≈ 15k) while the remaining 19 read it (cache_read ≈ 290k). Batched shows a mixed profile — concurrent requests race to write the cache, resulting in ~9 writes and ~11 reads per run. The 5-minute ephemeral cache TTL means intra-batch caching is partially effective but not as clean as sequential's serial warm-up.

**Wall-clock:** Sequential ~182s/run. Batched: 396s (repeat 1, API cold), 77s (repeats 2–3). All 3 batch runs completed well within the 60-min budget.

**Decision: flip `link_use_batches` default → `True`.** Batched is 19.8% cheaper than sequential despite more cache-creation tokens, because the 50% batch discount outweighs the additional write overhead. The margin is consistent across all 3 repeats with no overlap in the run-to-run spread. Batch wall-clock is well within budget.

## Config summary (`config.py`)

- `FEED_RECENCY_DAYS`: 14 → **3**
- `LINK_RECENCY_DAYS`: 45 → **4**
- New: `link_use_batches` (bool, default `false` until the cost measurement lands, then flip).
- No new required env.

## Testing (TDD)

- **Feed sources:** `FEED_SOURCES` point at the new category-feed URLs; a `parse_feed` test
  against a captured category-feed sample asserts entries parse (mock the fetch; never hit
  the live network). A test that each configured URL is well-formed.
- **Feeds trigger:** `per_film` query override flows through `trigger_feeds` →
  `run_feeds_ingest` (mock the ingest); omitted param falls back to the configured default.
- **Recency:** with `FEED_RECENCY_DAYS=3`, `drop_stale` excludes stories older than 3 days;
  the link selection with `LINK_RECENCY_DAYS=4` includes a story published 3.5 days ago but
  fetched today (the race case).
- **Batches:** the Stage-1 link pipeline builds N batch requests, submits, and applies
  results to story state with the *same* floor/`link_note` outcomes as the sequential path;
  a fake/mocked batches client (per repo convention — no live API); re-run idempotency holds
  (already-`linked`/`rejected` stories aren't reprocessed).
- `task test`, `task lint`, `task typecheck` green; `task format` first. Commit normally
  (pre-commit hooks delegate into the container — no `--no-verify`).

## Delivery plan (milestones)

Sub-issues 1-PR-each, backend. Final ticket shapes set in the Linear scoping pass (Story-
labeled parents, per-stack split, blocker wiring, assignee = the user).

- **M1 — Source quality (noise reduction).** Swap whole-site → film-category feeds for
  Deadline/Variety/THR//Film (verified URLs); keep Collider/ScreenRant whole-site, flagged.
  *Output:* fewer non-film stories ingested → smaller, cleaner link workload.
- **M2 — Cadence split.** `per_film` override on the feeds trigger; new `hourly-feeds.yml`
  workflow; rename/retarget `daily-ingest.yml` → `daily-pipeline.yml`; recency-window config
  retune (feed 3 / link 4); shared Actions `concurrency` guard. *Output:* hourly ingest +
  daily link; trade-feed rotation no longer drops stories. Depends on M1 (feed sources) only
  loosely — can proceed in parallel, but the recency retune is most meaningful once sources
  are clean.
- **M3 — Batches API cost optimization.** `AnthropicClient` batch surface; Stage-1 link via
  Batches behind `link_use_batches`; cost measurement (sequential+caching vs batch);
  (extension) Stage-2 clustering via Batches; flip the default once measured. *Output:* ~50%
  link cost, validated. Depends on the link pipeline (already shipped); independent of M1/M2.

## Out of scope / Deferred

| Deferred item | Home | Rationale |
|---|---|---|
| Collider/ScreenRant (Valnet) film-category feed discovery | Ingestion & Feeds | Needs their CMS taxonomy; no category feed at obvious paths. Keep whole-site meanwhile. |
| Dropping the 4 broad Google queries in favor of pure per-film coverage | Ingestion & Feeds | Measure per-film coverage sufficiency first; broad queries are the 100-cap-prone source. |
| Sub-hourly / event-driven ingestion | Ingestion & Feeds | Hourly is sufficient for the observed feed cap; revisit only if a source proves to rotate faster than 1h. |
| Credits/cast ingestion (linking recall) | Ingestion & Feeds | Already deferred in the Entity-Linking spec. |
| Validation-set population & accuracy baseline | Entity Linking & Clustering | `validation_set.json` is empty; seed it from a real run (`export_link_validation_draft.py`) and hand-label — separate effort. |

Also out of scope: Synthesis, any film/event-serving API or FE reads, and the synthesized
summary text. No frontend changes are required by this plan.

## Supporting data (full-pipeline test, 2026-06-20, local corpus)

**TMDB:** 235 films upserted, 78 skipped (excluded status), 0 failed (~80s).

**Feeds** (14-day window, per-film on): **11,834 stories**, 11 feeds OK, 235 films queried,
0 failed (~5.9 min). By source: per-film 11,353 · broad release-date 100 · broad casting 100
· broad trailer 95 · Empire 59 · broad greenlight 55 · /Film 20 · Deadline 12 ·
ScreenRant 10 · Variety 10 · Collider 10 · THR 10. Per-film dominates (~96%); the trades
contribute only 10–59 each.

**Recency distribution** (by `published_at`): ≤1d 822 · ≤2d 2,094 · ≤3d 3,370 · ≤7d 6,944
of 11,834. Pruned to the 2-day operational window → **2,093 stories**.

**Link pass** (2-day corpus, floor 0.7, Haiku link / Sonnet cluster): Stage 1 processed
2,093, **575 linked (27.5%)**, 1,518 rejected, **0 failed**, across **97 distinct films**.
(The 27.5% link rate is far above the ~13% naive-title-match / ~87%-rejection figure from
the greenfield 620-story corpus — because the per-film Google queries are film-targeted, so
a much higher fraction of ingested stories genuinely match.) Stage 2 clustering then
produced **197 events from 574 linked stories across 97 films**, 0 failures — confirming
the per-film event segmentation works at corpus scale.

**Feed-cap probe** (2026-06-20, identifying UA): every trade feed — whole-site *and*
film-category — returned only ~10–20 `<item>`s (Deadline 12, Variety 10, THR 10,
ScreenRant 10, /Film 20). Film-category feeds verified live (HTTP 200, RSS/XML) for
Deadline `/v/film/feed/`, Variety `/v/film/feed/`, THR `/c/movies/feed/`, /Film
`/category/movies/feed/`. Collider and ScreenRant (both Valnet) returned `text/html` or 404
at `/movie-news/feed/` and `/tag/movie-news/feed/` — no category feed at the obvious paths.
The uniform ~10–20-item cap is the direct evidence that a 24h pull rotates trade stories
out before we see them.
