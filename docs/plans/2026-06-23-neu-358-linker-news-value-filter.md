# Linker Production-News Filter (NEU-358) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Stage-1 linker from linking stories that are *about* a tracked film but announce nothing new about its production (reactions, roundups, interview color, streaming-catalogue moves, downstream pieces), and make the change measurable via the existing validation harness.

**Architecture:** Add a fourth `reason` value `not-news` to the Stage-1 linker prompt + `apply_link_decisions`, rejecting those stories with an auditable `link_note`. Add an orthogonal "is this production news?" axis to the validation fixture (`is_production_news` + `exclusion_category`), a pure `compute_news_value_metrics` scorer, and wire a news-value report into `scripts/validate_linking.py` + label-proposal into `scripts/propose_validation_labels.py`. Stage 2 (`cluster.py`) is untouched.

**Tech Stack:** Python 3.13, Pydantic v2, SQLAlchemy 2 async (models only here), pytest (pytest-asyncio `auto` mode), ruff, pyright. Everything runs in the container via `task` — **never** run `pytest`/`ruff`/`pyright`/`python` on the host.

## Global Constraints

- **One ticket = one PR.** Branch `tom/neu-358-backend-tighten-linker-event-acceptance-criteria`.
- **Commits:** Conventional Commits subject; **no** Linear ID in the subject (optional `Refs NEU-358.` in the body); **no** `Co-Authored-By`; **no** `🤖 Generated with Claude Code` footer in commits. If executed via subagent-driven-development, implementer subagents do **not** commit — the user commits once at the end.
- **Run everything via `task`** (`task test`, `task lint`, `task typecheck`, `task format`); they `docker compose exec` into `upmovies-backend`. Keep the container up (`task up`). Run `task format` before committing.
- **All tests here are unit tests** (`tests/unit/...`) — the CLAUDE.md single-integration-file quirk does **not** apply; individual unit files are safe to run.
- **No DB migration** — `link_status='rejected'` and the free-text `link_note` column already exist.
- **Modern type hints** (`X | None`, `X | Y`); **no** `from __future__ import annotations`; ruff line length 100.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/upmovies/link/linker.py` | `not-news` reason in the prompt + `apply_link_decisions` rejection branch + `link_note` | 1 |
| `src/upmovies/link/validation.py` | `ValidationItem.is_production_news` / `.exclusion_category` + validator | 2 |
| `src/upmovies/link/metrics.py` | pure `compute_news_value_metrics` + `NewsValueMetrics` | 3 |
| `tests/fixtures/link/validation_set.json` | relabel Famke row + add curated `not-news` rows | 4 |
| `tests/fixtures/link/README.md` | document the two new fields + scoring rule | 4 |
| `scripts/validate_linking.py` | `news_value_rows` helper + news-value report section | 5 |
| `scripts/propose_validation_labels.py` | `_proposal_to_row` helper + proposer prompt emits the new axis | 5 |
| `tests/unit/link/test_linker.py` | `not-news` decision tests | 1 |
| `tests/unit/link/test_validation.py` | new-field validator + curated-fixture tests | 2, 4 |
| `tests/unit/link/test_metrics.py` | news-value scorer tests | 3 |
| `tests/unit/scripts/test_news_value_tooling.py` | **new** — pure helpers in both scripts | 5 |

---

## Task 1: Reject non-production-news stories in the linker

**Files:**
- Modify: `src/upmovies/link/linker.py` (`_INSTRUCTIONS` prompt; `apply_link_decisions` ~line 119-171)
- Test: `tests/unit/link/test_linker.py`

**Interfaces:**
- Consumes: existing `apply_link_decisions(*, raw, stories, roster, floor)`, `link_story_batch(...)`, and the test helpers `_run`, `_roster`, `_story` already in `test_linker.py`.
- Produces: `apply_link_decisions` now handles a decision with `reason == "not-news"` (+ optional `category`) → `link_status="rejected"`, `film_id=None`, `link_confidence=None`, `link_note = "not-news:<category>"` when `category` is one of the recognized set, else `"not-news"`. Recognized categories: module constant `_NOT_NEWS_CATEGORIES = {"reaction", "roundup", "streaming-move", "interview-quote", "downstream"}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/link/test_linker.py`:

```python
async def test_not_news_with_category_is_rejected():
    story, _, _, result = await _run(
        lambda sid: json.dumps(
            [{"id": sid, "film": 1, "confidence": 0.9, "reason": "not-news", "category": "reaction"}]
        )
    )
    assert result.rejected == 1 and result.linked == 0
    assert story.link_status == "rejected"
    assert story.film_id is None
    assert story.link_confidence is None
    assert story.link_note == "not-news:reaction"


async def test_not_news_without_category_is_rejected():
    story, _, _, _ = await _run(
        lambda sid: json.dumps([{"id": sid, "film": 1, "confidence": 0.9, "reason": "not-news"}])
    )
    assert story.link_status == "rejected"
    assert story.link_note == "not-news"


async def test_not_news_unknown_category_falls_back_to_bare_note():
    story, _, _, _ = await _run(
        lambda sid: json.dumps(
            [{"id": sid, "film": 1, "confidence": 0.9, "reason": "not-news", "category": "bogus"}]
        )
    )
    assert story.link_note == "not-news"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/link/test_linker.py -k not_news`
Expected: FAIL — `not-news` currently falls through to the final `else`, so `link_note == "no-match"`, not `"not-news..."`.

- [ ] **Step 3: Add the recognized-category constant**

In `src/upmovies/link/linker.py`, below `_MAX_TOKENS = 2048` (line 19), add:

```python
_NOT_NEWS_CATEGORIES = {"reaction", "roundup", "streaming-move", "interview-quote", "downstream"}
```

- [ ] **Step 4: Add the `not-news` branch in `apply_link_decisions`**

In `apply_link_decisions`, replace the rejection `else` block (currently lines 151-161) with:

```python
        else:
            story.link_status = "rejected"
            story.film_id = None
            story.link_confidence = None
            if reason == "about" and film_id is not None and confidence < floor:
                story.link_note = "below-floor"
            elif reason == "mention":
                story.link_note = "mention"
            elif reason == "not-news":
                category = decision.get("category")
                story.link_note = (
                    f"not-news:{category}" if category in _NOT_NEWS_CATEGORIES else "not-news"
                )
            else:
                story.link_note = "no-match"
            rejected += 1
```

- [ ] **Step 5: Update the linker prompt**

In `_INSTRUCTIONS`, replace the `Definitions:` block (currently lines 27-34) with:

```python
Definitions:
- "about": the story announces or confirms something NEW about exactly one tracked film's \
production — casting, a filming start/wrap/status change, a trailer or teaser, a release \
date set or moved, a major creative/production change (director, studio, format), or a \
release-affecting distribution deal.
- "not-news": the story is primarily about a tracked film but announces nothing new about \
its production. Do NOT link these. Examples: cast/crew or fan/social-media reactions, \
praise, or enthusiasm; "everything we know so far" roundups and aggregators with no new \
information; interview color about what it is like to work on the project; talent comments \
on plot points that are not a formal announcement; streaming-platform or catalogue moves \
of an existing title; and any story whose news value is entirely downstream of an earlier \
beat.
- "mention": the film is only referenced in passing (an aside, a list, a comparison, or \
an actor's other project). Mentions are NOT links.
- "no-match": the story is not about any tracked film. Most stories are no-match — \
unrelated TV, games, sports, obituaries, or already-released films. Returning no-match is \
expected and correct.
```

Then replace the JSON-contract paragraph (currently lines 40-46) with:

```python
Return ONLY a JSON array — no prose, no markdown — one object per input story, using the \
story's id:
[{"id": "<story id>", "film": <roster index or null>, "confidence": <0.0-1.0>, "reason": \
"about" | "mention" | "no-match" | "not-news", "category": "reaction" | "roundup" | \
"streaming-move" | "interview-quote" | "downstream" | null}]

"confidence" is your probability that the story is about that exact roster film (0.0 for \
mention/no-match/not-news). "category" labels why a "not-news" story was excluded (null \
otherwise)."""
```

- [ ] **Step 6: Run the not-news tests to verify they pass**

Run: `task test -- tests/unit/link/test_linker.py -k not_news`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the whole linker file for regression**

Run: `task test -- tests/unit/link/test_linker.py`
Expected: PASS — existing about/mention/no-match/below-floor/no-decision tests still green (the opening "entity-linking classifier" line is unchanged, so `test_build_batch_request_carries_custom_id_and_cached_block` still passes).

- [ ] **Step 8: Commit**

```bash
task format
git add src/upmovies/link/linker.py tests/unit/link/test_linker.py
git commit -m "feat(link): reject non-production-news stories in the Stage-1 linker

Refs NEU-358."
```

---

## Task 2: Add the production-news axis to the fixture schema

**Files:**
- Modify: `src/upmovies/link/validation.py` (`ValidationItem` + `_check_consistency`)
- Test: `tests/unit/link/test_validation.py`

**Interfaces:**
- Produces: `ValidationItem.is_production_news: bool | None` (default `None`) and `ValidationItem.exclusion_category: Literal["reaction","roundup","streaming-move","interview-quote","downstream","other"] | None` (default `None`). Validator rules: both may be set only when `relation == "about"`; `exclusion_category` may be set only when `is_production_news is False`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/link/test_validation.py`:

```python
def test_about_can_carry_production_news_axis():
    item = ValidationItem.model_validate(
        _item(is_production_news=False, exclusion_category="reaction", event_type=None)
    )
    assert item.is_production_news is False
    assert item.exclusion_category == "reaction"


def test_about_defaults_news_axis_to_none():
    item = ValidationItem.model_validate(_item())
    assert item.is_production_news is None
    assert item.exclusion_category is None


def test_news_axis_only_on_about_items():
    with pytest.raises(ValidationError):
        ValidationItem.model_validate(
            _item(relation="none", expected_film_tmdb_id=None, event_type=None,
                  is_production_news=False)
        )


def test_exclusion_category_requires_is_production_news_false():
    with pytest.raises(ValidationError):
        ValidationItem.model_validate(_item(exclusion_category="reaction"))  # is_production_news None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/link/test_validation.py -k "news_axis or production_news or exclusion_category"`
Expected: FAIL — fields don't exist yet (`ValidationError`/`TypeError` on unknown field, or the consistency rules aren't enforced).

- [ ] **Step 3: Add the fields**

In `src/upmovies/link/validation.py`, add to `ValidationItem` (after `event_group`, line 20):

```python
    is_production_news: bool | None = None  # about-only: False = excluded (not production news)
    exclusion_category: (
        Literal["reaction", "roundup", "streaming-move", "interview-quote", "downstream", "other"]
        | None
    ) = None
```

- [ ] **Step 4: Extend the validator**

In `_check_consistency` (before `return self`, line 27), add:

```python
        if self.relation != "about" and (
            self.is_production_news is not None or self.exclusion_category is not None
        ):
            raise ValueError("production-news fields may be set only on 'about' items")
        if self.exclusion_category is not None and self.is_production_news is not False:
            raise ValueError("exclusion_category requires is_production_news=False")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `task test -- tests/unit/link/test_validation.py`
Expected: PASS (existing 3 + new 4).

- [ ] **Step 6: Commit**

```bash
task format
git add src/upmovies/link/validation.py tests/unit/link/test_validation.py
git commit -m "feat(link): add production-news axis to the validation fixture schema

Refs NEU-358."
```

---

## Task 3: News-value precision/recall scorer

**Files:**
- Modify: `src/upmovies/link/metrics.py`
- Test: `tests/unit/link/test_metrics.py`

**Interfaces:**
- Produces:
  - `@dataclass NewsValueMetrics` with `true_positives, false_positives, false_negatives, true_negatives: int`, `precision, recall: float`, `leaks_by_category: dict[str, int]`.
  - `compute_news_value_metrics(rows: Iterable[tuple[bool, bool | None, str | None]]) -> NewsValueMetrics`. Each row is `(linked, is_production_news, exclusion_category)` for one **about** row. Expected-news = `is_production_news is not False`. linked&expected→TP; linked&excluded→FP (+ `leaks_by_category[category or "other"] += 1`); not-linked&expected→FN; not-linked&excluded→TN. `precision = TP/(TP+FP)`, `recall = TP/(TP+FN)` (0.0 when denominator 0).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/link/test_metrics.py` (and extend the import on line 1):

```python
from upmovies.link.metrics import (
    cluster_purity,
    compute_link_metrics,
    compute_news_value_metrics,
)


def test_news_value_all_real_news_linked():
    m = compute_news_value_metrics([(True, True, None), (True, None, None)])
    assert (m.true_positives, m.false_positives, m.false_negatives) == (2, 0, 0)
    assert m.precision == 1.0 and m.recall == 1.0
    assert m.leaks_by_category == {}


def test_news_value_linked_excluded_is_a_leak():
    m = compute_news_value_metrics([(True, False, "reaction")])
    assert m.false_positives == 1 and m.precision == 0.0
    assert m.leaks_by_category == {"reaction": 1}


def test_news_value_leak_without_category_buckets_other():
    m = compute_news_value_metrics([(True, False, None)])
    assert m.leaks_by_category == {"other": 1}


def test_news_value_dropped_excluded_is_true_negative():
    m = compute_news_value_metrics([(False, False, "roundup")])
    assert m.true_negatives == 1 and not m.leaks_by_category


def test_news_value_dropped_real_news_is_false_negative():
    m = compute_news_value_metrics([(False, True, None)])
    assert m.false_negatives == 1 and m.recall == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/link/test_metrics.py -k news_value`
Expected: FAIL — `ImportError: cannot import name 'compute_news_value_metrics'`.

- [ ] **Step 3: Implement the scorer**

Append to `src/upmovies/link/metrics.py` (the file already imports `Counter`, `Iterable`, `dataclass`):

```python
@dataclass
class NewsValueMetrics:
    true_positives: int
    false_positives: int
    false_negatives: int
    true_negatives: int
    precision: float
    recall: float
    leaks_by_category: dict[str, int]


def compute_news_value_metrics(
    rows: Iterable[tuple[bool, bool | None, str | None]],
) -> NewsValueMetrics:
    """Score the production-news axis over 'about' rows. Each row is
    (linked, is_production_news, exclusion_category); expected-news is True unless
    is_production_news is explicitly False. precision/recall are about the *kept* (linked)
    stories being real news; leaks_by_category counts excluded rows that still linked."""
    tp = fp = fn = tn = 0
    leaks: Counter[str] = Counter()
    for linked, is_news, category in rows:
        expected_news = is_news is not False
        if linked and expected_news:
            tp += 1
        elif linked:  # linked an excluded story — a leak
            fp += 1
            leaks[category or "other"] += 1
        elif expected_news:  # dropped a real-news story
            fn += 1
        else:  # correctly dropped an excluded story
            tn += 1
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    return NewsValueMetrics(tp, fp, fn, tn, precision, recall, dict(leaks))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `task test -- tests/unit/link/test_metrics.py`
Expected: PASS (existing 7 + new 5).

- [ ] **Step 5: Commit**

```bash
task format
git add src/upmovies/link/metrics.py tests/unit/link/test_metrics.py
git commit -m "feat(link): add news-value precision/recall scorer

Refs NEU-358."
```

---

## Task 4: Curated regression rows + fixture docs

**Files:**
- Modify: `tests/fixtures/link/validation_set.json` (relabel 1 row, add 5 rows)
- Modify: `tests/fixtures/link/README.md`
- Test: `tests/unit/link/test_validation.py`

**Interfaces:**
- Consumes: `load_validation_set` (Task 2 schema), `compute_news_value_metrics` (Task 3).
- Produces: the committed fixture contains ≥6 `about` rows with `is_production_news == False` covering all five categories `{reaction, roundup, streaming-move, interview-quote, downstream}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/link/test_validation.py` (add `from pathlib import Path` at the top):

```python
_FIXTURE = Path(__file__).parents[2] / "fixtures" / "link" / "validation_set.json"
_EXCLUSION_CATEGORIES = {"reaction", "roundup", "streaming-move", "interview-quote", "downstream"}


def test_fixture_has_curated_not_news_rows():
    items = load_validation_set(_FIXTURE)
    excluded = [it for it in items if it.relation == "about" and it.is_production_news is False]
    assert len(excluded) >= 6
    assert _EXCLUSION_CATEGORIES <= {it.exclusion_category for it in excluded}


def test_curated_excluded_rows_score_clean_when_dropped():
    from upmovies.link.metrics import compute_news_value_metrics

    items = load_validation_set(_FIXTURE)
    excluded = [it for it in items if it.relation == "about" and it.is_production_news is False]
    rows = [(False, it.is_production_news, it.exclusion_category) for it in excluded]
    m = compute_news_value_metrics(rows)
    assert m.true_negatives == len(excluded)
    assert m.false_positives == 0 and m.leaks_by_category == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/link/test_validation.py -k "curated or not_news_rows"`
Expected: FAIL — the fixture has no `is_production_news` rows yet.

- [ ] **Step 3: Relabel the Famke-Janssen row**

In `tests/fixtures/link/validation_set.json`, find the object with
`"url": "https://deadline.com/2026/06/famke-janssen-marvel-made-mistake-avengers-doomsday-1236963165/"`
and add two keys to it (keep its existing keys; it is `relation: "about"`, `expected_film_tmdb_id: 1003596`):

```json
      "is_production_news": false,
      "exclusion_category": "interview-quote"
```

- [ ] **Step 4: Add 5 curated not-news rows**

Append these 5 objects to the JSON array (each references a film already tracked in the fixture, so `expected_film_tmdb_id` is real):

```json
    {
      "url": "https://example.test/neu358/lotr-gollum-mckellen-cant-wait",
      "source": "Empire",
      "title": "Ian McKellen “Can’t Wait” To Return As Gandalf In The Hunt For Gollum",
      "summary": "The actor gushed about reuniting with Andy Serkis, calling the upcoming film a dream he never expected to revisit.",
      "relation": "about",
      "expected_film_tmdb_id": 1090869,
      "event_type": null,
      "event_group": null,
      "is_production_news": false,
      "exclusion_category": "reaction"
    },
    {
      "url": "https://example.test/neu358/spider-man-brand-new-day-everything-we-know",
      "source": "ScreenRant",
      "title": "Spider-Man: Brand New Day — Everything We Know So Far About The MCU Reboot",
      "summary": "A roundup of previously reported casting, plot rumors, and release details — no new information.",
      "relation": "about",
      "expected_film_tmdb_id": 969681,
      "event_type": null,
      "event_group": null,
      "is_production_news": false,
      "exclusion_category": "roundup"
    },
    {
      "url": "https://example.test/neu358/enola-holmes-netflix-top-10-resurgence",
      "source": "Collider",
      "title": "Enola Holmes 1 & 2 Surge Back Into Netflix’s Global Top 10 Ahead Of The Threequel",
      "summary": "The first two films are climbing the streaming charts again as catalogue interest builds.",
      "relation": "about",
      "expected_film_tmdb_id": 1202033,
      "event_type": null,
      "event_group": null,
      "is_production_news": false,
      "exclusion_category": "streaming-move"
    },
    {
      "url": "https://example.test/neu358/evil-dead-burn-producer-teases-deadites",
      "source": "Bloody Disgusting",
      "title": "Evil Dead Burn Producer Teases A “Nastier” Deadite Ahead Of Release",
      "summary": "In a new interview the producer dropped a minor plot detail about the creature design, downstream of the already-reported greenlight.",
      "relation": "about",
      "expected_film_tmdb_id": 1212763,
      "event_type": null,
      "event_group": null,
      "is_production_news": false,
      "exclusion_category": "downstream"
    },
    {
      "url": "https://example.test/neu358/how-to-rob-a-bank-dubai-screening-reaction",
      "source": "X",
      "title": "Audiences Go Wild Over How To Rob A Bank Footage At Surprise Dubai Screening",
      "summary": "Social media erupted with praise after a sizzle reel screened for fans — a reaction, not an announcement.",
      "relation": "about",
      "expected_film_tmdb_id": 1437511,
      "event_type": null,
      "event_group": null,
      "is_production_news": false,
      "exclusion_category": "reaction"
    }
```

> Note: insert these as elements of the existing top-level array (mind the comma after the previous final element). If unsure the JSON is well-formed, validate inside the container: `task shell` then `python -c "import json; json.load(open('tests/fixtures/link/validation_set.json'))"`.

- [ ] **Step 5: Document the new fields in the README**

In `tests/fixtures/link/README.md`, add two rows to the Schema table (after the `event_group` row, line 44) and a short subsection. Table rows:

```markdown
| `is_production_news` | bool \| null | no (about only) | `false` marks an `about` story that is **not** production news (should not link). `null` = treated as production news (expected to link). |
| `exclusion_category` | string \| null | no | One of `reaction｜roundup｜streaming-move｜interview-quote｜downstream｜other`. Set only when `is_production_news` is `false`. Diagnoses *why* a story was excluded. |
```

Then add this subsection after "Relation labels":

```markdown
## Production-news axis (NEU-358)

Orthogonal to about/mention/none: an `about` story can still fail the *production-news*
test (it talks about the film but announces nothing new — a reaction, a roundup, interview
color, a streaming-catalogue move, or a downstream piece). For scoring, an `about` row is
**expected to link** iff `is_production_news is not False`; rows with `is_production_news:
false` are expected to be rejected by the Stage-1 linker. Run `scripts/validate_linking.py`
to see news-value precision/recall and the leak-by-category table.
```

- [ ] **Step 6: Run the fixture tests to verify they pass**

Run: `task test -- tests/unit/link/test_validation.py`
Expected: PASS (curated + scoring tests green; the whole file still loads the fixture).

- [ ] **Step 7: Commit**

```bash
task format
git add tests/fixtures/link/validation_set.json tests/fixtures/link/README.md tests/unit/link/test_validation.py
git commit -m "test(link): add curated not-news rows to the validation fixture

Refs NEU-358."
```

---

## Task 5: Wire news-value reporting into the harness + label proposer

**Files:**
- Modify: `scripts/validate_linking.py` (add `news_value_rows` helper + report section)
- Modify: `scripts/propose_validation_labels.py` (extract `_proposal_to_row` + proposer prompt emits the axis)
- Test: `tests/unit/scripts/test_news_value_tooling.py` (new)

**Interfaces:**
- Consumes: `ValidationItem` (Task 2), `compute_news_value_metrics` (Task 3). `scripts` is an importable package (`from scripts.validate_linking import news_value_rows`).
- Produces:
  - `news_value_rows(items_with_linked: Iterable[tuple[ValidationItem, bool]]) -> list[tuple[bool, bool | None, str | None]]` — keeps only `relation == "about"` items, mapping each to `(linked, is_production_news, exclusion_category)`.
  - `_proposal_to_row(row: dict, proposal: dict | None, roster_tmdb_ids: set[int]) -> dict` — builds one output fixture row including `is_production_news` / `exclusion_category` (set only for `about` proposals; `exclusion_category` only when `is_production_news is False`).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/scripts/test_news_value_tooling.py`:

```python
from scripts.propose_validation_labels import _proposal_to_row
from scripts.validate_linking import news_value_rows
from upmovies.link.validation import ValidationItem


def _about(**kw) -> ValidationItem:
    base = dict(url="u", source="s", title="t", summary="", relation="about",
                expected_film_tmdb_id=1)
    base.update(kw)
    return ValidationItem.model_validate(base)


def test_news_value_rows_keeps_about_and_maps_linked():
    items_with_linked = [
        (_about(is_production_news=False, exclusion_category="reaction"), True),
        (_about(), False),
        (ValidationItem.model_validate(dict(url="u2", source="s", title="t", summary="",
                                            relation="none")), True),  # dropped (not about)
    ]
    rows = news_value_rows(items_with_linked)
    assert rows == [(True, False, "reaction"), (False, None, None)]


def _draft_row():
    return {"url": "u", "source": "s", "title": "t", "summary": ""}


def test_proposal_to_row_about_carries_news_axis():
    p = {"relation": "about", "tmdb_id": 7, "event_type": "casting",
         "is_production_news": False, "exclusion_category": "roundup"}
    row = _proposal_to_row(_draft_row(), p, {7})
    assert row["relation"] == "about" and row["expected_film_tmdb_id"] == 7
    assert row["is_production_news"] is False and row["exclusion_category"] == "roundup"


def test_proposal_to_row_real_news_has_no_exclusion_category():
    p = {"relation": "about", "tmdb_id": 7, "event_type": "trailer",
         "is_production_news": True, "exclusion_category": "roundup"}
    row = _proposal_to_row(_draft_row(), p, {7})
    assert row["is_production_news"] is True and row["exclusion_category"] is None


def test_proposal_to_row_non_about_blanks_news_axis():
    p = {"relation": "none", "tmdb_id": None, "event_type": None,
         "is_production_news": False, "exclusion_category": "reaction"}
    row = _proposal_to_row(_draft_row(), p, set())
    assert row["relation"] == "none"
    assert row["is_production_news"] is None and row["exclusion_category"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/scripts/test_news_value_tooling.py`
Expected: FAIL — `ImportError` for `news_value_rows` / `_proposal_to_row`.

- [ ] **Step 3: Add `news_value_rows` + report to `validate_linking.py`**

In `scripts/validate_linking.py`, add the import and helper near the top (after the existing imports):

```python
from collections.abc import Iterable

from upmovies.link.metrics import compute_link_metrics, compute_news_value_metrics
from upmovies.link.validation import ValidationItem, load_validation_set


def news_value_rows(
    items_with_linked: Iterable[tuple[ValidationItem, bool]],
) -> list[tuple[bool, bool | None, str | None]]:
    """Map (item, linked) pairs to the news-value scorer's row shape, keeping 'about' only."""
    return [
        (linked, it.is_production_news, it.exclusion_category)
        for it, linked in items_with_linked
        if it.relation == "about"
    ]
```

(Replace the existing `from upmovies.link.metrics import compute_link_metrics` and `from upmovies.link.validation import load_validation_set` lines with the combined imports above.)

Then, at the end of `main()` (after the precision/recall print, line 74), add:

```python
    nv = compute_news_value_metrics(
        news_value_rows((it, st.film_id is not None) for st, it in zip(stories, items, strict=True))
    )
    print("\n=== NEWS-VALUE (production-news axis, 'about' rows) ===")
    print(
        f"kept-real={nv.true_positives} kept-excluded(leak)={nv.false_positives} "
        f"dropped-real={nv.false_negatives} dropped-excluded={nv.true_negatives}"
    )
    print(f"precision={nv.precision:.3f}  recall={nv.recall:.3f}")
    if nv.leaks_by_category:
        leaks = ", ".join(f"{k}={v}" for k, v in sorted(nv.leaks_by_category.items()))
        print(f"leaks by category: {leaks}")
```

- [ ] **Step 4: Extract `_proposal_to_row` + extend the proposer in `propose_validation_labels.py`**

In `scripts/propose_validation_labels.py`, add the helper (after `EVENT_TYPES`, line 46):

```python
EXCLUSION_CATEGORIES = (
    "reaction",
    "roundup",
    "streaming-move",
    "interview-quote",
    "downstream",
    "other",
)


def _proposal_to_row(row: dict, proposal: dict | None, roster_tmdb_ids: set[int]) -> dict:
    """Build one fixture row from a draft row + the model's proposal. Sets the production-news
    axis only for 'about' proposals; exclusion_category only when is_production_news is False."""
    relation, tmdb_id, event_type = "TODO", None, None
    is_production_news, exclusion_category = None, None
    if proposal is not None:
        relation = (
            proposal.get("relation")
            if proposal.get("relation") in ("about", "mention", "none")
            else "TODO"
        )
        if relation == "about":
            tmdb_id = proposal.get("tmdb_id")
            if tmdb_id not in roster_tmdb_ids:  # hallucinated / out-of-roster id
                tmdb_id = None
            event_type = proposal.get("event_type") if proposal.get("event_type") in EVENT_TYPES else None
            is_production_news = proposal.get("is_production_news")
            if not isinstance(is_production_news, bool):
                is_production_news = None
            if is_production_news is False:
                cat = proposal.get("exclusion_category")
                exclusion_category = cat if cat in EXCLUSION_CATEGORIES else None
    return {
        "url": row["url"],
        "source": row["source"],
        "title": row["title"],
        "summary": row.get("summary", ""),
        "relation": relation,
        "expected_film_tmdb_id": tmdb_id,
        "event_type": event_type,
        "event_group": None,
        "is_production_news": is_production_news,
        "exclusion_category": exclusion_category,
    }
```

Replace the inline `out.append({...})` loop in `main()` (currently lines 136-164, which also tracks `bad_tmdb`) with:

```python
    out = [_proposal_to_row(row, proposals.get(str(i)), roster_tmdb_ids) for i, row in enumerate(draft)]
    missing = sum(1 for i in range(len(draft)) if proposals.get(str(i)) is None)
```

Replace the summary block — the three `n_about`/`n_mention`/`n_none` sums **and** the `bad_tmdb` print (lines 166-173, everything up to but not including the final `print(json.dumps(out, ...))`) — with:

```python
    n_about = sum(1 for r in out if r["relation"] == "about")
    n_mention = sum(1 for r in out if r["relation"] == "mention")
    n_none = sum(1 for r in out if r["relation"] == "none")
    n_excluded = sum(1 for r in out if r["is_production_news"] is False)
    print(
        f"proposals: {n_about} about ({n_excluded} not-news), {n_mention} mention, "
        f"{n_none} none, {missing} undecided",
        file=sys.stderr,
    )
```

Finally extend the proposer prompt `_INSTRUCTIONS`: change the `about` bullet and add the axis instruction. Replace the `- "about"` bullet (lines 54-56) with:

```python
- "about": the story is PRIMARILY about exactly one tracked film. Set "tmdb_id" to that \
film's TMDB id and "event_type" to one of: {", ".join(EVENT_TYPES)}. Also judge whether it \
is production news: set "is_production_news" true if it announces or confirms something NEW \
(casting, filming start/wrap, trailer, release date, a major creative/production change, a \
release-affecting distribution deal); false if it is merely about the film without new \
production info (a reaction, praise, an "everything we know" roundup, interview color, a \
streaming/catalogue move, or a downstream piece). When false, set "exclusion_category" to \
one of: reaction, roundup, streaming-move, interview-quote, downstream, other.
```

And update the JSON-contract line (lines 67-70) to:

```python
Return ONLY a JSON array — no prose, no markdown — one object per input story, using the \
story's id:
[{{"id": "<id>", "relation": "about"|"mention"|"none", "tmdb_id": <roster TMDB id or \
null>, "event_type": <one of the types above, or null>, "is_production_news": <true|false|\
null>, "exclusion_category": <category or null>}}]"""
```

- [ ] **Step 5: Run the tooling tests to verify they pass**

Run: `task test -- tests/unit/scripts/test_news_value_tooling.py`
Expected: PASS (4 tests).

- [ ] **Step 6: Lint + typecheck the scripts (they removed `bad_tmdb`; catch dead vars)**

Run: `task lint` then `task typecheck`
Expected: both clean. (If `ruff` flags an unused import/variable, fix and re-run.)

- [ ] **Step 7: Commit**

```bash
task format
git add scripts/validate_linking.py scripts/propose_validation_labels.py tests/unit/scripts/test_news_value_tooling.py
git commit -m "feat(scripts): report news-value accuracy and propose exclusion labels

Refs NEU-358."
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `task test`
Expected: PASS — entire suite green, no regressions.

- [ ] **Step 2: Lint, typecheck, format**

Run: `task lint` then `task typecheck` then `task format`
Expected: lint + typecheck clean; `format` makes no further changes (if it does, re-stage and amend the last commit or add a `style:` commit).

- [ ] **Step 3: Confirm no stray DB migration was created**

Run: `git status --porcelain migrations/`
Expected: empty — this ticket adds **no** migration.

- [ ] **Step 4: Hand off**

Stop. The PR is ready for the user to open against `main` from branch `tom/neu-358-backend-tighten-linker-event-acceptance-criteria`. The user then runs the manual AC pass: full hand-relabel of the existing 76 `about` rows (via `propose_validation_labels.py` → review → correct) and `python scripts/validate_linking.py` to confirm the excluded categories no longer link and the news-value recall holds.

---

## Self-review notes (coverage vs spec)

- **Stage-1 `not-news` filter + audit `link_note`** → Task 1. ✓ (AC: rejection rationale logged.)
- **Fixture schema `is_production_news` + `exclusion_category`** → Task 2. ✓
- **Pure news-value scorer** → Task 3. ✓
- **Curated regression rows + README** → Task 4. ✓ (AC: excluded categories measurable; guarded in CI.)
- **Harness report + label proposer** → Task 5. ✓
- **No DB migration / no Stage-2 change / no new endpoint** → respected throughout; verified in Task 6 Step 3.
- **Out of scope (Tom's manual relabel + sign-off run, retroactive re-link)** → noted in Task 6 Step 4.
