# Retrieval tuning — 2026-08-13

> NEU-1135, **the decision grid** — the constants in `link/retrieval/select.py` are set from this one.
> Design of record: `specs/backlotter-undated-film-discovery-project-spec.md` §7.2, backend ADR-0010.
> Taken against a prod-refreshed local DB (3,050 films / 2,695 active) after the writers
> tranche and the 2026-08-13 07:00 sweep (+266 films). Cap and batch tables are measured at
> the K in force at the time, K=35 — the *old* value; the cap table is what the new K=47 was
> chosen from. The grid below was taken without `--count-tokens`, so its token column is a
> four-characters-per-token estimate; the per-candidate cost used for pricing was counted
> separately against the tokenizer (92 tok/candidate — see "Fine cap sweep" below).

## Outcome

| Constant | Was | Now | Basis |
|---|---|---|---|
| `LINK_RETRIEVAL_THRESHOLD` (T) | 0.5 | **0.5** (held) | No usable value above it — see the fine sweep below |
| `LINK_RETRIEVAL_MAX_CANDIDATES` (K) | 35 | **47** | Deepest pick rank 43 (both windows) + the named margin of 4 |
| `LINK_RETRIEVAL_SATURATION_WARN_RATE` | 0.05 | **0.05** (reaffirmed) | Floor moved 1.8% → 1.89%; margin still ~2.6x |
| `LINK_RETRIEVAL_MAX_ZERO_CANDIDATE_RATE` | 0.10 | **0.10** (held) | T=0.6 now 18.4%; margin 15.6pp → 8.4pp, re-check next pass |

Corpus: **4820 stories** over the last 21 days, **175 picks** still in the active catalog. Index: **2695 films**, 6230 tokens, 3816 rescue folds.

Picks linked at or after **2026-08-08T20:30:00+00:00** are excluded — retrieval authored those verdicts, so they cannot appear in the denominator as misses (§3.4). Control — the 44 excluded picks swept on their own at T=0.5/K=25: recall **1.000** (0 lost to T, 0 lost to the cap). At or near 1.000 is the expected result, and the evidence that the exclusion is warranted rather than assumed.

## Threshold (uncapped)

| T | recall | picks | lost to T | zero-candidate | median | p90 | p99 | max | mean |
|---|---|---|---|---|---|---|---|---|---|
| 0.25 | **0.983** | 175 | 3 | 0 (0.0%) | 57 | 114 | 168 | 246 | 64.13 |
| 0.34 | **0.983** | 175 | 3 | 8 (0.2%) | 17 | 33 | 54 | 105 | 18.48 |
| 0.4 | **0.983** | 175 | 3 | 8 (0.2%) | 16 | 33 | 54 | 105 | 18.47 |
| 0.5 | **0.983** | 175 | 3 | 9 (0.2%) | 16 | 32 | 53 | 80 | 17.83 |
| 0.6 | **0.966** | 175 | 6 | 888 (18.4%) | 2 | 5 | 9 | 19 | 2.19 |
| 0.67 | **0.926** | 175 | 13 | 1479 (30.7%) | 1 | 3 | 6 | 9 | 1.41 |
| 0.75 | **0.926** | 175 | 13 | 1479 (30.7%) | 1 | 3 | 6 | 9 | 1.41 |
| 1.0 | **0.903** | 175 | 17 | 1508 (31.3%) | 1 | 3 | 6 | 9 | 1.37 |

## Cap

Deepest pick that cleared T=0.5: **rank 43**. That is the smallest K losing no pick, and the number §3.2's margin is added to — the grid below only brackets it.

| K (at T=0.5) | recall | lost to cap | saturated | mean offered |
|---|---|---|---|---|
| 10 | **0.977** | 1 | 3478 (72.2%) | 9.09 |
| 15 | **0.977** | 1 | 2495 (51.8%) | 12.28 |
| 20 | **0.977** | 1 | 1605 (33.3%) | 14.49 |
| 25 | **0.977** | 1 | 991 (20.6%) | 15.88 |
| 30 | **0.977** | 1 | 565 (11.7%) | 16.72 |
| 31 | **0.977** | 1 | 511 (10.6%) | 16.83 |
| 35 | **0.977** | 1 | 329 (6.8%) | 17.19 |
| 40 | **0.977** | 1 | 190 (3.9%) | 17.47 |
| 45 | **0.983** | 0 | 113 (2.3%) | 17.63 |
| 50 | **0.983** | 0 | 62 (1.3%) | 17.73 |
| 60 | **0.983** | 0 | 17 (0.4%) | 17.81 |
| 75 | **0.983** | 0 | 3 (0.1%) | 17.83 |
| 100 | **0.983** | 0 | 0 (0.0%) | 17.83 |

## Catalog growth (T=0.5, K=25, 4820 stories)

| films | median | p90 | p99 | max | mean offered | zero-candidate | saturated |
|---|---|---|---|---|---|---|---|
| 250 | 1 | 3 | 6 | 13 | 1.26 | 39.3% | 0.0% |
| 500 | 2 | 6 | 11 | 20 | 2.62 | 18.0% | 0.0% |
| 750 | 4 | 9 | 15 | 27 | 4.35 | 6.1% | 0.0% |
| 1000 | 5 | 12 | 20 | 35 | 6.02 | 3.3% | 0.2% |
| 2695 | 16 | 32 | 53 | 80 | 15.88 | 0.2% | 20.6% |

## Batch size

Instruction block: **2203 tok**, re-sent uncached on every call (below Haiku 4.5's 4096-token cache floor). Candidate list: **1096 tok/story** over 20 stories, **72 tok** per rendered candidate.

| batch | calls | input tok/call | tok/story | instructions share | worst-case reply tok/call | headroom vs max_tokens=2048 |
|---|---|---|---|---|---|---|
| 10 | 16 | 14235 | 1424 | 15.5% | 332 | 1716 |
| 15 | 10 | 19928 | 1329 | 11.1% | 498 | 1550 |
| 20 | 8 | 26257 | 1313 | 8.4% | 663 | 1385 |
| 25 | 6 | 31738 | 1270 | 6.9% | 829 | 1219 |
| 30 | 5 | 37644 | 1255 | 5.9% | 994 | 1054 |
| 40 | 4 | 50301 | 1258 | 4.4% | 1326 | 722 |

## The other window

This is the **decision grid**; `2026-08-13-neu-1135-retrieval-tuning-45d.md` is the
confirmation grid, run for the two-window rule NEU-1088 established. Both windows put the
deepest pick at **rank 43**, which is what K=47 rests on.

Read the 45-day window for that rank and for the shape of the T curve only. Its story mix is
not comparable — 87,103 stories at a mean offered set of 9.01, against 4,820 at 17.83 over the
identical catalog — so every set-size-derived rate comes out flattered there.

## Fine threshold sweep — why T has no next step

The coarse grid above jumps 0.5 → 0.6 and reads like a gap a finer sweep might fill. It is not
a gap, it is a cliff: the score is a fraction of a title's **distinct** tokens, so the dominant
mass of candidates scores exactly 0.5 (one token of a two-token title), and every T above 0.5
discards all of them at once. Every value from 0.501 to 0.6 gives the identical measurement.

| T | recall | lost to T | zero-cand | median | p90 | p99 | max | mean |
|---|---|---|---|---|---|---|---|---|
| 0.45 | 0.983 | 3 | 9 (0.2%) | 16 | 32 | 53 | 80 | 17.83 |
| 0.5 | 0.983 | 3 | 9 (0.2%) | 16 | 32 | 53 | 80 | 17.83 |
| 0.501 | 0.966 | 6 | 887 (18.4%) | 2 | 5 | 9 | 19 | 2.19 |
| 0.51 | 0.966 | 6 | 887 (18.4%) | 2 | 5 | 9 | 19 | 2.19 |
| 0.55 | 0.966 | 6 | 887 (18.4%) | 2 | 5 | 9 | 19 | 2.19 |
| 0.571 | 0.966 | 6 | 887 (18.4%) | 2 | 5 | 9 | 19 | 2.19 |
| 0.6 | 0.966 | 6 | 888 (18.4%) | 2 | 5 | 9 | 19 | 2.19 |
| 0.625 | 0.960 | 7 | 900 (18.7%) | 2 | 5 | 9 | 19 | 2.14 |

18.4% breaches the 10% hard ceiling outright, so **K is the only live lever** from here.

## Fine cap sweep — how K=47 was chosen

| K (at T=0.5) | recall | lost to cap | saturated | mean offered |
|---|---|---|---|---|
| 25 | 0.977 | 1 | 991 (20.56%) | 15.88 |
| 31 | 0.977 | 1 | 511 (10.60%) | 16.83 |
| 35 | 0.977 | 1 | 329 (6.83%) | 17.19 |
| 40 | 0.977 | 1 | 190 (3.94%) | 17.47 |
| 42 | 0.977 | 1 | 152 (3.15%) | 17.55 |
| **43** | **0.983** | **0** | 137 (2.84%) | 17.58 |
| 45 | 0.983 | 0 | 113 (2.34%) | 17.63 |
| **47** | **0.983** | **0** | **91 (1.89%)** | **17.68** |
| 50 | 0.983 | 0 | 62 (1.29%) | 17.73 |
| 60 | 0.983 | 0 | 17 (0.35%) | 17.81 |

Margin priced: K=43 → K=47 costs +0.10 candidates/story ≈ **+9 tok/story** at **92 tok per
rendered candidate**. The whole move from K=35 costs +0.49 candidates ≈ **+45 tok/story**.

The 92 is counted against the tokenizer via `messages.count_tokens`, which keeps it
comparable to NEU-1088's 98 (also counted). The grid run above was taken *without*
`--count-tokens`, and its four-characters-per-token estimate reads **72** — 22% low. Use the
counted figure; the estimate is only there so a run without an API key still produces a
table.

Uncapped mean is 17.83, so K=47 delivers **99.2%** of what no cap at all would offer — K is
now almost pure tail control rather than a corpus-wide prompt-size cost.

## Pick-rank distribution — rank 43 is a lone outlier, honoured deliberately

    n=172  median=1  p90=3  p95=4  p99=8  max=43
    deepest twelve: 4, 4, 4, 4, 4, 5, 5, 5, 5, 6, 8, 43

The single deep pick:

    rank 43, score 0.500, set size 47
    headline: Matt Damon Describes His Role in The Daniels' New Sci-Fi Movie as
              'The Breakfast Club' Meets 'Inception' Meets Anime Meets John Oliver
    linked film: Untitled Daniels Event Film   (linked 2026-07-25, pre-cutover — roster
                 ground truth, not a verdict retrieval authored)
    top of its set: Daniel and the Fiery Furnace (1.0), Once (1.0), Everything is Okay (0.667)

It is kept because of what it is, not despite it. `Untitled <Director> Project` titles carry
no distinctive tokens, so they always score the floor and rank at the bottom of whatever
collision set the headline draws — and **138 films now carry such a title, 126 of them
undated**. That is the population this project exists to admit, so picks of this shape get
commoner as the sweep runs. Trimming the outlier (K would fall to ~12) would discard the
signal the expansion was built to produce.

## Grid-vs-production calibration

NEU-1088 warned the grid runs optimistic on saturation by half again, on one comparison. A
cleaner one exists now — same catalog era, same K, a full day's backlog rather than a 16-hour
slice:

| Comparison | Grid | Production | Ratio |
|---|---|---|---|
| K=25, 2026-08-11 | 7.6% | 7.89% | 1.04x |
| K=35, 2026-08-12 (16h slice, n=215) | 1.8% | 2.79% | 1.55x |
| **K=35, 2026-08-13 (full backlog, n=184)** | **6.83%** | **7.61%** | **1.11x** |

So the 1.55x was the slice sampling the tail, not a standing bias. Expect production near
**2.1%** at K=47 — comfortably under the 5% warn rate, which is why it is reaffirmed rather
than moved.
