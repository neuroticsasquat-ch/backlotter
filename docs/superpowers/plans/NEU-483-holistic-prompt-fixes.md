# NEU-483 Holistic Prompt Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 11 bugs logged in NEU-483 by tightening the LINK, CLUSTER, and SUMMARIZE prompt instructions — no schema, DB, or frontend changes.

**Architecture:** Three targeted `_INSTRUCTIONS`-constant edits in `upcoming-movies-backend`, one per pipeline stage: (1) LINK gets a medium/project-mismatch trap; (2) CLUSTER gets a casting-consolidation rule, a named-performer requirement for casting, a tie-in-product exclusion from `release_date`, and a claimed-date-vs-known-date comparison rule; (3) SUMMARIZE gets a state-the-actual-date rule, a names-are-not-a-paraphrase-violation rule, and a tightened "report only the production fact" bullet covering genre-label filler and unrelated history — plus a `SUMMARY_PROMPT_VERSION` bump so stored summaries re-generate. Every addition is instruction-only (no new code branches), so each is verified with an `_INSTRUCTIONS.lower()` content assertion, following the existing `test_instructions_*` convention already used throughout these three test files.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, pytest (pytest-asyncio auto mode). Everything runs in the container via `task` (no host Python).

## Global Constraints

- **Never run tools on the host.** Use `task test`, `task lint`, `task typecheck`, `task format` (they `docker compose exec` into `upmovies-backend`). Keep the container up (`task up`).
- **Type hints:** modern `X | None` / `X | Y`. **No** `from __future__ import annotations`.
- **ruff:** line length 100; rules E,F,W,I,B,UP. Run `task format` before committing.
- **Commits (this repo):** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-483.` in the body), **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. Branch: `tom/neu-483-bugs-2026-07-03` (the ticket's `gitBranchName`).
- **Before claiming done:** `task test`, `task lint`, `task typecheck` all green.
- **NEU-457 (run-date anchor) and NEU-456 (admin Sources page) are already merged/shipped.** `as_of_date` is already in all three payloads and `film.release_date` is already in CLUSTER's payload — do not re-add either. IMDb source-tier downgrade is a manual action in the (already-shipped) admin Sources UI, not part of this plan.
- All nine prompt-text additions are pure string edits inside existing `_INSTRUCTIONS` constants — no function signatures change, so no downstream caller needs updating.

---

## File Structure

- `src/upmovies/link/linker.py` — MODIFY `_INSTRUCTIONS` (Task 1).
- `tests/unit/link/test_linker.py` — ADD one `test_instructions_*` case (Task 1).
- `src/upmovies/link/cluster.py` — MODIFY `_INSTRUCTIONS`, four insertions (Task 2).
- `tests/unit/link/test_cluster_pure.py` — ADD four `test_instructions_*` cases (Task 2).
- `src/upmovies/synthesize/summarizer.py` — MODIFY `_INSTRUCTIONS`, three edits (Task 3).
- `src/upmovies/config.py` — MODIFY `summary_prompt_version` default (Task 3).
- `tests/unit/synthesize/test_summarizer.py` — ADD three `test_instructions_*` cases (Task 3).
- `tests/unit/test_config.py` — MODIFY the existing `test_settings_summary_defaults` assertion (Task 3).

Task order: **1 (LINK) → 2 (CLUSTER) → 3 (SUMMARIZE + config)**. Tasks touch disjoint files and are independent; this order just follows the pipeline's own LINK→CLUSTER→SUMMARIZE flow for easy spec cross-referencing.

---

## Task 1: LINK medium/project-mismatch trap

Add a trap so a story about a different-medium project (a TV series, video game, or other adjacent production) sharing the tracked film's characters/franchise is not linked as if it were about the film itself. Fixes NEU-483 bug #5 (a "Joker" casting event was fabricated from a story actually about the *Batman: Caped Crusader* animated series).

**Files:**
- Modify: `src/upmovies/link/linker.py` (the `_INSTRUCTIONS` string, ~lines 96–103)
- Test: `tests/unit/link/test_linker.py`

**Interfaces:**
- Consumes: nothing new — this is a pure instruction-text change. `apply_link_decisions(*, raw, stories, roster, floor)` signature is unchanged.
- Produces: no code interface change.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/link/test_linker.py` (it already has this exact pattern — see `test_instructions_cover_sibling_spinoff_trap` a few lines above where you're inserting):

```python
def test_instructions_cover_medium_mismatch_trap():
    from upmovies.link.linker import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    # NEU-483 #5: a story about a same-franchise TV series/game is not "about" the
    # tracked film merely because it shares characters — that's a different production.
    assert "different medium" in lowered
    assert "tv series" in lowered
    assert "video game" in lowered
```

- [ ] **Step 2: Run test to verify it fails**

Run: `task test -- tests/unit/link/test_linker.py`
Expected: FAIL — `assert "different medium" in lowered` fails (the sentence isn't in `_INSTRUCTIONS` yet).

- [ ] **Step 3: Add the LINK prompt rule**

In `src/upmovies/link/linker.py` `_INSTRUCTIONS`, the current text around the end of the other-film-developments trap and the start of the input-format paragraph reads:

```python
scheduling comparison or reference point (e.g. "Film X shifted its release to avoid clashing \
with [tracked film]" is about Film X). Return "mention" for the tracked film. Classify \
"about" only when the NEW development belongs to the tracked film itself.

The input is a JSON object `{"as_of_date": <YYYY-MM-DD>, "stories": [...]}`. `as_of_date` is \
```

Insert a new paragraph between them:

```python
scheduling comparison or reference point (e.g. "Film X shifted its release to avoid clashing \
with [tracked film]" is about Film X). Return "mention" for the tracked film. Classify \
"about" only when the NEW development belongs to the tracked film itself.

Be strict about medium/project mismatches: a story about a DIFFERENT production sharing the \
same characters, setting, or franchise name — a spin-off TV series, an animated series, a \
video game, a stage adaptation, or any project in a different medium — is NOT about the \
tracked film merely because it names the same characters or franchise. A character's casting \
or appearance in a TV series, game, or other adjacent project is not a casting fact about the \
tracked FILM. Return "no-match" for it (or "mention" if the tracked film is named only in \
passing) unless the story also reports a new production fact about the film itself.

The input is a JSON object `{"as_of_date": <YYYY-MM-DD>, "stories": [...]}`. `as_of_date` is \
```

- [ ] **Step 4: Run test to verify it passes**

Run: `task test -- tests/unit/link/test_linker.py`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Format, lint, typecheck**

Run: `task format && task lint && task typecheck && task test -- tests/unit/link/test_linker.py`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/link/linker.py tests/unit/link/test_linker.py
git commit -m "feat(link): treat different-medium projects as no-match

A story about a same-franchise TV series, video game, or other
different-medium production is not \"about\" the tracked film merely
because it shares characters or a franchise name.

Refs NEU-483."
```

---

## Task 2: CLUSTER casting/release-date fixes

Four additions to `_INSTRUCTIONS`: casting-event consolidation, a named-performer requirement for casting, excluding tie-in/companion products from `release_date`, and comparing a claimed date-change against the film's already-known `release_date`. Fixes NEU-483 bugs #2, #3, #4, #5 (CLUSTER half), #7, #8 (CLUSTER half), #9.

**Files:**
- Modify: `src/upmovies/link/cluster.py` (the `_INSTRUCTIONS` string, ~lines 76–138)
- Test: `tests/unit/link/test_cluster_pure.py`

**Interfaces:**
- Consumes: nothing new — pure instruction-text changes. `assemble_cluster_payload(...)`, `parse_cluster_groups(...)`, `apply_cluster_decisions(...)` signatures are unchanged; `film.release_date` is already present in the payload (confirmed in `assemble_cluster_payload`, `tests/unit/link/test_cluster_pure.py::test_assemble_cluster_payload_shape`).
- Produces: no code interface change.

- [ ] **Step 1: Write the four failing tests**

Add to `tests/unit/link/test_cluster_pure.py` (it already has this exact `_INSTRUCTIONS.lower()` pattern — see `test_instructions_flag_already_scheduled_restatement` and `test_instructions_state_primary_beat_precedence` above):

```python
def test_instructions_state_casting_consolidation_rule():
    """NEU-483 #7, #9: a new casting story naming a performer already in an existing
    casting event must attach there instead of opening a duplicate event."""
    text = _INSTRUCTIONS.lower()
    assert "already appears in an existing casting event" in text
    assert "continuation of that casting beat" in text


def test_instructions_require_named_performer_for_casting():
    """NEU-483 #5, #8: no performer named (or casting only 'forthcoming') is not a
    casting beat."""
    text = _INSTRUCTIONS.lower()
    assert "requires an actual performer's name" in text
    assert "forthcoming" in text


def test_instructions_exclude_tie_in_products_from_release_date():
    """NEU-483 #2: a companion video game/merchandise launch is never the film's own
    release_date beat, even when the story says "release"."""
    text = _INSTRUCTIONS.lower()
    assert "companion product" in text
    assert "tie-in" in text


def test_instructions_flag_fake_date_move_matching_known_release_date():
    """NEU-483 #3, #4: a story framing a date as "moved" when it matches
    film.release_date is a restatement, not a new beat, regardless of headline framing."""
    text = _INSTRUCTIONS.lower()
    assert "regardless of how the headline frames it" in text
    assert "already-known release_date" in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: FAIL — all four new tests fail (none of the four sentences exist in `_INSTRUCTIONS` yet).

- [ ] **Step 3: Add the casting-consolidation rule**

In `src/upmovies/link/cluster.py` `_INSTRUCTIONS`, the current text reads:

```python
For each new story, either attach it to an existing event (it continues a beat already \
logged) or assign it to a new event (a beat not yet logged). Group new stories that report \
the SAME beat into ONE new event; split different beats into separate events. Five outlets \
reporting the same casting is one event. A single trailer or first-look reveal reported \
across several days by many outlets is ONE event — attach later stories to the existing \
event rather than opening a new one.

Classify each new event by the story's DOMINANT, headline beat — the development the coverage \
```

Insert a new paragraph between them:

```python
For each new story, either attach it to an existing event (it continues a beat already \
logged) or assign it to a new event (a beat not yet logged). Group new stories that report \
the SAME beat into ONE new event; split different beats into separate events. Five outlets \
reporting the same casting is one event. A single trailer or first-look reveal reported \
across several days by many outlets is ONE event — attach later stories to the existing \
event rather than opening a new one.

The same applies to casting: when a new story names a performer who already appears in an \
EXISTING casting event — alone or alongside others — attach it there. A fuller cast list, an \
additional outlet, or a repeat report of the same signing is a continuation of that casting \
beat, not a new one. Open a new casting event only for a genuinely different performer or role.

Classify each new event by the story's DOMINANT, headline beat — the development the coverage \
```

- [ ] **Step 4: Add the named-performer requirement**

Immediately below in the same constant, the current text reads:

```python
- A bare role announcement with no imagery or footage is "casting".
- A release date mentioned in passing inside a casting story stays "casting".

Every event must be a beat in THIS film's own life. If a new story's actual subject is a \
```

Insert a new bullet between them:

```python
- A bare role announcement with no imagery or footage is "casting".
- A release date mentioned in passing inside a casting story stays "casting".
- A "casting" event requires an actual performer's name. A story that reports a role or \
character joining without naming who plays them, or that says casting is "expected", \
"forthcoming", "yet to be announced", or otherwise teases future announcements with nobody \
confirmed, is not a casting beat — classify it "other" (or "off_topic" if it reports no fact \
about this film at all).

Every event must be a beat in THIS film's own life. If a new story's actual subject is a \
```

- [ ] **Step 5: Add the tie-in exclusion and date-comparison rules**

Further down, the release_date paragraph currently reads:

```python
A "release_date" event requires a story announcing a NEW or CHANGED release date. A story \
that merely restates the film's already-known release date (given as `film.release_date` in \
the payload), or lists it in a calendar / roundup context, is NOT a new release_date beat — \
put it in its own group with "type": "off_topic" and "confidence": null so it is dropped \
rather than recorded.

Return ONLY JSON — no prose, no markdown:
```

Change it to:

```python
A "release_date" event requires a story announcing a NEW or CHANGED release date. A \
"release_date" event is about the FILM's own theatrical, streaming, or home-video release — \
never a tie-in or companion product (a video game, soundtrack, book, or other merchandise \
release) even when the story uses the word "release" or ties its timing to the film's release \
date. Such tie-in news, if newsworthy at all, is "other" — never "release_date". A story \
that merely restates the film's already-known release date (given as `film.release_date` in \
the payload), or lists it in a calendar / roundup context, is NOT a new release_date beat — \
put it in its own group with "type": "off_topic" and "confidence": null so it is dropped \
rather than recorded. Compare the story's claimed date against `film.release_date` in the \
payload: if the story frames the date as new, changed, or "moved" but the date given matches \
the film's already-known release_date, this is not a new beat regardless of how the headline \
frames it — put it in its own group with "type": "off_topic" and "confidence": null, same as a \
plain restatement.

Return ONLY JSON — no prose, no markdown:
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: PASS (all tests in the file, including the four new ones).

- [ ] **Step 7: Format, lint, typecheck, full CLUSTER suite**

Run: `task format && task lint && task typecheck && task test -- tests/unit/link/ tests/integration/link/`
Expected: all green (the integration suite confirms nothing about `apply_cluster_decisions`'s existing behavior regressed — these edits touch only prompt text, no code branches).

- [ ] **Step 8: Commit**

```bash
git add src/upmovies/link/cluster.py tests/unit/link/test_cluster_pure.py
git commit -m "feat(link): tighten CLUSTER casting and release-date rules

Add a casting-consolidation rule (attach to an existing casting event
naming the same performer instead of duplicating it), require a named
performer for a casting beat, exclude tie-in/companion products from
release_date typing, and compare a claimed date-change against the
film's already-known release_date.

Refs NEU-483."
```

---

## Task 3: SUMMARIZE prompt fixes + prompt-version bump

Three edits to `_INSTRUCTIONS` plus a `SUMMARY_PROMPT_VERSION` bump so stored summaries re-generate under the new prompt. Fixes NEU-483 bugs #4 (SUMMARIZE half), #6, #10, #11.

**Files:**
- Modify: `src/upmovies/synthesize/summarizer.py` (the `_INSTRUCTIONS` string, ~lines 58–84)
- Modify: `src/upmovies/config.py:47`
- Test: `tests/unit/synthesize/test_summarizer.py`, `tests/unit/test_config.py`

**Interfaces:**
- Consumes: nothing new — pure instruction-text changes. `build_summary_request(event, run_date)`, `summarize_event(...)` signatures are unchanged.
- Produces: no code interface change; `summary_prompt_version` default becomes `"8"`.

- [ ] **Step 1: Write the three failing SUMMARIZE tests**

Add to `tests/unit/synthesize/test_summarizer.py` (it already has this exact pattern — see `test_instructions_reject_a_different_films_date` at the bottom of the file):

```python
def test_instructions_require_stating_actual_release_date():
    """NEU-483 #4: a release_date beat must state the actual date, not describe the
    announcement only in relational terms."""
    from upmovies.synthesize.summarizer import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    assert "state the actual date" in lowered
    assert "without giving the date itself" in lowered


def test_instructions_allow_naming_people_not_descriptors():
    """NEU-483 #6: naming an actor/character is a fact, not a paraphrase violation —
    don't substitute "the lead actor" / "his character" for the actual name."""
    from upmovies.synthesize.summarizer import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    assert "not a paraphrase violation" in lowered
    assert "vague descriptor" in lowered


def test_instructions_forbid_genre_label_and_unrelated_history_filler():
    """NEU-483 #10, #11: no genre-label tack-ons unless the genre itself is the news,
    and no unrelated history (e.g. a prior title change) bleeding into the beat."""
    from upmovies.synthesize.summarizer import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    assert "genre label" in lowered
    assert "prior title change" in lowered
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/synthesize/test_summarizer.py`
Expected: FAIL — all three new tests fail (none of the phrases exist in `_INSTRUCTIONS` yet).

- [ ] **Step 3: Add the state-the-actual-date rule**

In `src/upmovies/synthesize/summarizer.py` `_INSTRUCTIONS`, the date-handling block currently ends:

```python
- A beat reported now has already happened (a trailer that dropped, a casting that closed); \
never state it as occurring on a date AFTER `as_of_date`. A date after `as_of_date` is a \
future/scheduled date (e.g. the film's release), not when this beat took place.

Return ONLY a JSON object, no prose or markdown:
```

Insert a new bullet between them:

```python
- A beat reported now has already happened (a trailer that dropped, a casting that closed); \
never state it as occurring on a date AFTER `as_of_date`. A date after `as_of_date` is a \
future/scheduled date (e.g. the film's release), not when this beat took place.
- For a "release_date" beat, state the actual date (or an unambiguous relative time, e.g. "in \
two weeks") plainly. Never describe the announcement only in relational terms — e.g. "a date \
that was announced alongside confirmation of X" — without giving the date itself.

Return ONLY a JSON object, no prose or markdown:
```

- [ ] **Step 4: Add the names-are-not-a-paraphrase-violation rule**

The "Name only the people party to THIS beat" bullet currently reads:

```python
- Name only the people party to THIS beat — e.g. the cast member for a casting beat. Omit \
the director and other crew unless the beat is itself about them (e.g. an "X to direct" \
announcement).
- No relational or biographical framing — don't add who someone is related to, married to, \
```

Insert a new bullet between them:

```python
- Name only the people party to THIS beat — e.g. the cast member for a casting beat. Omit \
the director and other crew unless the beat is itself about them (e.g. an "X to direct" \
announcement).
- Always name them by their actual name — do not substitute a vague descriptor ("the lead \
actor," "his character") for a name the sources provide. Reproducing a person's name or \
character name is not a paraphrase violation; the "strict paraphrase" rule is about sentence \
construction, not about omitting names.
- No relational or biographical framing — don't add who someone is related to, married to, \
```

- [ ] **Step 5: Tighten the "report only the production fact" bullet**

That bullet currently reads:

```python
- Report only the production fact. State who / what / when and stop. Exclude: fan, audience, \
or social-media reactions; whether the news "generated discussion" or "circulated on social \
media"; the talent's stated feelings about their role or the project; "ahead of" / "in \
advance of" / "approaches release" framing that adds no fact; and any meta-commentary about \
the announcement itself. If the summary could be replaced by the headline with nothing lost, \
it has too much filler — cut it back.
```

Replace it with:

```python
- Report only the production fact. State who / what / when and stop. Exclude: fan, audience, \
or social-media reactions; whether the news "generated discussion" or "circulated on social \
media"; the talent's stated feelings about their role or the project; "ahead of" / "in \
advance of" / "approaches release" framing that adds no fact; any meta-commentary about the \
announcement itself; a genre label ("in an action thriller," "in a horror film") unless the \
genre itself is the news; and unrelated history about the film — e.g. a prior title change — \
unless it is itself the beat being reported. If the summary could be replaced by the headline \
with nothing lost, it has too much filler — cut it back.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `task test -- tests/unit/synthesize/test_summarizer.py`
Expected: PASS (all tests in the file, including the three new ones).

- [ ] **Step 7: Bump the prompt version**

In `src/upmovies/config.py:47`, change:

```python
    summary_prompt_version: str = Field(default="7", alias="SUMMARY_PROMPT_VERSION")
```

to:

```python
    summary_prompt_version: str = Field(default="8", alias="SUMMARY_PROMPT_VERSION")
```

- [ ] **Step 8: Update the existing config test**

In `tests/unit/test_config.py`, `test_settings_summary_defaults` currently asserts:

```python
    assert s.summary_prompt_version == "7"
```

Change it to:

```python
    assert s.summary_prompt_version == "8"
```

- [ ] **Step 9: Run the config test to verify it passes**

Run: `task test -- tests/unit/test_config.py`
Expected: PASS.

- [ ] **Step 10: Format, lint, typecheck, full SUMMARIZE + config suite**

Run: `task format && task lint && task typecheck && task test -- tests/unit/synthesize/ tests/unit/test_config.py`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add src/upmovies/synthesize/summarizer.py src/upmovies/config.py tests/unit/synthesize/test_summarizer.py tests/unit/test_config.py
git commit -m "feat(synthesize): tighten SUMMARIZE date, naming, and filler rules

Require stating the actual date for a release_date beat, allow naming
actors/characters without treating it as a paraphrase violation, and
forbid genre-label tack-ons and unrelated history bleeding into a beat.
Bump SUMMARY_PROMPT_VERSION 7->8 to re-summarize existing events.

Refs NEU-483."
```

---

## Final verification (whole ticket)

- [ ] Run the full suite: `task test` — all green.
- [ ] `task lint` and `task typecheck` — all green.
- [ ] Confirm the three commits are present and messages follow the repo convention (no Linear ID in subject, no footer, no co-author).
- [ ] Manual spot-check (recommended before merge, not automated): re-run LINK/CLUSTER/SUMMARIZE against the 11 NEU-483 screenshot cases — or their underlying story text — and confirm each no longer reproduces. This needs a live `ANTHROPIC_API_KEY`; the reviewer/user runs it.
- [ ] Manually downgrade IMDb's source tier in the admin Sources page (NEU-483 bug #1, #9) — separate from this PR, no code involved.

## Spec coverage map

- Spec §LINK (medium/project-mismatch trap) → Task 1.
- Spec §CLUSTER (casting consolidation, named-performer requirement, tie-in exclusion, date-comparison) → Task 2.
- Spec §SUMMARIZE (state-the-date, names-not-paraphrase, no genre/history filler) → Task 3.
- Spec's `SUMMARY_PROMPT_VERSION` bump → Task 3 Steps 7–9.
- Spec "Out of scope" (IMDb tier, deterministic casting-dedup guardrail) → intentionally has no task; called out in Final verification / Global Constraints instead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
