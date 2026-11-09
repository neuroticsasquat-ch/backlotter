# NEU-1088 — Retune retrieval T and K for the expanded catalog

**Target repo:** `upcoming-movies-backend`
**Ticket:** [NEU-1088](https://linear.app/neuroticsasquatch/issue/NEU-1088/backend-retune-retrieval-t-and-k-for-the-expanded-catalog)
**Design of record:** `docs/specs/2026-08-06-entity-linking-candidate-retrieval-design.md` §5.2
**Project spec:** `docs/specs/backlotter-undated-film-discovery-project-spec.md` §7.2
**Authored:** 2026-08-11, from a `/grilling` session

---

## 1. Why now

The candidate-retrieval design spec predicted this ticket and named its trigger:

> Cap saturation is the health signal to watch as the catalog grows: at K=25 it is 0.1% today,
> low enough that a rise means something. It will rise — measured against sub-catalogs, p90
> candidates grows about linearly with catalog size, so the undated-film expansion is expected
> to saturate this cap and force a retune.

**The trigger fired.** Prod `ingest.run_retrieval_health`, the four most recent `link` runs:

| link run | stories | zero-candidate | **cap-saturated** | mean candidates |
|---|---|---|---|---|
| 2026-08-08 20:30 | 101 | 0.00% | **0.00%** | 9.25 |
| 2026-08-09 09:06 | 83 | 1.20% | **2.41%** | 9.13 |
| 2026-08-10 09:04 | 205 | 1.46% | **3.41%** | 10.04 |
| **2026-08-11 09:05** — first index over the expanded catalog | 228 | 0.00% | **7.89%** | **12.83** |

The directors tranche flipped at 05:12 UTC on 2026-08-11; the 09:05 run is the first to build
its retrieval index over the result. Catalog at time of writing: **2,321 films, 706 undated**,
against §5.2's 1,226 — about **1.9×**.

Saturation has gone 0% → 7.9% in three days. §5.2 measured K=10 saturating **7.3%** of stories
and called that the level at which the cap "does bind", costing two picks outright. We are at
that level now, at K=25.

**Read these numbers against each other, not against §5.2.** Their denominator is one run's
pending set; §5.2's is every retained story, most of which are zero-candidate. That is why the
live zero-candidate rates here (0–1.5%) sit far below §5.2's 5.4%.

### 1.1 A second reason, and it is time-sensitive

`tune_retrieval.py` measures recall against **picks** — `link_status = 'linked' AND film_id IS
NOT NULL`. Before the 2026-08-08 cutover (§5.12, NEU-1004) those verdicts came from the roster:
independent ground truth. After it they come from **retrieval itself**, at T=0.5/K=25, which is
circular — a pick that saturated out of the cap was never linked, so it cannot appear in the
denominator as a miss.

Today that is roughly **419 roster-labelled picks against ~26 retrieval-labelled ones**. Every
week that ratio worsens as roster-era stories age out of the retention window. Within a couple
of months the independent denominator is gone for good.

This measurement is close to the last chance to take it against ground truth the retrieval path
did not author. That is an argument for running it now rather than after more sweeps land.

---

## 2. What to build

Six pieces, one PR (§3.7).

1. **A harness flag** — `--picks-linked-before`, so the recall denominator can exclude picks
   retrieval produced.
2. **Two measurement runs**, recorded.
3. **T and K** re-derived from the recent grid.
4. **The zero-candidate ceiling** recalibrated, if the separation test says it has gone slack.
5. **A saturation warn tier** — setting, health-row flag, detail line.
6. **The prose that makes the constants trustworthy** — `select.py`'s docstring, a new dated
   section in the retrieval design spec, and an ADR-0010 amendment.

---

## 3. Pinned decisions

Each of these was decided in the grilling session. They are decisions, not derivations — an
implementer should not re-open them, but should say so loudly if a measurement contradicts one.

### 3.1 The retune targets today's catalog, not the endstate

Measure against the current **2,321-film** catalog and set the constants from that grid.

The writers tranche (+270 films, NEU-1089) is small enough that it likely moves nothing. The
cast tranche (+2,341, NEU-1090) roughly doubles the catalog again and **is expected to force a
third pass**. The spec section this ticket writes must say so explicitly, so the third pass is
inherited rather than rediscovered.

**Why not set K for the endstate now.** §5.2's own growth curve carries the caveat that kills
it: "a random subset of today's catalog is a proxy for a smaller catalog, not a sample of a
larger one … The curve is a predictor, not a promise." Setting live constants from an
extrapolation is precisely what NEU-1001 existed to stop doing.

### 3.2 K = the smallest K that loses no pick, plus a **named** margin

> **Rule.** Find the smallest K at which `picks lost to the cap` is 0. Add an explicit margin
> over the deepest observed pick rank. **Write the margin down as a decision, and price it** in
> input tokens per story at the measured mean.

This is what §5.2 actually did — picks-lost hit 0 at K=21 and it took **25** — but the margin
was never named, so the section reads as though the rule were "clear the p99 set size". That
distinction did not matter when headroom was nearly free. It matters now:

- At §5.2's time, mean offered was **4.23**, and K=25 cost "0.01 candidates per story over K=20".
- Prod's latest run has mean offered at **12.83**. At ~102 tokens per rendered candidate, the
  candidate block has grown from roughly 430 to roughly 1,300 tokens per story **at fixed K**.

Raising K now costs real money in a way it did not in August, and p99 set size scales with the
catalog without bound. So the target is recall, and saturation is **reported, not chased**.

### 3.3 Two corpus windows; the recent one decides

Run the harness twice:

| run | window | why |
|---|---|---|
| comparability | `--days 45` | like-for-like against §5.2's recorded tables |
| **decision** | `--days 21` | the traffic mix the pipeline actually receives |

Google News broad queries are paused (ADR-0001), and it shows — story volume by week:

| week of | stories | picks |
|---|---|---|
| 06-29 | 29,290 | 40 |
| 07-06 | 39,053 | 43 |
| 07-13 | 15,888 | 82 |
| 07-20 → 08-03 | ~1,600/wk | 84–101 |
| 08-10 | 483 | 13 |

A 45-day window is therefore dominated by a source that no longer arrives, at ~20× the current
rate and a far lower pick density. Its set-size and zero-candidate columns describe a corpus
that is gone. **Set the constants from the 21-day grid.** Record the 45-day grid anyway — the
comparison is what keeps the design spec's history readable, and a divergence between the two
is itself a finding worth writing down.

The harness costs no LLM tokens, so the second run's only cost is scoring time.

### 3.4 Exclude the picks retrieval authored

Add `--picks-linked-before <timestamp>` to `tune_retrieval.py`. It drops picks whose
`linked_at` falls on or after the retrieval cutover. **Default: exclude.**

`link_note` is null on successful links, so `linked_at` against the 2026-08-08 cutover is the
only available discriminator. Use it.

Print the excluded set's recall as a **control**. It should come back at or near **1.000** by
construction — that is the evidence the circularity is real rather than assumed, and if it does
not, something about the pick model is not what this spec thinks it is.

This flag is what keeps the third (post-cast) pass honest, when contaminated picks will
dominate the denominator.

### 3.5 Recalibrate the zero-candidate ceiling if it has gone slack

`MAX_ZERO_CANDIDATE_RATE` = 0.25 is documented in `health.py` as **"a collapse detector, not a
drift detector"**, calibrated as roughly 4.6× the observed 5.4% and safely under the 32.6% a
mis-set T=0.6 would produce.

**The separation test.** From this ticket's own grid, check both halves:

1. Does 25% still sit well above the observed zero-candidate rate at the chosen T?
2. Does it still sit **below** what a one-step-too-high T would produce?

Half 2 is the one at risk. Zero-candidate *falls* as the catalog grows (45.4% at 250 films →
5.5% at 1,226), so a mis-set T's rate falls with it, and the ceiling drifts toward being unable
to catch the failure ADR-0010 names. If the test fails, move `MAX_ZERO_CANDIDATE_RATE` and its
`config.Settings` mirror in this ticket, recording the new calibration. The pinning test between
the two must stay green.

### 3.6 Saturation gets a **warn** tier — durable, and it does not fail the run

`saturated_stories` is recorded on `run_retrieval_health` and has **no threshold at all**. The
hard guard fires on zero-candidate only. That is why saturation went 0% → 7.9% and nothing
raised a hand; it was found by querying prod by hand.

The ticket's own criterion — "cap saturation back inside the guard" — names a guard that does
not exist. Build it:

- A new setting for the warn rate, mirrored in `link/retrieval/health.py` the way the existing
  constants are, with the same pinning test.
- A **flag on `run_retrieval_health`** when the rate exceeds it. This needs a migration.
- A clause on the `link` run's `detail` line, so it lands durably on `/admin/runs`. The line is
  built in `link/pipeline.py` and currently reads
  `linked N, rejected N; N events from N stories (N stale-stage rejected)` — append to it, and
  drop the clause entirely when the threshold is not breached.
- **The run still succeeds.**

**Why warn and not hard.** ADR-0010's doctrine is that the hard tier catches collapse and the
soft tier catches drift. Rising saturation is drift by definition — it is the signal that says
*retune*, not *outage*. `run_daily` is fail-fast, so a hard tier here would publish no summaries
at all on a day when nothing was actually broken.

**Calibrate the threshold from this ticket's grid**, not from a guess.

> **Accepted risk.** The calibrating evidence is essentially one post-flip run (n=228). This
> threshold is a first cut, and §3.1's third pass should expect to move it. Say so in the spec
> section rather than letting a provisional number read as a measured one.

### 3.7 One PR

All six pieces ship together in NEU-1088.

> **Accepted risk.** A tuning change and a schema migration share a revert boundary, and the PR
> is large enough that CI failures and review findings are harder to attribute. Decided
> knowingly: it means there is no window in which the grid says the tripwire should have fired
> and nothing implements it.

### 3.8 A recorded measurement satisfies the ticket, changed value or not

The ticket's stated criterion, "New T and K set from measurement", is **restated**:

> T and K are re-derived from a recorded grid, and any value that does not move is shown not to
> need to.

§5.2's "Re-measured post-#195" section is the precedent — it concluded "**Nothing needs
retuning**" and was a complete result, not a failed ticket.

**Expected outcome, stated in advance so the measurement can contradict it:** K moves; **T holds
at 0.5**. T has nowhere to go — §5.2's pick-score distribution has nothing landing between 0 and
0.5 (the flat region is a property of the scoring function, not of catalog size), and T=0.6
would breach the zero-candidate ceiling outright at ~33%.

---

## 4. Acceptance criteria

- [ ] `tune_retrieval.py` takes `--picks-linked-before`, excluding retrieval-authored picks by
      default and printing the excluded set's recall as a control.
- [ ] Both grids recorded — `--days 45` and `--days 21` — with the 21-day one identified as the
      one that set the values.
- [ ] T and K re-derived per §3.2, with the K margin **named and priced** in tokens per story.
- [ ] The separation test (§3.5) is run and its result recorded, whether or not the ceiling moves.
- [ ] Saturation warn tier live: setting, health-row flag + migration, detail-line clause,
      threshold calibrated from the grid and labelled provisional.
- [ ] `select.py`'s module docstring **rewritten** against the new measurement. It currently
      documents the NEU-1001 corpus in detail and ends on "the undated-film expansion is expected
      to saturate this cap and force a retune" — leaving that in place would make it confidently
      wrong.
- [ ] A new dated section in `2026-08-06-entity-linking-candidate-retrieval-design.md`, in the
      §5.2 / post-#195 house style, recording both grids and every decision above — including
      §3.1's expected third pass.
- [ ] ADR-0010 amended to record the new soft tier.
- [ ] `CONTEXT.md` gains a **Soft breach** entry, and **Hard breach** cross-references it. The
      glossary currently names only the hard tier, which reads as though it were the only one.
      Proposed wording: *a run whose cap-saturation rate exceeds the warn threshold, flagged on
      the health row and named in the run's detail line — retrieval health's soft tier. It does
      not fail the run: saturation is drift, and the daily chain is fail-fast.*
      `_Avoid_: saturation breach (the flag is about the rate, not the cap), warning (too vague —
      the hard tier warns too).`
- [ ] `task test`, `task lint`, `task typecheck` green; `alembic` single head.

---

## 5. Procedure

The measurement runs against a **prod-refreshed** local database. Catalog size is the variable
the whole exercise turns on, and the dev catalog is a fraction of prod's.

```bash
task db:refresh
# CLAUDE.md gotcha: db:refresh restores catalog/news/ingest from prod but leaves `app`, where
# alembic_version lives. The local DB now carries prod's older content schemas while
# `alembic current` still reports head. Re-apply before trusting anything:
#   alembic stamp <prod's revision> && task migrate
task shell
python scripts/tune_retrieval.py --days 45 --count-tokens > /tmp/tuning-45d.md
python scripts/tune_retrieval.py --days 21 --count-tokens > /tmp/tuning-21d.md
```

Add the migration **after** the model column, per the repo's documented order: model first
(tests pick it up via `create_all`), then `task makemigration -- "msg"`, review the generated
file, then `task migrate`.

> Watch for the `_alembic_tmp_*` autogenerate artifact and review the generated migration before
> applying it.

---

## 6. Explicitly out of scope

- **`LINK_BATCH_SIZE`.** Investigated during grilling and found **not** coupled to K in the
  direction the ticket implies. Batch size is bound by the **reply** — one decision object per
  story against `_MAX_TOKENS` = 2048, where a truncated reply fails to parse and takes the whole
  batch with it. K drives the **input** side. They are separable, so batch size moves only if
  the measurement produces a surprise, and then as its own ticket.
- **`render.OVERVIEW_MAX`.** §5.2 deferred it as an F1 question that costs a `validate_linking`
  run to answer. Still deferred.
- **A saturation *hard* tier.** §3.6 decided warn-only. Revisit only with evidence that a
  saturation level exists at which retrieval is genuinely collapsed rather than merely drifting.
- **Dormancy constants** (`SWEEP_DORMANCY_DAYS`, `SWEEP_DORMANT_REFRESH_DAYS`) — NEU-1118.
- **Re-running `validate_linking`.** §5.2's "What this does not settle" still holds: gate #3's
  precision delta lives in the classifier and the confidence floor, not in T or K.

---

## 7. Known unknowns

- **The saturation threshold is calibrated on n=228.** Provisional by construction (§3.6).
- **Undated films may collide differently** from the catalog the growth curve was drawn on.
  §5.2 flagged both directions: more per-franchise entries argues worse, more obscure titles
  argues better. This ticket's measurement is the first real evidence either way, and it should
  say which way it landed.
- **The 21-day window's tail statistics are thinner** — roughly 280 picks against the 45-day
  window's 419 — which is exactly where §3.2's "deepest observed pick rank" margin decision
  needs resolution. If the two windows disagree on that rank, prefer the **wider** window for
  the margin and the recent one for everything else, and record that you did.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
