# NEU-300 — Stage-2 cluster-purity baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/specs/2026-06-25-neu-300-stage2-cluster-purity-design.md`

**Goal:** Produce the Stage-2 cluster-purity / dedup baseline — wire `cluster_purity` + a new pairwise metric into a runnable harness over the labeled fixture, with an anti-anchoring labeling proposer.

**Architecture:** Approach A — extract two pure helpers from the DB-coupled `cluster.py` so a lightweight in-memory harness (`scripts/validate_clustering.py`) measures the *real* prompt/parse with no DB writes; add a within-film pairwise P/R/F1 metric next to the existing `cluster_purity`; gold `event_group`s are drafted by an Opus proposer (`scripts/propose_event_groups.py`) and hand-corrected by Tom.

**Tech Stack:** Python 3.13, async SQLAlchemy 2 + asyncpg, Anthropic SDK (`AnthropicClient`), pytest (+ pytest-asyncio auto mode), ruff, pyright. Everything runs in the container via `task`.

## Global Constraints

- **No host Python.** Run everything via `task` (`task test`, `task lint`, `task typecheck`, `task format`) — they `docker compose exec` into `upmovies-backend`. Container must be up (`task up`).
- **TDD:** write the failing test first; pytest-asyncio is `auto` mode (no `@pytest.mark.asyncio`). Mock HTTP with respx; never hit the live network **in tests**.
- **Pure functions stay pure:** no DB, no LLM, no I/O in `assemble_cluster_payload`, `parse_cluster_groups`, `compute_cluster_metrics`.
- **Behavior-unchanged refactor:** the existing `tests/integration/link/test_cluster.py` is the regression guard for Tasks 1–2 — it must stay green with zero edits.
- **Type hints:** modern `X | None`, `X | Y`; **no** `from __future__ import annotations`.
- **ruff:** line length 100; rules E,F,W,I,B,UP. `import x as x` re-export pattern in `__init__.py`.
- **Integration-test quirk:** running a single integration file in isolation errors (pytest-asyncio session-loop). Scope to the **directory** (`task test -- tests/integration/link/`) or run the whole suite.
- **Anti-anchoring:** the proposer model is **Opus** (`claude-opus-4-8`) — distinct from the `cluster_model` (Sonnet) under test.
- **Commits:** Conventional Commits subject; **no** Linear ID in the subject (optional `Refs NEU-300.` in the body); **no** `🤖` footer; **no** `Co-Authored-By`. Branch: `tom/neu-300-be-complete-m3-validation-stage-2-cluster-purity-baseline`.
- **Scripts are not unit-tested** (mirrors `validate_linking.py` / `propose_validation_labels.py` — manual run tools that hit the live LLM). Their *pure dependencies* (Tasks 1–3) carry the tests; the script tasks verify via typecheck + lint + an import smoke.
- Before each PR: `task test`, `task lint`, `task typecheck`, `task format` all green.

## File Structure

| File | Responsibility |
|---|---|
| `src/upmovies/link/cluster.py` | **Modify.** Add pure `assemble_cluster_payload(...)` and `parse_cluster_groups(...)` + `ClusterGroup`; rewire `build_cluster_request` / `apply_cluster_decisions` to use them. |
| `src/upmovies/link/metrics.py` | **Modify.** Add pure `compute_cluster_metrics(...)` + `ClusterMetrics` (purity reuses `cluster_purity`). |
| `scripts/validate_clustering.py` | **New.** Approach-A Stage-2 harness: per-film cluster call → purity + pairwise P/R/F1 + type agreement + gate verdict. |
| `scripts/propose_event_groups.py` | **New.** Opus proposer drafting film-namespaced `event_group` slugs. |
| `tests/unit/link/test_cluster_pure.py` | **New.** Unit tests for `assemble_cluster_payload` + `parse_cluster_groups`. |
| `tests/unit/link/test_metrics.py` | **Modify.** Add `compute_cluster_metrics` cases. |
| `tests/fixtures/link/README.md` | **Modify.** Document `event_group` semantics + the film-namespaced slug convention. |

> Distinct filename `test_cluster_pure.py` (not `test_cluster.py`) avoids a duplicate test-module basename clash with `tests/integration/link/test_cluster.py`.

**Not in these tasks (Tom's manual pass, post-merge):** hand-correcting `event_group` in `tests/fixtures/link/validation_set.json`, the paid live `validate_clustering.py` run, the ground-truth re-judge, the tuning iteration (if the gate calls for it), and the NEU-282 decision. See the *Manual pass* section.

---

### Task 1: Extract pure `assemble_cluster_payload`

**Files:**
- Modify: `src/upmovies/link/cluster.py` (replace the payload-assembly tail of `build_cluster_request`, ~lines 175–189)
- Test: `tests/unit/link/test_cluster_pure.py` (new)

**Interfaces:**
- Produces: `assemble_cluster_payload(*, film_title: str, film_year: int | None, existing_payload: list[dict[str, Any]], new_payload: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]` returning `(system, messages)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/link/test_cluster_pure.py`:

```python
import json

from upmovies.link.cluster import _INSTRUCTIONS, assemble_cluster_payload


def test_assemble_cluster_payload_shape():
    system, messages = assemble_cluster_payload(
        film_title="The Odyssey",
        film_year=2026,
        existing_payload=[],
        new_payload=[{"n": 1, "title": "T", "summary": "S"}],
    )
    assert system == [{"type": "text", "text": _INSTRUCTIONS}]
    assert len(messages) == 1 and messages[0]["role"] == "user"
    user = json.loads(messages[0]["content"])
    assert user["film"] == {"title": "The Odyssey", "year": 2026}
    assert user["existing_events"] == []
    assert user["new_stories"] == [{"n": 1, "title": "T", "summary": "S"}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: FAIL — `ImportError: cannot import name 'assemble_cluster_payload'`.

- [ ] **Step 3: Add the pure function and rewire `build_cluster_request`**

In `src/upmovies/link/cluster.py`, add the function above `build_cluster_request`:

```python
def assemble_cluster_payload(
    *,
    film_title: str,
    film_year: int | None,
    existing_payload: list[dict[str, Any]],
    new_payload: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Pure prompt assembly shared by build_cluster_request (production) and the
    validate_clustering harness. No DB, no LLM. NEU-377: plain system block (cluster
    instructions are below Sonnet's 2048-token cache floor, so no cache_control)."""
    user: dict[str, Any] = {
        "film": {"title": film_title, "year": film_year},
        "existing_events": existing_payload,
        "new_stories": new_payload,
    }
    system = [{"type": "text", "text": _INSTRUCTIONS}]
    messages = [{"role": "user", "content": json.dumps(user)}]
    return system, messages
```

Then in `build_cluster_request`, replace the inline `user` / `system` / `messages` construction (currently lines ~175–189) with a call to it, keeping the `plan` construction:

```python
    system, messages = assemble_cluster_payload(
        film_title=film.title,
        film_year=film.release_date.year if film.release_date else None,
        existing_payload=existing_payload,
        new_payload=new_payload,
    )
    plan = ClusterPlan(
        film_id=film_id,
        existing_event_ids=[e.id for e in existing_events],
        unclustered_story_ids=[s.id for s in unclustered],
        film_status=film.status,
    )
    return system, messages, plan
```

- [ ] **Step 4: Run the new test + the cluster regression suite**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: PASS.
Run: `task test -- tests/integration/link/`
Expected: PASS (behavior unchanged — `build_cluster_request` tests still green).

- [ ] **Step 5: Lint, typecheck, format**

Run: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/link/cluster.py tests/unit/link/test_cluster_pure.py
git commit -m "refactor(link): extract pure assemble_cluster_payload from build_cluster_request

Refs NEU-300."
```

---

### Task 2: Extract pure `parse_cluster_groups`

**Files:**
- Modify: `src/upmovies/link/cluster.py` (add `ClusterGroup` + `parse_cluster_groups`; rewire `apply_cluster_decisions` to consume it)
- Test: `tests/unit/link/test_cluster_pure.py` (append)

**Interfaces:**
- Consumes: `_extract_json_object` (existing, same module).
- Produces:
  - `ClusterGroup` dataclass: `existing: int | None`, `event_type: str | None`, `confidence: str | None`, `story_indices: list[int]` (1-based, within `1..n_stories`, within-group de-duplicated, order-preserved).
  - `parse_cluster_groups(raw: str, *, n_stories: int) -> list[ClusterGroup] | None` — `None` only when the JSON is unparseable. **No cross-group dedup** (that stays in `apply_cluster_decisions`'s `assigned` set) and **no type validation** (the caller owns `_VALID_TYPES` / stale-stage rules).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/link/test_cluster_pure.py`:

```python
from upmovies.link.cluster import parse_cluster_groups


def test_parse_cluster_groups_new_event():
    raw = '{"events": [{"existing": null, "type": "casting", "confidence": "confirmed", "stories": [1, 2]}]}'
    groups = parse_cluster_groups(raw, n_stories=2)
    assert groups is not None and len(groups) == 1
    g = groups[0]
    assert g.existing is None
    assert g.event_type == "casting"
    assert g.confidence == "confirmed"
    assert g.story_indices == [1, 2]


def test_parse_cluster_groups_attach_to_existing():
    raw = '{"events": [{"existing": 3, "type": null, "confidence": null, "stories": [1]}]}'
    groups = parse_cluster_groups(raw, n_stories=2)
    assert groups[0].existing == 3 and groups[0].story_indices == [1]


def test_parse_cluster_groups_drops_out_of_range_and_dupes():
    raw = '{"events": [{"existing": null, "type": "trailer", "confidence": "confirmed", "stories": [1, 1, 5, "x"]}]}'
    groups = parse_cluster_groups(raw, n_stories=2)
    assert groups[0].story_indices == [1]


def test_parse_cluster_groups_unparseable_returns_none():
    assert parse_cluster_groups('{"events": [trunc', n_stories=3) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: FAIL — `cannot import name 'parse_cluster_groups'`.

- [ ] **Step 3: Add `ClusterGroup` + `parse_cluster_groups`**

In `src/upmovies/link/cluster.py`, add near the other dataclasses:

```python
@dataclass
class ClusterGroup:
    existing: int | None
    event_type: str | None
    confidence: str | None
    story_indices: list[int]


def parse_cluster_groups(raw: str, *, n_stories: int) -> list[ClusterGroup] | None:
    """Pure parse of the cluster LLM response. Returns None when the JSON is unparseable
    (the caller decides what a None means). Validates story indices are ints within
    1..n_stories and de-duplicates them *within a group*; cross-group dedup and
    type/confidence validation stay in apply_cluster_decisions."""
    try:
        data = json.loads(_extract_json_object(raw))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return []
    groups: list[ClusterGroup] = []
    for group in data.get("events", []):
        seen: set[int] = set()
        indices: list[int] = []
        for n in group.get("stories") or []:
            if not isinstance(n, int) or not (1 <= n <= n_stories) or n in seen:
                continue
            seen.add(n)
            indices.append(n)
        existing = group.get("existing")
        groups.append(
            ClusterGroup(
                existing=existing if isinstance(existing, int) else None,
                event_type=group.get("type"),
                confidence=group.get("confidence"),
                story_indices=indices,
            )
        )
    return groups
```

- [ ] **Step 4: Rewire `apply_cluster_decisions` to consume it**

Replace the inline `try/json.loads` block and the per-`group` index loop. The new top of the loop:

```python
    groups = parse_cluster_groups(raw, n_stories=len(story_ids))
    if groups is None:
        log.warning("cluster: unparseable response for film %s", plan.film_id)
        return ClusterResult(0, 0)

    now = datetime.now(UTC)
    assigned: set[UUID] = set()
    events_created = stories_clustered = stories_rejected = 0

    for group in groups:
        group_sids: list[UUID] = []
        for n in group.story_indices:
            sid = story_ids[n - 1]
            if sid not in by_id or sid in assigned:
                continue
            group_sids.append(sid)
        if not group_sids:
            continue
        if group.existing is not None and 1 <= group.existing <= len(existing_events):
            event = existing_events[group.existing - 1]
            event.updated_at = now
        else:
            etype = group.event_type
            conf = group.confidence
            if etype not in _VALID_TYPES or conf not in ("confirmed", "rumored"):
                log.warning(
                    "cluster: invalid new event for film %s: type=%r confidence=%r",
                    plan.film_id,
                    etype,
                    conf,
                )
                continue
            if is_stale_stage(etype, plan.film_status):
                for sid in group_sids:
                    story = by_id[sid]
                    story.link_status = "rejected"
                    story.film_id = None
                    story.link_confidence = None
                    story.link_note = f"stale-stage:{etype}"
                    assigned.add(sid)
                    stories_rejected += 1
                continue
            occurred = min((by_id[sid].published_at or by_id[sid].fetched_at) for sid in group_sids)
            event = Event(
                film_id=plan.film_id, event_type=etype, confidence=conf, occurred_at=occurred
            )
            session.add(event)
            await session.flush()
            events_created += 1
        for sid in group_sids:
            session.add(EventStory(event_id=event.id, story_id=sid))
            assigned.add(sid)
            stories_clustered += 1

    return ClusterResult(events_created, stories_clustered, stories_rejected)
```

(The within-group dedup that used to be `sid in group_sids` is now done by `parse_cluster_groups`; the cross-group `assigned` dedup is unchanged. Net behavior is identical.)

- [ ] **Step 5: Run unit + regression suites**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: PASS.
Run: `task test -- tests/integration/link/`
Expected: PASS — `apply_cluster_decisions` behavior unchanged (incl. `test_apply_dedups_repeated_story_within_group`, `test_apply_returns_empty_on_unparseable_response`).

- [ ] **Step 6: Lint, typecheck, format, commit**

```bash
task format && task lint && task typecheck
git add src/upmovies/link/cluster.py tests/unit/link/test_cluster_pure.py
git commit -m "refactor(link): extract pure parse_cluster_groups from apply_cluster_decisions

Refs NEU-300."
```

---

### Task 3: `compute_cluster_metrics` (purity + pairwise dedup)

**Files:**
- Modify: `src/upmovies/link/metrics.py`
- Test: `tests/unit/link/test_metrics.py`

**Interfaces:**
- Consumes: `cluster_purity` (existing, same module).
- Produces: `compute_cluster_metrics(predicted_clusters: Iterable[set[str]], gold_group_by_key: Mapping[str, str | None]) -> ClusterMetrics` with fields `purity, pairwise_precision, pairwise_recall, pairwise_f1, n_items, n_predicted_pairs, n_gold_pairs` (all floats except the three `int` counts). **Invariant the caller must honor:** predicted clusters are within-film and gold slugs are film-namespaced, so no pair crosses films.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/link/test_metrics.py`:

```python
from upmovies.link.metrics import compute_cluster_metrics


def test_cluster_metrics_perfect():
    pred = [{"a", "b"}, {"c"}]
    gold = {"a": "g1", "b": "g1", "c": "g2"}
    m = compute_cluster_metrics(pred, gold)
    assert m.purity == 1.0
    assert m.pairwise_precision == 1.0
    assert m.pairwise_recall == 1.0
    assert m.pairwise_f1 == 1.0
    assert m.n_items == 3


def test_cluster_metrics_over_merge_drops_precision():
    pred = [{"a", "b"}]  # model merged two distinct beats
    gold = {"a": "g1", "b": "g2"}
    m = compute_cluster_metrics(pred, gold)
    assert m.pairwise_precision == 0.0  # 1 predicted pair, 0 gold pairs
    assert m.pairwise_recall == 1.0     # no gold pair to miss
    assert m.purity == 0.5
    assert m.n_predicted_pairs == 1 and m.n_gold_pairs == 0


def test_cluster_metrics_over_split_drops_recall():
    pred = [{"a"}, {"b"}]  # model fragmented one beat → duplicate events
    gold = {"a": "g1", "b": "g1"}
    m = compute_cluster_metrics(pred, gold)
    assert m.pairwise_recall == 0.0     # missed the one gold pair
    assert m.pairwise_precision == 1.0  # no predicted pair → none false
    assert m.purity == 1.0              # purity is blind to splitting
    assert m.n_predicted_pairs == 0 and m.n_gold_pairs == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `task test -- tests/unit/link/test_metrics.py`
Expected: FAIL — `cannot import name 'compute_cluster_metrics'`.

- [ ] **Step 3: Implement**

In `src/upmovies/link/metrics.py`, add `from itertools import combinations` to the imports, then:

```python
@dataclass
class ClusterMetrics:
    purity: float
    pairwise_precision: float
    pairwise_recall: float
    pairwise_f1: float
    n_items: int
    n_predicted_pairs: int
    n_gold_pairs: int


def _co_pairs(groups: Iterable[Iterable[str]]) -> set[frozenset[str]]:
    """All unordered same-group key pairs across the given groups."""
    pairs: set[frozenset[str]] = set()
    for group in groups:
        for a, b in combinations(sorted(set(group)), 2):
            pairs.add(frozenset((a, b)))
    return pairs


def compute_cluster_metrics(
    predicted_clusters: Iterable[set[str]],
    gold_group_by_key: Mapping[str, str | None],
) -> ClusterMetrics:
    """Score predicted clusters (sets of story keys) against gold event_group slugs.
    Purity catches over-merging; pairwise recall catches over-splitting (the dedup axis).
    Empty pair-sets score 1.0 by convention (no pairs to get wrong)."""
    clusters = [set(c) for c in predicted_clusters]
    purity = cluster_purity(clusters, gold_group_by_key)

    gold_groups: dict[str, set[str]] = {}
    for key, slug in gold_group_by_key.items():
        if slug is not None:
            gold_groups.setdefault(slug, set()).add(key)

    predicted_pairs = _co_pairs(clusters)
    gold_pairs = _co_pairs(gold_groups.values())
    tp = len(predicted_pairs & gold_pairs)
    pp = len(predicted_pairs)
    gp = len(gold_pairs)
    precision = tp / pp if pp else 1.0
    recall = tp / gp if gp else 1.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    n_items = sum(len(c) for c in clusters)
    return ClusterMetrics(purity, precision, recall, f1, n_items, pp, gp)
```

- [ ] **Step 4: Run to verify pass**

Run: `task test -- tests/unit/link/test_metrics.py`
Expected: PASS (all three new cases + existing metrics tests).

- [ ] **Step 5: Lint, typecheck, format, commit**

```bash
task format && task lint && task typecheck
git add src/upmovies/link/metrics.py tests/unit/link/test_metrics.py
git commit -m "feat(link): add compute_cluster_metrics (purity + pairwise dedup)

Refs NEU-300."
```

---

### Task 4: `scripts/validate_clustering.py` (Stage-2 harness)

**Files:**
- Create: `scripts/validate_clustering.py`

**Interfaces:**
- Consumes: `assemble_cluster_payload`, `parse_cluster_groups` (Tasks 1–2); `compute_cluster_metrics` (Task 3); `load_validation_set` / `ValidationItem` (existing); `AnthropicClient` (existing); `settings.cluster_model`, `settings.cluster_max_tokens`, `settings.anthropic_api_key`.

- [ ] **Step 1: Confirm `ValidationItem.event_group` exists**

Run: `task shell` then `python -c "from upmovies.link.validation import ValidationItem; print('event_group' in ValidationItem.__annotations__ or hasattr(ValidationItem, 'event_group'))"`
Expected: `True`. If `False`, add `event_group: str | None = None` to `ValidationItem` (and, if there's a `_check_consistency`, allow it only on `relation == "about"` rows), with a one-line unit test in `tests/unit/link/test_validation.py`, then `task test -- tests/unit/link/test_validation.py`. (The fixture already carries the key on every row, so this is almost certainly already present.)

- [ ] **Step 2: Create the harness**

Create `scripts/validate_clustering.py`:

```python
"""Measure Stage-2 clustering accuracy (purity + pairwise dedup) against the labeled
fixture, using the real cluster_model. Approach A: in-memory, read-only DB for film
metadata, no DB writes. Run in the container with a real key in .env:

    task shell
    python scripts/validate_clustering.py [tests/fixtures/link/validation_set.json]

Prints cluster purity, pairwise precision/recall/F1, event_type agreement, and the
NEU-300 gate verdict. Costs one Sonnet cluster call per scoreable film. Record the
numbers in docs/specs/2026-06-25-neu-300-stage2-cluster-purity-design.md."""

import asyncio
import sys
from collections import Counter, defaultdict

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.config import get_settings
from upmovies.db import SessionLocal
from upmovies.link.cluster import assemble_cluster_payload, parse_cluster_groups
from upmovies.link.metrics import compute_cluster_metrics
from upmovies.link.validation import ValidationItem, load_validation_set
from upmovies.llm.client import AnthropicClient

DEFAULT_FIXTURE = "tests/fixtures/link/validation_set.json"
_SUMMARY_MAX = 500  # mirror cluster.build_cluster_request's _SUMMARY_MAX

# NEU-300 gate (see the spec).
_GREEN = (0.90, 0.80)
_FLOOR = (0.80, 0.65)


def _clustering_rows(items: list[ValidationItem]) -> dict[int, list[ValidationItem]]:
    """Rows that would actually link and thus cluster: 'about' + production-news + has
    an expected film, grouped by expected tmdb_id."""
    by_film: dict[int, list[ValidationItem]] = defaultdict(list)
    for it in items:
        if (
            it.relation == "about"
            and it.is_production_news is not False
            and it.expected_film_tmdb_id is not None
        ):
            by_film[it.expected_film_tmdb_id].append(it)
    return by_film


async def main(path: str) -> None:
    settings = get_settings()
    items = load_validation_set(path)
    by_film = _clustering_rows(items)

    async with SessionLocal() as s:
        film_by_tmdb = {f.tmdb_id: f for f in (await s.execute(select(Film))).scalars().all()}

    gold_group_by_key: dict[str, str | None] = {}
    gold_type_by_key: dict[str, str | None] = {}
    predicted_clusters: list[set[str]] = []
    predicted_type_by_cluster: list[str | None] = []
    n_films = n_no_film = n_unlabeled = n_unparseable = 0

    async with AnthropicClient(api_key=settings.anthropic_api_key) as client:
        for tmdb_id, film_items in by_film.items():
            film = film_by_tmdb.get(tmdb_id)
            if film is None:
                n_no_film += 1
                print(f"WARNING: film tmdb={tmdb_id} not in DB; skipping {len(film_items)} row(s)")
                continue
            labeled = [it for it in film_items if it.event_group]
            n_unlabeled += len(film_items) - len(labeled)
            if not labeled:
                continue
            n_films += 1
            for it in labeled:
                gold_group_by_key[it.url] = it.event_group
                gold_type_by_key[it.url] = it.event_type

            new_payload = [
                {"n": i, "title": it.title, "summary": (it.summary or "")[:_SUMMARY_MAX]}
                for i, it in enumerate(labeled, start=1)
            ]
            system, messages = assemble_cluster_payload(
                film_title=film.title,
                film_year=film.release_date.year if film.release_date else None,
                existing_payload=[],
                new_payload=new_payload,
            )
            raw = await client.complete(
                model=settings.cluster_model,
                system=system,
                messages=messages,
                max_tokens=settings.cluster_max_tokens,
            )
            groups = parse_cluster_groups(raw, n_stories=len(labeled))
            if groups is None:
                n_unparseable += 1
                print(f"WARNING: unparseable cluster response for tmdb={tmdb_id} ({film.title})")
                continue
            assigned: set[str] = set()
            for g in groups:
                cluster: set[str] = set()
                for n in g.story_indices:
                    url = labeled[n - 1].url
                    if url in assigned:
                        continue
                    assigned.add(url)
                    cluster.add(url)
                if cluster:
                    predicted_clusters.append(cluster)
                    predicted_type_by_cluster.append(g.event_type)

    m = compute_cluster_metrics(predicted_clusters, gold_group_by_key)

    # Secondary (non-gating): predicted new-event type vs the majority gold type of members.
    type_total = type_correct = 0
    for cluster, ptype in zip(predicted_clusters, predicted_type_by_cluster, strict=True):
        if ptype is None:
            continue
        gold_types = Counter(gold_type_by_key.get(u) for u in cluster)
        majority = max(gold_types, key=lambda k: gold_types[k]) if gold_types else None
        type_total += 1
        if ptype == majority:
            type_correct += 1
    type_agreement = type_correct / type_total if type_total else 0.0

    if m.purity >= _GREEN[0] and m.pairwise_f1 >= _GREEN[1]:
        verdict = "GREEN — good enough; NEU-282 stays deferred (not triggered)."
    elif m.purity >= _FLOOR[0] and m.pairwise_f1 >= _FLOOR[1]:
        verdict = "TUNE — run one cluster-prompt tuning iteration, then re-measure."
    else:
        verdict = "ESCALATE — below floor; scope NEU-282 (embeddings) per the gate."

    print("\n=== STAGE-2 CLUSTERING (gold event_group baseline) ===")
    print(f"model={settings.cluster_model}  scoreable_films={n_films}  items={m.n_items}")
    print(f"skipped: {n_no_film} film(s) not in DB, {n_unlabeled} unlabeled row(s), {n_unparseable} unparseable")
    print(f"purity={m.purity:.3f}")
    print(
        f"pairwise: precision={m.pairwise_precision:.3f} recall={m.pairwise_recall:.3f} "
        f"f1={m.pairwise_f1:.3f}  (predicted_pairs={m.n_predicted_pairs}, gold_pairs={m.n_gold_pairs})"
    )
    print(f"event_type agreement (secondary)={type_agreement:.3f} over {type_total} new event(s)")
    if m.n_gold_pairs < 10:
        print(f"NOTE: only {m.n_gold_pairs} gold pair(s) — treat pairwise as DIRECTIONAL; prefer keeping NEU-282 deferred.")
    print(f"GATE: {verdict}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FIXTURE))
```

- [ ] **Step 3: Verify it typechecks, lints, and imports**

Run: `task format && task lint && task typecheck`
Expected: clean (no test — script mirrors the untested `validate_linking.py` precedent; its pure deps are tested in Tasks 1–3).
Run: `task shell` then `python -c "import scripts.validate_clustering"`
Expected: imports with no error.

- [ ] **Step 4: Commit**

```bash
git add scripts/validate_clustering.py
git commit -m "feat(scripts): add validate_clustering Stage-2 purity harness

Refs NEU-300."
```

---

### Task 5: `scripts/propose_event_groups.py` (Opus labeling proposer) + README

**Files:**
- Create: `scripts/propose_event_groups.py`
- Modify: `tests/fixtures/link/README.md`

**Interfaces:**
- Consumes: `build_roster`-free path — reads `Film` directly; `AnthropicClient`; `_extract_json_array` (existing, `upmovies.link.linker`); `settings.anthropic_api_key`.

- [ ] **Step 1: Create the proposer**

Create `scripts/propose_event_groups.py`:

```python
"""Pre-fill gold event_group labels so building the Stage-2 validation set is a
review-and-correct pass. For each tracked film's linkable 'about' rows, a STRONG model
(Opus — deliberately distinct from the Sonnet cluster_model under test, to avoid measuring
the model against itself) groups them into production beats and names each beat. Writes the
full fixture with event_group filled to stdout, logs to stderr:

    task shell
    python scripts/propose_event_groups.py < tests/fixtures/link/validation_set.json \\
        > tests/fixtures/link/validation_eventgroups.json

Then open the output, correct the beat groupings (read every one — a model-assisted set
inherits the proposer's blind spots), and save the curated result as
tests/fixtures/link/validation_set.json."""

import asyncio
import json
import sys
from collections import defaultdict

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.config import get_settings
from upmovies.db import SessionLocal
from upmovies.link.linker import _extract_json_array
from upmovies.llm.client import AnthropicClient

PROPOSAL_MODEL = "claude-opus-4-8"  # stronger than cluster_model (Sonnet); override via argv[1]
MAX_TOKENS = 2048
SUMMARY_MAX = 500

_INSTRUCTIONS = """You group an upcoming-movies tracker's news stories about ONE film into \
distinct production BEATS — real moments in its life (a casting, a trailer drop, a \
release-date change, filming start/wrap, a director/studio change, etc.). Stories reporting \
the SAME beat share a group; different beats are different groups. Five outlets reporting the \
same casting are ONE beat.

You are given the FILM and a list of its stories (each an integer id "n", a headline, and a \
short dek). Assign every story a short kebab-case beat slug naming the beat (e.g. \
"doctor-doom-casting", "first-trailer", "release-date-shift", "filming-wrap").

Return ONLY a JSON array — no prose, no markdown — one object per input story:
[{"n": <id>, "beat": "<kebab-slug>"}]"""


async def main(model: str) -> None:
    rows = json.load(sys.stdin)
    print(f"loaded {len(rows)} fixture rows", file=sys.stderr)

    settings = get_settings()
    async with SessionLocal() as s:
        film_by_tmdb = {f.tmdb_id: f for f in (await s.execute(select(Film))).scalars().all()}

    # row index -> proposed event_group; only for linkable 'about' rows with a known film.
    by_film: dict[int, list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        if (
            row.get("relation") == "about"
            and row.get("is_production_news") is not False
            and row.get("expected_film_tmdb_id") in film_by_tmdb
        ):
            by_film[row["expected_film_tmdb_id"]].append(i)

    print(f"{len(by_film)} film(s) with linkable about-rows | proposer model: {model}", file=sys.stderr)

    event_group: dict[int, str] = {}
    async with AnthropicClient(api_key=settings.anthropic_api_key) as client:
        for tmdb_id, idxs in by_film.items():
            film = film_by_tmdb[tmdb_id]
            payload = [
                {
                    "n": j,
                    "title": rows[idx]["title"],
                    "summary": (rows[idx].get("summary") or "")[:SUMMARY_MAX],
                }
                for j, idx in enumerate(idxs)
            ]
            user = {"film": {"title": film.title, "year": film.release_date.year if film.release_date else None},
                    "stories": payload}
            raw = await client.complete(
                model=model,
                system=[{"type": "text", "text": _INSTRUCTIONS}],
                messages=[{"role": "user", "content": json.dumps(user)}],
                max_tokens=MAX_TOKENS,
            )
            try:
                proposals = {int(d["n"]): d.get("beat") for d in json.loads(_extract_json_array(raw))}
            except (json.JSONDecodeError, KeyError, ValueError, TypeError):
                print(f"  WARNING: unparseable proposal for tmdb={tmdb_id} ({film.title})", file=sys.stderr)
                proposals = {}
            for j, idx in enumerate(idxs):
                beat = proposals.get(j)
                if isinstance(beat, str) and beat.strip():
                    event_group[idx] = f"{tmdb_id}-{beat.strip()}"
            print(f"  proposed {film.title} ({len(idxs)} rows)", file=sys.stderr)

    out = [{**row, "event_group": event_group.get(i, row.get("event_group"))} for i, row in enumerate(rows)]
    n_labeled = sum(1 for r in out if r.get("event_group"))
    print(f"event_group proposed on {n_labeled} row(s)", file=sys.stderr)
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else PROPOSAL_MODEL))
```

- [ ] **Step 2: Verify typecheck / lint / import**

Run: `task format && task lint && task typecheck`
Expected: clean.
Run: `task shell` then `python -c "import scripts.propose_event_groups"`
Expected: imports cleanly.

- [ ] **Step 3: Document `event_group` in the fixture README**

Append to `tests/fixtures/link/README.md`:

```markdown
## `event_group` (Stage-2 gold groups)

Gold beat-grouping key for the cluster-purity baseline (NEU-300). Set **only** on linkable
`about` rows (`relation == "about"` AND `is_production_news` not `false`); `null` elsewhere.
Stories about the **same production beat** share an `event_group`; different beats differ.

Slugs are **film-namespaced** — `"{expected_film_tmdb_id}-{beat-slug}"` (e.g.
`"1003596-doctor-doom-casting"`) — so they are globally unique, which lets
`compute_cluster_metrics` pool predicted clusters across films without cross-film pair
leakage. Draft with `scripts/propose_event_groups.py` (Opus), then hand-correct; score with
`scripts/validate_clustering.py`.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/propose_event_groups.py tests/fixtures/link/README.md
git commit -m "feat(scripts): add propose_event_groups labeling proposer

Refs NEU-300."
```

---

## Final verification (before opening the PR)

- [ ] `task test` — full suite green.
- [ ] `task lint && task typecheck && task format` — all clean.
- [ ] PR title: `feat(link): add Stage-2 cluster-purity baseline harness (NEU-300)`; body may carry the `🤖` footer.

## Manual pass (Tom, post-merge — closes the ticket)

These are not code tasks; they consume real API tokens and human judgment:

1. **Label gold groups:** `python scripts/propose_event_groups.py < tests/fixtures/link/validation_set.json > /tmp/eg.json`, hand-correct the beat groupings in `/tmp/eg.json`, save as `tests/fixtures/link/validation_set.json` (commit separately).
2. **Ground-truth refine:** while labeling, re-judge the borderline `about`/`mention` rows (Famke Janssen / Tom Holland "Repay The Favour" / the *Doomsday* cast set piece). If any flip, re-run `scripts/validate_linking.py` and update the recorded Stage-1 numbers.
3. **Measure:** `python scripts/validate_clustering.py` → read purity / pairwise F1 / `n_gold_pairs` / gate verdict.
4. **Act on the gate:** GREEN → record + mark NEU-282 deferred. TUNE → one cluster-prompt iteration, re-measure. ESCALATE (only on a non-thin baseline) → scope NEU-282.
5. **Record** the numbers + the NEU-282 decision in the spec's *Baseline results* section → M3 closed.
```
