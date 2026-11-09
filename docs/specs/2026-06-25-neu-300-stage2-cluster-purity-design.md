# NEU-300 — Complete M3 validation: Stage-2 cluster-purity baseline + ground-truth refinement

- **Ticket:** [NEU-300](https://linear.app/neuroticsasquatch/issue/NEU-300/be-complete-m3-validation-stage-2-cluster-purity-baseline-ground-truth) · `[backend]` · Project *Movies: Entity Linking & Clustering* · Milestone *M3 — Validation & accuracy baseline*
- **Branch:** `tom/neu-300-be-complete-m3-validation-stage-2-cluster-purity-baseline`
- **Blocked by:** NEU-299 (Done — delivered the Stage-1 baseline + the 286-row labeled set).
- **Related:** NEU-279 / NEU-277 (the metrics-harness and the cluster+classify service). **Gates:** NEU-282 (embeddings/pgvector escalation — its trigger is decided by this baseline). **Reuses ideas from:** NEU-380 (`scripts/eval_cluster_diff.py`, the no-ground-truth A/B cluster harness).
- **Date:** 2026-06-25

## Problem

M3 shipped its plumbing but only half its deliverable. NEU-299 produced the **Stage-1 linking** baseline (precision ~0.99, recall ~0.92–0.95) over a 286-row labeled fixture (`relation`: 187 `none` / 85 `about` / 14 `mention`). The **Stage-2 cluster-purity / dedup** baseline — the other named M3 deliverable — was never produced:

- `link/metrics.py` already has a pure `cluster_purity(clusters, gold_group_by_key)`, but **nothing wires it** — no harness runs Stage-2 and feeds it predicted clusters.
- The fixture's `event_group` field (the gold beat-grouping key) is **null on all 286 rows** — there is no ground truth to score against.

Two pieces remain, per the ticket:

1. **Stage-2 cluster-purity / dedup baseline.** Label `event_group` on the linkable `about` rows, add a Stage-2 harness, run it, record the numbers, and (per the chosen scope) tune the cluster prompt and settle NEU-282 from the result.
2. **Ground-truth refinement.** Re-judge the 2–3 flagged borderline `about`/`mention` rows; if any flip, re-run the Stage-1 baseline and update the recorded numbers.

**Output:** an `event_group`-labeled validation set + a documented Stage-2 cluster-purity baseline + an evidenced NEU-282 keep/escalate decision → M3 fully closed.

## Decisions (locked in brainstorming)

1. **Harness = Approach A (in-memory functional), mirroring `scripts/validate_linking.py`.** The harness reads film metadata (title/year/status) from the live DB **read-only**, builds throwaway in-memory clustering inputs, calls the real `cluster_model` once per film, and scores in memory. It makes **no DB writes** and does not exercise the `apply_cluster_decisions` DB path. Rejected: Approach B (seed a test DB and run the full `run_link_ingest` cluster stage) — heavyweight, and it conflates *clustering quality* with apply-path mechanics that are already separately tested (NEU-365 / NEU-367 / NEU-372).
2. **Scope = the full chain: measure → tune if weak → settle NEU-282.** The decision gate (below) is part of this ticket, not a follow-up.
3. **Metrics = purity (exists) + a new within-film pairwise precision/recall/F1.** Purity catches *over-merging* (different beats in one event); **pairwise recall is the dedup axis** the ticket names (one beat fragmented across events = duplicate update-log entries). A secondary `event_type` classification-agreement number is reported (the data is already labeled) but does **not** gate.
4. **Anti-drift refactor:** extract a pure `assemble_cluster_payload(...)` and a pure `parse_cluster_groups(...)` from `cluster.py`, shared by production and the harness, so the harness measures the *real* prompt/parse, not a copy that can drift.
5. **Anti-anchoring:** the cluster model under test is **Sonnet** (`cluster_model = claude-sonnet-4-6`), so the gold-group proposer uses **Opus** (`claude-opus-4-8`) with a *dedicated labeling prompt* (not the production cluster prompt) — gold independent of the model under test. Fallback: Sonnet proposer with heavier human correction if the account lacks Opus access.
6. **Definition of done (mergeable PR) = code only:** the harness, the pairwise metric, the two pure-function extractions, the labeling proposer, and their unit tests. **Tom's manual pass** (not a merge blocker, mirrors NEU-358 / NEU-367): hand-correct the proposed `event_group`s, run the paid live measurement, do the ground-truth re-judge, and — with the recorded numbers — run the tuning iteration (if triggered) and the NEU-282 call. The baseline numbers and the NEU-282 decision are recorded back into this spec's *Baseline results* section, which closes the ticket.

## The decision gate

Applied after the live measurement (and after one tuning pass, if reached):

| Result | Action |
|---|---|
| Purity ≥ **0.90** AND pairwise-F1 ≥ **0.80** | ✅ Good enough. Record baseline. **NEU-282 stays deferred** (marked "not triggered — baseline met"). M3 closed. |
| Below that, but ≥ purity **0.80** / pairwise-F1 **0.65** | 🔧 One cluster-prompt tuning iteration, then re-measure. Clears the green bar → done; still below → escalate. |
| Below the floor after one tuning pass | 🚨 The LLM-first design can't close the gap by prompt tuning → **scope NEU-282** (embeddings-assisted candidate grouping / similarity dedup). NEU-282 then gets its own spec/plan; this ticket records the trigger evidence. |

Prior expectation: Stage-1 is already P~0.99 / R~0.92–0.95, and NEU-380 found *Sonnet* clusters sensibly (it was *Haiku* that over-split, +15–20% events). So the likely outcome is the green band and NEU-282 staying deferred — but the gate makes that an evidenced call rather than an assumption.

## Architecture

### 1. Pure extractions from `cluster.py` (anti-drift)

Two pure helpers are lifted out of the existing DB-coupled functions; production behavior is unchanged (the existing cluster tests are the regression guard):

- **`assemble_cluster_payload(film_title, film_year, existing_payload, new_payload) -> (system, messages)`** — the prompt-assembly tail of `build_cluster_request` (currently `cluster.py:175–189`). `build_cluster_request` keeps its DB reads (film, unclustered stories, recent events + headlines) and calls this helper to build the request. The harness calls it directly with `existing_payload=[]` (fresh fixture clustering exercises the new-event grouping path — exactly what purity measures) and a `new_payload` built from fixture rows.
- **`parse_cluster_groups(raw) -> list[ClusterGroup]`** — the parse half of `apply_cluster_decisions` (currently the inline `json.loads(_extract_json_object(raw))` + group iteration at `cluster.py:228–245`), returning typed groups `{existing: int|None, type: str|None, confidence: str|None, story_indices: list[int]}` with the same index-validation, **no DB**. `apply_cluster_decisions` consumes it (replacing its inline parse); the harness consumes it to turn the model response into predicted clusters of story indices.

### 2. Pairwise metric (`src/upmovies/link/metrics.py`)

New pure `compute_cluster_metrics(predicted_clusters, gold_group_by_key) -> ClusterMetrics`:

- `predicted_clusters: Iterable[set[str]]` — story keys (URLs) grouped by predicted event.
- `gold_group_by_key: Mapping[str, str | None]` — story key → gold `event_group` slug.
- Returns `ClusterMetrics(purity, pairwise_precision, pairwise_recall, pairwise_f1, n_items, n_predicted_pairs, n_gold_pairs)`.
- **Purity** reuses the existing `cluster_purity`. **Pairwise**: a predicted-positive pair = two keys in the same predicted cluster; a gold-positive pair = two keys sharing a gold slug; `TP` = pairs that are both. `precision = TP / predicted_pos`, `recall = TP / gold_pos`, `f1` = harmonic mean.
- **Invariant that lets pairwise be computed globally:** predicted clusters are within-film (one cluster call per film) and gold slugs are **film-namespaced** (§4), so no pair ever crosses films in either set — cross-film pairs are neither predicted- nor gold-positive and cannot distort precision/recall. The function therefore takes flat collections and needs no film argument.
- `n_predicted_pairs` / `n_gold_pairs` are reported so a thin fixture (few multi-story films) is visible as low statistical power (see *Limitations*).

### 3. Gold-group labeling proposer (`scripts/propose_event_groups.py`)

Mirrors `scripts/propose_validation_labels.py` (propose → human-correct), but for `event_group`:

- Reads the current `validation_set.json`; selects rows where `relation == "about"` AND `is_production_news is not False` AND `expected_film_tmdb_id is not None` (the rows that would actually link and thus cluster). Groups them by `expected_film_tmdb_id`.
- For each film with ≥1 such row, the **Opus** proposer (dedicated labeling prompt: "group these stories into distinct production beats; give each beat a short kebab slug") proposes a beat slug per story. Single-story films get one trivial group.
- Emits the fixture rows with `event_group` filled as **`{tmdb_id}-{beat-slug}`** (film-namespaced → globally unique, satisfying §2's invariant) to stdout, logs to stderr — same I/O contract as the existing proposer. Tom reviews/corrects and saves to `validation_set.json`.
- `PROPOSAL_MODEL = "claude-opus-4-8"`, overridable via the first CLI arg (fallback `claude-sonnet-4-6` + heavier human correction).

### 4. Stage-2 harness (`scripts/validate_clustering.py`)

The Approach-A runner (sibling to `validate_linking.py`):

- Load the fixture; select the gold-labeled clustering rows (`relation == "about"`, `is_production_news is not False`, `event_group is not None`). **Warn** on about-news rows missing `event_group` (un-labeled → excluded from scoring) and print how many films/rows are scoreable.
- Build a `tmdb_id -> (title, year, status)` map from the live DB (read-only, exactly as `validate_linking` builds its roster map). **Warn** on any expected film absent from the DB (it can't be looked up → its rows are skipped).
- For each film: `assemble_cluster_payload(title, year, existing_payload=[], new_payload=[{n, title, summary} ...])`, call `cluster_model` once via `AnthropicClient`, `parse_cluster_groups(raw)`, map each new-event group's story indices → URLs → a predicted cluster.
- Pool predicted clusters across films; `gold_group_by_key = {url: event_group}`. Print `compute_cluster_metrics` (purity + pairwise P/R/F1 + pair counts), the secondary `event_type` agreement (predicted new-event type vs the majority gold `event_type` of its members), and **the gate verdict** (which band the numbers fall in).
- Cost: one Sonnet cluster call per scoreable film — a few dollars at most. Run in-container with a real key, like `validate_linking.py`.

### 5. Ground-truth refinement

Folded into the same labeling session (Tom's manual pass): re-judge the flagged borderline rows on the merits — Famke Janssen / *Avengers: Doomsday* (already `about` + `is_production_news: false`; confirm it shouldn't be `mention`), Tom Holland "Repay The Favour" / *Spider-Man*, and the *Doomsday* cast-member set piece. If any `about`↔`mention` flip results, re-run `validate_linking.py` and update the recorded Stage-1 numbers (in the NEU-299/entity-linking spec and here).

## Components & files touched

| File | Change |
|---|---|
| `src/upmovies/link/cluster.py` | Extract pure `assemble_cluster_payload(...)` (from `build_cluster_request`) and `parse_cluster_groups(...)` (from `apply_cluster_decisions`); both callers now use them. Behavior unchanged. |
| `src/upmovies/link/metrics.py` | New pure `compute_cluster_metrics(...)` + `ClusterMetrics` dataclass (purity reuses `cluster_purity`; adds within-film pairwise P/R/F1). |
| `scripts/propose_event_groups.py` | **New.** Opus proposer that drafts film-namespaced `event_group` slugs for the `about` + production-news rows. |
| `scripts/validate_clustering.py` | **New.** Approach-A Stage-2 harness: per-film cluster call → purity + pairwise P/R/F1 + type agreement + gate verdict. |
| `tests/fixtures/link/validation_set.json` | `event_group` filled on the linkable `about` rows (Tom's hand-corrected proposer output); any borderline `about`/`mention` flips. |
| `tests/fixtures/link/README.md` | Document `event_group` semantics + the film-namespaced slug convention + the clustering-row selection rule. |
| `tests/unit/link/test_cluster.py` | Focused tests for the extracted `assemble_cluster_payload` / `parse_cluster_groups` (existing build/apply tests remain the behavior-unchanged guard). |
| `tests/unit/link/test_metrics.py` | `compute_cluster_metrics`: perfect grouping → 1.0/1.0/1.0; over-merge → low pairwise precision; over-split → low pairwise recall (the dedup case); pair-count reporting. |

## Testing (TDD, one backend PR)

Write each failing test first, in the container via `task test`:

1. **`assemble_cluster_payload`** — given a film + an `existing_payload` + a `new_payload`, returns the same `(system, messages)` the production `build_cluster_request` produced before extraction (a pinned-shape test); `existing_payload=[]` yields a well-formed new-stories-only request.
2. **`parse_cluster_groups`** — a valid response parses into typed groups; a truncated/unparseable response returns `[]` (mirrors today's tolerant behavior); out-of-range / duplicate story indices are dropped, matching the current `apply_cluster_decisions` validation.
3. **`compute_cluster_metrics`** — on hand-built clusters: a perfect match scores purity = pairwise-P = pairwise-R = pairwise-F1 = 1.0; merging two gold beats into one cluster drops pairwise precision (purity too); splitting one gold beat into two clusters drops pairwise recall while purity stays 1.0 (proving the two metrics are complementary); `n_predicted_pairs` / `n_gold_pairs` are correct.
4. **Behavior-unchanged guard** — the existing `build_cluster_request` / `apply_cluster_decisions` integration tests still pass against the refactored internals (no behavior change from the extraction).

All of `task test`, `task lint`, `task typecheck`, `task format` must be green before the PR (full CI locally, per house rules).

## Baseline results (measured 2026-06-25)

Gold `event_group`s hand-corrected via a localdev review UI (`scripts/build_eventgroup_review.py`); 75 about-news rows → 57 scoreable after the ground-truth not-news exclusions. Model = Sonnet `cluster_model`.

**Production-faithful baseline** — `scripts/validate_clustering.py` (clusters only newsworthy rows, mirroring production):

- Scoreable: **26 films / 57 rows / 138 gold pairs**.
- purity **1.000** · pairwise precision **1.000** / recall **1.000** / F1 **1.000** · event_type agreement **1.000** → **GATE: GREEN**.
- **Caveat — purity & precision are degenerate on this run.** 24/26 films are single-beat, and a single-beat film cannot lower purity or precision (every within-film pair is trivially correct; clusters are built per-film). Only **recall** carries real signal here, and it is genuine: the model kept the 15-story Spider-Man trailer, Shrek's 7, and Hexed's 4 each in **one** event — no over-splitting, so the dedup / duplicate-events failure mode does not occur (including on a high-volume film, the NEU-365 concern).

**Over-merge diagnostic** — `scripts/validate_clustering_overmerge.py` (clusters a film's *full* about-set with each distinct piece as its own singleton gold beat, so over-merge is testable). Run on Spider-Man, the one fixture film with a multi-story beat **plus** several distinct distractors (23 rows = a 15-story trailer beat + 8 singletons):

- purity **0.826** · precision **0.913** / recall **1.000** / F1 0.955.
- The model kept the trailer beat **perfectly pure** (no contamination, no split) and separated the Punisher casting item, but **lumped 5 distinct interview/promo `other` pieces into one event** — the sole precision hit.

**Interpretation:**

- **Over-split / dedup (the motivating concern): validated** — recall 1.0 on real multi-story beats.
- **Over-merge: real but low-impact** — confined to heterogeneous `other` pieces, which (a) Stage-1 (NEU-358/367) filters *before* clustering and (b) NEU-367 hides from the public surface even if leaked. Genuine production beats (trailer, casting) cluster cleanly.

**NEU-282 decision: DEFERRED — not triggered.** No clustering problem reaches the product; the over-merge that exists is on filtered + hidden rows; and embeddings would not fix it anyway (it is a prompt-granularity behavior, not a candidate-generation / recall gap — the lever, if ever needed, is cluster-prompt tuning). **M3 closed.**

## Limitations

- **Statistical power depends on the fixture's multi-story films.** Pairwise metrics only get signal from films with ≥2 linkable `about` rows; single-story films are trivially pure and contribute no pairs. The harness prints `n_gold_pairs` / scoreable-film count so a thin baseline is visible. **If scoreable pairs are too few to be conclusive, the result is treated as directional only** — we lean on NEU-380's broader Sonnet-vs-Haiku agreement evidence and **keep NEU-282 deferred** rather than escalate on thin data. Expanding the gold set (label `event_group` on a larger sample, or seed from a real production run) is the fallback if a firm number is needed, and would be its own follow-up.

## NEU-445 re-measure (2026-06-30)

After adding the dominant-beat precedence rule to the cluster prompt and the Angry Birds
first-look gold event:

- purity=1.000  pairwise f1=1.000  event_type agreement=1.000
- GATE: GREEN — good enough; NEU-282 stays deferred (not triggered).
- Angry Birds Movie 3 first-look event predicted type: trailer (was casting) ✓

Note: two prompt-wording iterations were required. The initial "dominant-beat" rule (NEU-445 Task 1)
was insufficient — the model still classified the Angry Birds animated character-design reveal as
"casting" because the headlines led with voice-cast names. A more specific rule distinguishing
animated/CGI character-design reveals ("in-film content" → "trailer") from live-action actor
costume stills ("promotional still" → "other") fixed both the Angry Birds case and preserved the
existing Man of Tomorrow "other" classification. Final harness run: 27 scoreable films / 60 items /
141 gold pairs; 29 new events, all types correct.

## Out of scope

- **Approach B** (seeded-DB full-pipeline harness) and any exercise of the `apply_cluster_decisions` DB path / dedup / stale-stage gate — covered by NEU-365 / NEU-367 / NEU-372.
- **Implementing NEU-282.** Only the *decision* (and, if triggered, the scoping handoff) lives here; the embeddings work is its own spec/plan.
- **A generic production-data cluster evaluator.** `eval_cluster_diff.py` (NEU-380) already covers the no-ground-truth A/B; this ticket is the gold-based fixture eval.
- **Tom's manual pass:** hand-correcting `event_group`s, the paid live measurement, the ground-truth re-judge, the tuning iteration (if triggered), and the NEU-282 call.
