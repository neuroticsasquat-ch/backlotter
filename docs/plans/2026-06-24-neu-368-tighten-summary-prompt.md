# NEU-368 — Tighten Summary Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the summarizer `_INSTRUCTIONS` prompt so generated summaries stop restating the film's own title, naming non-beat crew, or adding biographical fluff — and bump `summary_prompt_version` `2`→`3` so every existing summary regenerates on the next synth run.

**Architecture:** Prompt-only behavioural change in one file (`synthesize/summarizer.py`) plus a one-line config default bump. No new logic, schema, or migration — identical mechanism to NEU-359. The version bump alone re-summarizes everything: `_select_pending` (`synthesize/pipeline.py:68`) re-summarizes any `event_summary` whose stored `prompt_version` ≠ the current one (already covered by existing integration tests). The single automated-test anchor is the config-default assertion; the prompt content itself is validated by Tom's manual re-synth pass (real Anthropic key, token cost), not CI — asserting prompt substrings is brittle and tests the spec, not behaviour.

**Tech Stack:** Python 3.13, FastAPI, pydantic-settings, pytest. **All tooling runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python` on the host.

## Global Constraints

- **One backend PR**, on branch `tom/neu-368-backend-tighten-summary-prompt-drop-redundant-film-title`.
- **Container-only tooling:** `task test`, `task lint`, `task typecheck`, `task format` (they `docker compose exec` into `upmovies-backend`). Keep the container up (`task up`).
- **Pre-commit hooks delegate into Docker** — commit normally, **no `--no-verify`**. Run `task format` *before* staging so the format-check hook passes.
- **Before claiming done:** `task test`, `task lint`, `task typecheck` all green (and `task format` applied).
- **Commit message:** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-368.` in body), **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. Prefer `/commit-msg`.
- **No new test for prompt content** (Decision 6 in the spec) — do not add assertions on `_INSTRUCTIONS` substrings.
- **`_MAX_TOKENS = 256` stays unchanged** — comfortably enough for one sentence.
- **Keep `film_title` in the event payload** (`_event_payload`) — the model needs the film context; it is only told not to *restate* the title. Do not touch `EventInput` / `_event_payload`.

---

### Task 1: Rewrite the summary prompt and bump the prompt version

**Files:**
- Modify: `src/upmovies/config.py:40` (`summary_prompt_version` default)
- Modify: `tests/unit/test_config.py:98` (default-value assertion)
- Modify: `src/upmovies/synthesize/summarizer.py` (`_INSTRUCTIONS`, lines ~17–43, + module docstring lines 1–2)

**Interfaces:**
- Consumes: nothing new (no upstream tasks).
- Produces: no new symbols. `Settings.summary_prompt_version` default becomes `"3"`; `_INSTRUCTIONS` string content changes. Public signatures (`summarize_event`, `build_summary_request`, `build_summary_batch_request`, `parse_summary`, `EventInput`, `SummaryResult`) are **unchanged**.

- [ ] **Step 1: Create the work branch**

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
git checkout main && git pull
git checkout -b tom/neu-368-backend-tighten-summary-prompt-drop-redundant-film-title
```

- [ ] **Step 2: Confirm the container is up**

```bash
task up
```

Expected: `upmovies-backend` container running (needed for all `task` targets).

- [ ] **Step 3: Write the failing config-default assertion**

In `tests/unit/test_config.py`, function `test_settings_summary_defaults` (line ~98), change the expected default from `"2"` to `"3"`:

```python
    assert s.summary_prompt_version == "3"
```

Leave `test_settings_summary_overrides_from_env` (line ~101) **unchanged** — it sets env `SUMMARY_PROMPT_VERSION="2"` and asserts `"2"`, which still proves the env override wins and is now meaningfully distinct from the default.

- [ ] **Step 4: Run the config test to verify it fails**

Run: `task test -- tests/unit/test_config.py::test_settings_summary_defaults`
Expected: FAIL — `assert "2" == "3"` (the source default is still `"2"`).

- [ ] **Step 5: Bump the config default**

In `src/upmovies/config.py:40`, change:

```python
    summary_prompt_version: str = Field(default="2", alias="SUMMARY_PROMPT_VERSION")
```

to:

```python
    summary_prompt_version: str = Field(default="3", alias="SUMMARY_PROMPT_VERSION")
```

- [ ] **Step 6: Run the config tests to verify they pass**

Run: `task test -- tests/unit/test_config.py`
Expected: PASS — both `test_settings_summary_defaults` and `test_settings_summary_overrides_from_env` green.

- [ ] **Step 7: Rewrite `_INSTRUCTIONS` in `src/upmovies/synthesize/summarizer.py`**

Replace the entire `_INSTRUCTIONS = """..."""` block (lines ~17–43) with this exact text. Keep the existing line-continuation (`\`) style so ruff's 100-char line length is respected; the rendered prompt content must match the following verbatim:

```python
_INSTRUCTIONS = """You write neutral, factual update blurbs for an upcoming-movies tracker.

You are given one tracked film, the TYPE of news beat being reported, and the stories that \
report it (each a headline, a short dek, and its publication's name). Write ONE sentence \
summarizing this beat for a reader who is already on this film's page and knows which film \
it is.

Rules:
- Strict paraphrase. State the facts (who / what / when) entirely in your own words. \
Reproduce no phrasing from the headlines or deks — no quoted fragments, no distinctive \
wording lifted verbatim.
- Neutral register. Report what happened plainly; no hype, opinion, clickbait, or \
editorializing.
- Preserve certainty. Never present a report or rumor as established fact. If the sources \
hedge ("reportedly", "is said to"), hedge; if they confirm, state it plainly. Never upgrade \
the sources' level of certainty.
- Stay within the sources. Add no facts, dates, names, or speculation not present in the \
provided material.
- Do NOT restate the film's title. It renders on the film's own page, so naming the film is \
redundant. Use "the film" only if a reference is grammatically necessary.
- Name only the people party to THIS beat — e.g. the cast member for a casting beat. Omit \
the director and other crew unless the beat is itself about them (e.g. an "X to direct" \
announcement).
- No relational or biographical framing — don't add who someone is related to, married to, \
or reuniting with ("daughter of …", "reuniting with his father").
- Report only the production fact. State who / what / when and stop. Exclude: fan, audience, \
or social-media reactions; whether the news "generated discussion" or "circulated on social \
media"; the talent's stated feelings about their role or the project; "ahead of" / "in \
advance of" / "approaches release" framing that adds no fact; and any meta-commentary about \
the announcement itself. If the summary could be replaced by the headline with nothing lost, \
it has too much filler — cut it back.
- Prefer the canonical shape: state the beat in the film's already-known context and nothing \
more — e.g. "{Star} has joined the cast", "{Star} has been cast as {Character}" (character \
optional), "{Star} will reprise their role", "{Star} will make their acting debut".
- ONE sentence. Add a second only if it carries a distinct production fact (not a trailer \
like "Composer X has discussed the process").

Return ONLY a JSON object, no prose or markdown:
{"summary": "<your one-sentence update>"}"""
```

- [ ] **Step 8: Update the module docstring**

In `src/upmovies/synthesize/summarizer.py`, lines 1–2, change `"into one neutral\n1–2 sentence paraphrase"` to a single-sentence description:

```python
"""Summarization service: turn one news event (as an in-memory EventInput) into one neutral
single-sentence paraphrase via the Anthropic Messages/Batches API. Self-contained (no DB); the
```

(Cosmetic — keeps the docstring consistent with the new ONE-sentence policy. No behaviour.)

- [ ] **Step 9: Run the full test suite**

Run: `task test`
Expected: PASS — in particular `tests/integration/synthesize/test_pipeline.py::test_prompt_version_bump_refreshes` and `::test_select_pending_includes_prompt_version_mismatch` stay green (they prove the version bump regenerates; they assert nothing about prompt content). No new test is added for prompt content (per Global Constraints).

- [ ] **Step 10: Run lint, typecheck, and format**

```bash
task format
task lint
task typecheck
```

Expected: `task lint` and `task typecheck` report no errors; `task format` leaves the files clean (re-run `task lint` if format rewrote anything).

- [ ] **Step 11: Commit**

Generate the message with `/commit-msg`, or use:

```bash
git add src/upmovies/config.py src/upmovies/synthesize/summarizer.py tests/unit/test_config.py
git commit -m "feat: tighten summary prompt; bump prompt version to 3

Drop redundant film-title restatement, non-beat crew, and biographical
framing from the summary prompt; prefer a single canonical-form sentence.
Bump summary_prompt_version 2->3 so existing summaries regenerate on the
next synthesize run.

Refs NEU-368."
git push -u origin tom/neu-368-backend-tighten-summary-prompt-drop-redundant-film-title
```

(No `🤖` footer and no `Co-Authored-By` in the commit — repo convention. The footer belongs only in the PR body, via `/pr-desc`.)

---

## Post-merge (Tom's manual pass — not a merge blocker, not a plan step)

After merge, populate/verify against the preview corpus (real Anthropic key, token cost):

1. Re-run synthesize (the `prompt_version` bump regenerates all): `POST /admin/ingest/synthesize`, or the one-off Python driver per the localdev notes (`docker exec -e SUMMARY_USE_BATCHES=false upmovies_backend python …` for immediate sequential populate).
2. Re-scan the regenerated `event_summary` rows: summaries restating the film title / naming non-beat crew should approach 0.

## Self-review

- **Spec coverage:** Prompt rewrite (5 ticket points) → Step 7; version bump → Steps 3–6; module docstring → Step 8; regeneration relies on existing `_select_pending` (no task needed, verified green in Step 9); `film_title` kept in payload (Global Constraints, no edit to `_event_payload`); manual validation → Post-merge section. All spec sections covered.
- **Placeholder scan:** None. The `{Star}` / `{Character}` tokens in Step 7 are intentional prompt template text, not plan gaps. Full prompt text and exact old→new code given inline.
- **Type consistency:** No new symbols introduced; all public signatures unchanged, so no cross-task signature drift possible (single task).
