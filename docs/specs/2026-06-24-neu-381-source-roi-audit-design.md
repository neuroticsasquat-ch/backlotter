# NEU-381 — Per-source story-ingestion ROI audit (design)

- **Ticket:** NEU-381 · **Milestone:** LLM Cost & Token Efficiency · **Date:** 2026-06-24
- **Type:** one-off, read-only analysis (no schema change, no behavior change)
- **Consumes:** NEU-375 telemetry (`ingest.run_llm_usage`), merged.

## Problem

Every ingested story — linked **or** rejected — flows through the Stage-1 link classifier, so a
high-volume, low-link source is pure token drag. Historically ~89% of stories are rejected
(e.g. 17,391 rejected vs 2,136 linked). We don't know which sources earn their token cost and
which just inflate input usage. Suspicion is highest for per-film Google News searches, then the
broad Google queries, then any trade RSS feed outside Variety / THR / Deadline.

## Source taxonomy

`story.source` is the attribution key — persisted on every row — so the whole audit is a
`GROUP BY story.source`. The sources (`src/upmovies/news/feeds.py`) fall into four buckets:

| Bucket | `story.source` values |
|---|---|
| **Trusted trades** (the "keep" baseline) | `Variety`, `The Hollywood Reporter`, `Deadline` |
| **Other trade RSS** | `Collider`, `/Film`, `Empire`, `ScreenRant` |
| **Broad Google News** | `Google News: casting`, `Google News: release date`, `Google News: trailer`, `Google News: greenlight` |
| **Per-film Google News** | `Google News: per-film` (one search per tracked film, all under this single label) |

The **trusted-trade set** = {`Variety`, `The Hollywood Reporter`, `Deadline`}. It is the reference
against which every other source's *marginal* value is judged: a source that only re-surfaces what
the trusted trades already give us is waste, regardless of how well it links.

## Value metric (layered)

Per source, the script reports, from cheapest/shallowest to most decision-relevant:

1. **Volume** — stories ingested. The cost driver (more stories → more link-stage chunks →
   more roster re-sends + more output).
2. **Link rate** = `linked / ingested`. Raw signal-vs-noise.
3. **Event rate** = `stories that landed in an event / ingested`. Linked *and actually used*
   (a story can link but never join a clustered event).
4. **Unique events** — events the source contributed to where **no** trusted-trade story also
   contributed. This is the "what we'd have missed without this source" number — the honest ROI
   numerator. (Definition: for each event, collect the sources of its member stories via
   `event_story`; an event is *unique to non-trusted sources* if that set is disjoint from the
   trusted-trade set; attribute it to each non-trusted source that contributed.)
5. **Outlet overlap** — for Google sources only, the % of the source's stories whose resolved
   `story.outlet` is already a trade feed we pull directly. High overlap = paying Google to
   re-surface articles we already have. (Trade RSS sources have `outlet = NULL` by design — the
   fetcher only resolves outlets for Google aggregator feeds — so this column is N/A for them.)

## Cost-attribution method

NEU-375 telemetry is **per-run-per-stage**, not per-source — the link stage batches stories from
all sources into shared chunks, so there is no per-source token line. Attribute the link-stage
cost **proportionally by story volume**:

```
source_link_cost ≈ (source_stories_in_run / total_stories_in_run) × link_stage_cost_usd
```

read from `ingest.run_llm_usage` (rows with `stage = "link"`). This is sound because the link
stage's cost genuinely scales with story count, and **rejected stories cost the same as linked
ones** — which is the entire point, since a noisy source's rejects are the waste being measured.
Reported as an **estimate** (chunk packing isn't perfectly uniform across sources), not per-token
precision. Derived ROI figure: **cost-per-unique-event** = `source_link_cost / unique_events`
(∞ / flagged when a source produces zero unique events — the clearest "cut" signal).

## The script — `scripts/audit_source_roi.py`

Read-only, container-run (`task shell` → `python scripts/audit_source_roi.py`), mirrors the style
of `scripts/measure_link_cost.py` (records nothing to the DB; prints a human table + a
markdown block to paste into this spec). Reads:

- `news.story` — `source`, `outlet`, `link_status`, `film_id`
- `news.event` / `news.event_story` — event membership for event-rate + uniqueness
- `ingest.run_llm_usage` — `stage`, `cost_usd` for cost apportionment

Output: one row per `source`, columns = volume · link_rate · event_rate · unique_events ·
outlet_overlap · est_link_cost · cost_per_unique_event, plus bucket subtotals and a covered
run-id / date-window header for provenance. Optional `--window-days N` / `--run-id <uuid>` to
scope which corpus the numbers cover.

## Corpus & honesty caveats

- Run against the **current DB**: a fresh per-film-enabled feeds run (288 films queried, 1,829
  stories) layered on the ~19k historical stories — so all four buckets, including per-film, have
  attribution. Print the exact story count and date window the numbers cover.
- **Per-film attribution is bucket-level, not per-search**: every per-film hit shares
  `source = "Google News: per-film"`, so we measure the per-film *strategy* in aggregate, which is
  exactly the question ("are per-film searches worth it?").
- **Like-for-like volume matters**: a source seen for only part of the history will look cheap;
  normalize commentary to per-run or per-day where it affects the verdict.
- The cost figure is a **volume-proportional estimate**, restated wherever it's quoted.

## Deliverable & verdict

A markdown ROI table + a **keep / cut / needs-more-data** verdict per source, recorded in this
spec under a "Results (measured YYYY-MM-DD)" section. The verdict is the acceptance artifact.

## Out of scope (deliberate)

Editing `feeds.py` to actually drop sources. The prune is a **fast-follow sub-ticket** gated on
these numbers, keeping measurement and behavior change in separate PRs (1 PR = 1 change),
consistent with the rest of the milestone.

## Acceptance

- `scripts/audit_source_roi.py` runs read-only and prints the per-source ROI table.
- This spec records the table + a keep/cut verdict per source.
- No schema/behavior change; backend CI green (lint + typecheck on the new script).

## Self-review

- **Placeholders:** none — the only deferred values are the measured numbers (filled at run time
  in the Results section), which are intentionally not pre-filled.
- **Consistency:** the trusted-trade set is defined once and used for both the uniqueness metric
  and the outlet-overlap baseline; the cost method is stated once and referenced from ROI.
- **Scope:** single script + spec verdict; the prune is explicitly carved out. Fits one PR.
- **Ambiguity:** "unique event" is pinned to a precise set-disjointness rule against the
  trusted-trade set; "value" is the layered 5-metric stack, not a single ratio.

## Results (measured 2026-06-25)

**Provenance.** `scripts/audit_source_roi.py` run read-only over the full DB (21,356 stories,
window = all history). Events had been cleared from the localdev DB since the last full pipeline
run, so before auditing they were repopulated by a Stage-2-only link run
(`run_id 7cbe067b-9c15-41c9-a6d4-7b311e80538e`, 2026-06-25 — 0 pending stories so Stage-1 no-opped;
clustered the 2,332 already-linked stories into **392 events / 2,272 event_story rows**). The
`total link-stage cost = $1.694726` is summed from the NEU-375-instrumented link runs only (a
**floor**, not the lifetime total) and apportioned over all-history volume — relative shares are
robust, the absolute figure is not.

| source | volume | link_rate | event_rate | unique_events | outlet_overlap | est_link_cost | cost_per_unique_event |
|---|---|---|---|---|---|---|---|
| Deadline | 53 | 18.9% | 17.0% | 0 | N/A | $0.004206 | ∞ |
| Variety | 44 | 4.5% | 4.5% | 0 | N/A | $0.003492 | ∞ |
| The Hollywood Reporter | 41 | 7.3% | 7.3% | 0 | N/A | $0.003254 | ∞ |
| **Trusted trades subtotal** | 138 | 10.9% | 10.1% | 0 | — | $0.010951 | ∞ |
| /Film | 68 | 0.0% | 0.0% | 0 | N/A | $0.005396 | ∞ |
| ScreenRant | 50 | 6.0% | 6.0% | 3 | N/A | $0.003968 | $0.0013 |
| Collider | 50 | 4.0% | 2.0% | 0 | N/A | $0.003968 | ∞ |
| Empire | 24 | 4.2% | 4.2% | 0 | N/A | $0.001905 | ∞ |
| **Other trade RSS subtotal** | 192 | 3.1% | 2.6% | 3 | — | $0.015236 | $0.0051 |
| Google News: trailer | 342 | 34.8% | 34.8% | 17 | 0.3% | $0.027140 | $0.0016 |
| Google News: release date | 295 | 11.9% | 11.9% | 14 | 0.7% | $0.023410 | $0.0017 |
| Google News: casting | 267 | 3.4% | 3.4% | 3 | 0.0% | $0.021188 | $0.0071 |
| Google News: greenlight | 62 | 3.2% | 3.2% | 1 | 0.0% | $0.004920 | $0.0049 |
| **Broad Google News subtotal** | 966 | 17.1% | 17.1% | 35 | — | $0.076658 | $0.0022 |
| Google News: per-film | 20060 | 10.5% | 10.4% | 372 | 0.0% | $1.591881 | $0.0043 |
| **Per-film Google News subtotal** | 20060 | 10.5% | 10.4% | 372 | — | $1.591881 | $0.0043 |

### Headline finding

The going-in suspicion — that per-film Google News is pure token drag and the prime cut candidate —
is **refuted on value**. Per-film is simultaneously the biggest cost driver (20,060 stories = 94% of
volume, $1.59 = 94% of link cost) **and** the biggest value driver: **372 unique events ≈ 91% of all
unique-event coverage** (410 unique-event attributions across the catalog). It is the coverage engine,
not waste. The correct lever for per-film is **efficiency** (recency-window tightening, cross-day
dedup per NEU-372), **not removal**.

### Per-source verdict

| source | verdict | rationale |
|---|---|---|
| Deadline | **keep** | 18.9% link / 17.0% event — best trade. `unique=0` is structural (trades define the uniqueness baseline), not a fail. |
| Variety | **keep** | Baseline trusted trade; cheap. |
| The Hollywood Reporter | **keep** | Baseline trusted trade; cheap. |
| ScreenRant | **keep** | Best trade-RSS ROI ($0.0013/unique, 3 unique events). |
| /Film | **cut** | 0% link over 68 stories — pure noise, zero linked/events. |
| Collider | **cut (lean)** | 0 unique events — only re-surfaces what trusted trades already provide. |
| Empire | **cut (lean)** | 0 unique events; 24-story sample, negligible cost either way. |
| Google News: trailer | **keep** | Best ROI in the audit ($0.0016/unique, 34.8% link). |
| Google News: release date | **keep** | Strong ($0.0017/unique, 11.9% link). |
| Google News: casting | **needs-more-data** | Positive but weak ($0.0071/unique, 3.4% link). |
| Google News: greenlight | **needs-more-data** | 62-story / 1-unique-event sample too thin to judge. |
| Google News: per-film | **keep** | Dominant value (372 unique events); optimize cost, do not cut. |

### Implications for the prune fast-follow

The only clean cut candidates (/Film + Collider + Empire) total ~142 stories and ~$0.011 of
estimated link cost — **cutting them saves essentially nothing**. The prune sub-ticket's prize is
far smaller than the milestone assumed: the real cost lever is making **per-film cheaper**, not
dropping low-ROI feeds. The fast-follow has been **rescoped and filed as NEU-382**
("[backend] Reduce per-film Google News link-stage token spend") — targeting the per-film
rejected-volume waste (measurement-gated), with /Film / Collider / Empire dropped opportunistically
as a quality (not cost) cleanup.

### Secondary observations

- **Outlet overlap ≈ 0%** for every Google source (trailer 0.3%, release date 0.7%, rest 0.0%):
  Google is surfacing a long tail of *other* outlets, not re-selling the seven trade domains we
  already pull directly — i.e. it is additive coverage, which supports keeping the Google feeds.
- `unique_events` summed across sources (410) exceeds total events (392) by design — an event with
  member stories from two non-trusted sources is attributed to both.
