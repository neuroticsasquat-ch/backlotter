# NEU-453 Trailer/Release-Date Confusion + Cross-Film Mis-Attribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the summarizer from stating a past beat as happening on a future release date, and stop LINK/CLUSTER from logging another film's development as this film's event.

**Architecture:** Four targeted changes in `upcoming-movies-backend`: (1) two new SUMMARIZE prompt rules + a prompt-version bump so bad blurbs re-summarize; (2) a sharpened LINK `about`/`mention` boundary; (3) a CLUSTER `off_topic` backstop (prompt rule + a reject path in `apply_cluster_decisions` mirroring the existing `is_stale_stage` rejection); (4) a new offline LLM-judge summary-eval harness. Prompt behavior is verified by the offline eval harnesses (live LLM against labeled fixtures); unit tests cover plumbing and the new reject path.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, pytest (pytest-asyncio auto mode), Anthropic Messages/Batches API. Everything runs in the container via `task` (no host Python).

## Global Constraints

- **Never run tools on the host.** Use `task test`, `task lint`, `task typecheck`, `task format` (they `docker compose exec` into `upmovies-backend`). Keep the container up (`task up`).
- **Known quirk:** running a *single integration test file* in isolation errors with a pytest-asyncio session-loop warning. Scope integration runs to the **directory** (`task test -- tests/integration/link/`), not one file. Unit-test files may be run individually.
- **Type hints:** modern `X | None` / `X | Y`. **No** `from __future__ import annotations`.
- **ruff:** line length 100; rules E,F,W,I,B,UP. Run `task format` before committing.
- **Commits (this repo):** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-453.` in the body), **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. Branch: `tom/neu-453-bug-synthesis-confused-trailer-and-film-release-date`.
- **Before claiming done:** `task test`, `task lint`, `task typecheck` all green.
- **NEU-457 is already merged:** `as_of_date` is already threaded into all three prompts and the payloads. Do not re-add it — only add the new rules described here.

---

## File Structure

- `src/upmovies/synthesize/summarizer.py` — MODIFY `_INSTRUCTIONS` (Task 3).
- `src/upmovies/config.py` — MODIFY `summary_prompt_version` default (Task 3).
- `src/upmovies/link/linker.py` — MODIFY `_INSTRUCTIONS` (Task 2).
- `src/upmovies/link/cluster.py` — MODIFY `_INSTRUCTIONS` + `apply_cluster_decisions` (Task 1).
- `tests/integration/link/test_cluster.py` — ADD off_topic reject test (Task 1).
- `tests/fixtures/link/validation_set.json` — ADD labeled `mention` row (Task 2).
- `src/upmovies/synthesize/summary_eval.py` — CREATE importable eval helpers (Task 4).
- `scripts/validate_summaries.py` — CREATE thin live runner (Task 4).
- `tests/fixtures/synthesize/summary_cases.json` — CREATE labeled cases (Task 4).
- `tests/unit/synthesize/test_summary_eval.py` — CREATE unit tests for the pure helpers (Task 4).

Task order: **1 → 3 → 2 → 4** (code-heavy backstop first; prompt-only LINK and the new harness last). Tasks are independent; this order just front-loads the automatable work.

---

## Task 1: CLUSTER `off_topic` backstop (prompt + reject path)

Add a control type `off_topic` the model can assign to a story whose real subject is a different film. `apply_cluster_decisions` drops such stories (mirroring `is_stale_stage`) instead of creating an event. `off_topic` is a sentinel handled *before* the `_VALID_TYPES` check and is never persisted as an `Event.event_type` — no DB/schema/migration change.

**Files:**
- Modify: `src/upmovies/link/cluster.py` (the `_INSTRUCTIONS` string, ~lines 63–105; the `apply_cluster_decisions` new-event branch, ~lines 363–397)
- Test: `tests/integration/link/test_cluster.py`

**Interfaces:**
- Consumes: `apply_cluster_decisions(session, *, plan, raw, unresolved_tier="acceptable")`, `ClusterPlan`, `parse_cluster_groups` (unchanged signatures; `parse_cluster_groups` already passes `type` through verbatim, so `"off_topic"` arrives as `ClusterGroup.event_type`).
- Produces: an `off_topic` group rejects its stories — `link_status="rejected"`, `film_id=None`, `link_confidence=None`, `link_note="off-topic"`, `stories_rejected += 1`, no `Event` created.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/link/test_cluster.py` (it already imports `apply_cluster_decisions`, `ClusterPlan`, `Event`, `EventStory`, `Story`, `select`, `json`, and defines `_linked_story`):

```python
async def test_apply_drops_off_topic_new_event(session):
    """A story whose real subject is a different film is assigned type 'off_topic' and
    dropped (rejected, no event), mirroring the stale-stage reject path."""
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    s1 = await _linked_story(session, film, "https://e/1")
    await session.commit()

    plan = ClusterPlan(film_id=film.id, existing_event_ids=[], unclustered_story_ids=[s1.id])
    raw = json.dumps(
        {"events": [{"existing": None, "type": "off_topic", "confidence": None, "stories": [1]}]}
    )
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)
    await session.commit()

    assert result.events_created == 0
    assert result.stories_clustered == 0
    assert result.stories_rejected == 1
    assert (
        await session.execute(select(Event).where(Event.film_id == film.id))
    ).scalars().all() == []
    assert (await session.execute(select(EventStory))).scalars().all() == []
    refreshed = (await session.execute(select(Story).where(Story.id == s1.id))).scalar_one()
    assert refreshed.link_status == "rejected"
    assert refreshed.film_id is None
    assert refreshed.link_confidence is None
    assert refreshed.link_note == "off-topic"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `task test -- tests/integration/link/`
Expected: FAIL — `test_apply_drops_off_topic_new_event` errors/fails because `off_topic` hits the `_VALID_TYPES` guard, logs "invalid new event", and skips (leaves `s1` linked, `stories_rejected == 0`).

- [ ] **Step 3: Add the reject path in `apply_cluster_decisions`**

In `src/upmovies/link/cluster.py`, inside the `else:` (new-event) branch of the `for group in groups:` loop, insert the `off_topic` handling **before** the `if etype not in _VALID_TYPES ...` check. The branch currently starts:

```python
        else:
            etype = group.event_type
            conf = group.confidence
            if etype not in _VALID_TYPES or conf not in ("confirmed", "rumored"):
```

Change it to:

```python
        else:
            etype = group.event_type
            conf = group.confidence
            if etype == "off_topic":
                # Backstop for cross-film mis-attribution (NEU-453): a story whose real
                # subject is a different film reaches clustering only if LINK mis-linked it.
                # Drop it rather than record it as this film's event (mirrors is_stale_stage).
                for sid in group_sids:
                    story = by_id[sid]
                    story.link_status = "rejected"
                    story.film_id = None
                    story.link_confidence = None
                    story.link_note = "off-topic"
                    assigned.add(sid)
                    stories_rejected += 1
                continue
            if etype not in _VALID_TYPES or conf not in ("confirmed", "rumored"):
```

- [ ] **Step 4: Run test to verify it passes**

Run: `task test -- tests/integration/link/`
Expected: PASS (all cluster tests, including the new one).

- [ ] **Step 5: Add the CLUSTER prompt rule**

In `src/upmovies/link/cluster.py` `_INSTRUCTIONS`, make two edits.

(a) Add `off_topic` to the new-event `"type"` enumeration line. Change:

```python
- "type": one of announced, casting, production_start, production_wrap, release_date, \
trailer, first_look, other
```

to:

```python
- "type": one of announced, casting, production_start, production_wrap, release_date, \
trailer, first_look, other, off_topic
```

(b) Add a dedicated paragraph immediately **after** the `- A release date mentioned in passing inside a casting story stays "casting".` line and before `Split only when a story genuinely reports two co-equal beats.`:

```python
Every event must be a beat in THIS film's own life. If a new story's actual subject is a \
DIFFERENT film — even one that names this film only as context or a scheduling comparison \
(e.g. "another film moved its date to avoid clashing with this one") — do not log it as this \
film's event: put it in its own group with "type": "off_topic" and "confidence": null so it \
is dropped rather than recorded.
```

- [ ] **Step 6: Format, lint, typecheck, full suite**

Run: `task format && task lint && task typecheck && task test -- tests/integration/link/ tests/unit/link/`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/upmovies/link/cluster.py tests/integration/link/test_cluster.py
git commit -m "feat(link): drop off-topic cross-film stories at clustering

Add an 'off_topic' cluster type + reject path so a story whose real
subject is a different film is not logged as this film's event.

Refs NEU-453."
```

---

## Task 2: LINK `about`/`mention` boundary (prompt) + fixture row

Sharpen the linker so a development that belongs to a *different* film (this film named only as a scheduling comparison) is a `mention`, not `about`. `mention` is already a reject path, so no code change — just the prompt and a labeled fixture row for the eval harness.

**Files:**
- Modify: `src/upmovies/link/linker.py` (the `_INSTRUCTIONS` string, ~lines 22–80)
- Modify: `tests/fixtures/link/validation_set.json` (add one labeled row)

**Interfaces:**
- Consumes: nothing new — `apply_link_decisions` already maps `reason == "mention"` to `link_status="rejected"`, `link_note="mention"`.
- Produces: no code interface change. Behavior change verified by `scripts/validate_linking.py`.

- [ ] **Step 1: Add the LINK prompt rule**

In `src/upmovies/link/linker.py` `_INSTRUCTIONS`, add a new paragraph immediately **after** the franchise-generic paragraph (the block that ends `... do not force a nearest-match.`) and **before** the paragraph that begins `The input is a JSON object ...`:

```python
Be strict about other-film developments that only name a tracked film as context: a story \
whose actual subject is a DIFFERENT film — its release-date move, casting, delay, or \
box-office plan — is NOT "about" a tracked film merely because that film is named as a \
scheduling comparison or reference point (e.g. "Film X shifted its release to avoid clashing \
with [tracked film]" is about Film X). Return "mention" for the tracked film. Classify \
"about" only when the NEW development belongs to the tracked film itself.
```

- [ ] **Step 2: Add a labeled `mention` row to the validation fixture**

Append one object to the array in `tests/fixtures/link/validation_set.json`. Prefer a real corpus story matching this pattern if one is known; otherwise use this representative row (schema per `tests/fixtures/link/README.md` — `mention` rows need no `expected_film_tmdb_id` / `event_type`). Set `url`/`title`/`summary` to the actual offending story if available:

```json
{
  "url": "https://www.telugucinema.com/neu-453-other-film-postpone",
  "source": "telugucinema.com",
  "title": "Telugu film postponed to avoid clashing with Akhil Akkineni's release",
  "summary": "The makers of the rival film pushed their date to steer clear of the July 10 release it would otherwise have shared.",
  "relation": "mention"
}
```

> Note for the implementer: the fixture is normally hand-labeled real stories. If you cannot confirm a real corpus story for this case, keep this representative row but flag it in the PR description so the reviewer can swap in the real story URL later.

- [ ] **Step 3: Verify JSON is well-formed**

Run: `task shell -c "python -c 'import json; json.load(open(\"tests/fixtures/link/validation_set.json\"))'"`
Expected: no output, exit 0 (valid JSON). If `task shell -c` is unavailable, run `task shell` then the inner `python -c '...'`.

- [ ] **Step 4: Format, lint, full unit suite (plumbing unaffected but confirm green)**

Run: `task format && task lint && task test -- tests/unit/link/`
Expected: all green (no linker plumbing changed; this confirms nothing regressed).

- [ ] **Step 5: Commit**

```bash
git add src/upmovies/link/linker.py tests/fixtures/link/validation_set.json
git commit -m "feat(link): treat other-film developments naming a tracked film as mentions

A story whose subject is a different film, naming a tracked film only as a
scheduling comparison, is a mention rather than 'about'. Add a labeled
validation-fixture row for the offline linker eval.

Refs NEU-453."
```

- [ ] **Step 6 (manual, live LLM — run in container with a real key):**

Run: `task shell` then `python scripts/validate_linking.py` and `python scripts/validate_clustering.py`.
Expected: the new `mention` row is rejected (not linked), and about/mention precision + cluster purity do not regress versus the prior baseline. Record the before/after numbers in the spec's **Results** section (`docs/superpowers/specs/2026-07-01-neu-453-trailer-release-date-confusion-design.md`). This step needs `ANTHROPIC_API_KEY` in `.env` and costs live tokens — the reviewer/user runs it; do not fake results.

---

## Task 3: SUMMARIZE prompt rules + version bump

Add the beat-date-discipline and future-date-sanity rules, then bump `SUMMARY_PROMPT_VERSION` 5 → 6 so `_select_pending` re-summarizes every event (repairing the offending blurb in prod).

**Files:**
- Modify: `src/upmovies/synthesize/summarizer.py` (the `_INSTRUCTIONS` string, ~lines 38–79)
- Modify: `src/upmovies/config.py:46`
- Test: `tests/unit/synthesize/test_summarizer.py` (extend the existing payload plumbing test)

**Interfaces:**
- Consumes: `build_summary_request(event, run_date)`, `_INSTRUCTIONS`, `summary_prompt_version` (unchanged signatures).
- Produces: no code interface change; `SUMMARY_PROMPT_VERSION` default becomes `"6"`.

- [ ] **Step 1: Write/adjust the failing plumbing assertion**

The existing `test_build_summary_request_plain_block_and_payload` in `tests/unit/synthesize/test_summarizer.py` already asserts `"as_of_date" in system[0]["text"]`. Add a marker assertion for the new rule so a regression that drops it is caught. Insert into that test (after the existing `assert "as_of_date" in system[0]["text"]` line):

```python
    # NEU-453: the beat is dated by its own date, not another date in the sources.
    # (verbatim substring of the new rule — case-sensitive)
    assert "OWN date" in system[0]["text"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `task test -- tests/unit/synthesize/test_summarizer.py`
Expected: FAIL — `assert "own date" in ...` fails (rule not present yet).

- [ ] **Step 3: Add the two SUMMARIZE rules**

In `src/upmovies/synthesize/summarizer.py` `_INSTRUCTIONS`, the current final bullet before the `Return ONLY a JSON object` block is:

```python
- The payload includes `as_of_date`, today's date (UTC). Use it to get tense and relative \
dates right — do not describe something that happened on or before this date as if it were in \
the future.
```

Add these two bullets immediately **after** it (keep the existing bullet):

```python
- Date the beat by its OWN date, never by another date that merely appears in the sources. A \
film's release date, a scheduled premiere, or another event's date mentioned alongside this \
beat is context, not the date of THIS beat. If the sources do not make this beat's own date \
clear, state no date for it.
- A beat reported now has already happened (a trailer that dropped, a casting that closed); \
never state it as occurring on a date AFTER `as_of_date`. A date after `as_of_date` is a \
future/scheduled date (e.g. the film's release), not when this beat took place.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `task test -- tests/unit/synthesize/test_summarizer.py`
Expected: PASS.

- [ ] **Step 5: Bump the prompt version**

In `src/upmovies/config.py:46`, change:

```python
    summary_prompt_version: str = Field(default="5", alias="SUMMARY_PROMPT_VERSION")
```

to:

```python
    summary_prompt_version: str = Field(default="6", alias="SUMMARY_PROMPT_VERSION")
```

- [ ] **Step 6: Format, lint, typecheck, full unit suite**

Run: `task format && task lint && task typecheck && task test -- tests/unit/synthesize/`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/upmovies/synthesize/summarizer.py src/upmovies/config.py tests/unit/synthesize/test_summarizer.py
git commit -m "feat(synthesize): date beats by their own date, not a future release date

Add beat-date-discipline and future-date-sanity rules to the summary
prompt so a past beat (e.g. a released trailer) is never stated as
occurring on the film's future release date. Bump SUMMARY_PROMPT_VERSION
5->6 to re-summarize existing events.

Refs NEU-453."
```

---

## Task 4: SUMMARIZE offline eval harness (LLM-judge)

Add an importable eval module + a thin live runner + a labeled fixture, so the summary prompt has regression coverage analogous to `validate_clustering.py`. Pure helpers are unit-tested with a fake judge; the live orchestration runs the real summary model and an LLM-judge (a stronger model) and prints per-case pass/fail.

**Files:**
- Create: `src/upmovies/synthesize/summary_eval.py`
- Create: `scripts/validate_summaries.py`
- Create: `tests/fixtures/synthesize/summary_cases.json`
- Create: `tests/unit/synthesize/test_summary_eval.py`

**Interfaces:**
- Consumes: `EventInput`, `StoryInput`, `build_summary_request`, `parse_summary` from `upmovies.synthesize.summarizer`; `AnthropicClient` from `upmovies.llm.client`; `get_settings` from `upmovies.config`.
- Produces (in `summary_eval.py`):
  - `@dataclass(frozen=True) SummaryCase(name: str, as_of_date: date, event_type: str, film_title: str, stories: list[StoryInput], criteria: str)`
  - `@dataclass(frozen=True) JudgeVerdict(passed: bool, reason: str)`
  - `load_summary_cases(path: str) -> list[SummaryCase]`
  - `event_for_case(case: SummaryCase) -> EventInput`
  - `build_judge_request(case: SummaryCase, blurb: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]`
  - `parse_judge_verdict(raw: str) -> JudgeVerdict`

- [ ] **Step 1: Create the labeled fixture**

Create `tests/fixtures/synthesize/summary_cases.json`:

```json
[
  {
    "name": "trailer-not-release-date",
    "as_of_date": "2026-07-01",
    "event_type": "trailer",
    "film_title": "Rural Action Drama",
    "stories": [
      {
        "title": "Trailer unveiled for Akhil Akkineni's next",
        "dek": "The action-drama trailer dropped today; the film arrives in theaters on July 10.",
        "source": "News Mobile"
      }
    ],
    "criteria": "The blurb must NOT state that the trailer was released on July 10 (that is the film's future release date, after as_of_date). It may say the trailer is out now / was released this week. It must not describe the trailer as happening on any date after as_of_date."
  },
  {
    "name": "release-date-may-state-its-own-date",
    "as_of_date": "2026-07-01",
    "event_type": "release_date",
    "film_title": "Rural Action Drama",
    "stories": [
      {
        "title": "Film locks July 10 theatrical release",
        "dek": "The makers confirmed the film will hit theaters on July 10.",
        "source": "Deadline"
      }
    ],
    "criteria": "This IS a release_date beat, so stating the July 10 release date is correct. The blurb should convey the film is scheduled/dated for July 10 and must not claim July 10 already happened."
  },
  {
    "name": "casting-control-no-spurious-date",
    "as_of_date": "2026-07-01",
    "event_type": "casting",
    "film_title": "Rural Action Drama",
    "stories": [
      {
        "title": "Actor joins the cast",
        "dek": "The lead actor has signed on, with the film targeting a July 10 release.",
        "source": "Variety"
      }
    ],
    "criteria": "This is a casting beat. The blurb must not present the July 10 release date as the casting's date; it should report the casting itself, dating it (if at all) by the casting's own date, not the release date."
  }
]
```

- [ ] **Step 2: Write the failing unit tests for the pure helpers**

Create `tests/unit/synthesize/test_summary_eval.py`:

```python
import json
from datetime import date
from pathlib import Path

from upmovies.synthesize.summary_eval import (
    JudgeVerdict,
    SummaryCase,
    build_judge_request,
    event_for_case,
    load_summary_cases,
    parse_judge_verdict,
)

FIXTURE = "tests/fixtures/synthesize/summary_cases.json"


def test_load_summary_cases_reads_fixture():
    cases = load_summary_cases(FIXTURE)
    assert [c.name for c in cases][:1] == ["trailer-not-release-date"]
    first = cases[0]
    assert isinstance(first, SummaryCase)
    assert first.as_of_date == date(2026, 7, 1)
    assert first.event_type == "trailer"
    assert first.stories[0].source == "News Mobile"
    assert "July 10" in first.criteria


def test_event_for_case_builds_event_input():
    case = load_summary_cases(FIXTURE)[0]
    event = event_for_case(case)
    assert event.event_type == "trailer"
    assert event.film_title == "Rural Action Drama"
    assert event.stories[0].title.startswith("Trailer")


def test_build_judge_request_includes_blurb_and_criteria():
    case = load_summary_cases(FIXTURE)[0]
    system, messages = build_judge_request(case, "A trailer was released on July 10.")
    assert isinstance(system, list) and system[0]["type"] == "text"
    payload = json.loads(messages[0]["content"])
    assert payload["blurb"] == "A trailer was released on July 10."
    assert payload["as_of_date"] == "2026-07-01"
    assert payload["criteria"] == case.criteria


def test_parse_judge_verdict_reads_pass_and_reason():
    v = parse_judge_verdict('{"pass": false, "reason": "states a future date as past"}')
    assert v == JudgeVerdict(passed=False, reason="states a future date as past")


def test_parse_judge_verdict_tolerates_prose_wrapping():
    v = parse_judge_verdict('Here: {"pass": true, "reason": "ok"} done')
    assert v.passed is True


def test_parse_judge_verdict_defaults_to_fail_on_garbage():
    v = parse_judge_verdict("not json at all")
    assert v.passed is False
    assert v.reason
```

- [ ] **Step 3: Run the unit tests to verify they fail**

Run: `task test -- tests/unit/synthesize/test_summary_eval.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'upmovies.synthesize.summary_eval'`.

- [ ] **Step 4: Implement the eval helpers**

Create `src/upmovies/synthesize/summary_eval.py`:

```python
"""Offline summary-eval helpers (NEU-453). Pure, importable pieces used by
`scripts/validate_summaries.py`: load labeled cases, turn a case into the summarizer's
EventInput, assemble an LLM-judge request, and parse the judge's verdict. No DB, no network —
the live orchestration lives in the script."""

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from upmovies.synthesize.summarizer import EventInput, StoryInput

_JUDGE_INSTRUCTIONS = """You grade a one-sentence news blurb for an upcoming-movies tracker on \
temporal and attribution correctness only. You are given today's date (`as_of_date`), the \
news beat TYPE, the source stories, the generated blurb, and pass/fail CRITERIA. Judge the \
blurb ONLY against the criteria and the obvious temporal facts (a beat reported now has \
already happened and cannot occur after `as_of_date`; a date belonging to a different beat, \
such as the film's release date, is not this beat's date). Ignore style, tone, and wording.

Return ONLY a JSON object, no prose or markdown:
{"pass": true | false, "reason": "<one short clause>"}"""


@dataclass(frozen=True)
class SummaryCase:
    name: str
    as_of_date: date
    event_type: str
    film_title: str
    stories: list[StoryInput]
    criteria: str


@dataclass(frozen=True)
class JudgeVerdict:
    passed: bool
    reason: str


def load_summary_cases(path: str) -> list[SummaryCase]:
    with open(path) as fh:
        data = json.load(fh)
    cases: list[SummaryCase] = []
    for item in data:
        stories = [
            StoryInput(title=s["title"], dek=s.get("dek", ""), source=s.get("source", ""))
            for s in item["stories"]
        ]
        cases.append(
            SummaryCase(
                name=item["name"],
                as_of_date=date.fromisoformat(item["as_of_date"]),
                event_type=item["event_type"],
                film_title=item["film_title"],
                stories=stories,
                criteria=item["criteria"],
            )
        )
    return cases


def event_for_case(case: SummaryCase) -> EventInput:
    return EventInput(
        event_type=case.event_type,
        film_title=case.film_title,
        source_updated_at=datetime.combine(case.as_of_date, datetime.min.time(), tzinfo=UTC),
        stories=case.stories,
    )


def build_judge_request(
    case: SummaryCase, blurb: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    system = [{"type": "text", "text": _JUDGE_INSTRUCTIONS}]
    payload = {
        "as_of_date": case.as_of_date.isoformat(),
        "event_type": case.event_type,
        "film": case.film_title,
        "stories": [{"title": s.title, "dek": s.dek, "source": s.source} for s in case.stories],
        "blurb": blurb,
        "criteria": case.criteria,
    }
    messages = [{"role": "user", "content": json.dumps(payload)}]
    return system, messages


def parse_judge_verdict(raw: str) -> JudgeVerdict:
    """Read the judge's {"pass", "reason"} object. Anything unparseable is treated as a
    FAIL (a judge that did not answer cleanly must not silently pass a case)."""
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            obj = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            obj = None
        if isinstance(obj, dict) and isinstance(obj.get("pass"), bool):
            reason = obj.get("reason")
            return JudgeVerdict(passed=obj["pass"], reason=str(reason) if reason else "")
    return JudgeVerdict(passed=False, reason=f"unparseable judge output: {raw[:120]!r}")
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `task test -- tests/unit/synthesize/test_summary_eval.py`
Expected: PASS (all six).

- [ ] **Step 6: Create the live runner script**

Create `scripts/validate_summaries.py`:

```python
"""Measure summary-prompt temporal/attribution correctness (NEU-453) against the labeled
fixture. Generates each blurb with the real summary_model, then grades it with an LLM-judge
(cluster_model, a stronger model). No DB. Run in the container with a real key in .env:

    task shell
    python scripts/validate_summaries.py [tests/fixtures/synthesize/summary_cases.json]

Prints per-case PASS/FAIL + the judge's reason and an aggregate. Costs one summary call and
one judge call per case."""

import asyncio
import sys

from upmovies.config import get_settings
from upmovies.llm.client import AnthropicClient
from upmovies.synthesize.summarizer import build_summary_request, parse_summary
from upmovies.synthesize.summary_eval import (
    build_judge_request,
    event_for_case,
    load_summary_cases,
    parse_judge_verdict,
)

DEFAULT_FIXTURE = "tests/fixtures/synthesize/summary_cases.json"
_MAX_TOKENS = 256


async def main(path: str) -> None:
    settings = get_settings()
    cases = load_summary_cases(path)
    passed = 0

    async with AnthropicClient(api_key=settings.anthropic_api_key) as client:
        for case in cases:
            system, messages = build_summary_request(event_for_case(case), case.as_of_date)
            raw = await client.complete(
                model=settings.summary_model,
                system=system,
                messages=messages,
                max_tokens=_MAX_TOKENS,
            )
            try:
                blurb = parse_summary(raw)
            except Exception as exc:  # noqa: BLE001 - report, do not crash the whole run
                print(f"FAIL  {case.name}: summary unparseable ({exc})")
                continue

            j_system, j_messages = build_judge_request(case, blurb)
            j_raw = await client.complete(
                model=settings.cluster_model,
                system=j_system,
                messages=j_messages,
                max_tokens=_MAX_TOKENS,
            )
            verdict = parse_judge_verdict(j_raw)
            passed += verdict.passed
            mark = "PASS" if verdict.passed else "FAIL"
            print(f"{mark}  {case.name}")
            print(f"      blurb:  {blurb}")
            print(f"      reason: {verdict.reason}")

    print(f"\n=== SUMMARY EVAL ===  {passed}/{len(cases)} passed")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FIXTURE))
```

> Note: the broad `except Exception as exc:  # noqa: BLE001` is intentional — never let one bad case crash the whole eval run. `parse_summary` raises `ValueError`/`json.JSONDecodeError`, both covered.

- [ ] **Step 7: Format, lint, typecheck, full unit suite**

Run: `task format && task lint && task typecheck && task test -- tests/unit/synthesize/`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/upmovies/synthesize/summary_eval.py scripts/validate_summaries.py tests/fixtures/synthesize/summary_cases.json tests/unit/synthesize/test_summary_eval.py
git commit -m "feat(synthesize): add offline LLM-judge summary eval harness

Add validate_summaries.py plus importable helpers and a labeled fixture
covering trailer-vs-release-date temporal confusion, so the summary
prompt has regression coverage analogous to validate_clustering.py.

Refs NEU-453."
```

- [ ] **Step 9 (manual, live LLM — run in container with a real key):**

Run: `task shell` then `python scripts/validate_summaries.py`.
Expected: all seeded cases PASS (especially `trailer-not-release-date`). Paste the output into the spec's **Results** section. Needs `ANTHROPIC_API_KEY`; costs live tokens — the reviewer/user runs it.

---

## Final verification (whole ticket)

- [ ] Run the full suite: `task test` — all green.
- [ ] `task lint` and `task typecheck` — all green.
- [ ] Confirm the four commits are present and messages follow the repo convention (no Linear ID in subject, no footer, no co-author).
- [ ] Manual eval runs (Task 2 Step 6, Task 4 Step 9) executed with a live key; numbers/output recorded in the spec's Results section.

## Spec coverage map

- Spec §1 (SUMMARIZE prompt + version bump) → Task 3.
- Spec §2 (LINK mention/about boundary) → Task 2.
- Spec §3 (CLUSTER off_topic prompt + reject path) → Task 1.
- Spec Verification (LINK/CLUSTER fixture + evals; new SUMMARIZE eval; plumbing unit tests) → Task 2 (fixture + Step 6), Task 1 (unit test), Task 4 (harness + unit tests).
- Spec Acceptance 1–5 → Task 3 (1,3), Tasks 1+2 (2), Task 2 Step 6 + Task 4 Step 9 (4), Final verification (5).
```
