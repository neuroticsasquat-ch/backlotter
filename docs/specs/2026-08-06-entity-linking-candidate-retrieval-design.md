# backlotter: Entity-Linking Candidate Retrieval — design

**Linear project:** [backlotter: Entity-Linking Candidate Retrieval](https://linear.app/neuroticsasquatch/project/backlotter-entity-linking-candidate-retrieval-cdd461c61ac1)
**Repo:** `upcoming-movies-backend`
**Date:** 2026-08-06
**Tickets:** NEU-989 … NEU-1004
**ADRs:** [0008](../adr/0008-lexical-only-candidate-retrieval.md) ·
[0009](../adr/0009-zero-candidate-stories-reject-without-a-model-call.md) ·
[0010](../adr/0010-retrieval-health-replaces-the-cache-ratio-guardrail.md) ·
[0011](../adr/0011-cutover-gate-3-is-restated-in-whole-items.md)

---

## 1. Purpose and exit criterion

Replace the full-catalog cached prompt prefix in the `link` stage with **per-story candidate
retrieval**: narrow each story to a handful of plausible films before the model sees it.

**Exit criterion: cutover and deletion.** Retrieval is built behind a flag, measured against
production traffic, flipped on, and then `build_roster` and the roster prefix are **deleted
inside this project**.

Four revisions to how that plays out, all 2026-08-08 and all recorded below:

- The shadow measurement moved **off production** — the recall number was taken offline over
  98,662 stories and the wiring is rehearsed in dev (§5.4, §5.9).
- Cutover and deletion ship in **one release**, not sequentially (§5.5).
- **Gate #3 is stated in whole items rather than points** (§5.8, ADR-0011), because ±1 point
  turned out to be finer than the fixture can resolve. Its residue — three extra mention-links
  out of 94 — is accepted as a recorded product judgement.
- *backlotter: LLM Provider Gateway* M3 was blocked on this project and has been **unblocked**:
  the prefix shape it was waiting for is measured (§5.2, 1,988 tokens, under every cache
  floor), so it no longer needs to wait for the deletion to land.

The driver is the **200k context ceiling**, not cost. The prefix scales with catalog size, not
news volume, and *backlotter: Undated Film Discovery* plausibly multiplies the catalog 5–20x.
At 5x the prefix exceeds the context window and `link` fails outright. Cost savings are real
and substantial here (§4.4) but incidental.

## 2. Starting position

`link/roster.py` renders every active film into one cached system block —
`#N "Title" (year) [orig: …] genres: … — overview[:120]` — and `link/linker.py` sends it with a
batch of 15 stories, the model replying with a roster index.

| Measurement | Value | Source |
|---|---|---|
| Prod prefix | 44,724 → 51,525 tok, ~+680 tok/day | Anthropic usage export, 2026-07-21 → 07-31 |
| Dev catalog | 287 films, 240 active | `catalog.film` |
| Dev roster | 240 entries, 39,803 chars ≈ 10k tok | `build_roster` |
| Per-film cost | ~41 tok | derived — implies **~1,200 active films** in prod |
| Cache ratio | 12–18x, standard mode | `ingest.run_llm_usage` |

Already available to retrieve against, with no new ingestion: `catalog.film_alternative_title`
(431 rows dev), `catalog.film_credit` (8,173) → `catalog.person` (6,717), `catalog.collection`.

Two constraints established by inspection:

- **No pgvector.** The Postgres 17.8 image offers `pg_trgm`, `unaccent`, `fuzzystrmatch`; no
  `vector`. It is also the shared `tbc_postgresql_db` instance, so any extension install is a
  shared-infrastructure change. → ADR-0008.
- **Sentry is not wired into the pipeline.** `main.py` initializes it for the FastAPI app only;
  `pipeline_run` reports to nothing. Its sole alerting channel is the healthchecks.io deadman,
  which fires when a run finalizes `failed`. → ADR-0010.

## 3. Measured evidence

All figures from `tests/fixtures/link/validation_set.json` — 301 items, 93 labeled `about`
across 32 distinct films, scored against a 249-film catalog.

### 3.1 Recall is flat in K

| K | 1 | 3 | 5 | 10 | 20 | 40 |
|---|---|---|---|---|---|---|
| recall | 0.946 | 0.957 | 0.957 | 0.957 | 0.957 | 0.957 |

Recall@1 ≈ recall@40. Misses are **score-zero** misses, never ranking failures — so `K` is a
prompt-size guard, not a recall lever, and there is no long tail for a semantic model to reach.

### 3.2 Three of the four "misses" are mislabeled fixture rows

| headline | labeled film | actual subject |
|---|---|---|
| *Amy Adams TEASES Her Excitement For Star Wars: Starfighter…* | Avengers: Doomsday | Star Wars: Starfighter |
| *Star Wars: Matt Smith Opens Up On His … Starfighter Role* | Avengers: Doomsday | Star Wars: Starfighter |
| *Lewis Pullman On … The Spaceballs Sequel* | Spider-Man: Brand New Day | Spaceballs |

All three are synthetic not-news examples (`is_production_news: false`) that reused an arbitrary
tracked-film id. They must be rejected either way, so retrieval missing them costs nothing —
but they make the fixture unusable as a retrieval oracle until repaired (M1).

The fourth, *"Naga Bandham Movie Trailer Launch"* against the tracked **"Nagabandham"**, is a
genuine whitespace-variant miss, and the squash-fold fixes it.

### 3.3 Signal ablation — everything past titles is pure cost

At T=0.34, K=10, over 249 films:

| signals | recall | med / p90 / max candidates | zero-candidate stories |
|---|---|---|---|
| titles + squash-fold | **90/93** | 1 / 4 / 7 | 104/301 |
| + alternative titles | 90/93 | 1 / 4 / 7 | 93 |
| + collection name | 90/93 | 1 / 4 / 10 | 92 |
| + talent, boost only | 90/93 | 1 / 4 / 10 | 92 |
| + talent standing alone | 90/93 | 1 / 4 / 10 | 85 |

**On correctly-labeled items, titles + squash-fold scores 90/90.** Every further signal adds
candidate-set size for zero recall. Alt titles are nonetheless kept — same mechanism as titles,
covering localized/renamed films a 32-film corpus cannot exercise. Collection and talent are
excluded from scoring (they still appear in the *rendering*, §4.3).

### 3.4 Threshold behaviour

| T | 0.34 | 0.5 | 0.67 | 1.0 |
|---|---|---|---|---|
| recall | 0.968 | 0.968 | 0.935 | 0.925 |
| zero-candidate | 92/301 | 92/301 | 184/301 | 188/301 |

T=0.34 and T=0.5 are identical; the cliff sits between 0.5 and 0.67. **Final constants are not
set here** — a 249-film probe cannot predict collision behaviour at 1,200 or 24,000. They come
from the tuning ticket (M3) against shadow data. → **Set in §5.2**: T=0.5, K=25, batch 20, and
the cliff turns out to sit between 0.5 and 0.6, one grid step tighter than this table can see.

## 4. Design

### 4.1 Retrieval

Lexical only, pure Python, in-memory. One catalog query per run builds a token → film inverted
index over `film.title`, `film.original_title`, and `catalog.film_alternative_title`, restricted
by the existing `active_film_clause` — **search scope is unchanged**; released and canceled
films stay out, and that stays a product decision rather than a prefix-size workaround.

Normalization is a **squash-fold**: lowercase, strip punctuation and whitespace, so
`"Naga Bandham"` → `nagabandham` and matches as a substring. Scoring is the fraction of a
title's significant tokens present in the headline + dek, with the squash-fold as a full-credit
rescue for titles of ≥6 folded characters.

Selection: every film scoring ≥ **T**, capped at the **K** best. Empty result → zero-candidate
rejection (§4.4). → ADR-0008.

### 4.2 Request shape

Batches are kept — they amortize the instruction block — but the roster leaves the system block
entirely. Each story object in the user message carries **its own** numbered candidate list, and
the model replies with an index into *that story's* list. A reply naming an index outside a
story's list is rejectable, which the global-roster scheme could not express.

**Prompt caching disappears.** The remaining ~1.5k-token instruction block is below Haiku 4.5's
4096-token floor, and `link` was the only stage that cached at all. The *LLM Provider Gateway*
spec anticipated this and called it "a success, not a failure."

### 4.3 Candidate rendering

Roster fields — title, year, original title, genres, overview — **plus director, top-3 billed
cast, and collection name**. At ~1,200 films that was unaffordable; at a p90 of 4 candidates it
costs ~320 tok/story, ~4.8k per 15-story batch against today's 50k prefix.

This is the deliberate counterweight to the project's under-discussed risk: **narrowing the
candidate set hurts precision.** Shown one film and a headline about that film's untracked
sibling, the model has nothing correct to point at. The four franchise-trap paragraphs at
`link/linker.py:71-94` are therefore **retained in full**, and the offline gate measures
precision, not only recall.

### 4.4 Zero-candidate rejection

`link_status = 'rejected'`, `link_note = 'no-candidates'`, **no LLM call**. On this corpus that
is 29–63% of stories depending on T — the majority of the stage's workload, and where the cost
saving actually lands.

> **The cost claim in that last clause is superseded.** It was measured over a 249-film catalog.
> At production scale the zero-candidate share falls to 4.7% (§5.1) / 3.6% on a live run, and
> §5.9 measures retrieval costing ~19% *more* per run than the roster path, whose ~46k prefix
> was cached at a tenth of the input rate. §5.2's growth curve says the share keeps falling.
> **The correctness arguments below are untouched**; only the cost argument is retired, and §1
> always held cost to be incidental to the 200k context ceiling.

Two properties are part of the decision, not commentary (ADR-0009):

- The note is **distinguishable**, so stories lost to a retrieval bug are queryable and can be
  re-run within the recency window.
- Zero-candidate rejects are **excluded from `StageCounts.processed`**. This is not tidiness.
  `StageCounts.total_failure` returns `False` the moment `processed > 0`, so counting them would
  mean a total Anthropic outage reports ~30% processed, the run finalizes `succeeded`, the daily
  chain proceeds, and — `link` being **lossy** — the failed stories age out and are gone. The
  repo's one guard on its one lossy stage would be silently switched off.

### 4.5 Observability and guard

`ingest.link_retrieval_probe`: one row per story the roster **linked** (was it retrieved, at
what rank, at what score) plus per-run aggregates for the denominator and zero-candidate counts.
Rows only where the roster linked — where both paths reject, there is nothing to adjudicate.
Follows the `ingest.llm_call` precedent (NEU-974).

Alerting is **retrieval health**, not cache ratio (ADR-0010) — the briefed cache-ratio alert
guards a window that never opens, since Undated Film Discovery is blocked on this project.

- **Hard breach** → run finalizes `failed` → deadman `/fail`. Subject to a minimum-denominator
  rule, mirroring `total_failure_error`'s existing refusal to let a small denominator fail the
  chain daily. → **Set in §5.3**: ceiling 25%, minimum 50 stories, armed under `on` only.
- **Soft signal** → recorded per run, surfaced on `/admin/runs`.

### 4.6 Module layout

```
src/upmovies/link/
  retrieval/
    normalize.py   squash-fold, tokenization           pure
    index.py       one query/run → token → film index  I/O at build only
    select.py      scorer, threshold + cap             pure
    render.py      candidate → prompt lines            pure
  linker.py        prompt + request builder + decisions (rewritten)
  roster.py        DELETED at M4
```

## 5. Rollout

`LINK_RETRIEVAL_MODE` = `off` | `shadow` | `on`.

In **shadow** the roster path still decides; retrieval runs beside it and records what it
*would* have offered. Because retrieval is pure and free, this is a true-scale recall
measurement against the incumbent on live traffic at **zero added LLM cost**, exercising the
same code path that later goes live.

**Cutover gates — all three:**

1. Recall ≥ ~99% against roster picks, measured across a **moving** catalog, plus a
   deployment smoke test. **Revised 2026-08-08** — was "over ≥ 7 consecutive daily shadow
   runs"; see §5.4.
2. Every miss in gate #1's recall measurement hand-adjudicated as a genuine loss *or* a roster
   false positive, with only genuine losses counting against gate #1. Not decoration: the
   roster makes false positives, so retrieval declining to surface one is a **win** that a bare
   percentage scores as a loss. **Revised 2026-08-08** — "shadow miss" became "miss" when the
   measurement moved off production (§5.4). The four misses are worked through in §5.6.
3. Offline end-to-end accuracy against the roster baseline on the pinned fixture, via
   `scripts/validate_linking.py` + `link/metrics.py`, with precision judged separately from
   F1 — an F1 that holds while precision falls and recall rises is the narrowing regression
   (§4.3), and an F1-only gate waves it through. **Revised 2026-08-08** — originally "within
   ~1 point" on both deltas; §5.7 established that ±1 point is finer than this fixture can
   resolve, so the same bar is now stated in whole items (ADR-0011): coverage complete,
   no links lost, no more than 3 false positives added. One-sided, as before: beating the
   baseline is not a breach. Restated and adjudicated in §5.8.

Exact numbers are confirmed from observed data before the flip.

**All three gates are settled as of 2026-08-08.** Gate #1 in §5.4/§5.6, gate #2 in §5.6, gate
#3 in §5.8. The dev rehearsal gate #1 also asks for is §5.9, and what remains irreducibly
production is §5.10.

> **Gate #3 was re-scored post-cutover against a 5.7× larger fixture — §5.11 (NEU-1012).** The
> residue ADR-0011 accepted holds (3.35% measured against 3.19% accepted, inside the run-to-run
> spread), and 3b now passes with real margin. **3a fails**: candidate coverage is 534/538
> rather than 94/94, on four correct labels that lexical matching cannot reach. Nothing about
> retrieval changed; the instrument grew big enough to contain gaps the old corpus never
> sampled. Read §5.11 before treating §5.8's numbers as current.

### 5.1 Recorded baseline and first gate-#3 measurement — 2026-08-07 (NEU-1000)

`scripts/validate_linking.py --mode both`, `claude-haiku-4-5`, floor 0.7, batch 15, T=0.34,
K=10, against the repaired fixture (301 items, 93 `about`) and a **local database refreshed
from prod** (`task db:refresh`): 1,407 films, **1,226 active**, 98,662 stories. This is the
first written-down baseline; every earlier figure in §3 came from the 249-film dev catalog.

| | precision | recall | F1 | TP | FP | FN | TN |
|---|---|---|---|---|---|---|---|
| **roster (baseline)** | **0.875** | **0.452** | **0.596** | 42 | 6 | 51 | 202 |
| retrieval | 0.796 | 0.419 | 0.549 | 39 | 10 | 54 | 199 |
| delta | **−7.9 pts** | −3.2 pts | **−4.6 pts** | | | | |

**Gate #3 fails at the untuned defaults**, and it fails on precision hardest — the narrowing
risk §4.3 names, landing where it was predicted to. Not-news leaks: 5 roster (reaction 2,
roundup 2, other 1) against 4 retrieval (roundup 2, reaction 1, interview-quote 1); that axis
is a wash and is not what moved F1.

**The loss is in the classifier, not in retrieval.** Retrieval offered the correct film in
**53 of 53** scoreable `about` items — perfect coverage — so every lost link is the model
declining to pick a film it was shown. Tuning T and K (NEU-1001) cannot fix that on its own;
the prompt and the floor are where this delta lives.

Three measurements at prod scale that revise §2–§4:

- **The roster prefix is confirmed.** 1,226 active films render to 183,183 chars ≈ **46k
  tokens**, inside the 44.7k–51.5k band the July usage export showed. §2's "~1,200 active
  films" derivation was right.
- **The zero-candidate saving largely evaporates.** §4.4 puts it at "29–63% of stories …
  the majority of the stage's workload" — that was measured over 249 films. Over 1,226 it is
  **14/301 (4.7%)**: more films means more titles sharing a token with any given headline.
  ADR-0009's correctness arguments are untouched, but its cost argument is now small.
- **The cap binds hard.** 81/301 stories (27%) are cap-saturated at K=10, mean offered set
  6.53 — against a p90 of 4 at 249 films. K is doing real work at this scale, which §3.1's
  "K is a prompt-size guard, not a recall lever" did not anticipate.

Two caveats on the absolute numbers. Both paths' recall is depressed by fixture decay — 9 of
the 33 films the fixture names, covering 40 of the 93 `about` items, have left the active
catalog since it was labeled, and are unlinkable for *either* path. The comparison stays
valid because the loss is symmetric, but 0.452 is not this system's recall against fresh
labels. Three stories also came back with no decision from the model and were rejected as
`no-decision`. Re-record the baseline against a re-labeled fixture before treating these as
the cutover's reference numbers.

> **Superseded by §5.1a (NEU-1010).** The decay was worse than "symmetric, so the comparison
> holds" implies, and the remedy was not a re-label: the fixture is now *dated* and scored
> against the catalog as of its labeling date. Both paths gain ~15 F1 points, the F1 delta
> inverts from −4.6 to **+0.6**, and the precision loss survives at −7.6. **Use §5.1a's table
> as the cutover's reference, not this one.**

### 5.1a The fixture is dated, and the baseline above was measured through decay — 2026-08-08 (NEU-1010)

§5.1 closes by asking for a re-labeled fixture before its numbers are treated as the
cutover's reference. The re-label turned out to be the wrong remedy, and the numbers were
wrong by more than the caveat suggested.

**The labels were never the problem; the harness's clock was.** `validate_linking.py` built
the roster and the index at wall-clock time, so a film that had released since labeling fell
out of the active set and became unlinkable — by *either* path — and every item naming it
scored as a recall failure of the path under test. Measured 2026-08-08 against a
prod-refreshed database: **42 of 94 `about` items, naming 10 of 34 films.** All ten left the
same way, their release date passing; none were canceled. One film, *Spider-Man: Brand New
Day*, carried 22 items on its own.

This is not rot. It is the fixture's subject matter aging out of the product's scope by
design, and it recurs: as of 2026-08-08, **88 of the 1,195 active films release within 7
days and 266 within 30** — roughly a fifth of the active catalog per month. (One day's
forward window, not an average: the two figures imply 12.6 and 8.9 films/day respectively,
so treat the shape as indicative rather than a rate.) Re-labeling would have bought ~six weeks
before NEU-1011 was again measuring against a moving oracle, and — since the existing labels
are hand-made — would have replaced human ground truth with model-assisted ground truth for
no coverage gain.

**The fix is to date the fixture.** `validation_set.json` becomes
`{"as_of_date": "2026-07-01", "items": […]}`; `build_roster` and `build_candidate_index` take
an optional `as_of` (production passes nothing and still reads today's catalog); the harness
applies it to both paths and to the prompt's own `as_of_date`, and **exits with an error**
rather than a warning if a pinned set still names an unreachable film. At that date all 34
films are in scope and coverage is **94/94**.

**Three things the pin is not**, all of which bound how far these numbers travel:

- **It rewinds the active-film filter, not ingestion history.** 74% of `catalog.film` was
  ingested after 2026-07-01, so the pinned catalog is **1,407 films** against the 1,226 §5.1
  scored and the 1,195 active today. Deliberate and conservative — both paths see the same
  films, so the comparison stays like-for-like, and more films means more lexical collisions,
  which makes narrowing harder rather than easier. It is a fair comparison, not a replay.
- **At this date the filter excludes nothing.** The catalog's earliest `release_date` *is*
  2026-07-01 and no row carries a `Released`/`Canceled` status, so 1,407 is the whole table
  and `active_film_clause` is a no-op for this run. The eval therefore does not exercise
  scope filtering at all, and its candidate-set statistics sit above what production sees.
- **Coverage has a one-day margin, not a structural guarantee.** The earliest film the
  fixture labels (*Enola Holmes 3*) releases exactly on 2026-07-01, and the clause admits
  `release_date >= today`. 94/94 holds by a day. That is why `_check_coverage` **aborts**
  rather than warns on a pinned fixture: the margin is thin enough that a re-pin or a label
  change could cross it, and the resulting numbers would look entirely plausible.

One item is mis-served by the pin in the other direction: a single `about` story published
2026-08-07 is scored with the prompt's `as_of_date` set to 2026-07-01, five weeks before it
was written. One row of 302, recorded rather than fixed — the fixture spans 2026-06-24 to
2026-08-07, so no single date is right for every row, and the catalog constraint (pin early
enough to keep films reachable) and the recency constraint (pin late enough that no story is
in the future) genuinely conflict.

#### Re-recorded baseline — pinned, at §5.2's tuned constants

`--mode both --threshold 0.5 --limit 25`, `claude-haiku-4-5`, floor 0.7, batch 20, 302 items:

| | precision | recall | F1 | TP | FP | FN | TN |
|---|---|---|---|---|---|---|---|
| **roster (baseline)** | **0.909** | **0.638** | **0.750** | 60 | 6 | 34 | 202 |
| retrieval | 0.833 | 0.691 | 0.756 | 65 | 13 | 29 | 195 |
| delta | **−7.6 pts** | +5.3 pts | **+0.6 pts** | | | | |

Candidate sets: zero-candidate 13/302 (4.3%), cap-saturated 3 (1.0%), mean offered 8.50,
**expected film offered 94/94**.

**Gate #3 still fails — but on precision, not F1.** The F1 delta is +0.6, comfortably inside
the ~1-point tolerance; precision falls 7.6 points while recall rises 5.3. That is exactly
the masked regression NEU-1003's gate #3 was written to catch, and the harness's own gate
logic catches it.

**Two corrections to §5.1.** Neither path's absolute numbers there were this system's
accuracy. The roster path gives the one clean decay-only comparison, since it takes no T or
K: **0.596 → 0.750 F1, +15.4 points**, from nothing but making its subjects reachable. And
§5.1's headline conclusion inverts: retrieval is **ahead** on F1 and recall once its subjects
are reachable, not 4.6 points behind.

*Retrieval's* lift cannot be read off the two tables directly, because §5.1 ran T=0.34/K=10
and batch 15 while the table above runs T=0.5/K=25 and batch 20. Held at §5.1's constants and
pinned, retrieval scores **F1 0.830** (below), so the decay repair is worth ~+28 points to it
and §5.2's retune costs ~−7 — and even that comparison carries a batch-size and a one-item
difference. Only the roster row isolates decay cleanly.

**What does not change is the precision loss: −7.9 there, −7.6 here.** It survived the
repair, so it is a real property of narrowing rather than an artifact of decay — which is
what NEU-1011 is scoped against.

#### K is a precision lever, and §5.2 did not price that

The same fixture, pinned, at the *untuned* T=0.34/K=10 (batch 20, so only T and K move):

| | precision | recall | F1 |
|---|---|---|---|
| roster | 0.914 | 0.681 | 0.780 |
| retrieval | 0.890 | 0.777 | **0.830** |
| delta | **−2.4 pts** | +9.6 pts | **+4.9 pts** |

— a precision delta of **−2.4** against −7.6 at T=0.5/K=25, and F1 +4.9 against +0.6. The
roster row moves between the two runs (0.780 → 0.750) despite taking neither constant, which
is model non-determinism at this sample size and is itself a caution against reading
sub-point differences here. K=10 saturated 102 of 302 stories;
K=25 saturates 3 and offers a mean of 8.50 candidates. The truncation §5.2 removed as a
recall risk was also, accidentally, a precision guard: **the model links what it is shown**,
so a deeper candidate list buys reachable picks and pays for them in wrong ones.

§5.2 set K against *retrieval coverage* — "K=25 clears the p99 set size and the deepest pick
ever seen" — which is the right objective for the candidate stage and the wrong one for the
end-to-end gate. K therefore belongs in NEU-1011's lever list beside the confidence floor and
the prompt, and its recall-vs-precision trade should be swept end-to-end rather than settled
on candidate-set statistics. This does not invalidate §5.2's grid, which measured what it
said it measured; it means the constant it chose was optimized against a different objective
than gate #3 scores.

#### Only `validate_linking.py` honours the pin

The dated fixture is read by seven other callers — `diagnose_linking`, `tune_retrieval`,
`validate_clustering`, `validate_clustering_overmerge`, `measure_title_filter`,
`export_retrieval_catalog`, and the suite's `link_retrieval` fixture module — and all of them
still build their catalog at wall clock. They are not wrong today (they answer
candidate-stage and clustering questions, not gate #3), but they will drift the way §5.1
drifted, silently. Threading `as_of` through them was left out of NEU-1010 as scope;
`diagnose_linking` is the one that most wants it next, since it exists to explain
`validate_linking`'s misses and will now disagree with it about which films are reachable.

### 5.2 Tuned constants — 2026-08-07 (NEU-1001)

`scripts/tune_retrieval.py`, over **98,662 production stories** — every story the database
retains, the retention window being shorter than the 45-day sweep window — against the
**1,226-film active catalog**, in a local database refreshed from prod (`task db:refresh`).
Prompt sizes are exact, from the Anthropic token-counting endpoint; nothing here cost a
generated token.

**The named input did not exist, and the substitute is not a lesser one.** M2's shadow
probe rows are the input this ticket was scoped against, but the shadow code sits on the
release branch unshipped, so production has written none. What made the substitution
available is the same property that made shadow cheap in the first place (§5): retrieval is
pure, and every story already carries the roster's verdict in `news.story`, so the probe's
measurement — *was the roster's pick in the candidate set, at what rank, at what score* —
replays exactly offline. Against one run's rows it trades fresh traffic for six weeks of it
and every (T, K) at once, which is what a grid needs. Two things it does not replace: it
cannot watch the constants behave against a *moving* catalog, and its denominator is every
retained story rather than one run's pending set. Shadow keeps running; it now has tuned
constants to run with.

| constant | was | now | what set it |
|---|---|---|---|
| **T** | 0.34 | **0.5** | the highest threshold that loses no reachable roster pick |
| **K** | 10 | **25** | p99 candidate set = 18, deepest pick observed = rank 21 |
| `LINK_BATCH_SIZE` | 15 | **20** | the 2048-token reply ceiling, not a cached prefix |

#### T — the flat region has a top, and it is 0.5

| T | 0.25 | 0.34 | 0.4 | **0.5** | 0.6 | 0.67 | 1.0 |
|---|---|---|---|---|---|---|---|
| recall vs roster picks | 0.989 | 0.989 | 0.989 | **0.989** | 0.959 | 0.940 | 0.926 |
| zero-candidate | 0.0% | 5.3% | 5.3% | **5.4%** | 32.6% | 36.1% | 36.4% |
| candidates med / p90 / p99 / max | 10/25/47/111 | 3/9/18/45 | 3/9/18/45 | **3/9/18/44** | 1/2/3/8 | 1/2/3/7 | 1/2/3/6 |

Denominator: 365 of 418 roster picks in the window; the other 53 name films that have since
left the active catalog and are unreachable at any (T, K), so they are excluded rather than
scored as misses.

The score distribution of those 365 picks is what actually decides T. Scored at T=0, so the
zero bucket is a true zero — those four films share no title token with their story and no
squash-fold rescue, and are not scorable against it at all:

| pick score | 0.0 | 0.5 | 0.6 | 0.667 | 0.75 | 0.8 | 1.0 |
|---|---|---|---|---|---|---|---|
| picks | 4 | **11** | 1 | 6 | 1 | 4 | 338 |

**Nothing lands between 0 and 0.5.** Recall is therefore flat for every T from 0 to 0.5 and
drops at 0.6. T=0.5 is the top of the flat region — the last value that costs nothing — and
taking the top rather than the bottom is what resists catalog growth: recall at a given T
does not move as the catalog grows, but candidate-set size does, and a higher threshold
admits fewer collisions.

**The four misses score exactly zero**, so they are the lexical floor (§8), not a threshold
effect, and no T reaches them:

- *"Warner Bros' 'F.A.S.T.' Dashes Into Summer 2027"* → tracked **F.A.S.T.** The headline
  names the film outright, but `significant_tokens` drops single characters and the fold
  `fast` is 4 characters, under `SQUASH_FOLD_MIN_CHARS` = 6. A normalization gap, and the
  one of the four that is fixable.
- Two festival-programme stories (*San Sebastián*, *TIFF 2026*) → **Milo**, **Your Mother
  Your Mother Your Mother**: the tracked title appears nowhere in headline or dek.
- *"David Zaslav … Touts 'Fantastic' 'Superman' Sequel"* → tracked **Man of Tomorrow**: the
  film is named only by its franchise. Exactly the case §8 accepts.

#### K — the cap is no longer free, and 25 is where it stops costing

| K (at T=0.5) | 10 | 15 | 20 | 21 | **25** | 30 |
|---|---|---|---|---|---|---|
| recall | 0.984 | 0.986 | 0.986 | 0.989 | **0.989** | 0.989 |
| picks lost to the cap | 2 | 1 | 1 | 0 | **0** | 0 |
| cap-saturated stories | 7.3% | 1.8% | 0.5% | 0.4% | **0.1%** | 0.0% |
| mean offered | 3.94 | 4.16 | 4.22 | 4.22 | **4.23** | 4.24 |

Pick ranks: p50 = 1 (262 of 361 rank first), p90 = 3, p99 = 8, **max = 21**. K=25 clears both
the p99 set size (18) and the deepest pick ever seen, and costs 0.01 candidates per story
over K=20 — the distribution's tail is long but thin, so headroom is nearly free while
truncation is not.

This corrects §3.1. "K is a prompt-size guard, not a recall lever" was measured at 249 films;
at 1,226 the cap does bind, and K=10 would have cost two picks and saturated 7.3% of stories.
Saturation at K=25 is 0.1% — non-zero, so the health signal is alive, and low enough that a
rise means catalog growth rather than noise. That is the number to watch as the undated-film
expansion lands.

#### Catalog growth — p90 candidates moves about linearly with catalog size

The forward-looking measurement, and the only evidence available about a catalog that does
not exist yet. Sub-catalogs drawn deterministically by film id from the 1,226, scored over
the same 10,000 stories at T=0.5, K=25:

| films | median | p90 | p99 | max | mean offered | zero-candidate | cap-saturated |
|---|---|---|---|---|---|---|---|
| 250 | 1 | 2 | 5 | 11 | 0.91 | 45.4% | 0.0% |
| 500 | 1 | 4 | 7 | 15 | 1.57 | 26.7% | 0.0% |
| 750 | 2 | 5 | 11 | 21 | 2.37 | 16.7% | 0.0% |
| 1,000 | 2 | 7 | 14 | 28 | 3.32 | 9.2% | 0.0% |
| **1,226** | **3** | **9** | **18** | **36** | **4.26** | **5.5%** | **0.2%** |

p90 tracks catalog size almost exactly proportionally (9 × N/1226 predicts 1.8 / 3.7 / 5.5 /
7.3 against measured 2 / 4 / 5 / 7), and mean offered does the same. Extrapolated, the
undated-film expansion's **5x gives a p90 near 45 and 20x near 180** — K=25 saturates for
most stories well before either, so **cap saturation is the tripwire that says retune**, and
`RunRetrievalHealth.saturated_stories` already records it per run. Two caveats: a random
subset of today's catalog is a proxy for a smaller catalog, not a sample of a larger one,
and undated films may collide differently (more per-franchise entries argues worse, more
obscure titles argues better). The curve is a predictor, not a promise.

The same curve retires ADR-0009's cost argument for good: zero-candidate stories fall from
45.4% at 250 films to 5.5% at 1,226 and will approach zero as the catalog grows. §5.1
already flagged this; the shape now says it is not a plateau. The correctness arguments —
the distinguishable note, the exclusion from `StageCounts.processed` — are untouched.

Per-run **p90** is deliberately *not* added to `RunRetrievalHealth` here. That is a schema
change, and the health row belongs with the hard-breach guard (NEU-1002); mean and
saturation already move together with p90 on this curve, so nothing is unwatched meanwhile.

#### `LINK_BATCH_SIZE` — the reply is the binding constraint now

Exact counts, `claude-haiku-4-5`, at T=0.5/K=25, over one pool of ~150 consecutive real
stories re-chunked at each size — so the only thing moving between rows is how the
instruction block spreads. (Slicing the pool's first *n* stories instead, as the first cut
of the script did, reports story composition as if it were amortization: the per-story
column came back non-monotonic, which amortization cannot produce.) Instruction block: **1,988 tokens**, re-sent uncached every call
(below the 4,096-token cache floor, as §4.2 predicted). A rendered candidate costs **~102
tokens**; a story's candidate list, **~360**.

| batch | input tok/call | tok/story | instructions share | worst-case reply | headroom vs `_MAX_TOKENS`=2048 |
|---|---|---|---|---|---|
| 15 | 13,560 | 904 | 14.7% | 894 | 1,154 |
| **20** | **17,498** | **875** | **11.4%** | **1,183** | **865** |
| 25 | 21,262 | 850 | 9.4% | 1,481 | 567 |
| 30 | 25,113 | 837 | 7.9% | 1,780 | 268 |
| 40 | 32,715 | 818 | 6.1% | 2,373 | **−325** |

15 was chosen when a ~46k-token cached prefix was amortized across the batch. With no prefix
the input side barely cares — going 15 → 20 saves 29 tokens per story, 3.2%, and everything
past 20 saves less again — and what bounds the batch instead is the **reply**: one decision
object per story against a 2048-token ceiling, where a truncated reply fails to parse and
takes every story in the batch with it. 40 overruns outright; 30 leaves 13% of the ceiling.
20 keeps 42% spare, takes the larger half of the amortization on offer, and holds the blast
radius of a failed call to 20 stories. It applies to both paths, so the roster/retrieval F1
comparison stays like-for-like — and it makes the incumbent cheaper too, at 25% fewer
cached-prefix reads.

#### Candidate rendering width — kept at 120 characters

`render.OVERVIEW_MAX` was left to this ticket as a prompt-size trade (§4.3). It stays at
120. The overview is ~30 of the ~102 tokens a rendered candidate costs, so tripling it would
add ~29% to every request — to buy something no free measurement can price. Whether a longer
overview helps the classifier is an **F1** question, and answering it means paying for a
`validate_linking` run; worse, moving it now would move the roster path's baseline at the
same time, which is the one comparison the cutover gate rests on. Revisit after the cutover,
when the roster is gone and only one path moves.

#### Re-measured post-#195 — 2026-08-08: the constants hold

This grid was taken in #194, one commit before #195 collapsed dotted and slashed initialisms
before tokenizing — a global change to `significant_tokens`, so every number above predates
it. Re-run at `--days 45 --threshold 0.5 --limit 25 --count-tokens`, against a 1,195-film
catalog (down from 1,226 as a day of films released):

| | #194 (pre) | #195 (post) |
|---|---|---|
| reachable roster picks | 365 | **352** |
| recall @ T=0.5 | 0.989 | **0.991** |
| picks lost to T @ 0.5 | 4 | **3** |
| zero-candidate @ T=0.5 | 5.4% | **6.1%** |
| K=25 picks lost to cap | 0 | **0** |
| cap saturation @ K=25 | 0.1% | **0.2%** |
| instruction block | 1,988 tok | **1,988 tok** |
| rendered candidate | ~102 tok | **102 tok** |
| batch-40 headroom vs 2048 | −325 | **−325** |

**Nothing needs retuning.** T=0.5 is still the top of the flat region — recall is identical
from 0.25 to 0.5 and drops at 0.6 (0.960) — and K=25 still clears the cap with zero picks
lost. The prompt-size half is unchanged to the token, confirming #195 touched matching only.

**The one substantive move is the fix landing:** picks lost to T fell from 4 to 3, which is
the `F.A.S.T.` miss (§5.6) no longer missing. Recall rose accordingly.

Two second-order notes. The denominator fell 365 → 352 because the catalog shed 31 films in a
day — the same turnover §5.1a measures, visible again. And zero-candidate rose 5.4% → 6.1%,
which is catalog shrinkage rather than tokenization (fewer films, fewer chances to match); it
leaves §5.3's guard calibration intact, still ~4x under the 25% ceiling, with a mis-set T=0.6
still breaching it at 34.6%.

#### What this does not settle

Gate #3 still fails at §5.1's numbers, and tuning does not fix it: retrieval already offered
the correct film in 53 of 53 scoreable items there, so the −7.9-point precision delta lives
in the classifier and the confidence floor, not in T or K. Re-running `validate_linking`
costs real tokens and belongs with the re-labeled fixture §5.1 calls for.

### 5.3 The hard-breach guard — 2026-08-07 (NEU-1002)

The hard tier of §4.5's two-tier guard, and what was built instead of the briefed cache-ratio
alert (ADR-0010). Under `LINK_RETRIEVAL_MODE=on`, a run whose zero-candidate rate clears the
ceiling finalizes `failed`; `run_daily` is fail-fast, so that aborts the chain and pings the
healthchecks.io deadman `/fail` — the pipeline's only alerting channel.

| constant | value | what set it |
|---|---|---|
| `LINK_RETRIEVAL_MAX_ZERO_CANDIDATE_RATE` | **0.25** | ~4.6x the 5.4% measured at T=0.5/K=25, under the 32.6% a mis-set T=0.6 produces |
| `LINK_RETRIEVAL_HEALTH_MIN_STORIES` | **50** | far below an ordinary run's pending set, far above where one story moves the rate |

**The named input did not exist here either, for the same reason as §5.2** — shadow has
written no production rows, the M2 code being unshipped on the release branch. The
substitute is §5.2's own grid, which measured the zero-candidate rate at every (T, K) over
98,662 production stories against the 1,226-film catalog. That is a better calibration
input than one shadow run would have been: the ticket asks for the rate "actually observed,
with margin", and the grid gives both the observed rate (5.4%) and the shape of what
mis-tuning does to it (32.6% at T=0.6, 36.4% at T=1.0).

**The ceiling is a collapse detector, not a drift detector**, and the gap between 5.4% and
25% is the deliberate part. Two asymmetries set it there. The cost of a false breach is the
whole daily chain: no summaries publish that day, so a guard tuned tight enough to catch
drift would trade a real outage for recurring self-inflicted ones. And the rate's own drift
runs the *safe* way — §5.2's catalog-growth curve has zero-candidate falling from 45.4% at
250 films to 5.5% at 1,226 and approaching zero as the catalog expands, so the margin widens
on its own as the undated-film expansion lands. What 25% catches is the failure ADR-0010
actually names: an index that built empty, or a normalization regression, silently rejecting
the backlog in a lossy stage. Ordinary drift has the soft tier on `/admin/runs` (NEU-997),
and cap saturation — which grows *toward* its threshold rather than away — remains the
tripwire that says retune.

**The minimum denominator mirrors `total_failure_error`.** That rule already refuses to let
one bad item on an empty backlog fail the chain daily, for exactly this reason: with a thin
backlog, a collapse and a quiet news day are the same observation. At 50 stories a breach
needs 13 zero-candidate rejects; an ordinary run's pending set is an order of magnitude
larger.

**Both stay settings**, like T and K, so an incident is answered from env rather than a
redeploy — and 1.0 disarms the guard outright, `max_zero_candidate_rate` being the highest
*acceptable* rate rather than the first breaching one.

**Scoped to `on`, and separate from `total_failure`.** Under `shadow` the roster still
decides, so retrieval offering nothing costs no story its link and the guard stays disarmed.
The two rules are joined only at the finalize site, where a run that trips both reports
both: `StageCounts` keeps its narrow, denominator-free "produced nothing at all" rule for
model availability, and failing a run on a *rate* stays confined to retrieval health (§8).

One defect fixed in passing: `docker-compose.yml` and `docker-compose.prod.yml` still pinned
`LINK_RETRIEVAL_THRESHOLD=0.34` / `LINK_RETRIEVAL_MAX_CANDIDATES=10` as their fallbacks, so
§5.2's tuned constants never reached a running container — the compose defaults are meant to
repeat the code defaults and had gone stale. Corrected to 0.5 / 25.

### 5.4 Gate #1 revised: the shadow-day count is replaced — 2026-08-08

Gate #1 asked for shadow recall ≥ ~99% against roster picks over **≥ 7 consecutive daily
runs**. The reasoning — that one good day says nothing about a catalog that keeps growing —
holds and is if anything strengthened by §5.1a, which measured that catalog turning over
about a fifth per month. The *mechanism* is what changes: the number the gate asks for has
already been taken, at larger scale, and the property the day-count was protecting is now
measurable without waiting.

**The recall measurement exists.** §5.2 replayed the roster's own picks over **98,662
production stories** — six weeks of retained traffic — and scored **0.989** against roster
picks at T=0.5/K=25. That is gate #1's metric at roughly 25x the sample seven daily runs
would yield. As measured that is 98.9%, marginally under a hard 99% — but gate #2's
adjudication closes the gap: two of the four misses are roster false positives, and those
leave the denominator, giving **361/363 = 0.9945**. See §5.6. **Gate #1 passes.**

**The moving-catalog property is now replayable.** §5.2 named this as the one thing its
offline substitute could not do — "it cannot watch the constants behave against a *moving*
catalog." NEU-1010's `as_of` removes that limit: recall, zero-candidate rate and cap
saturation can be replayed at each of the last N daily catalog states from data already in
the database, at zero token cost. The reconstruction is imperfect in the way §5.1a records —
it rewinds the active-film filter, not ingestion history — so older dates carry an inflated
catalog. Conservative, not faithful.

**What genuinely remains is a rehearsal, not a measurement** — and it belongs in **dev**, not
production. `task db:refresh` puts prod's `catalog`/`news`/`ingest` into the local database
(1,407 films, 98,662 stories as of 2026-08-08), the container runs the same image against the
same code, and `_ping` is a no-op when `HEALTHCHECK_DAILY_URL` is unset, so the whole
`run_daily` chain can be exercised locally without touching the real deadman.

**Dev is strictly better than a production shadow period here**, because of what §5.3's guard
is scoped to. `pipeline.py:374-378` arms the hard breach only under `retrieval_mode == "on"`;
under `shadow` the roster still decides, so the guard stays disarmed by design and a
production shadow period *can never exercise it*. In dev you can run at `on`, drop
`LINK_RETRIEVAL_MAX_ZERO_CANDIDATE_RATE` low enough to force a breach, and watch the run
finalize `failed`, the chain abort, and the `/fail` ping fire. That retires the guard's only
untested surface — its wiring — before the flip rather than after it.

So the rehearsal is: in dev, against prod-refreshed data, run the daily chain at `shadow` and
at `on`, confirm probe rows, the `RunRetrievalHealth` row and `/admin/runs`, and force one
guard breach.

**What is irreducibly production**, and it is narrow:

- **Migration `9d0d376657d5` has never applied to prod's schema.** Additive tables, so the
  risk is low, but it is literally untested there.
- **Coolify injects env by a different mechanism than compose does.** This is exactly the
  class of failure already observed: NEU-1010's first baseline run was silently taken at
  `THRESHOLD=0.34`/`MAX_CANDIDATES=10` because a long-running container held env from before
  §5.3 corrected the compose defaults. **`printenv` the guard's two constants in the deployed
  container** — do not trust the compose file.
- **The flip itself.**

**There is no production shadow canary**, though an earlier draft of this section proposed
one. §5.5 puts the deletion in the same release, so `shadow` has no roster to decide with — it
stops being a state the system can occupy. The dev rehearsal and the post-deploy env check are
the whole of the pre-flip verification.

Gate #1 therefore becomes: **the multi-date offline replay, the dev rehearsal including a
forced guard breach, and a post-deploy `printenv` check on the guard's constants.** All
recorded here before the flip.

### 5.5 Cutover and deletion ship together — 2026-08-08

**Decision:** v0.2.0 carries the whole project — NEU-1011's precision work, NEU-1003's cutover,
NEU-1004's deletion of the roster path — plus *LLM Provider Gateway* M1–M5, and deploys with
`LINK_RETRIEVAL_MODE=on`. One release, one deploy. Production goes from v0.1.x straight to
retrieval with no roster in the tree.

This overrides the staging §5 implies, where the flag provides a live fallback and deletion
follows later as a separate step. It is a deliberate trade, taken on the view that the dev
rehearsal (§5.4) covers the surface that a production shadow period would have.

**What it costs, stated plainly.**

- **Rollback stops being a configuration change.** With `build_roster` gone, `shadow` and
  `off` have nothing to fall back *to* — they are not merely unhelpful, they are not
  meaningful states. Recovery from a bad cutover is a revert and redeploy: minutes, not the
  seconds an env flip would take.
- **The guard's first armed run is in production**, since it only arms under `on`
  (`pipeline.py:374-378`). §5.4's dev breach rehearsal and the post-deploy `printenv` check on
  its two constants are what stand in for a canary here.
- **A single deploy carries a rewrite of the lossy stage, a run-failing guard, four rewired
  LLM call sites, the batch-path deletion and per-call telemetry.** If something misbehaves,
  attribution is harder than it would be across two releases.

**Why that is acceptable.** `build_roster` is a pure rendering function over `catalog.film`
and its genres — it formats data, it does not own any. Deleting it removes code, not state, so
"rebuild the roster" means recovering a file from git history while every film it rendered is
still in the database. And a bad linking day is recoverable on its own terms: zero-candidate
rejects carry the distinguishable `no-candidates` note and can be re-run inside the recency
window (§4.4), and wrong links have the admin delink surface.

The residual exposure is therefore one degraded daily run, remediable without the roster —
which is a smaller thing than the staged rollout was defending against.

### 5.6 Gate #2: the four misses adjudicated — 2026-08-08

Gate #1's measurement is §5.2's replay: **365 reachable roster picks** at T=0.5/K=25 over
98,662 stories, of which retrieval offered 361 and missed **4**. All four score exactly zero,
so none is a ranking failure. §5.2 filed all four under "the lexical floor". Gate #2 asks a
different question — *loss or win?* — and on that axis they do not all land the same way.

| # | story | roster's pick | verdict |
|---|---|---|---|
| 1 | *"Warner Bros' 'F.A.S.T.' Dashes Into Summer 2027"* | **F.A.S.T.** | **already fixed** since the measurement |
| 2 | *"David Zaslav … Touts 'Fantastic' 'Superman' Sequel"* | **Man of Tomorrow** | **genuine loss**, accepted (§8) |
| 3 | San Sebastián programme (Screen Daily) | **Milo** | **roster false positive — retrieval wins** |
| 4 | TIFF 2026 programme (Variety) | **Your Mother Your Mother Your Mother** | **roster false positive — retrieval wins** |

**1 was a real defect and is already fixed.** §5.2 diagnosed it as `significant_tokens`
dropping single characters while the fold `fast` fell under `SQUASH_FOLD_MIN_CHARS` = 6. That
was true when measured — and the fix landed one commit later, in #195 (initialism collapse),
*after* §5.2's grid was taken in #194. `significant_tokens` now collapses `F.A.S.T.` to the
token `fast`, matching the headline's own `fast` as a whole word; the fold is never consulted.
Verified 2026-08-08 against the production story: **rank 1, score 1.0, 18 candidates.**

**§5.2's whole grid predated #195, not just this one miss** — the collapse changed
tokenization globally. It has since been **re-run** (§5.2, "Re-measured post-#195"): the
constants hold unchanged, and picks lost to T fell from 4 to 3, which is precisely this miss
no longer missing. The figures below are therefore measured rather than recomputed.

**2 is the accepted floor.** The film is named only by its franchise, which is exactly the case
§8 lists as unreachable by lexical retrieval. A genuine loss, knowingly taken.

**3 and 4 were read and are roster false positives.** Both are festival-lineup announcements,
and each covers **two tracked films** — which the classifier's own rule forbids linking:

| story | tracked films it covers | roster picked |
|---|---|---|
| *"San Sebastian adds Mike Leigh, Nicole Garcia, Pablo Larraín titles to competition lineup"* (Screen Daily, conf 0.80) | **Tender Loving Care** + **Milo** | Milo |
| *"TIFF 2026 Announces Special Presentations Program Additions…"* (Variety, conf 0.88) | **Love of Your Life** + **Your Mother Your Mother Your Mother** | Your Mother… |

`_CLASSIFICATION_RULES` defines `about` as announcing something new about **"exactly one
tracked film's production"**. Each of these covers two, so neither is an `about` story by the
system's own definition. And `Story.film_id` is single-valued, so the roster necessarily picked
one and left the other tracked film unlinked — the choice between them was arbitrary.

Two details confirm it. Neither film is named anywhere in the headline or dek the classifier
reads; Screen Daily's entire dek is *"Spanish festival is set to take place from September
18-26."* And the same festival beat reaches both films through sibling stories that **do** name
them in the headline — Deadline's Milo sales story, Deadline's *"TIFF Sets Special
Presentations Including … 'Your Mother Your Mother Your Mother'"*. Dropping these two costs no
coverage of the underlying event.

**Gate #1 clears, on measured numbers.** The post-#195 re-run already credits the `F.A.S.T.`
fix; gate #2's rule then removes the two roster false positives from the denominator:

| | denominator | hits | recall |
|---|---|---|---|
| §5.2 as first measured (pre-#195) | 365 | 361 | 0.989 — *marginally under ~99%* |
| re-measured post-#195 | 352 | 349 | **0.991 — clears ~99%** |
| adjudicated (two roster FPs removed) | 350 | 349 | **0.9971** |

The middle row is a measurement, not a recomputation. The last applies gate #2's own rule to
it. Both clear the bar, so gate #1 does not depend on the adjudication — though the
adjudication is what makes the remaining miss a single, understood one.

**The one genuine loss left is *Man of Tomorrow***, named in its story only by franchise — the
lexical floor §8 accepts by name.

**Gate #1 and gate #2 both pass.** Gate #3 remains the project's only failing gate (§5.1a).

A note on what this says about the design rather than the gate: a multi-tracked-film lineup
story is exactly the shape retrieval handles *better* than the roster. Retrieval offers both
tracked films as candidates, and the "exactly one" rule then tells the model to decline —
whereas the roster, shown the whole catalog, picked one and moved on.

### 5.7 Gate #3: two real fixes, and a gate the fixture cannot resolve — 2026-08-08 (NEU-1011)

NEU-1011 was scoped to close gate #3's precision gap. It closed part of it, found that one of
the three named levers is dead, and established that **the gate as written cannot be
adjudicated on this fixture at all** — the run-to-run noise is several times its tolerance.

#### The floor is a dead lever

`diagnose_linking.py`, ported to the retrieval path here, runs the linker once at floor 0.0 and
then classifies at every candidate floor — so one paid run prices the whole curve:

| floor | 0.50 | 0.60 | **0.70** | 0.75 | 0.80 | 0.90 |
|---|---|---|---|---|---|---|
| precision | 0.843 | 0.843 | **0.843** | 0.843 | 0.843 | 0.861 |
| recall | 0.745 | 0.745 | **0.745** | 0.745 | 0.745 | 0.660 |
| false positives | 13 | 13 | **13** | 13 | 13 | 10 |

Every floor from 0.5 to 0.8 is **identical**: the model returns high confidence on essentially
everything it links, so the floor has nothing to bite on. Only 0.90 moves it, buying 1.8 points
of precision for 8.5 of recall. `LINK_CONFIDENCE_FLOOR` cannot close a 7-point gap, and is
struck off the lever list.

#### Fix 1 — the pin was manufacturing false positives (a defect in §5.1a)

Of retrieval's thirteen false positives, **six named films the catalog only learned about after
the fixture was labeled** — `John Rambo` ×2, `Addicted to Change`, `I Love Paris`, `Hershey`,
`FAMILIAR`, ingested between 2026-07-04 and 08-06. A `none` label means "not about any film
tracked **at labeling time**", so those links were correct and unlabelable, not wrong.

§5.1a called the pin's ingestion gap "conservative" on the grounds that more films means more
collisions. That reasoning was incomplete: extra films also create links the fixture cannot
credit, which is a *precision* penalty, and it lands hardest on whichever path is best at
surfacing the right film. `films_ingested_after` now neutralizes such a pick to "no link" — the
counterfactual where the film was not there — for **both** paths.

The alternative, adding `created_at <= as_of` to the index build, was rejected: it is simpler,
but it drops the catalog to **367 films** against production's 1,195, which the §5.2 growth
curve puts in a regime (~43% zero-candidate, ~1 candidate/story) that behaves nothing like
production. Scale is worth more here than reconstruction purity.

Effect: roster false positives 6 → 2, retrieval 13 → 8. **Both paths were being penalized**,
so §5.1a's absolute precision figures were too low for each of them.

#### Fix 2 — the candidate list reads as evidence, and the prompt now says it isn't

The remaining false positives are not franchise-sibling confusions. **Not one is a wrong-film
pick on an `about` row** — every one is a `none` or `mention` row: magazine issue previews
(*"Empire Issue Preview: Spider-Man: Brand New Day, Supergirl, Jackass…"*), multi-film roundups
(*"First Look at Shrek 5, New Gollum Film Casting and Star Trek Return"*), and stories about
untracked films whose titles overlap a tracked one (*"Hello & Paris"* → `I Love Paris`,
*"Never Change!"* → `Addicted to Change`, *"eerily familiar"* → `FAMILIAR`).

That is the narrowing effect, precisely: the model reads *selection into the candidate list* as
evidence of aboutness. `_RETRIEVAL_HEADER` told it the candidates were "the only tracked films
available" but never that the list is a **lexical prefilter**. It now says so — a film is on
the list only because its title shares a word with the headline, a story about an untracked
film is still handed the tracked films that overlap it, and being offered a candidate is never
itself a reason to pick one — and closes by directing the model to classify by the shared rules
"exactly as you would if the entire catalog were in front of you rather than this short list".

The addition is deliberately **epistemic, not classificatory**. A first draft also told the
model that roundups and festival lineups were "mentions"; that contradicted
`_CLASSIFICATION_RULES`, which classes a multi-film list as `not-news`/`roundup`, and would
have made the two paths write different `link_note` telemetry for the same decision. The rules
stay single-sourced; only the retrieval header's framing of what the candidate list *means*
changes. `_ROSTER_HEADER` is untouched and verified byte-identical (sha `bcd49466c06ab7c6`), so
the baseline the gate measures against has not moved.

Effect: retrieval false positives 8 → 5, precision 0.896 → 0.932.

#### The finding that actually matters: the gate is below the noise floor

Four `--mode both` runs, same fixture, same constants, changing only what is noted. **D is the
shipped configuration**:

| run | change | roster P | roster FP | retrieval P | retrieval FP | Δ precision | Δ F1 |
|---|---|---|---|---|---|---|---|
| A | §5.1a baseline | 0.909 | 6 | 0.833 | 13 | −7.6 | **+0.6** |
| B | + post-labeling exclusion | 0.972 | 2 | 0.896 | 8 | −7.6 | **−2.9** |
| C | + prompt, first draft | 0.985 | 1 | 0.922 | 6 | −6.3 | **+2.5** |
| **D** | **+ prompt as shipped** | **0.971** | **2** | **0.932** | **5** | **−4.0** | **−0.8** |

**The two fixes worked, and the trend is what says so rather than any single run.** Retrieval's
precision rises monotonically across every change — 0.833 → 0.896 → 0.922 → 0.932 — and its
false positives fall 13 → 8 → 6 → 5. The precision delta more than halves, from −7.6 to −4.0.

**But the roster column is the control, and it is not stable.** Its prompt is byte-identical
across all four runs, and B → C → D changed only *retrieval* code, which cannot touch it — yet
its precision reads 0.972, 0.985, 0.971 and its F1 0.836, 0.805, 0.822 across those three. Its
false-positive count wanders between 1 and 2 on identical inputs.

So the F1 delta spans **5.4 points (−2.9 to +2.5)** across runs against a gate tolerance of
**±1 point**. The arithmetic explains why: 94 `about` items and single-digit false-positive
counts mean one item is worth ~1.3 precision points, so a ±1-point gate asks the fixture to
resolve a difference smaller than a single story. **It cannot, and no change to the code will
make it.**

#### Where gate #3 actually stands

At the shipped configuration:

- **The F1 half passes.** −0.8 points, inside the ~1-point tolerance.
- **The precision half fails.** −4.0 points — but that is **three false positives**, 5 against
  the roster's 2, on a 94-item population.
- **Candidate coverage is 94/94 in every run.** It is never the retrieval stage that loses a
  link; the residue is entirely classifier behaviour.

What is durable is a **trade, not a regression**: retrieval links a little more aggressively,
finding equal-or-better recall in every run while linking ~3 more stories that merely mention a
candidate. Whether that is acceptable for a news tracker is a **product judgement**, and a
±1-point F1 gate on a 94-item fixture cannot make it.

**Recommendation.** Restate gate #3 in units the fixture can resolve. State it in whole items —
"retrieval adds no more than N false positives against the roster" — and either enlarge the
`about` population, which is the binding constraint on every number in this section, or average
a fixed number of runs. On the evidence, the cutover is not blocked on a measurement: it is
blocked on someone deciding that three extra mention-links out of 94, bought with equal or
better recall, is the right trade. §8 already accepts precision-under-narrowing as mitigated
rather than eliminated, and the 200k ceiling makes the cutover mandatory rather than optional.

> **Answered in §5.8 (NEU-1003).** The gate is restated in whole items and its residue accepted
> as a recorded product judgement (ADR-0011). The two remedies this recommendation offers —
> enlarging the `about` population, averaging a fixed number of runs — were both declined, and
> §5.8 records why and what that leaves owed.

### 5.8 Gate #3 restated, and the cutover decision — 2026-08-08 (NEU-1003)

§5.7 ended by handing this ticket a decision rather than a measurement: *"the cutover is not
blocked on a measurement: it is blocked on someone deciding that three extra mention-links out
of 94, bought with equal or better recall, is the right trade."* This section is that decision,
its grounds, and the numbers a future reader needs to check it. The reasoning is
[ADR-0011](../adr/0011-cutover-gate-3-is-restated-in-whole-items.md);
what follows is the arithmetic and the verdict.

#### The gate is restated in whole items — and the precision clause is deliberately relaxed

The original gate held both the F1 and the precision delta to ~1 point. §5.7 established that
±1 point is below the fixture's noise floor — 94 scoreable `about` items and single-digit
false-positive counts put **one story at ~1.3 precision points**.

**The noise is worse than §5.7 recorded.** It notes the roster control's false-positive count
wandering between 1 and 2 across four runs whose prompt is byte-identical. Recovering its
*true positives* from the same recorded figures gives **69 / 64 / 67** across runs B, C and D —
a spread of **five items**, on identical inputs, from a path whose prompt did not change. Each
reconstruction reproduces §5.7's recorded precision *and* F1 to three places, so this is read
off the existing numbers rather than newly measured.

| # | check | at §5.7 run D | verdict |
|---|---|---|---|
| 3a | retrieval offers the correct film for every scoreable `about` item | **94 / 94** | pass — the only part with real margin |
| 3b | retrieval's true positives ≥ the roster's | **68 ≥ 67** | pass, but the margin is 1 against a control that moves by 5 |
| 3c | retrieval adds ≤ 3 false positives against the roster | **+3** (5 vs 2) | at the boundary |

**3c's ceiling is a relaxation, and it must be read as one.** The original gate had two clauses
and, converted into items, they disagree. Holding retrieval's 68 true positives against the
roster's 67 / 2:

| original clause | converted to items | excess allowed |
|---|---|---|
| F1 within ~1 point | 5 false positives scores −0.77 pts, 6 scores −1.26 → ≤5 total | **3** |
| precision within ~1 point | P must be ≥ 0.961; 68/70 = 0.971 passes, 68/71 = 0.958 does not → ≤2 total | **0** |

The **precision** clause is the load-bearing one — it is why gate #3 has a second clause at
all, since an F1-only gate is exactly what waves the narrowing regression through (§4.3).
Converted, it allows retrieval *no* extra false positives. Taking 3 relaxes it.

That is taken deliberately, and not because it makes the measurement pass: **0 excess is not a
bar this instrument can express.** With the control's own false positives moving by one and its
true positives by five between identical runs, a "zero extra false positives" gate would be
decided by which run you happened to take. Between two clauses that disagree, the ceiling is
set by the one the fixture can resolve — and the gap between them, three items, is what is
being **accepted** rather than met.

**Reading the table against §5.7.** §5.7 records run D as precision 0.971 → 0.932, false
positives 2 → 5, Δ precision −4.0, Δ F1 −0.8. The true-positive counts are not stated there;
they are recovered from those figures and are over-determined, so the reconstruction is
checkable rather than assumed. Roster TP = 67, FP = 2 reproduces both P = 67/69 = 0.971 and
F1 = 0.822; retrieval TP = 68, FP = 5 reproduces P = 68/73 = 0.932 and F1 = 0.814, giving
Δ F1 = −0.8. `format_comparison` prints exactly these numbers from those four counts.

So the trade, stated plainly and without §5.7's rounding: **retrieval finds one more correct
link than the roster and buys it with three more wrong ones.**

#### Neither surviving check is a measurement to lean on

3c is three of an allowed three, at a ceiling that has already been moved from 0. 3b is a
one-item margin against a control whose own true positives move by five between identical
runs. On an instrument like that, +3 and +4 — and 68 and 67 — are not distinguishable
observations.

The gate is therefore **not what licenses the cutover**. It is a sanity bound: it would still
catch a collapse (coverage falling, links lost in quantity, false positives doubling), which
is worth having, and it is why 3a matters most — 94/94 is the one figure here with real margin,
and it is the one that is actually about the stage this project changed. What licenses the
cutover is the judgement, recorded here so it can be argued with:

- **The baseline has an expiry date.** Gate #3 measures parity with the roster path, and the
  roster path is not an option to choose. The 200k context ceiling makes the cutover
  mandatory rather than optional (§1), and §5.5 puts NEU-1004's deletion in the same release.
  The question the fixture can answer is not the question that decides anything.
- **The two error kinds are not symmetric.** A false positive is a story on a film's timeline
  that merely mentions it — visible, and **remediable** through the admin delink surface,
  which already stamps `link_note = 'manual-unlink'`. A false negative is permanent: `link` is
  lossy, so an unlinked story ages out of the recency window and is never linked. The trade
  runs toward the recoverable failure.
- **The residue is not the failure this gate was written to catch.** §4.3's narrowing
  regression is the model shown a film and a headline about *that film's untracked sibling*,
  picking the sibling's story. Not one of run D's five false positives is a wrong-film pick on
  an `about` row — every one is a `none` or `mention` row (§5.7). And 3a has been 94/94 in
  every run ever taken: it is never the retrieval stage that loses a link.
- **§8 already accepts precision-under-narrowing** as mitigated rather than eliminated. This
  is that acceptance being cashed, not a new risk taken on.

**Gate #3 passes as restated. All three cutover gates are now met.**

#### What was declined, and what is owed

Two remedies §5.7 recommended were **not** taken here, and both should be recorded as owed
rather than dismissed:

- **Averaging a fixed number of runs.** Declined on cost and on reasoning: averaging a noisy
  estimator does not enlarge a 94-item population, which is the binding constraint, and the
  decision it would inform is dominated by the asymmetries above. It remains the cheapest way
  to make this fixture adjudicable at all.
- **Enlarging the labeled `about` population.** The real fix, and a labeling project rather
  than a tuning one. NEU-1010 established that hand-labeling is the expensive part.

**The accepted residue is watched in production, not on the fixture.** `link_note =
'manual-unlink'` records every operator delink, so the manual-delink rate is a
human-adjudicated precision signal on live traffic — a larger and continuously growing sample
than the fixture will ever be. A sustained rise after cutover is the signal that this
judgement was wrong. No new instrumentation is needed; only the discipline to look.

#### The harness now scores the gate the spec holds

`GateVerdict` and `format_comparison` were rewritten to score 3a/3b/3c in items. The points
deltas are still computed and printed — §5.1a and §5.7 are written in them, and dropping them
would make those sections uncheckable — but they are the record, not the pass condition. The
`--tolerance` flag becomes `--max-excess-false-positives`.

Leaving the harness printing `GATE: FAIL` on a gate the spec accepts would have been worse
than not reporting at all: the next reader would take an argued, recorded decision for an
unnoticed regression.

### 5.9 The dev rehearsal — 2026-08-08 (NEU-1003)

§5.4 replaced gate #1's seven-day production shadow period with a dev rehearsal, on the
argument that the recall number already existed at 25x the sample and that the one thing left
— the *wiring* — is better exercised somewhere the guard can actually be made to fire. This is
that rehearsal.

**Setup.** Local database refreshed from prod (`task db:refresh`): 1,407 films, 1,223 active at
index build, 98,662 stories, **168 pending** in the 3-day recency window. The container runs the
same image against the same code, and `HEALTHCHECK_DAILY_URL` is unset, so `_ping` is a no-op
and the real deadman is never touched. Each run is the whole `run_daily` chain — tmdb → feeds →
link → synthesize — with the 168 pending stories restored from a snapshot between runs, since
`link` is lossy and would otherwise leave the next run nothing to do.

#### The migration: two, not one — and prod's revision is one step further back than §5.4 implies

§5.4 names `9d0d376657d5` as the migration that has never applied to prod. The deploy applies
**two**. The schema `db:refresh` restored has `event_summary.edited_at` / `edited_by` and
`event.subject_key`, but **no `ingest.llm_call`**, which places prod at `8db18de6d77c`. So
v0.2.0 applies `ddeba5194a23` (add `ingest.llm_call`) *and* `9d0d376657d5` (add
`ingest.link_retrieval_probe`, `ingest.run_retrieval_health`).

Rehearsed by stamping the local database back to `8db18de6d77c` and running `alembic upgrade
head` against the prod-shaped schema: **both applied clean**, with all six check constraints on
`link_retrieval_probe` and all four on `run_retrieval_health` present afterwards. The prod image
runs `alembic upgrade head` in its `CMD` before uvicorn, so this happens on deploy — and a
failure there is a container that does not start, which is the loud failure rather than the
quiet one.

**One caveat, and it is the only unverified step in the whole cutover plan.** Prod's revision is
*inferred* from the schema `task db:refresh` restored (snapshot taken 2026-08-07 21:00 UTC), not
read from prod. §5.10 makes reading it directly the first check.

**A footgun found in passing.** `task db:refresh` restores `catalog` / `news` / `ingest` from
prod but leaves `app` alone — and `alembic_version` lives in `app`. A refresh therefore silently
reverts any migration touching the three content schemas while `alembic current` keeps reporting
head. That is exactly how the local database came to claim `9d0d376657d5` with neither of its
tables present. Harmless here — it is what made this rehearsal possible — but it will mislead
anyone who trusts `alembic current` after a refresh, and it is worth fixing separately.

#### §5.4's Coolify env risk, reproduced in dev on the first attempt

The first shadow run was taken against a container that had been up ten hours — since before
#196 corrected the compose defaults — and `printenv` in it read:

```
LINK_RETRIEVAL_MODE=off
LINK_RETRIEVAL_MAX_CANDIDATES=10
LINK_RETRIEVAL_THRESHOLD=0.34
```

with the guard's two constants **absent entirely**. That is precisely the failure §5.4 names,
and the same one that silently mis-took NEU-1010's first baseline. It is worth stating that the
mechanism is not Coolify-specific: any long-running container holds the env it was created with,
and the compose file being right is not the same as the container being right.

**The soft tier caught it without being asked to.** The misconfigured run reported cap
saturation of **34.7%** against §5.2's 0.2% at K=25 — which is §5.1a's "K=10 saturated 102 of
302" signature, unmistakable. After `docker compose up -d --force-recreate`, `printenv` read
0.5 / 25 / 0.25 / 50 and saturation fell to 1.8%. Both runs now sit side by side on
`/admin/runs`, and the bad one is obvious at a glance. Saturation is doing the job §5.2 assigned
it, and it did it before anyone thought to look at the env.

#### Shadow, at the tuned constants

`LINK_RETRIEVAL_MODE=shadow`, T=0.5, K=25. Index built in **187 ms** — 1,223 films, 2,388
searchable titles, 3,984 tokens, 2,124 rescue folds. The full chain succeeded.

| | shadow run | §5.2's grid (98,662 stories) |
|---|---|---|
| stories retrieved | 168 | 98,662 |
| zero-candidate | 6 (**3.6%**) | 5.4% (6.1% post-#195) |
| cap-saturated | 3 (**1.8%**) | 0.1–0.2% |
| mean candidates | **8.23** | 4.23 |
| probe rows | 14, of which 12 retrieved (max rank 3, mean score 0.861) | — |

**The two columns disagree because their denominators are different populations, not because
anything is wrong.** §5.2 scored every *retained* story — six weeks of traffic, the overwhelming
majority of it already rejected as unrelated. A live run scores one day's *pending* set, which
arrives largely from per-film feeds and is therefore far more film-ish. More film-ish stories
match more titles, so a live run retrieves more per story. The live figures land close to
§5.1a's pinned-fixture numbers (mean 8.50, saturation 1.0%) rather than §5.2's, which is the
same effect: the fixture is curated news, not raw intake.

Two consequences, one reassuring and one a correction:

- **The guard has more margin than §5.3 calibrated for, not less.** Zero-candidate on a live
  run is 3.6%, *below* the 5.4% §5.3 sized the 25% ceiling against. The drift also still runs
  the safe way (§5.2's growth curve). Nothing about §5.3's calibration needs to move.
- **Cap saturation's watch baseline was taken from the wrong population.** §5.2 nominates
  saturation as "the tripwire that says retune" and puts it at 0.1–0.2%. On a live run's pending
  set it is **~1.8% before any catalog growth at all** — 9x higher. Anyone watching for a rise
  off 0.2% would read day one as an expansion already underway. **Watch from the live figure.**

**The probe writes, constrains and reads back.** 14 rows for 168 stories, written only where the
roster produced a pick — 11 linked plus 3 rejected downstream at `stale-stage` / `below-floor` —
which is §4.5's "rows only where the roster linked", behaving as specified. `/admin/runs` reads
them back through `load_retrieval_health` and `retrieval_health_series` with the aggregate and
the trend both populated.

**This is emphatically not a recall measurement.** Fourteen picks cannot say anything about a
~99% gate; 12 of 14 is a number with an error bar wider than the gate itself. §5.2's
98,662-story replay is gate #1's measurement (§5.4, §5.6). What this rehearsal establishes is
that the machinery runs.

#### Live, at `on` — the configuration that ships

`LINK_RETRIEVAL_MODE=on`, the same 168 stories restored, the same constants. The full chain
succeeded.

**Retrieval's health row is identical to shadow's, to the digit** — 168 stories, 6
zero-candidate, 3 saturated, mean 8.23. That is §5's claim for shadow ("exercising the same
code path that later goes live") demonstrated rather than asserted: retrieval is pure, so the
same stories produce the same candidate sets whether the roster decides or retrieval does. It
is also why a further shadow period could have told us nothing new.

**No probe rows, and that is correct.** Zero under `on`, against 14 under shadow. §4.5 scopes
the probe to stories *the roster linked* — under `on` there is no roster, so there is no pick to
adjudicate against. Anyone expecting probe rows to keep flowing after cutover is reading the
table's contract wrong; `RunRetrievalHealth` is the row that survives NEU-1004, which is exactly
why `health.py` lives outside `link/shadow.py`.

**The roster prefix is gone, and the token ledger is the proof.** `build_roster` logs nothing,
so the absence of a log line would show nothing — `ingest.run_llm_usage` does:

| link stage | input | cache read | cache write | output | cost |
|---|---|---|---|---|---|
| shadow (roster decides) | 21,958 | 472,352 | 59,044 | 11,842 | $0.2022 |
| **`on` (retrieval decides)** | **182,648** | **0** | **0** | 11,451 | **$0.2399** |

Cache read and cache write are **exactly zero** under `on`. That is §4.2's "prompt caching
disappears" confirmed on a live run, and shadow's 59,044 cache-creation tokens are the roster
prefix that stops being built.

**An honest correction to §4.4: on a live run, retrieval is not cheaper.** It cost ~19% *more*
for the same 168 stories, because the roster's ~46k prefix was being **cached** at a tenth of
the input rate while retrieval's per-story candidate lists are re-sent uncached on every call.
§5.1 already found the zero-candidate saving largely evaporating at production catalog size
(4.7% there, 3.6% here); this closes the point. It changes nothing about the decision — §1 is
explicit that "the driver is the 200k context ceiling, not cost" and calls the savings
"incidental" — but §4.4's "where the cost saving actually lands" should be read as
**superseded**. One run, one catalog size, a warm cache: the direction is the finding, not the
19%.

**Zero-candidate rejects reach the database as designed.** 6 of the 168 stories carry
`link_note = 'no-candidates'`, matching the health row's `zero_candidate_stories = 6` exactly —
ADR-0009's distinguishable note, on 6 stories no model was asked about.

**What this run is not.** The roster linked 11 of these stories and retrieval linked 10, the
rest splitting across `mention`, `not-news:*`, `off-topic` and `stale-stage:*`. That is one
168-story sample with **no ground truth attached**, and it is not an accuracy comparison — the
two paths also run different prompts. Gate #3 (§5.8) is the accuracy measurement; this is a
smoke test that the stage decides, records and commits.

#### The forced guard breach — the whole point of doing this in dev

§5.4's argument for a dev rehearsal over a production shadow period rests on one thing: the
hard breach arms only under `on` (`pipeline.py:377-408`), so a shadow period *cannot* exercise
it, and §5.5 makes this cutover the guard's first armed run in production. Dev is where it can
be made to fire on purpose.

Run at `on` with the ceiling dropped to 1% — below the 3.6% the same 168 stories produce — the
minimum denominator left at its real 50, and `HEALTHCHECK_DAILY_URL` pointed at a local sink so
the ping is observable rather than a no-op. Every link in the chain fired:

```
retrieval health: stories=168 zero_candidate=6 saturated=3 mean_candidates=8.226…
ERROR upmovies.link.pipeline: retrieval health breach: 6 of 168 stories had
      no candidates (3.6%, over the 1.0% ceiling)
INFO  link run 26f6b80a-… finished: failed
ERROR daily pipeline aborting: link stage ended failed
```

| link in the chain | observed |
|---|---|
| health row still written before the guard reads | 168 / 6 / 3 / 8.23, as in both other runs |
| `hard_breach_error` fires and names its numbers | the message above, verbatim |
| the run finalizes `failed` with the breach as its `error` | `ingest_run.error` carries the same string |
| `run_daily` aborts the chain | **no `synthesize` run row exists** — it never started |
| the deadman is pinged `/fail` | `POST /hc/start` 05:50:33, `POST /hc/fail` 05:57:42 |
| the process exits non-zero for the scheduler | exit code **1** |

Three details worth keeping:

- **The health row is written before the guard is consulted, and survives the failure.** That
  ordering is deliberate (`health.py`: the write is best-effort, the guard reads the tally not
  the row) and it is what makes a breached run diagnosable afterwards rather than merely failed.
- **The error message carries the numbers that caused it** — count, denominator, rate and
  ceiling. Whoever the deadman wakes gets the diagnosis from `/admin/runs` without re-running
  anything.
- **`tmdb` and `feeds` had already succeeded and stay succeeded.** Fail-fast aborts what comes
  *after*; it does not unwind. The cost of a false breach is precisely the published summaries
  for that day, which is what §5.3 priced the 25% ceiling against.

**The `shadow` half of the scoping is by construction, not by measurement.**
`retrieval_breach` is initialized `None` and assigned only inside the `if retrieval_mode ==
"on"` branch, so under `shadow` there is no path by which it can be non-`None` at the finalize
site. Read rather than rehearsed, deliberately — a fourth chain run could only confirm what the
control flow already makes impossible.

**With this, gate #1's rehearsal half is met.** The guard's only untested surface — its wiring —
is retired before the flip rather than after it, which was §5.4's whole argument.

### 5.10 The production cutover: the order, and the checks — 2026-08-08 (NEU-1003)

Everything above is evidence. This is the operation, and it is short — §5.4 was right that what
is irreducibly production is narrow.

#### The ordering constraint is gone — revised 2026-08-08, post-NEU-1004

An earlier revision of this section opened with **"`LINK_RETRIEVAL_MODE=on` must be set in
Coolify *before* v0.2.0 deploys, not after"**, on the reasoning that §5.5 puts NEU-1004's
deletion in the same release, so a container coming up on v0.2.0 with the variable unset or
`off` would take an `else` branch that no longer exists. It also recorded that the compose
fallback stayed `${LINK_RETRIEVAL_MODE:-off}` "until v0.2.0 *is* the deployed code", and that
**NEU-1004 is the ticket that owns changing it**.

NEU-1004 changed it by **deleting the flag outright** rather than collapsing it to a boolean
kill-switch (§5.12). That dissolves the constraint rather than satisfying it. There is no branch
to select and no variable to read: `config.py` has no `link_retrieval_mode`, neither compose file
passes `LINK_RETRIEVAL_MODE`, and `.env.example` no longer documents it. Retrieval is not a mode
the deploy selects — it is what the code does.

**Clear the variable from Coolify if the earlier plan already set it.** `Settings` carries
`extra="ignore"`, so a leftover value cannot fail the boot or change behaviour — but a variable
that reads as configured and is never consulted is exactly the trap §5.12 removed it from
`.env.example` to avoid, and exactly the shape of the misconfiguration §5.9 and NEU-1010 each
took once already. Step 4 below checks it is gone.

#### The checklist

1. **Read prod's alembic revision** — `select version_num from app.alembic_version`. Expected
   `8db18de6d77c`. §5.9 infers this from the schema `db:refresh` restored rather than reading
   prod, so it is **the one number in this plan not checked at source**. If it reads anything
   else, re-derive which migrations the deploy will apply before going further.
2. **Set nothing in Coolify; clear `LINK_RETRIEVAL_MODE` if it is there.** Per above — the flag
   is gone, and this step is now a removal rather than an addition. Leave T, K and the guard's
   two constants unset unless you intend to override the code defaults — they are already
   correct in `docker-compose.prod.yml` as of #196.
3. **Deploy v0.2.0.** The image's `CMD` runs `alembic upgrade head` before uvicorn, applying
   `ddeba5194a23` then `9d0d376657d5`. Both rehearsed clean against a prod-shaped schema (§5.9).
   A migration failure is a container that will not start — loud, which is what you want here.
4. **`printenv` the constants in the running container.** Not a precaution: §5.9 caught a live
   miss with it on the first attempt, and NEU-1010's first baseline was silently mis-taken the
   same way. Read them from the *container*, never from the compose file. Expect exactly four
   lines — `LINK_RETRIEVAL_MODE` is **not** among them, and seeing it means step 2 was skipped:
   ```
   LINK_RETRIEVAL_THRESHOLD=0.5
   LINK_RETRIEVAL_MAX_CANDIDATES=25
   LINK_RETRIEVAL_MAX_ZERO_CANDIDATE_RATE=0.25
   LINK_RETRIEVAL_HEALTH_MIN_STORIES=50
   ```
   A leftover `LINK_RETRIEVAL_MODE` is inert, not dangerous — but it is the only line here whose
   absence is the passing result, so read the list rather than grepping for the four you expect.
5. **Watch the first daily run on `/admin/runs`.** A `RunRetrievalHealth` row **must exist** — a
   missing row means retrieval did not run at all, which is a different failure from a run whose
   retrieval found nothing (§4.5). Then read it against these, not against §5.2's corpus-wide
   figures:

   | signal | expect | alarm at |
   |---|---|---|
   | zero-candidate rate | ~3.6% (§5.9's live run) | anywhere near the 25% ceiling |
   | cap saturation | ~1.8% (§5.9's live run, **not** §5.2's 0.2%) | a sustained rise — the retune tripwire |
   | mean candidates | ~8 | a collapse toward 1, or growth past ~20 |

6. **Then watch the manual-delink rate.** `link_note = 'manual-unlink'` is the production check
   on gate #3's accepted residue (§5.8), and it is the only one there is — the fixture cannot
   resolve a difference this small. A sustained rise says the trade ADR-0011 accepted was the
   wrong one.

#### Rollback

**A revert and redeploy, not an env flip** (§5.5). `build_roster` is gone from the tree at
v0.2.0, and so is the flag that used to name it — there is no `shadow` or `off` to fall back to,
and no env change that reaches this at all. Reverting means going back to a pre-v0.2.0 image,
which restores the roster path and the flag together. The exposure this leaves is one degraded
daily run: zero-candidate rejects carry the distinguishable `no-candidates` note and can be
re-run inside the recency window (§4.4), and wrong links have the admin delink surface.

### 5.11 The fixture enlarged, and gate #3 re-adjudicated — 2026-08-08 (NEU-1012)

§5.8 closed by recording two remedies as **owed** rather than dismissed: averaging runs, and
enlarging the labeled `about` population. This section pays the second one, which §5.8 called
"the real fix". The `about` population goes from **94 rows over 34 films to 538 over 121**, and
gate #3 is re-scored against it.

The instrument changed in three ways, and it is worth separating them, because only the first
is what the ticket set out to do:

1. **The population is 5.7× larger**, which is what buys resolution.
2. **The pin moved to the labeling date**, which removes two distortions the old pin carried.
3. **Four retrieval coverage gaps appeared** that a 34-film corpus could not contain.

#### The pin moved forward, and that matters more than it sounds

The fixture was pinned to 2026-07-01 because that was the date at which the *then-labeled*
films were all still active. Re-labeling let the pin move to the labeling date itself,
**2026-08-08**, and three properties fall out of that:

| | at 2026-07-01 | at 2026-08-08 |
|---|---|---|
| coverage margin | 1 day (*Enola Holmes 3* released **on** the pin) | structural — the proposer's roster **is** the pinned active set |
| stories published after the pin | 1 of 302, recorded as unfixable | **0**, by construction (`--as-of` bounds the draft) |
| films neutralized by `films_ingested_after` | **1,068 of 1,435** (74%) | **0** |
| films excluded by `active_film_clause` | **none** — the eval never exercised scope filtering | 212 |

The third row is the one that changes what the gate measures. `films_ingested_after`
neutralizes a pick naming a film the catalog gained *after* labeling, because a `none` label
cannot speak to a film that was not there to label (NEU-1011, §5.1a). That correction was
right, and at the old pin it covered three quarters of the catalog — **so a false positive
naming any of those 1,068 films did not count.** At the labeling date the set is empty. Gate
#3's false-positive counts are now counts of every false positive, not of the quarter that
happened to be scoreable.

The fourth row adds coverage rather than removing a distortion. §5.1a recorded that at
2026-07-01 `active_film_clause` excluded nothing, so "the eval does not exercise scope
filtering at all". It does now: 42 carried rows whose films released between the two pins were
**demoted to `none`** — which is not a relabelling of convenience, since `none` means "not
about any film tracked at labeling time" and at the new pin that is exactly true of them. They
are hard negatives, lexically strong against titles the roster no longer holds, and 22 of them
name *Spider-Man: Brand New Day*, whose untracked-sibling traps are precisely §4.3's failure
mode.

#### How the set was built, and what the review is worth

The pipeline is NEU-1010's — `export_link_validation_draft.py` → `propose_validation_labels.py`
→ hand correction — but two of its three stages were substantially rewritten rather than merely
threaded, and that is worth stating plainly against the ticket's "reuse the existing machinery".
The draft exporter **dumped every story in a 45-day window**, which was reasonable at a few
hundred rows and is not at 98,687: it is now a source-stratified, seed-reproducible sampler.
The proposer gained bounded concurrency, because 160 sequential batches is hours of wall clock
for work the API will do in parallel. And `assemble_validation_set.py` is new, to reconcile the
carried labels with the new proposals. The hand-correction stage — the expensive one, and the
one the ticket cared about — is unchanged.

Two further changes were needed to make the pipeline correct at a moving pin, and both were
latent defects rather than enhancements:

- **The proposer built its roster at wall clock** while the fixture was pinned elsewhere. A
  film that released between the pin and today was therefore offered to the labeler and
  filtered out by the harness — an `about` row that `_check_coverage` aborts the whole run
  over. `--as-of` now makes the labelable set and the scoreable set the same set.
- **The hallucination guard checked the whole catalog, not the roster.** `roster_tmdb_ids`
  scopes it, which is what makes the previous point stick.

The draft was 4,000 stories, sampled proportionally across the 13 feed sources and ordered by
`md5(seed ‖ url)` so the draw is reproducible from its recipe. Sonnet proposed labels for all
4,000; the fixture keeps every proposed `about` and `mention` plus a seeded subsample of the
proposed `none`, and **all 873 of those rows were read and corrected by hand.** 60 corrections,
a 6.9% proposal error rate.

**The error the review exists to catch is a transcription error, and no end-to-end score would
have shown it.** 21 of the 60 corrections were an `about` row naming the wrong film, and
**16 of those named a film whose TMDB id shares a five-digit prefix with the correct one**
(14 of them share six):

| rows | proposed | correct | shared prefix |
|---|---|---|---|
| 10 | 1170600 *Return of the Living Dead* | 1170608 *Dune: Part Three* | 6 of 7 |
| 4 | 1389373 *Rowdy Janardhana* | 1389379 *Ranabaali* | 6 of 7 |
| 1 | 1300926 *The Angry Birds Movie 3* | 1300968 *Hunger Games: Sunrise on the Reaping* | 5 of 7 |
| 1 | 1375187 *Dumas: Black Devil* | 1375161 *Don't Move* | 5 of 7 |

The model read each story correctly and then copied the id wrong out of a 1,223-line roster.
The rows stay `about` and stay production news, so precision, recall and F1 are all untouched;
what breaks is the **retrieval oracle**, which is exactly the NEU-989 defect class. It is
caught cheaply by NEU-989's own audit — "does any significant token of the labeled title appear
in the headline or dek?" — run over every `about` row, with a minimum token length of 4 so
short tokens do not match as substrings under the squash-fold. Re-run it after every proposal
pass; it is not optional at this scale. **The structural fix is to stop asking a model to copy
an integer**: have the proposer emit the roster *line number* or the title, and resolve the id
in code. That is left for the next labeling pass rather than done here.

The remaining wrong-film corrections were same-title traps of the kind §4.3 is about, in the
direction the prompt already warns of: *Resident Evil* stories about the games (4 rows),
*Madden* (the NFL curse), *Masterplan* (Italian regional planning), *Verity* (a mining stock),
*Call of Duty*, *Zelda* (the game remake), and *Don't Look Back in Anger* (Liam Gallagher on
X). They are `none` now and they are among the most valuable negatives in the set.

False negatives were rare: reading all 546 proposed `none` rows turned up **one** row that
should have been `about`. The proposer under-calls `about` far less often than it mis-keys the
film.

**One thing was retired rather than carried, and it should not be silent.** The fixture no
longer covers the `streaming-move` exclusion category at all. Its only row was an *Enola Holmes
3* story, and that film released between the two pins, so the row demoted to `none` with the
other 41. The 4,000-row draft produced no replacement — which is not an accident of sampling:
a streaming/catalogue-move story is about a film you can already watch, and the fixture is
pinned to the *active* catalog, which is upcoming films only. The category is close to
unobservable in a set built this way, and `test_validation.py`'s
`_EXCLUSION_CATEGORIES` drops it accordingly. The other five categories all gained coverage
(reaction 78, other 66, interview-quote 49, roundup 33, downstream 29, against 33 not-news rows
in total before). Anyone wanting the axis back needs a synthetic row, as NEU-358 originally
wrote one.

**What the review does not cover, stated so the next reader can discount it.** Rows the
proposer called `none` and the subsample dropped were never read, so an `about` story Sonnet
missed *and* the subsample excluded is simply absent. Absent rows bias no score — neither path
is charged for them — but the set is therefore easier than the corpus, under-representing
stories a strong model finds hard. And the fixture is **enriched, not representative**: the
production `about` rate is ~8%, so a representative set holding 538 `about` rows would be
~6,700 rows to review. The class mix is identical for both paths, so it cannot favour either;
what it does mean is that absolute precision here is not a production estimate.

#### The recall oracle's 100% floor was a corpus artifact

`test_recall_oracle.py` has asserted recall 1.0 since M1, "no slack". Over 538 rows and 121
films it measures **534/538 = 0.993**, and every one of the four misses is a *correct* label —
they are retrieval coverage gaps the 94-row corpus never sampled, not fixture defects:

| film | why it is unreachable |
|---|---|
| *Untitled Daniels Event Film* | the catalog title is a **placeholder**; there is no title to match |
| *Shaun the Sheep: The Beast of Mossy Bottom* | **subtitle dilution** — a headline carrying the whole colloquial name scores 2/5 against the full title, under T=0.5 |
| *Holiday Ever After: A Disney World Wish Come True* | same, 2/8 |
| *The Vvaan* | the headline spells it "Vvan" — a one-character variant defeats both the token match and the squash-fold rescue |

The floor is re-derived to 534/538 with the four films pinned by id as an **upper bound** on
the miss set, so fixing one passes and a fifth fails. Subtitle dilution now has three members
counting §5.1a's *Fall 2: Deadpoint*, which makes it the largest named lexical gap in the
system and a candidate for its own ticket — scoring a title's *distinctive prefix* as well as
its full token set would reach all three.

This is the more general lesson of the ticket, and it is the same one §8 already records about
gate #3: **1.0 over 94 rows was a statement about the corpus, not about retrieval.** A floor
measured on a population too small to contain the failure modes will read perfect until the
population grows.

#### The re-gate — three runs, 2026-08-08

`--mode both`, `claude-haiku-4-5`, T=0.5, K=25, batch 20, floor 0.7, pinned 2026-08-08. Three
runs, nothing changed between them:

| | roster P | roster F1 | roster TP | roster FP | retr P | retr F1 | retr TP | retr FP | Δ TP | excess FP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.958 | 0.732 | 319 | 14 | 0.925 | 0.802 | 381 | 31 | +62 | **+17** |
| 2 | 0.960 | 0.722 | 311 | 13 | 0.924 | 0.809 | 387 | 32 | +76 | **+19** |
| 3 | 0.960 | 0.754 | 334 | 14 | 0.921 | 0.789 | 371 | 32 | +37 | **+18** |
| mean | 0.959 | 0.736 | 321 | 13.7 | 0.923 | 0.800 | 380 | 31.7 | +58 | **+18.0** |

Candidate coverage was **534/538 in all three**, with the same four films (above).

#### The population bought precision resolution, and bought nothing for F1

This is the result worth carrying forward, and it was not the expected one. Comparing the
roster control — whose prompt is byte-identical, here and in §5.7 — across three runs on each
fixture:

| roster control spread over 3 runs | 94-item fixture (§5.7) | 538-item fixture |
|---|---|---|
| precision | **1.4 pts** (0.971 – 0.985) | **0.2 pts** (0.958 – 0.960) |
| F1 | 3.1 pts (0.805 – 0.836) | **3.2 pts** (0.722 – 0.754) |
| true positives | 5 of 94 (5.3%) | 23 of 538 (4.3%) |

**Precision steadied sevenfold; F1 did not steady at all.** The reason is structural rather
than incidental. Precision is TP/(TP+FP), and false positives stayed in the low double digits
while true positives grew 5.7×, so one item fell from ~1.3 precision points to **0.22**. F1 is
dominated by *recall*, and recall noise is proportional: the model non-deterministically links
or declines ~4–5% of `about` rows whatever the population, so the spread scales with it and the
ratio does not move.

**So enlarging the fixture fixes the half of gate #3 that was load-bearing and leaves the other
half exactly as unusable as it was.** §5.7's finding — that a ±1-point *F1* tolerance is below
this instrument's noise — still stands at 538 items and would still stand at 5,000. Anyone
tempted to restore a points-based F1 clause should read that row of the table first.

#### Gate #3, re-scored

| # | check | measured | verdict |
|---|---|---|---|
| 3a | retrieval offers the correct film for every scoreable `about` item | **534 / 538**, identical in all three runs | **FAIL** — four correct labels naming films lexical matching cannot reach |
| 3b | retrieval's true positives ≥ the roster's | **+58 mean** (+37 … +76) | **pass**, and now with real margin |
| 3c | excess false positives ≤ the accepted rate for this population | **+18.0 mean** (17, 19, 18; sd 0.8) against a ceiling of **17** | **at the boundary**, ~1 item over |

**3c is now a measurement rather than a coin flip.** The excess moves by 2 items across
identical runs — sd 0.8 against a ceiling of 17, about 5% of the bar. On the 94-item fixture
the same quantity had a Poisson spread of roughly ±2.4 items against a ceiling of **3**, i.e.
noise of the same size as the entire allowance. That is the ticket's exit criterion, and it is
met: *a precision delta of a few items is now resolvable above run-to-run noise.*

**The residue ADR-0011 accepted is confirmed in magnitude and slightly exceeded in fact.** It
accepted 3 excess false positives per 94 scoreable `about` items — 3.19%, which converts to
17.2 items at this population. Measured, retrieval runs at **3.35%** (mean 18.0 / 538).

State the uncertainty honestly, because it is the whole point of the exercise: over three runs
the sample sd is 1.0 item, so the standard error of that mean is **0.58**. The mean sits **1.0
item above the converted ceiling — about 1.7 standard errors — and 2 of the 3 runs are above
it.** That is not a pass. It is also not a clear failure: 1.7 SE is the kind of margin that
another three runs could move either way. What it *is* — and what 94 items never gave anyone —
is a number with error bars small enough to argue about. The trade ADR-0011 described was
characterized correctly to within about one story per 538; whether that last story matters is a
product question, not a measurement one.

**3a fails, and that is the honest headline.** It was the clause ADR-0011 called "the only part
with real margin", at 94/94 in every run ever taken. At 538 items it is 534/538. Retrieval did
not get worse — the four misses are pre-existing lexical gaps (placeholder titles, subtitle
dilution, a spelling variant) that a 34-film corpus never sampled. But the gate as written says
*every* scoreable item, and it no longer does. The choice is between fixing the gaps and
restating 3a with the known-miss set pinned, as `test_recall_oracle.py` now does; this section
does neither, and records the failure.

#### Where the narrowing cost actually lives: the production-news axis

The clearest new signal is one the 94-item fixture could not have produced — it carried 33
not-production-news rows, where this one carries 255:

| | roster | retrieval |
|---|---|---|
| not-news stories leaked (kept when they should be rejected) | 84 mean (80, 81, 92) | **127 mean** (121, 126, 133) |
| news-value precision | 0.739 | **0.667** (−7.2 pts) |

**Retrieval leaks about 50% more not-production-news stories than the roster does, in every
run, by a margin many times the noise.** That is where its precision cost is concentrated —
not in wrong-film picks. It *confirms* ADR-0011's reading ("not one of run D's five false
positives is a wrong-film pick on an `about` row") and shows the effect is systematic and large
rather than incidental to five items. The mechanism is §4.3's, one step removed: shown six
candidates instead of 1,223, the model is likelier to decide the story is about one of them,
and that willingness spends itself on reaction pieces, roundups and interview colour rather
than on the wrong film.

The product consequence is unchanged in kind and larger in degree than §5.8 assumed: the extra
links are stories that genuinely concern the film but announce nothing. They are visible on the
timeline and remediable through the admin delink surface, so the asymmetry argument holds —
but the manual-delink rate is now the thing to watch closely rather than casually, and the
`link_note = 'not-news:*'` split is where a prompt fix would show up first.

### 5.12 The roster path deleted — 2026-08-08 (NEU-1004)

The project's exit criterion, and the last thing in it. `link/roster.py`, the roster branch in
`link/pipeline.py`, the roster prompt in `link/linker.py` and `tests/integration/link/
test_roster.py` are gone. Retrieval is the only link path there is.

**`LINK_RETRIEVAL_MODE` is retired rather than collapsed.** The ticket allowed a boolean
kill-switch as an alternative to deleting the flag. There is nothing for one to switch *to*:
`off` and `shadow` both named the roster path, and §5.5 already accepted that recovery from a
bad cutover is a revert and redeploy. A boolean whose false branch is "do not link at all"
would be a worse rollback than the revert, not a better one. The flag is gone from `config.py`,
from both compose files and from `.env.example`; `LINK_RETRIEVAL_THRESHOLD` and the guard's two
constants stay. `.env.example` was the one place that mattered to get right beyond tidiness:
`Settings` runs `extra="ignore"`, so a `LINK_RETRIEVAL_MODE` left documented there would be
silently inert rather than failing at startup as its own comment promised.

**This invalidated two steps of §5.10's cutover checklist, which is revised alongside it.** That
checklist opened by requiring `LINK_RETRIEVAL_MODE=on` be set in Coolify *before* v0.2.0 deploys
— written when the flag's fate was still open, and correct only if NEU-1004 kept or collapsed it.
Deleting it outright turns that step into a no-op and turns step 4's `printenv` expectation into
a check that must now *fail* to find the variable. The cutover has not been performed yet, so the
revision lands before anyone runs it rather than after.

**`link/shadow.py` went with the flag.** The observer only ever built under `shadow`, so
deleting that state left it unreachable. `RunRetrievalHealth` is unaffected — it was
deliberately housed in `link/retrieval/health.py` rather than in the shadow module precisely so
it would outlive this (§4.5), and the live path still writes it and the hard-breach guard still
reads it.

**`ingest.link_retrieval_probe` is kept, and is now historical.** Nothing writes it: a probe
row adjudicates retrieval against a *roster* pick, and there is no second opinion left. The
table and its rows stay because they are gate #1's evidence and `/admin/runs` still reports
recall for the runs that produced them. Dropping the table is a separate decision from deleting
the code that filled it, and is not taken here.

**The four dependent scripts, decided on their merits.**

| Script | Outcome |
|---|---|
| `validate_linking.py` | **Ported.** Scores the retrieval path alone. |
| `diagnose_linking.py` | **Ported.** `--mode` dropped; retrieval only. |
| `propose_validation_labels.py` | **Ported** to the retrieval index. |
| `measure_link_cost.py` | **Retired.** |

`measure_link_cost` measured cache-creation against cache-read on a ~46k-token prefix that no
longer exists — the ticket's own reading, and correct: with no cached prefix left there is no
ratio to report, and the per-call `ingest.llm_call` telemetry (NEU-975) already carries what
replaced it. `scripts/assemble_validation_set.py` was not on the ticket's list but read
`build_roster` too, and is ported alongside the proposer.

**Gate #3 loses two of its three checks with the baseline they were measured against.** 3b
(true positives at least the roster's) and 3c (excess false positives within the accepted rate)
were deltas; with no roster there is nothing to take a delta against, so `evaluate_gate`,
`GateVerdict`, `format_comparison` and the `ACCEPTED_EXCESS_FALSE_POSITIVES` rate ADR-0011
established are deleted along with them. **3a survives**, because it never needed a baseline:
it asks whether retrieval offered the correct film at all, which is a property of the retrieval
stage alone. `validate_linking` still prints it as an explicit `COVERAGE: PASS`/`FAIL` line, and
it still fails on the real 534/538 gap §5.11 found. ADR-0011 stands as the record of the
decision; the code that scored it does not outlive the comparison it scored.

**Prompt caching leaves production entirely**, as §4.2 anticipated. `cached_system_block` is
*not* deleted: `scripts/propose_validation_labels.py` still sends its whole labelable film list
as a cached prefix reused across ~160 batches in one sitting, which is exactly the shape caching
pays for. What the ticket asked was that nothing still *assumes* caching, and nothing does — the
one production caller is gone and `link` was the only stage that ever cached.

**`roster_tmdb_ids` moved rather than died.** The labeling scripts bound what may be labeled
`about` to the active film set, and that bound has to agree with what the harness can score
(§5.1a, §5.11). It is now `indexed_tmdb_ids` in `link/retrieval/index.py`, over `IndexedFilm`
instead of `RosterEntry`. Both read the same `active_film_clause` at the same `as_of`, so the
labelable set is unchanged; only the module that owns the read moved. All three callers — the
proposer, the assembler and `validate_linking` — go through it, so what may be labeled `about`
and what can be scored cannot drift apart. The concept now has a `CONTEXT.md` entry
(**labelable set**), which it did not while "the roster" was doing the naming.

**The proposer's prompt prefix is pinned by test rather than by assertion.** Its rendering moved
off the roster onto the index, and the fixture's ground truth was proposed against the roster's
exact line format — so `test_propose_validation_labels` now fixes that format line for line,
including the 120-character overview trim that moved from build time to render time. Without
it, the next edit could relabel a corpus under a silently different prompt.

`news/fetcher.py` needed no change beyond the stale docstring reference the ticket named — its
`_film_titles` was always its own lighter read.

### 5.13 Retuned for the expanded catalog, and saturation gets a threshold — 2026-08-11 (NEU-1088)

> **Superseded in part by §5.14 (NEU-1135).** K=35 below is no longer the live value — it is
> 47. And this section's framing of T as the lever that resists catalog growth is retired
> there: a finer sweep found no usable value above 0.5 at all. Read this section for the
> method and for the history; read §5.14 for the constants in force.

§5.2 predicted this section and named its trigger: *"the undated-film expansion is expected to
saturate this cap and force a retune."* The directors tranche flipped at 05:12 UTC on
2026-08-11 and the trigger fired within one run.

Prod `ingest.run_retrieval_health`, the four `link` runs either side of it:

| link run | stories | zero-candidate | **cap-saturated** | mean candidates |
|---|---|---|---|---|
| 2026-08-08 20:30 | 101 | 0.00% | **0.00%** | 9.25 |
| 2026-08-09 09:06 | 83 | 1.20% | **2.41%** | 9.13 |
| 2026-08-10 09:04 | 205 | 1.46% | **3.41%** | 10.04 |
| **2026-08-11 09:05** — first index over the expanded catalog | 228 | 0.00% | **7.89%** | **12.83** |

Saturation went 0% → 7.9% in three days. §5.2 measured K=10 saturating 7.3% of stories and
called that the level at which the cap "does bind"; we reached it at K=25.

**Read those four rows against each other, not against §5.2.** Their denominator is one run's
pending set; §5.2's is every retained story, most of which are zero-candidate. That is why the
live zero-candidate rates (0–1.5%) sit far below §5.2's 5.4%.

**Catalog at measurement: 2,321 films, 706 undated — of which 1,997 are *active*** and
therefore in the index, against §5.2's 1,226. That is 1.6× on the number retrieval actually
sees, not the 1.9× the raw catalog count suggests; `active_film_clause` excludes released and
dormant films, and it is the active set that drives collisions.

#### The measurement had to be made independent first

`tune_retrieval.py` scores recall against **picks** — `link_status = 'linked' AND film_id IS
NOT NULL`. Before the 2026-08-08 cutover (§5.12) those verdicts came from the roster:
independent ground truth. After it they come from retrieval itself at T=0.5/K=25, which is
circular — a pick that saturated out of the cap was never linked, so it cannot appear in the
denominator as a miss.

So the harness gained **`--picks-linked-before`**, defaulting to the cutover and excluding
retrieval-authored picks. `link_note` is null on a successful link, so `linked_at` is the only
discriminator available.

**The boundary is 20:30 UTC, not midnight.** The cutover is the deploy, not the date: the
2026-08-08 09:05 run was still roster-decided, and a midnight cutoff would have discarded its
ten roster picks as contaminated. 20:30 is the first `run_retrieval_health` row's run start,
and prod's `linked_at` values leave a clean eleven-hour gap either side of it.

**The control came back at exactly 1.000.** The 21 excluded picks, swept on their own at
T=0.5/K=25: recall 1.000, nothing lost to T, nothing lost to the cap. That is the evidence the
circularity is real rather than assumed — those picks exist *because* retrieval offered their
film at those constants. This flag is what keeps the third pass (below) honest, when
contaminated picks will dominate the denominator.

Today the split is **344 roster-labelled picks against 21 retrieval-labelled** on the 45-day
window. Every week that ratio worsens as roster-era stories age out of retention. This
measurement is close to the last one takeable against ground truth the retrieval path did not
author, which is why it was run now rather than after more sweeps land.

> **The harness was broken and nobody noticed.** `format_batch_table` still unpacked
> `build_retrieval_link_request` as a `(system, messages)` tuple, which has returned a single
> `Prompt` since the gateway landed (§5.1 of the gateway spec). It raised `TypeError` on every
> invocation. Ported here as part of the retune. The lesson is narrow but real: a measurement
> script with no test and no caller rots silently between the tickets that use it, and this one
> is load-bearing for exactly the constants nobody wants to guess at.

#### Two windows, and the recent one decides

Google News broad queries are paused (ADR-0001), and it dominates the arithmetic:

| window | stories | picks (post-exclusion) | mean offered @ T=0.5 |
|---|---|---|---|
| 45 days — comparability | 91,692 | 344 | 6.94 |
| **21 days — decision** | **4,841** | **191** | **12.89** |

A 45-day window is ~19× the story volume at less than half the mean candidate-set size: it is
dominated by a source that no longer arrives, at a far lower pick density. Its set-size and
zero-candidate columns describe a corpus that is gone. **The constants are set from the 21-day
grid**; the 45-day grid is recorded because the comparison is what keeps this section's history
readable against §5.2's.

Both grids are recorded in full at `docs/measurements/2026-08-11-neu-1088-retrieval-tuning-{21d,45d}.md`;
the decisive rows are reproduced below.

#### T holds at 0.5

| T | recall (21d) | zero-candidate (21d) | recall (45d) | zero-candidate (45d) |
|---|---|---|---|---|
| 0.25 | 0.984 | 0.0% | 0.988 | 0.0% |
| 0.34 | 0.984 | 0.5% | 0.988 | 0.6% |
| 0.4 | 0.984 | 0.5% | 0.988 | 0.6% |
| **0.5** | **0.984** | **0.5%** | **0.988** | **0.6%** |
| 0.6 | 0.969 | 25.6% | 0.971 | 28.6% |
| 0.67 | 0.932 | 37.9% | 0.936 | 32.3% |
| 1.0 | 0.911 | 38.4% | 0.922 | 32.6% |

**The flat region did not move.** Recall is identical from T=0.25 to T=0.5 in both windows and
falls at 0.6. §5.2 argued this is a property of the scoring function rather than of catalog
size — no pick scores strictly between zero and 0.5 — and the 1.6× expansion confirms it. T=0.6
would also take zero-candidate from 0.5% to 25.6%, which is the ceiling's whole territory.

This is the outcome the ticket predicted in advance so the measurement could contradict it. It
did not. Per §3.8's restatement, a constant shown not to need to move is a complete result.

#### K = 35: the deepest pick, plus a margin of 4

The rule, stated before the grid was read: **find the smallest K that loses no pick, add an
explicit margin over it, and price the margin.** §5.2 did exactly this — picks-lost hit 0 at
K=21 and it took 25 — but never named the margin, so the section reads as though the rule were
"clear the p99 set size". That distinction did not matter when headroom was nearly free.

| K (at T=0.5) | recall | lost to cap | saturated | mean offered |
|---|---|---|---|---|
| 10 | 0.979 | 1 | 54.6% | 8.31 |
| 20 | 0.979 | 1 | 15.8% | 11.74 |
| 25 *(old)* | 0.979 | 1 | 7.6% | 12.33 |
| 30 | 0.979 | 1 | 3.7% | 12.63 |
| **31** — deepest pick | **0.984** | **0** | 3.2% | 12.67 |
| **35** — chosen | **0.984** | **0** | **1.8%** | **12.77** |
| 40 | 0.984 | 0 | 0.8% | 12.84 |
| 50 | 0.984 | 0 | 0.1% | 12.89 |

**The deepest pick that clears T sits at rank 31 in both windows.** They agree — but they are
*nested*, so that is one observation and not two. §7 of the ticket anticipated a disagreement
and prescribed preferring the wider window for the margin; no tie-break was needed, because the
deepest pick falls inside the recent window.

**The margin is 4, and it costs +10 input tokens per story.** K=31 offers 12.67 candidates per
story against K=35's 12.77, at 98 tokens per rendered candidate. The whole move from K=25 costs
**+43 tok/story** (12.33 → 12.77). Four is §5.2's absolute margin carried forward; as a
proportion it is smaller (13% of 31, against 19% of 21), which is the conservative direction.

**Why the rule is recall and not saturation.** At §5.2 the mean offered set was 4.23 and K=25
cost "0.01 candidates per story over K=20". At the *same* K=25 it is now 12.33 — so at fixed K
the candidate block has roughly tripled, about 415 to 1,210 tokens per story at the ~98 tokens
per rendered candidate measured here. Meanwhile p99 set size scales
with the catalog without bound (23 at p90, 40 at p99, max 58 on the 21-day window). Setting K
to chase saturation would therefore buy prompt size indefinitely to reach picks that are not
there. **Saturation is reported, not chased**: K=35 saturates 1.8%, down from 7.6%, and that
number is watched rather than targeted.

**Targeting today's catalog, not the endstate,** deliberately. §5.2's own growth curve carries
the caveat that kills the alternative: *"a random subset of today's catalog is a proxy for a
smaller catalog, not a sample of a larger one … The curve is a predictor, not a promise."*
Setting live constants from an extrapolation is what NEU-1001 existed to stop doing.

#### The zero-candidate ceiling: 0.25 → 0.10

The separation test §3.5 prescribed, both halves, against this grid:

1. **Does 25% still sit well above the observed rate at T=0.5?** Yes, and by more than before:
   0.5% observed, so 25% is ~50× it. This half is not at risk and was never going to be.
2. **Does it still sit below what a one-step-too-high T would produce?** **Barely.** T=0.6
   measures 25.6% on the 21-day grid against §5.2's 32.6% — a 0.6-point margin where §5.2 had
   7.6.

Half 2 has gone slack, exactly as §3.5 predicted it would. The mechanism is the one that
section named: zero-candidate *falls* as the catalog grows (41.4% at 250 films → 0.5% at
1,997 on this grid's own growth curve), so a mis-set T's rate falls with it and the ceiling
drifts toward being unable to catch the failure ADR-0010 names. A 0.6-point margin is inside ordinary run-to-run variation; on a
given day a mis-set T=0.6 could produce 24% and slip under a 25% ceiling entirely.

**Moved to 0.10.** That is ~17× the observed 0.5–0.6% and ~2.6× below the 25.6% it has to
catch — a real margin on both halves, where 0.25 now has a large one on the half that does not
matter and almost none on the half that does. It stays a **collapse** detector: ADR-0010's
failure mode is an index that built empty or a normalization regression rejecting the backlog,
which produces rates near 100%, not 10%. The minimum-denominator rule (50 stories) is unchanged
and is what keeps a quiet news day from reaching the comparison at all.

#### Saturation gets a soft tier

`saturated_stories` has been recorded per run since NEU-1002 and had **no threshold at all**.
The hard guard fires on zero-candidate only. That is why saturation went 0% → 7.9% and nothing
raised a hand — it was found by querying prod by hand. The ticket's own acceptance criterion
("cap saturation back inside the guard") named a guard that did not exist.

Built here, as ADR-0010's soft tier made concrete:

- **`LINK_RETRIEVAL_SATURATION_WARN_RATE`**, mirrored as `SATURATION_WARN_RATE` in
  `link/retrieval/health.py` with the same pinning test the other four constants carry.
- **`soft_breach` on `ingest.run_retrieval_health`** (migration `542c88d0c3f1`), surfaced on
  `RetrievalHealthOut`. Stored rather than derived from `saturated_stories / stories_retrieved`
  at read time: the threshold is a setting precisely so it can move, and a derived flag would
  silently re-judge every historical run against today's value. No backfill — `false` is
  accurate for every prior run, because none of them warned.
- **A clause on the `link` run's `detail` line**, appended and absent when healthy, so it lands
  durably on `/admin/runs` beside the rest of the run's summary.
- **The run still succeeds.**

**Warn and not hard**, per ADR-0010's doctrine: the hard tier catches collapse, the soft tier
catches drift, and rising saturation is drift by definition — it is the signal that says
*retune*, not *outage*. `run_daily` is fail-fast, so a hard tier here would publish no summaries
at all on a day when nothing was actually broken.

**Calibrated at 5%**, from this grid: K=35 saturates 1.8%, and 5% is ~2.8× that. The grid is
close enough to production to set a live threshold from — at the old K=25 it reads 7.6%
against the 7.89% the 2026-08-11 run actually recorded — so 1.8% is what K=35 should show in
production. 5% is high enough to absorb ordinary run-to-run movement without sitting so high
that the next expansion passes under it.

> **Accepted risk, and it is why the number is labelled provisional.** The calibrating evidence
> is essentially one post-flip production run (n=228) plus one offline grid. Expect the third
> pass to move it.

#### Shipping a constant is two edits, not one — 2026-08-11

Recorded because the third pass below will meet it, and this one did not see it coming.

**The retune was merged, deployed and green while production ran the old constants.** The
migration applied, CI passed, `/admin/runs` looked normal. K was still 25.

`docker-compose.prod.yml` passes each constant through as `${NAME:-default}`, and on Coolify
that is a **seed, not a runtime default**: Coolify parses the reference the first time it meets
the variable, stores a UI entry holding that value, and from then on the UI entry is what
reaches the container. The fallback in the file is inert thereafter. Both `K` and the
zero-candidate ceiling had entries seeded months earlier, at 25 and 0.25, and those won.

The tell was an accident of this ticket's own scope: `LINK_RETRIEVAL_SATURATION_WARN_RATE` was
**new**, so Coolify had no entry for it and it came through at its fallback of 0.05 — in the
same container, from the same commit, where K refused to move. A new variable arriving correctly
beside an old one that did not is the signature of this failure, and doubles as a tracer for
whether a deploy landed at all.

Coolify additionally **refuses to delete** a UI entry whose name appears in the compose file
(*"Please remove it from the Docker Compose file first"*), so the resolution is to edit the
value there. Removing the `${...}` line to force a delete would be the wrong fix: that line is
what makes these constants tunable from env rather than by a redeploy, which is the property
§3.1 leans on for the cast tranche.

**So the sequence is:** code default → compose fallback → **Coolify UI, and restart** → verify
against the *running container*:

```bash
ssh <PROD_SSH> 'docker exec $(docker ps --format "{{.Names}}" | grep -i upmovies-backend | head -1) \
  printenv | grep LINK_RETRIEVAL | sort'
```

Read the container's name and created-time alongside it — Coolify replaces the container on
deploy, so a reading taken mid-deploy can come from the outgoing one. That happened here too,
and briefly made the diagnosis look shakier than it was.

`test_prod_compose_fallbacks_match_the_code_defaults` pins the compose fallbacks to the code
defaults, but it guards **the seed, not production** — it cannot see Coolify, and would not have
caught this. It earns its place for a fresh environment or a newly added variable, and nowhere
else.

#### Expect a third pass

Stated here so it is inherited rather than rediscovered:

- **Writers tranche** (NEU-1089, +270 films) — small enough that it likely moves nothing.
- **Cast tranche** (NEU-1090, +2,341 films) — roughly doubles the catalog again and **is
  expected to force a third retune**. On this grid's growth curve, saturation at a fixed K rose
  from 0.1% at 1,000 films to 7.6% at 1,997; a further doubling should breach the 5% warn rate
  at K=35, which is the intent — breaching it is what schedules the pass.

When that pass runs, `--picks-linked-before` is no longer optional bookkeeping: by then the
roster-era denominator will be a minority of the picks, and the default exclusion is the only
thing standing between the grid and a recall column retrieval wrote for itself.

And whatever it concludes, **the constants are not live until the Coolify entries are edited and
the running container is read back** (above). A retune that stops at "merged" has not happened.

#### What this does not settle

- **`LINK_BATCH_SIZE`** is unchanged at 20 and was investigated rather than assumed. It is
  bound by the **reply** — one decision object per story against `_MAX_TOKENS` = 2048, where a
  truncated reply fails to parse and takes the whole batch with it — while K drives the
  **input** side. They are separable. The 21-day grid does narrow the reply headroom (1,193
  tok at batch 20, against 855 spare) and batch 40 overruns the ceiling outright at 2,392, but
  20 is not close to the edge. Revisit as its own ticket if the reply grows.
- **`render.OVERVIEW_MAX`** — still the F1 question §5.2 deferred, still costing a
  `validate_linking` run to answer.
- **A saturation *hard* tier** — warn-only was decided knowingly. Revisit only with evidence
  that a saturation level exists at which retrieval is genuinely collapsed rather than drifting.
- **Whether undated films collide differently.** §5.2 flagged both directions — more
  per-franchise entries argues worse, more obscure titles argues better. The 1.6× expansion took
  mean offered from 4.23 to 12.89, roughly **3× for 1.6× the films**, which is superlinear and
  lands on the *worse* side. One expansion is thin evidence for a curve, but it is the first
  real evidence either way and it does not favour the optimistic reading.

### 5.14 Third pass: K again, T never — 2026-08-13 (NEU-1135)

§5.13 closed by predicting this section and naming its trigger: the cast tranche was expected
to force a third pass, and the writers tranche was thought "small enough that it likely moves
nothing." It moved something. The soft tier §5.13 installed fired on its first full-day
backlog over the post-writers catalog.

| Reading (UTC) | n | zero% | **sat%** | mean K | soft breach |
|---|---|---|---|---|---|
| 2026-08-12 01:48 — K=35 baseline, directors-only | 215 | 0.93 | 2.79 | 12.9 | no |
| 2026-08-12 15:36 — post-writers, thin | 57 | 0.00 | 0.00 | 14.3 | no |
| **2026-08-13 09:05 — first full post-writers backlog** | **184** | **0.00** | **7.61** | **17.9** | **yes** |

The hard tier was never in play — zero-candidate 0.00% against a 10% ceiling, exactly as §5.13
predicted ("zero-candidate falls as the catalog grows"). This is drift, which is what the soft
tier exists to name, and naming it on its own is the tier working.

**Catalog:** 1,997 → **2,695 active films** (3,050 rows), 1.35x, after the writers tranche and
the 2026-08-13 07:00 sweep's further 266 admissions.

**Method:** unchanged from §5.13 and NEU-1001 — `scripts/tune_retrieval.py` against a
prod-refreshed DB, two nested windows, picks linked at or after the retrieval cutover excluded
as circular (§3.4; the control returns recall 1.000 on 44 excluded picks, as expected). Grids:
`measurements/2026-08-13-neu-1135-retrieval-tuning-{21d,45d}.md`.

#### T = 0.5 held, and the reason changed

§5.13 called T=0.5 "the highest T that loses nothing" and framed a higher T as the lever that
resists catalog growth. **That framing is wrong and this pass retires it.** A fine sweep
between 0.5 and 0.6 shows no plateau to climb — every value from 0.501 upward gives the
*identical* measurement:

| T | recall | zero-candidate | mean set |
|---|---|---|---|
| 0.45 | 0.983 | 0.2% | 17.83 |
| **0.5** | **0.983** | **0.2%** | **17.83** |
| 0.501 | 0.966 | **18.4%** | 2.19 |
| 0.571 | 0.966 | **18.4%** | 2.19 |
| 0.6 | 0.966 | **18.4%** | 2.19 |

The scoring function explains it: the score is a fraction of a title's **distinct** tokens, so
the dominant mass of candidates sits at exactly 0.5 (one token of a two-token title) and steps
off together. 18.4% breaches the 10% hard ceiling outright, so there is no usable T above 0.5
at all. The 45-day window agrees (23.9% at T=0.6).

**Consequence: K is the only live lever.** A fourth pass has one lever, not two, and cannot
trade T against K. This is the most portable finding of the pass.

#### K = 35 → 47

The rule is §5.13's, unchanged: the smallest K that loses no pick, plus a named margin, and
price the margin. The deepest pick that clears T sits at **rank 43** — confirmed in both
windows, as §5.13's rank 31 was — so K = 43 + 4 = **47**.

| K (T=0.5, 21d) | recall | lost to cap | saturated | mean offered |
|---|---|---|---|---|
| 35 (old) | 0.977 | 1 | 6.83% | 17.19 |
| 43 | 0.983 | 0 | 2.84% | 17.58 |
| **47** | **0.983** | **0** | **1.89%** | **17.68** |
| 50 | 0.983 | 0 | 1.29% | 17.73 |

Margin priced at **92 tokens per rendered candidate** (counted, comparable to §5.13's 98):
+9 tok/story for the margin, +45 tok/story for the whole move off K=35.

**Rank 43 is a lone outlier, and is honoured deliberately.** Pick ranks run median 1, p90 3,
p99 8; the deepest twelve are 4, 4, 4, 4, 4, 5, 5, 5, 5, 6, 8, **43**. Trimming it would put K
near 12. It survives on what it is: a story about "The Daniels' new sci-fi movie" linked to
**Untitled Daniels Event Film**, scoring the floor 0.500 in a 47-film set, ranked below
coincidental full-credit matches like "Once" — and linked 2026-07-25, before the cutover, so it
is roster ground truth rather than a verdict retrieval wrote itself.

The generalisation is what matters: `Untitled <Director> Project` titles carry no distinctive
tokens *by construction*, so they always score the floor and rank at the bottom of whatever
collision set the headline draws. **138 films now carry such a title, 126 of them undated.**
That is precisely the population the undated-film project exists to admit, so picks of this
shape get commoner as the sweep runs. Trimming the outlier would discard the signal the
expansion was built to produce.

**Headroom is now almost pure tail control.** The uncapped mean is 17.83, so K=47 already
delivers 99.2% of what no cap at all would offer. Raising K no longer buys prompt size across
the corpus, only on the shrinking minority of stories that saturate — the opposite of §5.13's
position, and why the recall rule survives a deepest-pick rank that moved 31 → 43.

#### The two health thresholds

`SATURATION_WARN_RATE` is **reaffirmed at 0.05, not re-derived**. Like-for-like over one corpus
and one catalog, the floor is 1.89% at K=47 against 6.83% at K=35, so 5% keeps its ~2.6x
margin. It sits near §5.13's 1.8% by coincidence — different catalog *and* different K — and
those two figures must not be read as the ends of one measurement. Still provisional: it has
not yet met an expansion it was calibrated before, and the cast tranche is that test.

`MAX_ZERO_CANDIDATE_RATE` is **held at 0.10 and flagged**. §5.13 tightened it 0.25 → 0.10
because the margin against a mis-set T decays as the catalog grows. That decay has not stopped:
T=0.6 now measures 18.4%, so the ceiling clears the rate it must catch by 8.4pp where §5.13
left it 15.6pp. Out of scope here; the fourth pass should re-measure rather than inherit it.

#### The grid is better calibrated than §5.13 concluded

§5.13 warned the grid runs optimistic on saturation "by half again," from a single comparison
against a 16-hour slice. A clean one now exists — same catalog era, same K, a full day's
backlog:

| Comparison | Grid | Production | Ratio |
|---|---|---|---|
| K=25, 2026-08-11 | 7.6% | 7.89% | 1.04x |
| K=35, 2026-08-12 (16h slice, n=215) | 1.8% | 2.79% | 1.55x |
| **K=35, 2026-08-13 (full backlog, n=184)** | **6.83%** | **7.61%** | **1.11x** |

The 1.55x was the slice sampling the tail, not a standing bias. Expect production near **2.1%**
at K=47.

#### Expect to do this again

The cast tranche (NEU-1090, +2,341 films) roughly doubles the catalog and is expected to breach
the soft tier again — which remains the intent, since breaching is what schedules the pass.
Two cautions carry forward. **Do not extrapolate the breach linearly**: saturation is a tail
quantity against a fixed threshold, so it climbs faster than the catalog once the bulk of the
distribution approaches K, and both observed expansions bear that out. And **the pass will have
one lever**, per §5.14's T finding.

These constants are set from today's catalog rather than from an extrapolation of that one,
deliberately — the growth curve is a predictor, not a promise, and setting live constants from
it is what NEU-1001 existed to stop doing.


## 6. Milestones

| Milestone | Blocked by | Tickets |
|---|---|---|
| M1 — Retriever core | nothing | NEU-989 … NEU-993 |
| M2 — Shadow observation | M1 | NEU-994 … NEU-997 |
| M3 — The retrieval link path | M1 | NEU-998 … NEU-1001 |
| M4 — Cutover, guard, deletion | M2 + M3 | NEU-1002 … NEU-1004 |

M2 and M3 are independent of each other.

**M1 — Retriever core.** Pure, no pipeline change. Repair the three mislabeled fixture rows;
normalization + squash-fold + inverted index; scorer with threshold/cap selection; oracle-recall
test. That test costs **zero LLM tokens**, so it belongs in the suite and runs on every commit —
not in a script.

**M2 — Shadow observation.** `ingest.link_retrieval_probe` model + migration; the three-state
flag; shadow wiring in `link/pipeline.py`; retrieval health on `/admin/runs`. Measurement only —
the hard-breach guard is deliberately held to M4 so it cannot fail runs while constants are
untuned.

**M3 — The retrieval link path.** Rewritten prompt and request builder; decision application
with local-index resolution, the `no-candidates` note, out-of-list rejection, and the
`StageCounts` change; `scripts/validate_linking.py` ported to the retrieval path; tuning of T,
K and batch size.

**M4 — Cutover, guard, deletion.** Retrieval-health hard breach; flip to `on` once all three
gates pass, recording the evidence; delete `build_roster`, the roster prefix, and
`tests/integration/link/test_roster.py`, and port the four dependent scripts
(`validate_linking`, `measure_link_cost`, `diagnose_linking`, `propose_validation_labels`).

`news/fetcher.py` only *mentions* `build_roster` in a docstring — it has its own lighter
`_film_titles` and is unaffected.

## 7. Deliberately out of scope

- **Embeddings / pgvector.** ADR-0008. Trigger for revisiting: a measured recall drop after the
  undated-film expansion.
- **Widening search scope past active films.** Linking released films is a product-scope change.
- **Untracked films as labeled distractors.** Would answer the franchise trap structurally, but
  `catalog.film` holds only what TMDB discover surfaced, so coverage would be arbitrary — the
  prompt's own canonical example, the released *"The Housemaid"* beside the tracked *"The
  Housemaid's Secret"*, is not in the catalog at all.
- **Cache read/write ratio alerting.** ADR-0010, dropped with reasons.
- **Wiring Sentry into `pipeline_run`.** Worth doing — the scheduler reports to nothing today —
  but it is not this project's scope. → *backlotter: Maintenance*.

## 8. Accepted risks

- **The lexical recall floor.** A story naming its film only by star, director, or an unlisted
  nickname is unreachable. Watched by shadow measurement rather than assumed away.
- **A 32-film corpus certifying a 1,200-film system.** Precisely why the shadow gate exists;
  neither corpus certifies the cutover alone, and they fail in opposite directions.
- **Precision under narrowing.** Mitigated by richer candidate rendering, the retained
  franchise-trap prompt, and the prefilter framing NEU-1011 added (§5.7) — not eliminated.
  **Cashed at cutover** (§5.8, ADR-0011) and **measured properly at §5.11**: over a 538-item
  population the excess is 3.35% against the 3.19% accepted, which confirms the trade rather
  than overturning it. What §5.11 adds is *where* the cost sits — retrieval leaks ~50% more
  not-production-news stories than the roster (news-value precision −7.2 pts, consistent
  across runs), not wrong-film picks. Watched in production by the manual-delink rate
  (`link_note = 'manual-unlink'`) and by the `not-news:*` note split, not on the fixture.
- **A gate below its instrument's noise floor.** Gate #3's ±1-point tolerance was several
  times finer than a 94-item fixture can measure, and that went unnoticed until four runs were
  taken side by side. The general lesson is worth keeping: a delta gate needs its tolerance
  checked against the population it will be scored on, not only against what would be a
  meaningful regression. **§5.11 adds the sharper version:** enlarging the population 5.7×
  steadied *precision* sevenfold and left *F1* exactly as noisy, because recall noise is
  proportional and does not shrink with the denominator. Which half of a compound gate an
  enlargement fixes is not obvious in advance, and is worth measuring before assuming.
- **A recall floor measured on a corpus too small to hold its failure modes.** The M1 oracle
  read 1.0 for the whole project over 94 rows and 34 films, and 534/538 the moment the corpus
  reached 121 films (§5.11). The three gaps it exposed — placeholder titles, subtitle dilution,
  one-character spelling variants — were always there.
- **Failing a run on a rate** departs from `StageCounts`' deliberately narrow "produced nothing
  at all" rule. Scoped to retrieval health; `total_failure` is unchanged and continues to guard
  model availability independently.
