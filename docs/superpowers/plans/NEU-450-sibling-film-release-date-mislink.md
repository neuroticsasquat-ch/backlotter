# NEU-450 — Sibling/spin-off film release-date mislink — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a distinct, untracked sibling film (spin-off/sequel/prequel/origin) in a tracked franchise from being linked to — and evented/dated onto — the tracked flagship.

**Architecture:** Prompt-only sharpening of three existing pipeline rules — LINK (`no-match` for identified siblings), CLUSTER (`off_topic` backstop clause), SUMMARIZE (a different film's date is context, never this film's) — plus a `SUMMARY_PROMPT_VERSION` bump to force re-summarization. No schema, no migration, no new code paths, no new harness. Verified by the three existing offline eval harnesses; guarded by prompt-content unit tests.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, Pydantic v2, pytest. LLM prompts are module-level `_INSTRUCTIONS` strings. Everything runs **in-container via `task`** (no host Python).

## Global Constraints

- **In-container only:** run `task test`, `task lint`, `task typecheck`, `task format` — never host `pytest`/`ruff`/`pyright`/`python`. Pre-commit hooks delegate into Docker; commit normally (no `--no-verify`), keep the container up, run `task format` before committing.
- **Single cross-layer PR** (LINK + CLUSTER + SUMMARIZE), branch `tom/neu-450-…` (Linear-provided). No schema/migration.
- **Commit style:** Conventional Commits subject (`fix:`), **no** Linear ID in the subject (optional `Refs NEU-450.` in body), **no** `🤖` footer, **no** `Co-Authored-By`.
- **Prompt-content markers (bake verbatim):** LINK rule contains `spin-off` and `not itself tracked`; SUMMARIZE rule contains `different film` and `spin-off`; CLUSTER rule contains `spin-off`.
- **Eval-harness runs are manual/offline** (live API key, small token cost) — a verification gate for Tom's pass, **not** a merge blocker and **not** part of `task test`. Prompt tuning is probabilistic: success is measured against the validation fixtures, not proven absolutely.
- **Fixture vocabulary:** `validation_set.json` rows use `relation: "none"` for no-match (`ValidationItem.relation` is `Literal["about","mention","none"]`); a no-match row sets `expected_film_tmdb_id: null`, `event_type: null`, `event_group: null`.

---

### Task 1: LINK — sibling-film `no-match` rule

**Files:**
- Modify: `src/upmovies/link/linker.py` (the franchise-generic bullet in `_INSTRUCTIONS`, ~lines 71–77)
- Test: `tests/unit/link/test_linker.py` (new prompt-content test)
- Fixture: `tests/fixtures/link/validation_set.json` (append rows)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks (independent prompt edit).

- [ ] **Step 1: Write the failing prompt-content test**

Add to `tests/unit/link/test_linker.py`:

```python
def test_instructions_cover_sibling_spinoff_trap():
    from upmovies.link.linker import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    # A distinct, identified sibling film (spin-off/sequel/prequel) that is not
    # itself in the roster must be named as a no-match trap, distinct from the
    # existing "the next Batman" generic-reference rule.
    assert "spin-off" in lowered
    assert "not itself tracked" in lowered
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_linker.py::test_instructions_cover_sibling_spinoff_trap`
Expected: FAIL — `assert "spin-off" in lowered` (strings absent from `_INSTRUCTIONS`).

- [ ] **Step 3: Extend the franchise-generic rule in `_INSTRUCTIONS`**

In `src/upmovies/link/linker.py`, the franchise-generic paragraph currently ends (line ~77):

```
When the only roster candidate is a DIFFERENT entry in the same franchise, return no-match — \
do not force a nearest-match.
```

Append to that same paragraph (keep the trailing `\` line-continuation style):

```
This includes a distinct, NAMED sibling film — a spin-off, sequel, prequel, or origin/\
companion film ("a Shrek spin-off", "the Donkey origin movie", "an untitled sequel") — that \
is a DIFFERENT entry in a tracked film's franchise and is not itself tracked in the roster. \
Return no-match for it EVEN WHEN the story states a release date: a spin-off's or sequel's \
own date is not the tracked film's date. Link only when the story unambiguously identifies \
the exact roster film (its distinct subtitle, year, or director).
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_linker.py::test_instructions_cover_sibling_spinoff_trap`
Expected: PASS.

- [ ] **Step 5: Add regression rows to `validation_set.json`**

Append to the top-level JSON array in `tests/fixtures/link/validation_set.json` (the reported spin-off story + one analogue; `relation: "none"` is the fixture's no-match):

```json
{
  "url": "https://www.msn.com/en-us/movies/news/shrek-spin-off-movie-finally-sets-release-date-with-major-star-returning/ar-AA26yGBk",
  "source": "MSN",
  "title": "Shrek spin-off movie finally sets release date with major star returning",
  "summary": "Universal Pictures has officially announced the release date for its next Shrek spin-off movie. Per Deadline, the studio confirmed a Donkey origin film will arrive in June 2028, following Shrek 5's June 2027 release.",
  "relation": "none",
  "expected_film_tmdb_id": null,
  "event_type": null,
  "event_group": null
},
{
  "url": "https://example.com/donkey-origin-movie-june-2028",
  "source": "Deadline",
  "title": "Donkey origin movie sets June 2028 release, Eddie Murphy returning",
  "summary": "The Shrek franchise's Donkey spin-off has locked a June 2028 theatrical date, DreamWorks confirmed, expanding the world beyond the main Shrek films.",
  "relation": "none",
  "expected_film_tmdb_id": null,
  "event_type": null,
  "event_group": null
}
```

Note in the row rationale (PR description, not the fixture): both are untracked sibling films; the roster's only "Shrek" entry is *Shrek 5*, which neither story is about.

- [ ] **Step 6: Verify the fixture still parses**

Run: `task test -- tests/unit/link/`
Expected: PASS — the `ValidationItem` model validates the new rows (`relation: "none"` with a null `expected_film_tmdb_id` is legal).

- [ ] **Step 7: Format and commit**

```bash
task format
git add src/upmovies/link/linker.py tests/unit/link/test_linker.py tests/fixtures/link/validation_set.json
git commit -m "fix: reject distinct untracked sibling/spin-off films in linker

A spin-off/sequel/prequel that is a different, untracked entry in a tracked
film's franchise no longer links to the flagship, even when it states a
release date. Extends the franchise-generic no-match rule. Refs NEU-450."
```

---

### Task 2: CLUSTER — sibling-film `off_topic` backstop clause

**Files:**
- Modify: `src/upmovies/link/cluster.py` (the `off_topic` paragraph in `_INSTRUCTIONS`, ~lines 102–106)
- Test: `tests/unit/link/test_cluster.py` (new prompt-content test — use the actual cluster unit-test filename if it differs)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks. No code change — the `off_topic` sentinel reject path already exists in `apply_cluster_decisions`.

- [ ] **Step 1: Confirm the cluster unit-test file name**

Run: `ls tests/unit/link/ | grep cluster`
Expected: one or more of `test_cluster.py` / `test_cluster_pure.py`. Add the new test to the file that already holds cluster prompt/plumbing tests.

- [ ] **Step 2: Write the failing prompt-content test**

Add to the cluster unit-test file:

```python
def test_instructions_name_sibling_spinoff_as_off_topic():
    from upmovies.link.cluster import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    assert "spin-off" in lowered
    assert "off_topic" in lowered  # the sentinel is already documented; keep it asserted
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_cluster.py::test_instructions_name_sibling_spinoff_as_off_topic`
Expected: FAIL — `assert "spin-off" in lowered`.

- [ ] **Step 4: Extend the `off_topic` rule in `_INSTRUCTIONS`**

In `src/upmovies/link/cluster.py`, the `off_topic` paragraph currently reads (lines ~102–106):

```
Every event must be a beat in THIS film's own life. If a new story's actual subject is a \
DIFFERENT film — even one that names this film only as context or a scheduling comparison \
(e.g. "another film moved its date to avoid clashing with this one") — do not log it as this \
film's event: put it in its own group with "type": "off_topic" and "confidence": null so it \
is dropped rather than recorded.
```

Extend the parenthetical to name the sibling case — change the example clause to:

```
DIFFERENT film — even a spin-off, sequel, or prequel of this film's franchise, or one that \
names this film only as context or a scheduling comparison (e.g. "another film moved its date \
to avoid clashing with this one", or "a spin-off sets its own release date") — do not log it \
as this film's event: put it in its own group with "type": "off_topic" and "confidence": null \
so it is dropped rather than recorded.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_cluster.py::test_instructions_name_sibling_spinoff_as_off_topic`
Expected: PASS.

- [ ] **Step 6: Add a clustering regression row**

Add a labeled case for the offline `scripts/validate_clustering.py` fixture (match the fixture's existing shape — inspect `tests/fixtures/link/` for the clustering fixture file and its schema first, e.g. `validation_eventgroups.json`): a sibling/spin-off story reaching clustering for the flagship, expected outcome `off_topic` (dropped, no event). If the harness fixture shape does not accommodate a new labeled row cleanly, record this as a manual harness observation in the spec's Results instead and note it in the PR — do not force an ill-fitting row.

- [ ] **Step 7: Format and commit**

```bash
task format
git add src/upmovies/link/cluster.py tests/unit/link/
git commit -m "fix: name sibling/spin-off films in cluster off_topic backstop

A spin-off/sequel/prequel story that slips past the linker is dropped at
clustering (off_topic) rather than logged as the flagship's release_date
event. Prompt-only; the off_topic reject path already exists. Refs NEU-450."
```

---

### Task 3: SUMMARIZE — a different film's date is never this film's date

**Files:**
- Modify: `src/upmovies/synthesize/summarizer.py` (the beat-date rule in `_INSTRUCTIONS`, ~lines 77–83)
- Modify: `src/upmovies/config.py:47` (`summary_prompt_version` default `"6"` → `"7"`)
- Test: `tests/unit/synthesize/test_summarizer.py` (new prompt-content test)
- Fixture: `tests/fixtures/synthesize/summary_cases.json` (append a Mode 2 case)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Confirm no test hardcodes the old prompt version**

Run: `grep -rn '"6"' tests/unit/synthesize/ src/upmovies/config.py`
Expected: only the `config.py:47` default. If a synthesize test asserts `"6"`, update that assertion to `"7"` as part of Step 5. (The unit test at `test_summarizer.py:155` asserts `"1"` from an injected fake — unrelated, leave it.)

- [ ] **Step 2: Write the failing prompt-content test**

Add to `tests/unit/synthesize/test_summarizer.py`:

```python
def test_instructions_reject_a_different_films_date():
    from upmovies.synthesize.summarizer import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    # Mode 2: a spin-off/sequel/prequel's date co-mentioned in the sources is
    # context, never this film's release-date beat.
    assert "different film" in lowered
    assert "spin-off" in lowered
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- tests/unit/synthesize/test_summarizer.py::test_instructions_reject_a_different_films_date`
Expected: FAIL — the strings are absent.

- [ ] **Step 4: Sharpen the beat-date rule in `_INSTRUCTIONS`**

In `src/upmovies/synthesize/summarizer.py`, the beat-date bullet currently reads (lines ~77–80):

```
- Date the beat by its OWN date, never by another date that merely appears in the sources. A \
film's release date, a scheduled premiere, or another event's date mentioned alongside this \
beat is context, not the date of THIS beat. If the sources do not make this beat's own date \
clear, state no date for it.
```

Insert one sentence before the final "If the sources…" sentence:

```
- Date the beat by its OWN date, never by another date that merely appears in the sources. A \
film's release date, a scheduled premiere, or another event's date mentioned alongside this \
beat is context, not the date of THIS beat. A DIFFERENT film's release date — a spin-off, \
sequel, or prequel named in the same story — is likewise context and is NEVER this film's \
date. If the sources do not make this beat's own date clear, state no date for it.
```

- [ ] **Step 5: Bump the summary prompt version**

In `src/upmovies/config.py:47`, change:

```python
    summary_prompt_version: str = Field(default="6", alias="SUMMARY_PROMPT_VERSION")
```

to:

```python
    summary_prompt_version: str = Field(default="7", alias="SUMMARY_PROMPT_VERSION")
```

(If Step 1 found a synthesize test asserting `"6"`, update it to `"7"` now.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `task test -- tests/unit/synthesize/`
Expected: PASS — the new prompt-content test and any version assertion are green.

- [ ] **Step 7: Add a Mode 2 case to `summary_cases.json`**

Append to the top-level array in `tests/fixtures/synthesize/summary_cases.json`:

```json
{
  "name": "sibling-spinoff-date-is-not-this-films-date",
  "as_of_date": "2026-07-01",
  "event_type": "release_date",
  "film_title": "Shrek 5",
  "stories": [
    {
      "title": "Shrek 5 set for June 2027 as franchise revival begins",
      "dek": "Shrek 5 arrives June 30, 2027. A Donkey origin spin-off film will follow in June 2028, expanding the franchise.",
      "source": "MSN"
    }
  ],
  "criteria": "This is Shrek 5's own release_date beat, so stating June 2027 (or June 30, 2027) is correct. The blurb must NOT state June 2028 or attribute the Donkey spin-off's 2028 date to Shrek 5. It may state no date, but if it states a date it must be Shrek 5's own 2027 date."
}
```

- [ ] **Step 8: Format and commit**

```bash
task format
git add src/upmovies/synthesize/summarizer.py src/upmovies/config.py tests/unit/synthesize/test_summarizer.py tests/fixtures/synthesize/summary_cases.json
git commit -m "fix: a different film's date is never this film's release beat

The summarizer no longer attributes a co-mentioned spin-off/sequel release
date to the tracked film. Bumps SUMMARY_PROMPT_VERSION 6->7 to re-summarize
existing blurbs on the next run. Refs NEU-450."
```

---

### Task 4: Full verification — CI + offline eval harnesses

**Files:** none (verification only). Fill the spec's **Results** section.

- [ ] **Step 1: Run the full local CI pipeline**

Run: `task format && task test && task lint && task typecheck`
Expected: all green. (Run the whole suite, not a single integration file — the isolated-file async-loop warning is a known quirk.)

- [ ] **Step 2: Run the offline eval harnesses (manual, live key)**

In `task shell` with a real API key (small token cost; not a merge blocker):

```bash
python scripts/validate_linking.py
python scripts/validate_clustering.py
python scripts/validate_summaries.py
```

Expected:
- `validate_linking.py`: the two sibling rows classify no-match; overall about/mention precision does not regress (no new false negatives on genuine roster stories).
- `validate_clustering.py`: no cluster-purity regression (and the sibling case drops to `off_topic` if a row was added in Task 2).
- `validate_summaries.py`: the `sibling-spinoff-date-is-not-this-films-date` case passes; the existing controls still pass.

- [ ] **Step 3: Record results in the spec**

Update `docs/superpowers/specs/NEU-450-sibling-film-release-date-mislink.md` **Results** with the before/after harness numbers and the re-summarized Shrek 5 blurb from the next prod synthesize run (or a local run against the fixture). This is documentation, not a code commit — no code files change.

---

## Self-Review

**Spec coverage:**
- Goal 1 (LINK no-match for siblings) → Task 1. ✓
- Goal 2 (CLUSTER off_topic backstop) → Task 2. ✓
- Goal 3 (SUMMARIZE different-film date) → Task 3 (rule) . ✓
- Goal 4 (prompt-version bump to re-summarize) → Task 3 Step 5. ✓
- Verification (3 harnesses + unit markers + full CI) → prompt-content tests in Tasks 1–3, harnesses in Task 4. ✓
- Acceptance criteria 1–5 → covered across Tasks 1–4. ✓

**Placeholder scan:** No TBD/TODO. The one conditional ("if the clustering fixture shape doesn't accommodate a row, record as manual observation") is a deliberate, bounded fallback tied to inspecting the real fixture, not a vague instruction — Task 2 Step 6 names the file to inspect.

**Type/marker consistency:** Marker strings are consistent between each task's prompt edit and its unit test — LINK `spin-off`/`not itself tracked`; CLUSTER `spin-off`/`off_topic`; SUMMARIZE `different film`/`spin-off`. Prompt version `6`→`7` appears only in Task 3 (config + Step 1 guard). Fixture `relation: "none"` matches the `ValidationItem` model.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
