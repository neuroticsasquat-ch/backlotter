# Linker precision: aspirational / wishlist casting trap (NEU-443) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Stage-1 linker from accepting "actor *wants* this role" fan-casting stories as real casting beats, by naming the aspirational/wishlist pattern in the `not-news` prompt rule and capturing the regression in the validation set.

**Architecture:** Prompt-only news-value fix in the existing NEU-358/367 lineage — one new rule in `_INSTRUCTIONS` (`link/linker.py`), one labeled regression row in `validation_set.json`, and guard tests. No new code, no schema, no migration. Correctness is measured (not proven) via the existing `scripts/validate_linking.py` harness as a manual pass.

**Tech Stack:** Python 3.13, pytest (pytest-asyncio auto mode), ruff, pyright. Everything runs in the container via `task` (no host Python).

## Global Constraints

- **Run everything via `task`** — `task test` (scope with `task test -- tests/unit/link/...`), `task lint`, `task typecheck`, `task format`. Never run `pytest`/`ruff`/`pyright`/`python` on the host.
- **Before "done":** `task test`, `task lint`, `task typecheck` all green; `task format` applied.
- **Commits (backend convention):** Conventional Commits subject (`feat:`/`fix:`/`refactor:`/`docs:`); **no** Linear ID in the subject (optional `Refs NEU-443.` in the body); **no** `🤖` footer; **no** `Co-Authored-By`. PR title carries the Linear ID parenthetical: `... (NEU-443)`.
- **If executing via subagents:** omit the per-task `git commit` steps — stage only; Tom commits once at the end of the branch (per his subagent-driven workflow). The commit steps below are written for the inline-execution path.
- **Branch:** `tom/neu-443-improve-linker-precision-against-aspirationalwishlist`.
- **One PR, backend-only.**
- **Integration-file isolation quirk:** running a single integration test file in isolation errors with a session-loop warning — these tasks touch only `tests/unit/link/`, so scope to that dir (`task test -- tests/unit/link`).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/upmovies/link/linker.py` | Modify `_INSTRUCTIONS` (the `not-news` bullet, ends line 42) | Add the aspirational/wishlist-casting exclusion rule. |
| `tests/unit/link/test_linker.py` | Modify `test_instructions_warn_against_interview_enthusiasm_headlines` (lines 183-189) | Guard the new rule's phrasing against silent removal. |
| `tests/fixtures/link/validation_set.json` | Add 1 row | The Petsch regression, labeled for `compute_news_value_metrics`. |
| `tests/unit/link/test_validation.py` | Add `test_fixture_has_neu443_aspirational_casting_row` (after line 126) | Assert the regression row is present and correctly labeled. |

---

### Task 1: Add the aspirational/wishlist-casting rule to the linker prompt

**Files:**
- Modify: `src/upmovies/link/linker.py` (the `not-news` definition inside `_INSTRUCTIONS`, ending `downstream of an earlier beat.` at line 42)
- Test: `tests/unit/link/test_linker.py:183-189`

**Interfaces:**
- Consumes: nothing new.
- Produces: `_INSTRUCTIONS` now contains the verbatim strings `"wishlist"` and `"do not currently hold"` (asserted by the prompt-content test and referenced by the spec).

- [ ] **Step 1: Extend the failing prompt-content test**

Edit `test_instructions_warn_against_interview_enthusiasm_headlines` to add two assertions:

```python
def test_instructions_warn_against_interview_enthusiasm_headlines():
    from upmovies.link.linker import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    assert "teases" in lowered
    assert "reacts to" in lowered
    assert "no new production fact" in lowered
    assert "wishlist" in lowered
    assert "do not currently hold" in lowered
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_linker.py::test_instructions_warn_against_interview_enthusiasm_headlines`
Expected: FAIL on `assert "wishlist" in lowered` (the prompt does not yet contain it).

- [ ] **Step 3: Add the rule to `_INSTRUCTIONS`**

In `link/linker.py`, the `not-news` bullet currently ends:

```
catalogue moves of an existing title; and any story whose news value is entirely \
downstream of an earlier beat.
```

Append the new rule as continuation lines immediately after `downstream of an earlier beat.` (keep the existing backslash line-continuation style; the bullet now ends with the new sentences):

```
catalogue moves of an existing title; and any story whose news value is entirely \
downstream of an earlier beat. Aspirational or "wishlist" casting is also not-news: a \
story where talent expresses a desire, hope, or campaign for a role they do not currently \
hold — they "want to play", "would love to play", "hope to play", are "gunning for", \
"eyeing", or "fan-cast" in a part — reports no production fact and is not-news (category \
"interview-quote") EVEN WHEN it names the exact film and character. A real casting beat \
reports that a deal closed or the studio/filmmakers confirmed the actor ("has been cast", \
"joins the cast", "has signed on", or trade-reported "in talks") — an actor merely saying \
they want the role is not that.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_linker.py::test_instructions_warn_against_interview_enthusiasm_headlines`
Expected: PASS.

- [ ] **Step 5: Lint + format**

Run: `task format && task lint`
Expected: clean (watch the 100-char line length on the new continuation lines).

- [ ] **Step 6: Commit** *(skip if executing via subagents — stage only)*

```bash
git add src/upmovies/link/linker.py tests/unit/link/test_linker.py
git commit -m "feat: reject aspirational/wishlist casting as not-news

Widen the Stage-1 linker not-news rule to exclude stories where talent
merely wants/hopes for a role they do not hold, even when the exact film
and character are named. Refs NEU-443."
```

---

### Task 2: Capture the Petsch regression in the validation set

**Files:**
- Modify: `tests/fixtures/link/validation_set.json` (add one object to the array)
- Test: `tests/unit/link/test_validation.py` (add a test after line 126)

**Interfaces:**
- Consumes: `load_validation_set` and the `_FIXTURE` constant (`test_validation.py:89`), `ValidationItem`.
- Produces: a labeled `interview-quote` row at URL `https://www.joblo.com/madeline-petsch-poison-ivy-the-batman-2/` for `compute_news_value_metrics`.

- [ ] **Step 1: Write the failing presence test**

Add to `tests/unit/link/test_validation.py` (mirrors the existing `test_fixture_has_neu367_interview_reaction_rows` at line 111):

```python
def test_fixture_has_neu443_aspirational_casting_row():
    items = load_validation_set(_FIXTURE)
    by_url = {it.url: it for it in items}
    url = "https://www.joblo.com/madeline-petsch-poison-ivy-the-batman-2/"
    assert url in by_url, f"missing curated row {url}"
    it = by_url[url]
    assert it.relation == "about"
    assert it.expected_film_tmdb_id == 806704
    assert it.is_production_news is False
    assert it.exclusion_category == "interview-quote"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_validation.py::test_fixture_has_neu443_aspirational_casting_row`
Expected: FAIL on `assert url in by_url` (row not yet present).

- [ ] **Step 3: Add the regression row to the fixture**

Append this object to the JSON array in `tests/fixtures/link/validation_set.json` (mind the trailing comma on the preceding element; keep the file valid JSON):

```json
{
  "url": "https://www.joblo.com/madeline-petsch-poison-ivy-the-batman-2/",
  "source": "JoBlo",
  "title": "Madeline Petsch wants to devour men and save the planet as Poison Ivy in The Batman Part II",
  "summary": "Now that James Gunn's DCU is officially underway, it's no surprise that actors want to get in on the action. Madeline Petsch has made clear she'd love to play Poison Ivy in The Batman Part II, even dressing as the character on Halloween \"just to get their attention.\" She concedes nothing is decided: \"They haven't made the movie yet, so who knows?\"",
  "relation": "about",
  "expected_film_tmdb_id": 806704,
  "event_type": "other",
  "event_group": null,
  "is_production_news": false,
  "exclusion_category": "interview-quote"
}
```

- [ ] **Step 4: Run the presence test + the existing fixture guards to verify they pass**

Run: `task test -- tests/unit/link/test_validation.py`
Expected: PASS — the new test passes, and the existing `test_fixture_has_curated_not_news_rows` / `test_curated_excluded_rows_score_clean_when_dropped` still pass (the row is a clean `interview-quote` true-negative; the `ValidationItem` model validator accepts it because `about` + `expected_film_tmdb_id` + `is_production_news=false` + `exclusion_category` are mutually consistent).

- [ ] **Step 5: Full unit-link suite + lint**

Run: `task test -- tests/unit/link && task lint && task typecheck`
Expected: all green.

- [ ] **Step 6: Commit** *(skip if executing via subagents — stage only)*

```bash
git add tests/fixtures/link/validation_set.json tests/unit/link/test_validation.py
git commit -m "test: add wishlist-casting regression to link validation set

Petsch/Poison Ivy fan-casting story as an excluded interview-quote about
The Batman Part II (tmdb 806704). Refs NEU-443."
```

---

## Manual verification (Tom's pass — not a merge blocker)

Mirrors the NEU-358/367 precedent (real key, small token cost):

```
task shell
python scripts/validate_linking.py
```

Confirm:
- the Petsch row classifies `not-news` (no longer linked as `about`);
- `compute_news_value_metrics` leak count for `interview-quote` is unchanged-or-lower;
- **no new false negatives** on genuine casting rows (recall on real beats holds).

If the model still links the Petsch row, iterate on the rule wording in Task 1 (the closing "in talks / has signed on" boundary sentence is what protects recall — strengthen the wishlist verbs, not the boundary). Prompt tuning is probabilistic; success is measured against the validation set.

## Self-Review

- **Spec coverage:** (1) prompt rule → Task 1; (2) validation regression row → Task 2; (3) prompt-content test → Task 1 Step 1; (4) manual `validate_linking.py` → Manual verification section. All four spec deliverables map to a task. ✓
- **Placeholder scan:** no TBD/TODO; full prompt text, full JSON row, full test bodies given. ✓
- **Type/label consistency:** tmdb_id `806704` used identically in the fixture row and the presence test; assertion strings `"wishlist"` / `"do not currently hold"` are verbatim in the Task 1 prompt text; `exclusion_category` `"interview-quote"` is in the `ValidationItem` Literal set and the linker's `_NOT_NEWS_CATEGORIES`. ✓
