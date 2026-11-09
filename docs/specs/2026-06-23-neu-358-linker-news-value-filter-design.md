# NEU-358 — Tighten linker event-acceptance criteria (Stage-1 production-news filter)

- **Ticket:** [NEU-358](https://linear.app/neuroticsasquatch/issue/NEU-358/backend-tighten-linker-event-acceptance-criteria) · `[backend]` · Project *Movies: Content Quality* · Milestone *MVP Quality Bar*
- **Branch:** `tom/neu-358-backend-tighten-linker-event-acceptance-criteria`
- **Related:** NEU-363 (home-feed one-card-per-film-per-day) — soft UX dependency, parallelizable.
- **Date:** 2026-06-23

## Problem

The Stage-1 linker accepts stories that merely *mention* or *talk around* a film rather than announcing or confirming something new about its production. The prompt distinguishes **about / mention / no-match** but has no axis for "is this production news?". A cast-reaction piece, a "everything we know so far" roundup, or an actor interview is genuinely *about* the film, so it passes today and pollutes the event stream (and the downstream public surface).

Concrete proof from the current fixture: the `about` row
*"Famke Janssen Thinks Marvel 'Made A Mistake' Not Bringing Her Back For 'Avengers: Doomsday'"* (`event_type: other`) is correctly labeled "about" yet is pure actor commentary — exactly what should be excluded. This shows the new test is an **orthogonal axis**, not a relabel of about/mention/none.

### What should be excluded (not production news)

- Cast/crew enthusiasm, excitement, or praise about the film.
- Audience / fan / social-media reactions to existing news.
- Streaming-platform moves and catalogue changes (not production events).
- "Everything we know so far" roundups and aggregator pieces with no new information.
- Actor interview color about what it's like to work on the project.
- Producer/talent comments on plot points, unless the comment itself is a formal announcement.
- Any story whose news value is entirely downstream of an already-reported beat.

### What should be accepted (announces/confirms something new)

- Casting announcements or confirmations.
- Filming start, wrap, or status change.
- Trailer or teaser release.
- Release date set, moved, or confirmed.
- Major creative or production change (director, studio, format).
- Distribution deal that affects release (not a streaming migration of an older title).

## Decisions (locked in brainstorming)

1. **Filter lives in Stage 1 (the linker), not Stage 2 (clustering).** Rationale: the existing validation harness (`scripts/validate_linking.py`) is a *Stage-1* harness, the AC phrase "no longer **linked**" maps directly to `story.link_status`, a Stage-1 rejection is idempotent for free (rejected stories are never re-processed), and it drops noise before a link is ever created. The one exclusion that strictly needs Stage-2 event context — "downstream of an already-linked event" — is handled in spirit by a general "no new production info" rule, accepting it won't be perfect. **`cluster.py` is untouched.**
2. **Definition of done = code + a curated regression set.** This ticket delivers the prompt change, the fixture schema extension, the harness/report extension, the label-proposer extension, and ~6 curated `not-news` rows baked into the fixture as a unit-testable regression guard. The **full hand-relabel of the 76 existing `about` rows** and the **`validate_linking.py` AC sign-off run** (needs a real API key, costs tokens) are a **manual pass owned by Tom**, not a merge blocker.

## Architecture

Single new axis — "is this production news?" — folded into the Stage-1 linker as a fourth `reason` value, plus a parallel label axis on the validation fixture so the change is measurable.

### 1. Linker prompt + decision (`src/upmovies/link/linker.py`)

The model still classifies about / mention / no-match, then applies a production-news test to would-be-`about` stories and downgrades failures to **`not-news`**. The link rule is unchanged (`reason == "about" AND film is not None AND confidence >= floor`); `not-news` falls through to the existing rejected path.

**Prompt additions** (appended inside `_INSTRUCTIONS`, which is part of the prompt-cached system block alongside the ~216-film roster — the added lines are negligible against the roster):

- A `not-news` definition: *primarily about a tracked film but announcing nothing new about its production* — with the exclude list above (reactions, roundups, interview color, streaming/catalogue moves, downstream-of-an-earlier-beat).
- A sharpened `about` definition: reserved for stories that **announce or confirm something new** — casting, filming start/wrap/status, trailer/teaser, release date set or moved, major creative/production change (director, studio, format), release-affecting distribution deal.

**JSON contract** gains `not-news` to the `reason` enum and an **optional** `category` field, meaningful only for `not-news`:

```json
[{"id": "<story id>", "film": <roster index or null>, "confidence": <0.0-1.0>,
  "reason": "about" | "mention" | "no-match" | "not-news",
  "category": "reaction" | "roundup" | "streaming-move" | "interview-quote" | "downstream" | null}]
```

**`apply_link_decisions`** gets one new branch. When `reason == "not-news"`:
- `story.link_status = "rejected"`, `story.film_id = None`, `story.link_confidence = None`
- `story.link_note = f"not-news:{category}"` when a recognized `category` is present, else `"not-news"`.

All other branches (`about`/`below-floor`/`mention`/`no-match`/`no-decision`) are unchanged. **No DB migration:** `link_status='rejected'` and the free-text `link_note` column already exist; `scripts/diagnose_linking.py` already surfaces `link_note`, satisfying the AC's "rejection rationale is logged or surfaced."

### 2. Validation fixture schema (`src/upmovies/link/validation.py`)

`ValidationItem` gains two fields capturing the orthogonal axis:

```python
is_production_news: bool | None = None
exclusion_category: Literal[
    "reaction", "roundup", "streaming-move", "interview-quote", "downstream", "other"
] | None = None
```

Validator rules (extend the existing `_check_consistency`):
- `is_production_news` and `exclusion_category` may be set **only on `about` rows** (`relation == "about"`); on `mention`/`none` rows both must be `None`.
- `exclusion_category` may be set **only when `is_production_news is False`**.

**Scoring rule** (used by the harness): an `about` row is *expected to link* iff `is_production_news is not False`. So the 76 existing un-relabeled `about` rows (all default `is_production_news=None`) stay "expected link" — the current film-id baseline is unchanged until Tom relabels the bad ones to `False`.

### 3. Measurement — extend the existing harness (no second API run)

- **Pure scorer** `compute_news_value_metrics(...)` added to `src/upmovies/link/metrics.py`, a sibling to `compute_link_metrics`. Input: per about-row `(linked: bool, is_production_news: bool | None, exclusion_category: str | None)`. Output: a dataclass with news-value **precision** (of linked about-rows, how many were real news), **recall** (of real-news about-rows, how many linked), and a **leak-by-category** counter (how many excluded rows still linked, keyed by `exclusion_category`). No I/O — unit-testable directly.
- `scripts/validate_linking.py` prints a second "news-value" section, reusing its single live linker run (`story.film_id is not None` after the run is the `linked` signal).
- `scripts/propose_validation_labels.py` extended so the Sonnet proposer also proposes `is_production_news` + `exclusion_category` for `about` candidates — preserving the propose → review-HTML → correct workflow for the manual relabel pass.

### 4. Curated regression set (`tests/fixtures/link/validation_set.json` + README)

- Relabel the existing Famke-Janssen `about` row → `is_production_news: false, exclusion_category: "interview-quote"`.
- Add **5 curated `about` rows**, one per remaining exclusion category: a Dubai-screening fan reaction (`reaction`), a full-series streaming migration (`streaming-move`), an "everything we know about X" roundup (`roundup`), a cast member's enthusiasm quote (`reaction`/`interview-quote`), and a producer minor-plot-tease (`downstream`). These need only be schema-valid for the unit-test guard; live-roster membership matters only for Tom's manual API run.
- Document the two new fields and the scoring rule in `tests/fixtures/link/README.md`.

## Components & files touched

| File | Change |
|---|---|
| `src/upmovies/link/linker.py` | Prompt: `not-news` definition + sharpened `about`; JSON contract `reason`/`category`. `apply_link_decisions`: `not-news` → rejected + `link_note`. |
| `src/upmovies/link/validation.py` | `ValidationItem`: `is_production_news`, `exclusion_category` + validator. |
| `src/upmovies/link/metrics.py` | New pure `compute_news_value_metrics` (+ result dataclass). |
| `scripts/validate_linking.py` | Print news-value precision/recall + leak-by-category section. |
| `scripts/propose_validation_labels.py` | Proposer also emits `is_production_news` / `exclusion_category` for `about`. |
| `tests/fixtures/link/validation_set.json` | Relabel Famke row + add 5 curated `not-news` rows. |
| `tests/fixtures/link/README.md` | Document the new fields + scoring rule. |
| `tests/unit/link/test_linker.py` | `not-news` branch (rejected, `link_note` with/without category), regression on existing reasons. |
| `tests/unit/link/test_validation.py` | New-field validator (about-only, category-requires-false). |
| `tests/unit/link/test_metrics.py` | `compute_news_value_metrics` precision/recall/leak math. |

## Testing (TDD, one backend PR)

Write each failing test first, in the container via `task test`:

1. **Linker decision** — `apply_link_decisions` on a `not-news` decision rejects (status `rejected`, `film_id`/`confidence` `None`) with `link_note == "not-news:reaction"`; bare `not-news` (no category) → `link_note == "not-news"`; existing about/mention/no-match/below-floor/no-decision branches unchanged.
2. **Fixture schema** — an `about` row with `is_production_news=False` + `exclusion_category` validates; a `mention`/`none` row setting either field raises; an `about` row with `exclusion_category` but `is_production_news` not `False` raises; the committed fixture loads.
3. **News-value scorer** — `compute_news_value_metrics` computes precision/recall and the leak-by-category counter on hand-built rows (linked excluded row → counted as a leak; un-relabeled `about` rows (`None`) treated as expected-link).
4. **Regression fixture** — the 6 curated excluded rows are present, schema-valid, and score as expected-reject through the scorer.

All of `task test`, `task lint`, `task typecheck`, `task format` must be green before the PR (run the full CI locally per house rules).

## Out of scope

- **Stage-2 / `cluster.py` changes.** The `other` `event_type` stays valid (it carries genuine non-categorized beats like studio/format changes and distribution deals); it gets cleaner naturally as upstream noise is dropped.
- **Retroactive re-linking of already-linked stories.** The filter applies to `pending` stories going forward. To clean existing data, manually reset recent linked stories to `pending` and re-run the link pipeline — an ops action, not built here.
- **A new admin endpoint** for surfacing rejections — `link_note` + `diagnose_linking.py` are sufficient.
- **A `link_prompt_version` field.** The linker has no version concept today; re-running re-links `pending` stories. Not adding one (YAGNI).
- **Tom's manual pass:** full hand-relabel of the 76 existing `about` rows via the propose→review→correct workflow, and the `validate_linking.py` AC sign-off run (real key, token cost).

## Acceptance criteria (from the ticket)

- Re-running the pipeline on a representative sample shows the "exclude" categories are no longer linked. *(Measured by Tom via `validate_linking.py`'s new news-value section; guarded in CI by the curated regression rows.)*
- Existing valid events (casting, trailers, release dates) are not incorrectly rejected. *(News-value recall on `is_production_news` rows holds; film-id baseline unchanged until relabel.)*
- The rejection rationale is logged/surfaced for audit. *(`link_note = "not-news[:category]"`, surfaced by `diagnose_linking.py`.)*
