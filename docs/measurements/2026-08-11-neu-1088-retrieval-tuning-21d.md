# Retrieval tuning — 2026-08-12

> NEU-1088, **the decision grid** — the constants in `link/retrieval/select.py` are set from this one.
> Design of record: `specs/2026-08-06-entity-linking-candidate-retrieval-design.md` §5.13.
> Taken against a prod-refreshed local DB (2,321 films / 1,997 active) with
> `--count-tokens`. Cap and batch tables are measured at the K in force at the time,
> K=25 — the *old* value; the cap table is what the new K=35 was chosen from.

Corpus: **4841 stories** over the last 21 days, **191 picks** still in the active catalog. Index: **1997 films**, 5274 tokens, 3034 rescue folds.

Picks linked at or after **2026-08-08T20:30:00+00:00** are excluded — retrieval authored those verdicts, so they cannot appear in the denominator as misses (§3.4). Control — the 21 excluded picks swept on their own at T=0.5/K=25: recall **1.000** (0 lost to T, 0 lost to the cap). At or near 1.000 is the expected result, and the evidence that the exclusion is warranted rather than assumed.

## Threshold (uncapped)

| T | recall | picks | lost to T | zero-candidate | median | p90 | p99 | max | mean |
|---|---|---|---|---|---|---|---|---|---|
| 0.25 | **0.984** | 191 | 3 | 0 (0.0%) | 43 | 83 | 123 | 179 | 47.21 |
| 0.34 | **0.984** | 191 | 3 | 23 (0.5%) | 12 | 24 | 41 | 70 | 13.45 |
| 0.4 | **0.984** | 191 | 3 | 23 (0.5%) | 12 | 24 | 41 | 70 | 13.44 |
| 0.5 | **0.984** | 191 | 3 | 25 (0.5%) | 11 | 23 | 40 | 58 | 12.89 |
| 0.6 | **0.969** | 191 | 6 | 1238 (25.6%) | 1 | 4 | 7 | 13 | 1.71 |
| 0.67 | **0.932** | 191 | 13 | 1833 (37.9%) | 1 | 3 | 5 | 8 | 1.15 |
| 0.75 | **0.932** | 191 | 13 | 1833 (37.9%) | 1 | 3 | 5 | 8 | 1.15 |
| 1.0 | **0.911** | 191 | 17 | 1859 (38.4%) | 1 | 3 | 5 | 8 | 1.13 |

## Cap

Deepest pick that cleared T=0.5: **rank 31**. That is the smallest K losing no pick, and the number §3.2's margin is added to — the grid below only brackets it.

| K (at T=0.5) | recall | lost to cap | saturated | mean offered |
|---|---|---|---|---|
| 3 | **0.937** | 9 | 4473 (92.4%) | 2.93 |
| 5 | **0.969** | 3 | 4006 (82.8%) | 4.74 |
| 10 | **0.979** | 1 | 2642 (54.6%) | 8.31 |
| 15 | **0.979** | 1 | 1497 (30.9%) | 10.52 |
| 20 | **0.979** | 1 | 765 (15.8%) | 11.74 |
| 25 | **0.979** | 1 | 366 (7.6%) | 12.33 |
| 30 | **0.979** | 1 | 180 (3.7%) | 12.63 |
| 31 | **0.984** | 0 | 156 (3.2%) | 12.67 |
| 35 | **0.984** | 0 | 85 (1.8%) | 12.77 |
| 40 | **0.984** | 0 | 40 (0.8%) | 12.84 |
| 50 | **0.984** | 0 | 6 (0.1%) | 12.89 |

## Catalog growth (T=0.5, K=25, 4841 stories)

| films | median | p90 | p99 | max | mean offered | zero-candidate | saturated |
|---|---|---|---|---|---|---|---|
| 250 | 1 | 3 | 5 | 9 | 1.06 | 41.4% | 0.0% |
| 500 | 2 | 6 | 10 | 16 | 2.87 | 12.5% | 0.0% |
| 750 | 3 | 8 | 14 | 23 | 3.99 | 7.7% | 0.0% |
| 1000 | 5 | 11 | 19 | 31 | 5.59 | 3.7% | 0.1% |
| 1997 | 11 | 23 | 40 | 58 | 12.33 | 0.5% | 7.6% |

## Batch size

Instruction block: **2116 tok**, re-sent uncached on every call (below Haiku 4.5's 4096-token cache floor). Candidate list: **1034 tok/story** over 20 stories, **98 tok** per rendered candidate.

| batch | calls | input tok/call | tok/story | instructions share | worst-case reply tok/call | headroom vs max_tokens=2048 |
|---|---|---|---|---|---|---|
| 10 | 16 | 15020 | 1502 | 14.1% | 601 | 1447 |
| 15 | 10 | 21110 | 1407 | 10.0% | 897 | 1151 |
| 20 | 8 | 27906 | 1395 | 7.6% | 1193 | 855 |
| 25 | 6 | 33761 | 1350 | 6.3% | 1492 | 556 |
| 30 | 5 | 40087 | 1336 | 5.3% | 1784 | 264 |
| 40 | 4 | 53678 | 1342 | 3.9% | 2392 | -344 |
