# NEU-445 Primary-Beat Event Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop trailer/first-look stories that name cast from being misclassified as `casting` events, by adding a "primary beat wins" precedence rule to the Stage-2 clustering prompt and locking it with a gold fixture.

**Architecture:** Event `event_type` is assigned by an LLM in Stage-2 clustering (`src/upmovies/link/cluster.py`, `_INSTRUCTIONS`, model `claude-sonnet-4-6`). The prompt currently lists the seven types but gives no tie-break when a story carries multiple beats. We add a general principle to the prompt, add the real failing case as gold rows in the validation fixture, and confirm the flip via the existing in-container `validate_clustering.py` harness.

**Tech Stack:** Python 3.13, pytest (pytest-asyncio `auto` mode), ruff, pyright, SQLAlchemy 2 async. Everything runs in the container via `task` targets — **never run `pytest`/`ruff`/`pyright`/`python` on the host.**

## Global Constraints

- **Container-only:** run all tooling via `task` (`task test`, `task lint`, `task typecheck`, `task shell`). Source is bind-mounted; no host Python. Keep the `upmovies-backend` container up.
- **Run a directory or the whole suite, not a single integration file** (single-integration-file runs error with a known pytest-asyncio session-loop quirk). Unit tests may be scoped: `task test -- tests/unit/link/...`.
- **Type hints:** modern `X | None` / `X | Y`; **no** `from __future__ import annotations`.
- **Lint:** ruff, line length 100, rules E,F,W,I,B,UP. `task format` reformats.
- **TDD:** write the failing test first.
- **Commits:** Conventional Commits subject (`fix:`, `test:`, `docs:`, …). **No** Linear ID in the subject (optional `Refs NEU-445.` in the body). **No** `🤖 Generated with Claude Code` footer and **no** `Co-Authored-By` in commit messages. Commit normally — pre-commit hooks delegate into Docker, so do **not** use `--no-verify`; run `task format` first.
- **Taxonomy is fixed:** the seven valid `event_type` values (`announced, casting, production_start, production_wrap, release_date, trailer, other`) do not change. No DB/constraint/parser changes.

---

### Task 1: Add the "primary beat wins" precedence rule to the cluster prompt

Adds principle-based precedence guidance to `_INSTRUCTIONS` so the model classifies by the dominant/headline beat. A tripwire unit test guards the guidance against accidental removal in future refactors. (The real behavioral verification is the manual harness in Task 3 — this test only asserts the guidance is present in the prompt string.)

**Files:**
- Modify: `src/upmovies/link/cluster.py` (the `_INSTRUCTIONS` string, currently lines 54-76)
- Test: `tests/unit/link/test_cluster_pure.py` (add one test)

**Interfaces:**
- Consumes: `_INSTRUCTIONS` (module-level `str` in `src/upmovies/link/cluster.py`)
- Produces: no new public symbols; `_INSTRUCTIONS` gains the precedence sentences. The JSON contract, `parse_cluster_groups`, and `apply_cluster_decisions` are unchanged.

- [ ] **Step 1: Write the failing tripwire test**

Add to `tests/unit/link/test_cluster_pure.py`:

```python
from upmovies.link.cluster import _INSTRUCTIONS


def test_instructions_state_primary_beat_precedence():
    """NEU-445: the cluster prompt must tell the model to classify by the dominant
    (headline) beat and ignore incidental mentions, so a trailer/first-look that names
    cast is not mislabeled 'casting'."""
    text = _INSTRUCTIONS.lower()
    assert "dominant" in text
    assert "incidental" in text
    # The worked direction the rule exists to fix is spelled out.
    assert "trailer" in text and "casting" in text
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_cluster_pure.py::test_instructions_state_primary_beat_precedence`
Expected: FAIL — `assert "dominant" in text` (the word is not yet in the prompt).

- [ ] **Step 3: Add the precedence rule to `_INSTRUCTIONS`**

In `src/upmovies/link/cluster.py`, insert the precedence paragraph immediately after the existing "Five outlets reporting the same casting is one event." sentence (i.e. after the grouping paragraph, before the `New events carry:` block). Use line-continuation backslashes to match the surrounding style:

```python
    classify each. You are given the FILM, its EXISTING recent events (numbered from 1), and NEW \
    stories to place (each with an integer id "n").

    For each new story, either attach it to an existing event (it continues a beat already \
    logged) or assign it to a new event (a beat not yet logged). Group new stories that report \
    the SAME beat into ONE new event; split different beats into separate events. Five outlets \
    reporting the same casting is one event.

    Classify each new event by the story's DOMINANT, headline beat — the development the coverage \
    is really about. Incidental details never change the type: a trailer, teaser, or first-look \
    footage release that also names cast is a "trailer", not "casting"; a release date mentioned \
    in passing inside a casting story stays "casting". Split only when a story genuinely reports \
    two co-equal beats.

    New events carry:
```

(Only the new middle paragraph is added; keep every other line of `_INSTRUCTIONS` exactly as-is.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: PASS (the new test and all existing pure-parse tests).

- [ ] **Step 5: Lint, typecheck, format**

Run: `task format && task lint && task typecheck`
Expected: all clean (no diffs from format that break the string; ruff line length 100 respected).

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/link/cluster.py tests/unit/link/test_cluster_pure.py
git commit -m "fix: classify events by dominant beat, not incidental cast mentions

Refs NEU-445."
```

---

### Task 2: Add the Angry Birds first-look case as gold fixture rows

Adds the three real ticket stories to the clustering validation fixture as one gold event labeled `trailer`, so the harness (Task 3) measures the flip and future runs guard it. A unit test asserts the rows are present, well-formed, and consistently labeled.

**Files:**
- Modify: `tests/fixtures/link/validation_set.json` (add 3 array entries)
- Create: `tests/unit/link/test_validation_fixture_neu445.py`

**Interfaces:**
- Consumes: `load_validation_set` and `ValidationItem` from `src/upmovies/link/validation.py`. `ValidationItem` fields used: `url`, `source`, `title`, `summary`, `relation` (`"about"`), `expected_film_tmdb_id` (`int`), `event_type` (`"trailer"`), `event_group` (`str`). Constraint from its validator: an `"about"` item **must** set `expected_film_tmdb_id` and must **not** set `exclusion_category`.
- Produces: three `relation="about"` rows for The Angry Birds Movie 3 sharing one `event_group`, gold `event_type="trailer"`.

- [ ] **Step 1: Resolve The Angry Birds Movie 3's TMDB id (and confirm the film is in the dev DB)**

The harness only scores films present in the dev DB. Find the id:

```bash
task shell
python - <<'PY'
import asyncio
from sqlalchemy import select
from upmovies.catalog.models import Film
from upmovies.db import SessionLocal

async def main():
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(Film.tmdb_id, Film.title, Film.release_date)
            .where(Film.title.ilike("%angry birds%"))
        )).all()
        for r in rows:
            print(r.tmdb_id, "|", r.title, "|", r.release_date)

asyncio.run(main())
PY
```

Expected: a row for "The Angry Birds Movie 3" (2026) with its integer `tmdb_id`. **Record that id** — call it `<ANGRY_BIRDS_3_TMDB_ID>` below.

- If no row is returned, the film is not yet in the dev DB. Note this in the task output and proceed to add the fixture rows anyway (Task 3's harness will print `film tmdb=… not in DB; skipping` for it until the catalog is ingested); the fixture + unit test still land. Do **not** invent a TMDB id — leave the real id in once known.

- [ ] **Step 2: Write the failing fixture test**

Create `tests/unit/link/test_validation_fixture_neu445.py`:

```python
from pathlib import Path

from upmovies.link.validation import load_validation_set

_FIXTURE = Path(__file__).parents[2] / "fixtures" / "link" / "validation_set.json"

_ANGRY_BIRDS_URLS = {
    "https://people.com/walker-scobell-and-emma-myers-play-red-s-children-in-angry-birds-3-first-look-exclusive-12005126",
    "https://tribune.com.pk/story/2614930/the-angry-birds-movie-3-reveals-walker-scobell-emma-myers-as-red-and-silvers-teenage-children",
    "https://www.aol.com/lifestyle/angry-birds-movie-3-report-123500096.html",
}


def test_angry_birds_first_look_is_gold_trailer_event():
    """NEU-445: the three first-look stories form one gold event labeled 'trailer'."""
    items = load_validation_set(_FIXTURE)
    rows = [it for it in items if it.url in _ANGRY_BIRDS_URLS]

    assert len(rows) == 3, "all three Angry Birds first-look stories must be present"
    assert all(it.relation == "about" for it in rows)
    assert all(it.event_type == "trailer" for it in rows)
    # One shared, non-empty cluster label.
    groups = {it.event_group for it in rows}
    assert len(groups) == 1 and next(iter(groups))
    # All point at the same tracked film.
    film_ids = {it.expected_film_tmdb_id for it in rows}
    assert len(film_ids) == 1 and next(iter(film_ids)) is not None
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_validation_fixture_neu445.py`
Expected: FAIL — `assert len(rows) == 3` (rows not yet in the fixture; `rows` is empty).

- [ ] **Step 4: Add the three gold rows to the fixture**

Append these three objects to the JSON array in `tests/fixtures/link/validation_set.json` (replace `<ANGRY_BIRDS_3_TMDB_ID>` with the integer from Step 1; if the film was absent from the DB, still use the real TMDB id — look it up on themoviedb.org if needed, do not leave a placeholder). Summaries are faithful one-liners; refine wording from the source articles if convenient, but keep them about the first-look/footage reveal:

```json
  {
    "url": "https://people.com/walker-scobell-and-emma-myers-play-red-s-children-in-angry-birds-3-first-look-exclusive-12005126",
    "source": "People",
    "title": "Walker Scobell and Emma Myers Play Red's Children in 'Angry Birds 3' First Look (Exclusive)",
    "summary": "The Angry Birds Movie 3 debuts a first look at its teenage characters, with Walker Scobell and Emma Myers voicing the children of Red and Silver.",
    "relation": "about",
    "expected_film_tmdb_id": <ANGRY_BIRDS_3_TMDB_ID>,
    "event_type": "trailer",
    "event_group": "angry-birds-3-first-look"
  },
  {
    "url": "https://tribune.com.pk/story/2614930/the-angry-birds-movie-3-reveals-walker-scobell-emma-myers-as-red-and-silvers-teenage-children",
    "source": "Tribune",
    "title": "The Angry Birds Movie 3 reveals Walker Scobell, Emma Myers as Red and Silver's teenage children",
    "summary": "A new first look at The Angry Birds Movie 3 reveals its teenage characters, voiced by Walker Scobell and Emma Myers as the children of Red and Silver.",
    "relation": "about",
    "expected_film_tmdb_id": <ANGRY_BIRDS_3_TMDB_ID>,
    "event_type": "trailer",
    "event_group": "angry-birds-3-first-look"
  },
  {
    "url": "https://www.aol.com/lifestyle/angry-birds-movie-3-report-123500096.html",
    "source": "AOL",
    "title": "Angry Birds Movie 3 first look reveals teenage characters voiced by Walker Scobell and Emma Myers",
    "summary": "The Angry Birds Movie 3 shares a first look at its new teenage characters, with Walker Scobell and Emma Myers joining the voice cast as the children of Red and Silver.",
    "relation": "about",
    "expected_film_tmdb_id": <ANGRY_BIRDS_3_TMDB_ID>,
    "event_type": "trailer",
    "event_group": "angry-birds-3-first-look"
  }
```

Watch JSON validity: add a comma after the previous last element, and do not leave a trailing comma after the final array element.

- [ ] **Step 5: Run the fixture test and the full validation-loader coverage**

Run: `task test -- tests/unit/link`
Expected: PASS — the new test passes and the whole fixture still loads as `ValidationItem`s (no Pydantic validation error from the added rows).

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/link/validation_set.json tests/unit/link/test_validation_fixture_neu445.py
git commit -m "test: add Angry Birds first-look gold event for clustering validation

Refs NEU-445."
```

---

### Task 3: Validate the flip with the harness and record the numbers

Manual, in-container verification that the real case now classifies as `trailer` and that clustering quality did not regress. Deliverable: recorded harness numbers in the NEU-300 spec. (No automated test — `validate_clustering.py` makes live Sonnet calls and is not part of `task test`.)

**Files:**
- Modify: `docs/specs/2026-06-25-neu-300-stage2-cluster-purity-design.md` (append a dated NEU-445 measurement note)

**Interfaces:**
- Consumes: `scripts/validate_clustering.py` (default fixture `tests/fixtures/link/validation_set.json`), a real `ANTHROPIC_API_KEY` in the container's environment, and the Angry Birds Movie 3 `Film` row in the dev DB.
- Produces: a recorded measurement (purity, pairwise f1, event_type agreement, gate verdict) and confirmation the Angry Birds event predicts `trailer`.

- [ ] **Step 1: Ensure prerequisites**

Confirm the container is up (`task up`) and that a real `ANTHROPIC_API_KEY` is set in the repo-root `.env` (the harness costs one `claude-sonnet-4-6` call per scoreable film). Confirm the Angry Birds Movie 3 film is in the dev DB (Task 2 Step 1). If it is absent, ingest/seed it first (admin TMDB ingest, or insert the catalog row) — otherwise the harness skips the case and the flip cannot be observed.

- [ ] **Step 2: Run the clustering validation harness**

```bash
task shell
python scripts/validate_clustering.py
```

Expected output block (`=== STAGE-2 CLUSTERING (gold event_group baseline) ===`) includes:
- `purity=…` and `pairwise: … f1=…` — should remain in the GREEN band (`purity >= 0.90`, `f1 >= 0.80`); the `GATE:` line should not read `ESCALATE`.
- `event_type agreement (secondary)=…` — the Angry Birds new event should be counted as agreeing (its predicted type is `trailer`, matching the gold majority).

- [ ] **Step 3: Confirm the Angry Birds event predicts `trailer`**

If the printed aggregate leaves the Angry Birds case ambiguous, add a one-off print to confirm the predicted type for that film, or scope the run by temporarily pointing the script at a trimmed fixture. **Pass condition:** the Angry Birds first-look event's predicted `event_type` is `trailer` (not `casting`). If it still returns `casting`, iterate on the Task 1 prompt wording (strengthen the dominant-beat phrasing) and re-run — do not weaken the gold label.

- [ ] **Step 4: Record the numbers**

Append a dated note to `docs/specs/2026-06-25-neu-300-stage2-cluster-purity-design.md`:

```markdown
## NEU-445 re-measure (2026-06-30)

After adding the dominant-beat precedence rule to the cluster prompt and the Angry Birds
first-look gold event:

- purity=<value>  pairwise f1=<value>  event_type agreement=<value>
- GATE: <verdict>
- Angry Birds Movie 3 first-look event predicted type: trailer (was casting) ✓
```

Fill `<value>`/`<verdict>` from the Step 2 output.

- [ ] **Step 5: Commit the recorded measurement (if the spec dir is under version control)**

The umbrella `docs/` directory is not a git repo, so there may be nothing to commit. If `docs/` is tracked in some repo, commit there:

```bash
git add docs/specs/2026-06-25-neu-300-stage2-cluster-purity-design.md
git commit -m "docs: record NEU-445 clustering re-measure"
```

Otherwise note in the task output that the measurement was recorded to the (un-versioned) spec file.

---

## Self-Review

**Spec coverage:**
- Prompt precedence rule (spec §Approach 1) → Task 1. ✓
- Gold fixtures in `validation_set.json`, one `event_group`, `event_type: "trailer"` (spec §Approach 2) → Task 2. ✓
- Harness run + GREEN gate + trailer flip + record numbers in NEU-300 spec (spec §Verification/Constraints) → Task 3. ✓
- Non-goals (no heuristic override, no new type, no linker change, no prompt versioning) → respected; no task touches them. ✓
- Constraints (film must be in DB, live Sonnet call, secondary non-gating metric, manual step) → Task 3 Steps 1-3. ✓

**Placeholder scan:** The only intentional fill-in is `<ANGRY_BIRDS_3_TMDB_ID>` (a real lookup, Task 2 Step 1) and the `<value>`/`<verdict>` measurement outputs (Task 3 Step 4) — these are runtime-resolved values, not undefined behavior. No "TBD"/"handle edge cases"/"similar to" placeholders.

**Type consistency:** `_INSTRUCTIONS` (str), `load_validation_set`/`ValidationItem` field names (`url`, `source`, `title`, `summary`, `relation`, `expected_film_tmdb_id`, `event_type`, `event_group`) match `src/upmovies/link/validation.py`. `event_group` label `"angry-birds-3-first-look"` is identical across all three fixture rows and not referenced elsewhere.
