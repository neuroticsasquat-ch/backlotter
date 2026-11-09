# Retrieval tuning — 2026-08-13 (45-day window)

> NEU-1135, **the confirmation grid** — not the decision grid. Its job is the two-window rule
> NEU-1088 established: the deepest-pick rank is the one number a short window can get wrong by
> luck, so it is checked against five times the traffic before K is set from it.
> **It agrees: rank 43 in both windows**, exactly as NEU-1088's two windows both read rank 31.
>
> Decision grid: `2026-08-13-neu-1135-retrieval-tuning-21d.md`.
> Design of record: `specs/2026-08-06-entity-linking-candidate-retrieval-design.md` §5.14.

## Do not read the saturation column against the 21-day grid

The windows are nested but their **story mixes are not comparable**. 45 days reaches back into
a period with a very different corpus — 87,103 stories against the 21-day window's 4,820, at a
mean offered set of 9.01 against 17.83 over the identical 2,695-film catalog. Those older
stories retrieve far fewer candidates, so every rate derived from set size (saturation, mean
offered, zero-candidate) comes out flattered here: 0.3% saturation at K=43 against the 21-day
window's 2.84%.

That is why the 21-day window is the decision grid — its story mix is the one production now
sees — and why this one is quoted **only** for the deepest-pick rank and the shape of the T
curve. Quoting its 0.2% saturation as the expected production rate would be wrong by an order
of magnitude.

Corpus: **87103 stories** over the last 45 days, **337 picks** still in the active catalog. Index: **2695 films**, 6230 tokens, 3816 rescue folds.

Picks linked at or after **2026-08-08T20:30:00+00:00** are excluded — retrieval authored those verdicts, so they cannot appear in the denominator as misses (§3.4). Control — the 44 excluded picks swept on their own at T=0.5/K=25: recall **1.000** (0 lost to T, 0 lost to the cap). At or near 1.000 is the expected result, and the evidence that the exclusion is warranted rather than assumed.

## Threshold (uncapped)

| T | recall | picks | lost to T | zero-candidate | median | p90 | p99 | max | mean |
|---|---|---|---|---|---|---|---|---|---|
| 0.25 | **0.988** | 337 | 4 | 0 (0.0%) | 20 | 56 | 117 | 248 | 27.28 |
| 0.34 | **0.988** | 337 | 4 | 267 (0.3%) | 7 | 18 | 35 | 116 | 9.16 |
| 0.4 | **0.988** | 337 | 4 | 267 (0.3%) | 7 | 18 | 35 | 116 | 9.15 |
| 0.5 | **0.988** | 337 | 4 | 271 (0.3%) | 7 | 18 | 34 | 91 | 9.01 |
| 0.6 | **0.973** | 337 | 9 | 20817 (23.9%) | 1 | 3 | 5 | 24 | 1.34 |
| 0.67 | **0.941** | 337 | 20 | 24341 (27.9%) | 1 | 2 | 4 | 9 | 1.16 |
| 0.75 | **0.941** | 337 | 20 | 24341 (27.9%) | 1 | 2 | 4 | 9 | 1.16 |
| 1.0 | **0.926** | 337 | 25 | 24626 (28.3%) | 1 | 2 | 4 | 9 | 1.15 |

## Cap

Deepest pick that cleared T=0.5: **rank 43**. That is the smallest K losing no pick, and the number §3.2's margin is added to — the grid below only brackets it.

| K (at T=0.5) | recall | lost to cap | saturated | mean offered |
|---|---|---|---|---|
| 10 | **0.985** | 1 | 26637 (30.6%) | 6.76 |
| 15 | **0.985** | 1 | 12983 (14.9%) | 7.94 |
| 20 | **0.985** | 1 | 5844 (6.7%) | 8.50 |
| 25 | **0.985** | 1 | 2754 (3.2%) | 8.75 |
| 30 | **0.985** | 1 | 1363 (1.6%) | 8.88 |
| 35 | **0.985** | 1 | 724 (0.8%) | 8.94 |
| 40 | **0.985** | 1 | 412 (0.5%) | 8.97 |
| 43 | **0.988** | 0 | 249 (0.3%) | 8.98 |
| 45 | **0.988** | 0 | 197 (0.2%) | 8.99 |
| 47 | **0.988** | 0 | 159 (0.2%) | 8.99 |
| 50 | **0.988** | 0 | 112 (0.1%) | 9.00 |
| 60 | **0.988** | 0 | 31 (0.0%) | 9.00 |
| 75 | **0.988** | 0 | 6 (0.0%) | 9.01 |
| 100 | **0.988** | 0 | 0 (0.0%) | 9.01 |

## Catalog growth (T=0.5, K=25, 10000 stories)

| films | median | p90 | p99 | max | mean offered | zero-candidate | saturated |
|---|---|---|---|---|---|---|---|
| 250 | 0 | 2 | 4 | 13 | 0.65 | 58.7% | 0.0% |
| 500 | 1 | 3 | 7 | 20 | 1.35 | 34.6% | 0.0% |
| 750 | 2 | 5 | 10 | 26 | 2.14 | 22.1% | 0.0% |
| 1000 | 2 | 7 | 13 | 35 | 2.96 | 15.6% | 0.0% |
| 2695 | 7 | 18 | 34 | 67 | 8.82 | 0.3% | 3.2% |

## Batch size

Instruction block: **2203 tok**, re-sent uncached on every call (below Haiku 4.5's 4096-token cache floor). Candidate list: **481 tok/story** over 20 stories, **68 tok** per rendered candidate.

| batch | calls | input tok/call | tok/story | instructions share | worst-case reply tok/call | headroom vs max_tokens=2048 |
|---|---|---|---|---|---|---|
| 10 | 16 | 9542 | 954 | 23.1% | 330 | 1718 |
| 15 | 10 | 13039 | 869 | 16.9% | 496 | 1552 |
| 20 | 8 | 16871 | 844 | 13.1% | 661 | 1387 |
| 25 | 6 | 20257 | 810 | 10.9% | 827 | 1221 |
| 30 | 5 | 23866 | 796 | 9.2% | 993 | 1055 |
| 40 | 4 | 31529 | 788 | 7.0% | 1324 | 724 |
