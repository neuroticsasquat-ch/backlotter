# NEU-279: Metrics harness + accuracy baseline + tuning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure linking precision/recall/F1 (and cluster purity) against the labeled fixture, produce the documented accuracy baseline, and tune the confidence floor + prompts. The spike's named deliverable.

**Architecture:** Pure, TDD-tested metric functions in `link/metrics.py`. A manually-run script `scripts/validate_linking.py` builds the roster from the live DB, runs the real Stage-1 linker over the fixture stories, and prints metrics. The baseline numbers (a one-off real-model run) are recorded in the spec; the floor/prompt are tuned against them.

**Tech Stack:** Python, the `link`/`llm` packages, the live Anthropic API (for the baseline run only), pytest.

**Repo:** `upcoming-movies-backend` · **Branch:** `tom/neu-279-be-metrics-harness-accuracy-baseline-tuning` · **Spec:** `docs/specs/2026-06-19-entity-linking-clustering-design.md`

**Depends on:** NEU-274 (`build_roster`, `link_story_batch`), NEU-277 (`cluster_film_events`), NEU-278 (`load_validation_set`, the labeled fixture). The baseline run needs a real `ANTHROPIC_API_KEY` in `.env`.

> **Commit/PR convention:** No per-step commits — implement, run the checks, then the user commits once and opens the PR. All commands run in the container via `task`. The baseline run costs a small amount of API tokens.

---

## File Structure

- **Create** `src/upmovies/link/metrics.py` — `LinkMetrics`, `compute_link_metrics`, `cluster_purity`.
- **Create** `tests/unit/link/test_metrics.py`.
- **Create** `scripts/validate_linking.py` — the manual baseline runner.

---

### Task 1: Metric functions (TDD)

**Files:**
- Create: `src/upmovies/link/metrics.py`
- Test: `tests/unit/link/test_metrics.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/link/test_metrics.py`:

```python
from upmovies.link.metrics import cluster_purity, compute_link_metrics


def test_all_correct_links():
    m = compute_link_metrics([(1, 1), (2, 2)])
    assert (m.true_positives, m.false_positives, m.false_negatives) == (2, 0, 0)
    assert m.precision == 1.0 and m.recall == 1.0 and m.f1 == 1.0


def test_correct_rejections_are_true_negatives():
    m = compute_link_metrics([(None, None), (None, None)])
    assert m.true_negatives == 2
    assert m.precision == 0.0 and m.recall == 0.0 and m.f1 == 0.0


def test_overlink_is_false_positive():
    m = compute_link_metrics([(1, None)])
    assert m.false_positives == 1 and m.false_negatives == 0 and m.precision == 0.0


def test_missed_link_is_false_negative():
    m = compute_link_metrics([(None, 5)])
    assert m.false_negatives == 1 and m.recall == 0.0


def test_wrong_film_is_both_fp_and_fn():
    m = compute_link_metrics([(1, 2)])
    assert m.false_positives == 1 and m.false_negatives == 1


def test_cluster_purity_perfect():
    assert cluster_purity([{"a", "b"}, {"c"}], {"a": "G1", "b": "G1", "c": "G2"}) == 1.0


def test_cluster_purity_mixed():
    assert cluster_purity([{"a", "b", "c"}], {"a": "G1", "b": "G1", "c": "G2"}) == 2 / 3
```

- [ ] **Step 2: Run them to verify they fail**

Run: `task test -- tests/unit/link/test_metrics.py`
Expected: FAIL — `upmovies.link.metrics` does not exist.

- [ ] **Step 3: Implement `metrics.py`**

Create `src/upmovies/link/metrics.py`:

```python
"""Pure scoring functions for the linking/clustering accuracy baseline. No I/O — the
runner feeds these (predicted, expected) pairs and predicted clusters."""

from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass


@dataclass
class LinkMetrics:
    true_positives: int
    false_positives: int
    false_negatives: int
    true_negatives: int
    precision: float
    recall: float
    f1: float


def compute_link_metrics(pairs: Iterable[tuple[int | None, int | None]]) -> LinkMetrics:
    """Each pair is (predicted_tmdb_id, expected_tmdb_id); None means 'no link'. A wrong
    link counts as both a false positive and a false negative; a correct rejection is a
    true negative (precision/recall are about the linking positives)."""
    tp = fp = fn = tn = 0
    for predicted, expected in pairs:
        if predicted is not None and predicted == expected:
            tp += 1
        elif predicted is not None:  # linked, but wrong (or should have been none)
            fp += 1
            if expected is not None:
                fn += 1
        elif expected is not None:  # should have linked, didn't
            fn += 1
        else:  # both None — correct rejection
            tn += 1

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return LinkMetrics(tp, fp, fn, tn, precision, recall, f1)


def cluster_purity(
    clusters: Iterable[set[str]], gold_group_by_key: Mapping[str, str | None]
) -> float:
    """Standard cluster purity: for each predicted cluster, credit its majority gold
    group; sum and divide by the number of clustered items."""
    total = correct = 0
    for cluster in clusters:
        if not cluster:
            continue
        counts = Counter(gold_group_by_key.get(key) for key in cluster)
        total += len(cluster)
        correct += max(counts.values())
    return correct / total if total else 0.0
```

- [ ] **Step 4: Run them to verify they pass**

Run: `task test -- tests/unit/link/test_metrics.py`
Expected: PASS (7 tests).

---

### Task 2: The baseline runner

**Files:**
- Create: `scripts/validate_linking.py`

- [ ] **Step 1: Write the runner**

Create `scripts/validate_linking.py`:

```python
"""Measure Stage-1 linking accuracy against the labeled fixture using the real model.
Run in the container with a real key in .env:
    task shell
    python scripts/validate_linking.py [tests/fixtures/link/validation_set.json]

Prints precision / recall / F1 and the confusion counts. Costs a small amount of API
tokens. Use it to set `link_confidence_floor` and tune the linker prompt; record the
numbers in the design spec."""

import asyncio
import sys
from uuid import uuid4

from sqlalchemy import select

from upmovies.config import get_settings
from upmovies.db import SessionLocal
from upmovies.catalog.models import Film
from upmovies.link.linker import link_story_batch
from upmovies.link.metrics import compute_link_metrics
from upmovies.link.roster import build_roster
from upmovies.link.validation import load_validation_set
from upmovies.llm.client import AnthropicClient
from upmovies.news.models import Story

DEFAULT_FIXTURE = "tests/fixtures/link/validation_set.json"


async def main(path: str) -> None:
    settings = get_settings()
    items = load_validation_set(path)

    async with SessionLocal() as s:
        roster = await build_roster(s)
        tmdb_by_film_id = dict(
            (row.id, row.tmdb_id) for row in (await s.execute(select(Film))).scalars().all()
        )

    expected_ids = {it.expected_film_tmdb_id for it in items if it.expected_film_tmdb_id}
    roster_tmdb_ids = {tmdb_by_film_id[e.film_id] for e in roster.entries}
    missing = expected_ids - roster_tmdb_ids
    if missing:
        print(f"WARNING: {len(missing)} expected film(s) are not in the current roster: {missing}")

    # Build throwaway Story objects carrying the fixture text.
    stories = [
        Story(id=uuid4(), source=it.source, url=it.url, title=it.title, raw={"summary": it.summary})
        for it in items
    ]
    item_by_story_id = {str(st.id): it for st, it in zip(stories, items, strict=True)}

    async with AnthropicClient(api_key=settings.anthropic_api_key) as client:
        for i in range(0, len(stories), settings.link_batch_size):
            batch = stories[i : i + settings.link_batch_size]
            await link_story_batch(
                client=client, model=settings.link_model, roster=roster,
                stories=batch, floor=settings.link_confidence_floor,
            )

    pairs: list[tuple[int | None, int | None]] = []
    for st in stories:
        predicted = tmdb_by_film_id.get(st.film_id) if st.film_id is not None else None
        pairs.append((predicted, item_by_story_id[str(st.id)].expected_film_tmdb_id))

    m = compute_link_metrics(pairs)
    print(f"n={len(pairs)}  floor={settings.link_confidence_floor}  model={settings.link_model}")
    print(f"TP={m.true_positives} FP={m.false_positives} FN={m.false_negatives} TN={m.true_negatives}")
    print(f"precision={m.precision:.3f}  recall={m.recall:.3f}  f1={m.f1:.3f}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FIXTURE))
```

- [ ] **Step 2: Smoke-check it imports**

Run: `task shell`, then `python -c "import scripts.validate_linking"` is not on the path; instead `python -m py_compile scripts/validate_linking.py` (exit after). Expected: no syntax/import errors.

> Don't run the full baseline in CI — it hits the live API. It's a manual measurement (Task 3).

---

### Task 3: Run the baseline + tune (manual)

- [ ] **Step 1: Run the baseline**

With a real `ANTHROPIC_API_KEY` in `.env` and the labeled fixture present: `task shell` then `python scripts/validate_linking.py`. Record `n`, precision, recall, F1, and the confusion counts.

- [ ] **Step 2: Tune the floor**

Re-run at a few `LINK_CONFIDENCE_FLOOR` values (e.g. 0.6 / 0.7 / 0.8 — set in `.env`, `task up` to reload) to find the precision-favoring knee. If recall is poor for reasons the floor can't fix, adjust the linker prompt (`_INSTRUCTIONS` in `link/linker.py`) and re-measure.

- [ ] **Step 3: Record the baseline in the spec**

Add a "Baseline (measured <date>)" subsection to `docs/specs/2026-06-19-entity-linking-clustering-design.md` with the chosen floor and the precision/recall/F1 numbers. If you changed the default floor, update `link_confidence_floor` in `config.py`.

---

## Final verification (before handing off to commit)

- [ ] `task format`
- [ ] `task lint` — clean
- [ ] `task typecheck` — clean
- [ ] `task test` — full suite green (metric unit tests; the live runner is excluded from pytest)
- [ ] Hand off: the user commits (e.g. `feat: add linking accuracy metrics + baseline harness`) and opens the PR for NEU-279.

---

## Self-Review

- **Spec coverage:** Provides the precision/recall/F1 linking metrics and a cluster-purity function, a runnable harness over the labeled fixture, and the tune-the-floor + record-the-baseline steps — the spike's "design + accuracy baseline" output. Cluster purity is available for the secondary cluster measurement (group the about-labeled stories by `event_group`).
- **Placeholders:** The baseline numbers are intentionally produced by a manual live-model run; all code (metrics, runner) is concrete.
- **Type consistency:** `compute_link_metrics(Iterable[tuple[int|None,int|None]]) -> LinkMetrics` and `cluster_purity(Iterable[set[str]], Mapping[str,str|None]) -> float` match between tests and runner; the runner uses the real `build_roster`/`link_story_batch`/`load_validation_set` signatures from NEU-274/278 and maps `film_id -> tmdb_id` to compare against the fixture's TMDB-id labels.
