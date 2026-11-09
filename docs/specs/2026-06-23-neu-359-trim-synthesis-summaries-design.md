# NEU-359 — Trim synthesis summaries to the factual announcement

- **Ticket:** [NEU-359](https://linear.app/neuroticsasquatch/issue/NEU-359/backend-trim-synthesis-summaries-to-the-factual-announcement) · `[backend]` · Project *Movies: Content Quality* · Milestone *MVP Quality Bar*
- **Branch:** `tom/neu-359-backend-trim-synthesis-summaries-to-the-factual-announcement`
- **Date:** 2026-06-23
- **Status:** Implementation-ready. The ticket fully specifies the change; this spec records the exact edits verified against the code. No brainstorming needed — there are no design forks.

## Problem

The summarizer prompt currently asks for **2–3 sentences** and, despite a "neutral, no hype" rule, pads the factual announcement with fan-reaction framing, talent feelings, and meta-commentary about how the news was received. This lengthens summaries and dilutes the signal.

Real examples from current output (the **bold** sentence is noise):

> Elle Fanning has been cast as Effie Trinket in The Hunger Games: Sunrise on the Reaping. **Fanning has expressed her commitment to portraying the character authentically for fans of the franchise.**

> Netflix has set a June 26 release date for Baahubali: The Eternal War – Part 1. **The streaming platform's confirmation of the date has generated fan discussion around the film's content.**

**Desired behaviour:** state the production fact and stop — 1–2 sentences. Litmus test: *if the summary could be replaced by the headline with nothing lost, it has too much filler.*

## Decisions (settled by the ticket)

1. **Prompt-only behavioural change, plus a version bump.** No new logic. The change is (a) lower the sentence cap from 2–3 to **1–2** in the system block, and (b) add explicit negatives enumerating what to exclude.
2. **Bump `summary_prompt_version` default `"1"` → `"2"`.** Stale-version regeneration already exists: `_select_pending` (`src/upmovies/synthesize/pipeline.py:68`) re-summarizes any `event_summary` whose stored `prompt_version` ≠ the current one. Verified by the existing tests `test_select_pending_includes_prompt_version_mismatch` and `test_prompt_version_bump_refreshes`. So the bump alone re-summarizes everything on the next `synthesize` run — **nothing else to build for regeneration.**
3. **No new test for prompt *content*.** Asserting literal prompt substrings is brittle and tests the spec, not behaviour. The only test that must change is the config default assertion (see Testing). The behaviour the ticket cares about (≤2 sentences, facts only) is validated by a manual re-summarize run owned by Tom — it needs a real Anthropic key and costs tokens.

## The change

### 1. Prompt — `_INSTRUCTIONS` in `src/upmovies/synthesize/summarizer.py`

Three wording edits + one new rule:

- **Cap:** "Write ONE update of **2–3 sentences**" → "Write ONE update of **1–2 sentences**" (line ~21).
- **Last rule:** "Refer to the film by its title where natural. **2–3 sentences**, one paragraph." → "**1–2 sentences**, one paragraph." (line ~34).
- **JSON contract:** `{"summary": "<your **2–3 sentence** update>"}` → `<your **1–2 sentence** update>` (line ~37).
- **New "report only the production fact" rule**, listing the negatives from the ticket. Proposed text to add to the `Rules:` list:

  ```
  - Report only the production fact. State who / what / when and stop. Exclude:
    fan, audience, or social-media reactions; whether the news "generated discussion"
    or "circulated on social media"; the talent's stated feelings about their role or
    the project; "ahead of" / "in advance of" release framing that adds no fact; and
    any meta-commentary about the announcement itself. If the summary could be replaced
    by the headline with nothing lost, it has too much filler — cut it back.
  ```

- **Module docstring** (lines 1–2) says "neutral **2–3 sentence** paraphrase" — update to "1–2 sentence" for consistency. (Cosmetic; no behaviour.)

`_MAX_TOKENS = 256` is comfortably enough for 1–2 sentences and is left unchanged.

### 2. Config — `src/upmovies/config.py`

```python
summary_prompt_version: str = Field(default="1", alias="SUMMARY_PROMPT_VERSION")
```

→ change the default to `"2"`. (Env alias `SUMMARY_PROMPT_VERSION` unchanged; prod can still override.)

## Components & files touched

| File | Change |
|---|---|
| `src/upmovies/synthesize/summarizer.py` | `_INSTRUCTIONS`: 2–3 → 1–2 sentence cap (3 spots) + new "report only the production fact" rule with the exclusion list. Module docstring 2–3 → 1–2. |
| `src/upmovies/config.py` | `summary_prompt_version` default `"1"` → `"2"`. |
| `tests/unit/test_config.py` | Update the default-value assertion (line 98): `s.summary_prompt_version == "1"` → `"2"`. |

## Testing (TDD, one backend PR)

In the container via `task test`:

1. **Config default** — `tests/unit/test_config.py:98` currently asserts the default is `"1"`. Flip it to `"2"` (write/adjust the failing assertion first, then make the source change). The env-override case (lines 105–109, override → `"2"`) is unaffected.
2. **Regeneration is already covered** — `tests/integration/synthesize/test_pipeline.py::test_prompt_version_bump_refreshes` and `::test_select_pending_includes_prompt_version_mismatch` already prove a version change re-summarizes; no new test needed. Confirm they stay green.

All of `task test`, `task lint`, `task typecheck`, `task format` must be green before the PR (run the full CI locally per house rules).

## Manual validation (owned by Tom — not a merge blocker)

Per the AC: after merge, run a `synthesize` run against representative data and confirm the regenerated summaries are ≤2 sentences and contain only production facts (no fan reaction, no "generated discussion", no talent feelings, no "ahead of release" framing, no meta-commentary). This needs a real Anthropic key and costs tokens, so it is a manual pass, not CI.

## Out of scope

- **Any change to the synthesize selection / regeneration logic** — it already keys off `prompt_version` mismatch.
- **A migration or schema change** — `event_summary.prompt_version` already exists; only its current value changes.
- **Frontend changes** — summaries render unchanged; only their length/content shifts.
- **Tuning `_MAX_TOKENS`** — 256 already accommodates 1–2 sentences.

## Acceptance criteria (from the ticket)

- Prompts updated and a re-summarize run validates summaries are ≤2 sentences and contain only production facts. *(Prompt edits above; re-summarize run is Tom's manual pass.)*
- `SUMMARY_PROMPT_VERSION` bumped so stale summaries regenerate on the next synthesize run. *(Default `"1"` → `"2"`; existing `_select_pending` mismatch logic does the rest.)*
