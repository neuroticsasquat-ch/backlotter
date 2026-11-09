# Retrieval tuning — 2026-08-12

> NEU-1088, **the comparability grid** — recorded so the numbers stay readable against §5.2's, not used to set anything.
> Design of record: `specs/2026-08-06-entity-linking-candidate-retrieval-design.md` §5.13.
> Taken against a prod-refreshed local DB (2,321 films / 1,997 active) with
> `--count-tokens`. Cap and batch tables are measured at the K in force at the time,
> K=25 — the *old* value; the cap table is what the new K=35 was chosen from.

Corpus: **91692 stories** over the last 45 days, **344 picks** still in the active catalog. Index: **1997 films**, 5274 tokens, 3034 rescue folds.

Picks linked at or after **2026-08-08T20:30:00+00:00** are excluded — retrieval authored those verdicts, so they cannot appear in the denominator as misses (§3.4). Control — the 21 excluded picks swept on their own at T=0.5/K=25: recall **1.000** (0 lost to T, 0 lost to the cap). At or near 1.000 is the expected result, and the evidence that the exclusion is warranted rather than assumed.

## Threshold (uncapped)

| T | recall | picks | lost to T | zero-candidate | median | p90 | p99 | max | mean |
|---|---|---|---|---|---|---|---|---|---|
| 0.25 | **0.988** | 344 | 4 | 0 (0.0%) | 16 | 42 | 84 | 180 | 20.94 |
| 0.34 | **0.988** | 344 | 4 | 515 (0.6%) | 6 | 14 | 26 | 74 | 7.07 |
| 0.4 | **0.988** | 344 | 4 | 515 (0.6%) | 6 | 14 | 26 | 74 | 7.07 |
| 0.5 | **0.988** | 344 | 4 | 522 (0.6%) | 6 | 14 | 26 | 61 | 6.94 |
| 0.6 | **0.971** | 344 | 10 | 26188 (28.6%) | 1 | 2 | 4 | 15 | 1.14 |
| 0.67 | **0.936** | 344 | 22 | 29622 (32.3%) | 1 | 2 | 4 | 8 | 1.01 |
| 0.75 | **0.936** | 344 | 22 | 29622 (32.3%) | 1 | 2 | 4 | 8 | 1.01 |
| 1.0 | **0.922** | 344 | 27 | 29914 (32.6%) | 1 | 2 | 4 | 8 | 1.00 |

## Cap

Deepest pick that cleared T=0.5: **rank 31**. That is the smallest K losing no pick, and the number §3.2's margin is added to — the grid below only brackets it.

| K (at T=0.5) | recall | lost to cap | saturated | mean offered |
|---|---|---|---|---|
| 3 | **0.927** | 21 | 66444 (72.5%) | 2.78 |
| 5 | **0.968** | 7 | 46646 (50.9%) | 4.12 |
| 10 | **0.985** | 1 | 17399 (19.0%) | 5.90 |
| 15 | **0.985** | 1 | 6306 (6.9%) | 6.55 |
| 20 | **0.985** | 1 | 2387 (2.6%) | 6.79 |
| 25 | **0.985** | 1 | 928 (1.0%) | 6.88 |
| 30 | **0.985** | 1 | 373 (0.4%) | 6.92 |
| 31 | **0.988** | 0 | 310 (0.3%) | 6.92 |
| 35 | **0.988** | 0 | 148 (0.2%) | 6.93 |
| 40 | **0.988** | 0 | 73 (0.1%) | 6.94 |
| 50 | **0.988** | 0 | 15 (0.0%) | 6.94 |

## Catalog growth (T=0.5, K=25, 10000 stories)

| films | median | p90 | p99 | max | mean offered | zero-candidate | saturated |
|---|---|---|---|---|---|---|---|
| 250 | 0 | 2 | 3 | 8 | 0.60 | 57.9% | 0.0% |
| 500 | 1 | 3 | 7 | 16 | 1.43 | 32.2% | 0.0% |
| 750 | 2 | 5 | 9 | 19 | 2.07 | 22.0% | 0.0% |
| 1000 | 2 | 6 | 12 | 24 | 2.85 | 15.5% | 0.0% |
| 1997 | 6 | 14 | 26 | 52 | 6.93 | 0.5% | 1.1% |

## Batch size

Instruction block: **2116 tok**, re-sent uncached on every call (below Haiku 4.5's 4096-token cache floor). Candidate list: **521 tok/story** over 20 stories, **94 tok** per rendered candidate.

| batch | calls | input tok/call | tok/story | instructions share | worst-case reply tok/call | headroom vs max_tokens=2048 |
|---|---|---|---|---|---|---|
| 10 | 16 | 11742 | 1174 | 18.0% | 601 | 1447 |
| 15 | 10 | 16691 | 1113 | 12.7% | 894 | 1154 |
| 20 | 8 | 21350 | 1068 | 9.9% | 1184 | 864 |
| 25 | 6 | 26396 | 1056 | 8.0% | 1481 | 567 |
| 30 | 5 | 31248 | 1042 | 6.8% | 1781 | 267 |
| 40 | 4 | 40566 | 1014 | 5.2% | 2377 | -329 |
