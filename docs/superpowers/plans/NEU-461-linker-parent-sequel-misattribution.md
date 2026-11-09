# NEU-461 — Original-film trailer story linked to the tracked sequel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the pipeline from attributing a story about an *original/parent* franchise film to its tracked *sequel* when they share a title stem, via defense-in-depth: a stronger LINK guardrail, a reinforced CLUSTER `off_topic` backstop, and a gold validation-set case.

**Architecture:** LINK is an LLM classifier against a roster; CLUSTER is an LLM grouper with an `off_topic` sentinel that drops cross-film mis-attributions. In prod, a JoBlo story *"The Housemaid trailer … Sydney Sweeney and Amanda Seyfried reaches theatres soon"* (the **original** 2025 film) was linked to the tracked **sequel** "The Housemaid's Secret" (2027) and created a spurious TRAILER event. Only the sequel is in the catalog; the original is not. NEU-450's guardrail covers *franchise-generic* mentions and *named sibling/spin-off* films, but not the "story about the untracked **original/parent** film → its tracked sequel" direction. Both LLM stages missed it, so we harden both prompts and add the case to the validation set.

**Tech Stack:** Python 3.13, prompt strings in `linker.py` / `cluster.py`, pytest, a labeled `validation_set.json` fixture scored by `scripts/validate_linking.py` (eval harness, not CI). Linker/cluster behavior against real prompts is measured by that harness; CI asserts the *instructions contain the guidance* (the repo's established pattern for prompt guardrails).

## Global Constraints

- **Everything runs in the container via `task`** — never run tools on the host. Test: `task test -- <path>`. Lint/format/types: `task lint` / `task format` / `task typecheck`.
- Before claiming done: `task test`, `task lint`, `task typecheck` green; run `task format` first.
- Modern type hints; **no** `from __future__ import annotations`; ruff line length 100.
- Prompt guardrails are TDD-tested via *instructions-content assertions* (see existing `test_instructions_cover_sibling_spinoff_trap`, `test_instructions_name_sibling_spinoff_as_off_topic`). Live behavior is validated out-of-band via `scripts/validate_linking.py` against the gold set — **not** a CI gate.
- Commits: Conventional Commits subject, **no** Linear ID in subject (optional `Refs NEU-461.` in body), **no** `Co-Authored-By`, **no** Claude footer in commits.

---

### Task 1: Strengthen the LINK guardrail for original/parent → tracked-sequel

**Files:**
- Modify: `src/upmovies/link/linker.py` (`_INSTRUCTIONS`, append after the sibling/spin-off paragraph that ends at line 83)
- Test: `tests/unit/link/test_linker.py`

**Interfaces:**
- Produces: an extended `_INSTRUCTIONS` string containing new guidance identified in tests by the substrings `"title stem"` and `"both directions"`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/link/test_linker.py` (next to `test_instructions_cover_sibling_spinoff_trap`):

```python
def test_instructions_cover_original_to_sequel_trap():
    from upmovies.link.linker import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    # The sibling trap must run BOTH directions: a story about the original/earlier film
    # is not its tracked sequel merely because they share a title stem.
    assert "title stem" in lowered
    assert "both directions" in lowered
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_linker.py -v`
Expected: FAIL — `assert "title stem" in lowered` (substring absent today).

- [ ] **Step 3: Add the guidance**

In `src/upmovies/link/linker.py`, insert this paragraph into `_INSTRUCTIONS` immediately after the sibling/spin-off paragraph (the one ending `...its distinct subtitle, year, or director).` at line 83), before the "Be strict about other-film developments…" paragraph:

```
This franchise trap runs in BOTH directions. A story about an EARLIER or ORIGINAL film in a \
franchise — the first film, when only its sequel or continuation is tracked here — is NOT \
about the tracked sequel merely because they share a title stem (a story about "The \
Housemaid" is not about the tracked "The Housemaid's Secret") or share a lead actor. A \
trailer, review, or release for the original film is that film's own beat, not the sequel's. \
Link to the tracked sequel only when the story unambiguously identifies IT — its distinct \
subtitle, its year, or a detail unique to it; a shared franchise title stem plus a shared \
star is NOT enough. When the story's real subject is the original/parent film and only the \
sequel is tracked, return no-match (or "mention" if the tracked sequel is named only in \
passing).
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_linker.py -v`
Expected: PASS — new test green; all existing linker tests (parse/apply/instruction-content) still pass (the addition is additive text).

- [ ] **Step 5: Commit**

```bash
git add src/upmovies/link/linker.py tests/unit/link/test_linker.py
git commit -m "fix(link): reject original-film stories mislinked to tracked sequel

The franchise guardrail only covered sibling/spin-off traps; a story about the
untracked original film ('The Housemaid') was force-linked to its tracked sequel
('The Housemaid's Secret') on a shared title stem. Make the trap bidirectional.

Refs NEU-461."
```

---

### Task 2: Reinforce the CLUSTER off_topic backstop for original/parent films

**Files:**
- Modify: `src/upmovies/link/cluster.py` (`_INSTRUCTIONS`, the off_topic paragraph at lines 102-107)
- Test: `tests/unit/link/test_cluster.py`

**Interfaces:**
- Produces: extended cluster `_INSTRUCTIONS` containing the substring `"title stem"`, keeping the existing `off_topic` sentinel documented.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/link/test_cluster.py` (next to `test_instructions_name_sibling_spinoff_as_off_topic`):

```python
def test_instructions_name_original_film_as_off_topic():
    from upmovies.link.cluster import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    # A story about the ORIGINAL/earlier film reaching a tracked sequel's page must be
    # off_topic, not recorded as the sequel's event.
    assert "title stem" in lowered
    assert "off_topic" in lowered
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_cluster.py -v`
Expected: FAIL — `assert "title stem" in lowered` (absent today).

- [ ] **Step 3: Extend the off_topic paragraph**

In `src/upmovies/link/cluster.py`, replace the off_topic paragraph (lines 102-107) with:

```
Every event must be a beat in THIS film's own life. If a new story's actual subject is a \
DIFFERENT film — even a spin-off, sequel, or prequel of this film's franchise, the ORIGINAL \
or EARLIER film that this one continues (a story about "The Housemaid" is not an event for \
the tracked "The Housemaid's Secret" merely because they share a title stem or a lead actor), \
or one that names this film only as context or a scheduling comparison (e.g. "another film \
moved its date to avoid clashing with this one", or "a spin-off sets its own release date") — \
do not log it as this film's event: put it in its own group with "type": "off_topic" and \
"confidence": null so it is dropped rather than recorded.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_cluster.py -v`
Expected: PASS — new test green; existing `test_instructions_name_sibling_spinoff_as_off_topic` and cluster-pure tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/upmovies/link/cluster.py tests/unit/link/test_cluster.py
git commit -m "fix(cluster): mark original-film stories off_topic on sequel pages

Second line of defense for NEU-461: even if LINK slips, the cluster off_topic
backstop now explicitly covers a story about the original/earlier film reaching
its tracked sequel's page.

Refs NEU-461."
```

---

### Task 3: Add the Housemaid trailer case to the validation gold set

**Files:**
- Modify: `tests/fixtures/link/validation_set.json` (append one item)
- Test: `tests/unit/link/test_validation_fixture_neu461.py` (create)

**Interfaces:**
- Consumes: `load_validation_set(path)` → `list[ValidationItem]` (fields: `url`, `source`, `title`, `summary`, `relation` ∈ {"about","mention","none"}, `expected_film_tmdb_id`). A non-"about" item must leave `expected_film_tmdb_id` unset (model validator).
- Produces: a gold `relation: "none"` entry for the original-film trailer story, so `scripts/validate_linking.py` scores a link-to-sequel as a false positive.

- [ ] **Step 1: Write the failing test** (mirrors `test_validation_fixture_neu445.py`)

Create `tests/unit/link/test_validation_fixture_neu461.py`:

```python
from pathlib import Path

from upmovies.link.validation import load_validation_set

_FIXTURE = Path(__file__).parents[2] / "fixtures" / "link" / "validation_set.json"
_HOUSEMAID_URL = "https://www.joblo.com/the-housemaid-trailer-new/"


def test_original_housemaid_trailer_is_no_match():
    """NEU-461: a trailer story about the ORIGINAL 'The Housemaid' must NOT link to the
    tracked sequel 'The Housemaid's Secret'. Gold label: relation 'none', no expected film."""
    items = load_validation_set(_FIXTURE)
    rows = [it for it in items if it.url == _HOUSEMAID_URL]
    assert len(rows) == 1, "the original-Housemaid trailer story must be in the gold set"
    it = rows[0]
    assert it.relation == "none"
    assert it.expected_film_tmdb_id is None
    assert "housemaid" in it.title.lower()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_validation_fixture_neu461.py -v`
Expected: FAIL — `assert len(rows) == 1` finds 0 (entry not yet present).

- [ ] **Step 3: Append the gold entry**

Add this object to the JSON array in `tests/fixtures/link/validation_set.json` (match the file's existing indentation/formatting; ensure the preceding item now has a trailing comma):

```json
  {
    "url": "https://www.joblo.com/the-housemaid-trailer-new/",
    "source": "JoBlo",
    "title": "The Housemaid trailer: sexy psychological thriller starring Sydney Sweeney and Amanda Seyfried reaches theatres soon",
    "summary": "A new trailer has been released for the sexy psychological thriller The Housemaid, starring Sydney Sweeney and Amanda Seyfried, reaching theatres soon.",
    "relation": "none"
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_validation_fixture_neu461.py tests/unit/link/test_validation_fixture_neu445.py -v`
Expected: PASS — new fixture test green; the NEU-445 fixture test still passes (unchanged rows), confirming the JSON is still valid and well-formed.

- [ ] **Step 5: Full suite + lint/types**

Run: `task format && task lint && task typecheck && task test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/link/validation_set.json tests/unit/link/test_validation_fixture_neu461.py
git commit -m "test(link): add original-Housemaid trailer to validation gold set

Gold-labels the NEU-461 case as no-match so validate_linking.py scores a
link-to-sequel as a false positive.

Refs NEU-461."
```

---

## Verification (post-merge, optional eval — run by the user)

Prompt guardrails are not deterministically unit-testable; to confirm the live linker now rejects the case, run the eval harness in the container (it uses real LLM calls):

```bash
task shell
python scripts/validate_linking.py            # or scripts/diagnose_linking.py to see per-story picks
```

Look for the Housemaid trailer URL classified as no-match (no false-positive link to tmdb 1611116). The already-created spurious event is gone (you manually unlinked it); no data cleanup is required.

## Self-Review

- **Spec coverage (chosen option = prompt + cluster backstop + fixture):** LINK guardrail = Task 1; CLUSTER off_topic backstop = Task 2; gold validation case = Task 3. All three layers present.
- **Placeholder scan:** none — real prompt text, real JSON entry, exact test files and `task test -- <path>` commands.
- **Type consistency:** the fixture entry obeys `ValidationItem` (relation `"none"` ⇒ `expected_film_tmdb_id` omitted, satisfying `_check_consistency`); test asserts `relation == "none"` and `expected_film_tmdb_id is None`. Substring anchors (`"title stem"`) are present verbatim in both Task 1 and Task 2 prompt additions.
- **Why not the deterministic pre-link rule:** deliberately out of scope per the chosen approach — a hard title/subtitle rule risks rejecting legitimate links; the prompt+backstop+eval loop matches how NEU-450/451/453 were handled.
