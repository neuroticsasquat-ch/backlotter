# NEU-368 — Tighten summary prompt: drop redundant film title, extraneous crew, and biographical fluff

- **Ticket:** [NEU-368](https://linear.app/neuroticsasquatch/issue/NEU-368/backend-tighten-summary-prompt-drop-redundant-film-title-extraneous) · `[backend]` · Project *Movies: Content Quality* · Milestone *MVP Quality Bar* · Priority High
- **Branch:** `tom/neu-368-backend-tighten-summary-prompt-drop-redundant-film-title`
- **Date:** 2026-06-24
- **Status:** Implementation-ready. The ticket fully specifies the behavioural change; this spec records the exact edits verified against the code. The one design fork (how strongly to anchor the model) was settled in brainstorming — see Decisions.

## Problem

[NEU-359](https://linear.app/neuroticsasquatch/issue/NEU-359/backend-trim-synthesis-summaries-to-the-factual-announcement) trimmed summary *length* (2–3 → 1–2 sentences + a negatives rule), but summaries still pad the core fact with redundant and extraneous context. Crucially, **summaries render only on the film's own detail page** (`/film/{slug}` timeline) — the grouped home feed ([NEU-362](https://linear.app/neuroticsasquatch/issue/NEU-362/frontend-group-home-feed-by-film-per-day)) shows no summary text — so naming the film in the summary is pure redundancy.

Evidence from the re-linked preview (292 summaries):

- **264 / 292 (90%) restate their own film's title** — driven directly by the prompt line *"Refer to the film by its title where natural"* (`src/upmovies/synthesize/summarizer.py:40`).
- **47 mention a director / crew member** not central to the beat.

Examples (**bold** = droppable noise):

- *"Lewis Pullman has joined the cast of **Spaceballs: The New One**, **reuniting him with his father**."*
- *"Auli'i Cravalho … is returning to reprise her role in the live-action adaptation of Moana. **Composer Lin-Manuel Miranda has discussed the process of bringing the original star back.**"*
- *"Apple Martin, **daughter of Gwyneth Paltrow and Chris Martin**, will make her acting debut in the film."*
- *"Dwayne Johnson has been cast as Maui in the live-action Moana, **with a first look revealed showing the actor in a 40-pound bodysuit**."*

**Canonical form (the bar to aim for):** a casting summary is just `{Star} has joined the cast` — optionally `{Star} has been cast as {Character}` when the role is known and central. Never `… of {Film}` (redundant on the film's page), never the director, never biography. The same principle generalises to other beats: state the beat fact in the film's already-known context, nothing more.

- *"Apple Martin will make her acting debut."*
- *"Auli'i Cravalho will reprise her role."*
- *"Matt Smith has joined the cast."*

## Decisions

1. **Prompt-only behavioural change, plus a version bump.** No new logic, schema, or migration — the exact mechanism NEU-359 used. The change is (a) rewrite `_INSTRUCTIONS` per the ticket's five points, and (b) bump `summary_prompt_version` default `"2"` → `"3"`. The version bump alone re-summarizes everything on the next `synthesize` run: `_select_pending` (`src/upmovies/synthesize/pipeline.py:68`) re-summarizes any `event_summary` whose stored `prompt_version` ≠ the current one. Existing tests `test_select_pending_includes_prompt_version_mismatch` / `test_prompt_version_bump_refreshes` already cover this — **nothing to build for regeneration.**
2. **Anchoring style = declarative rules + inline canonical form** (settled in brainstorming). Match NEU-359's declarative-rule house style: remove the title-reference line, add the new negatives, and show the target *shape* inline (e.g. `"{Star} has joined the cast"`) — **no full bad→good few-shot examples.** Rationale: the target model is Haiku 4.5 (small), so an explicit canonical shape anchors output better than negatives alone, while full few-shot examples risk the model parroting example phrasing and cost more tokens.
3. **Keep passing `film_title` in the event payload** (`_event_payload`, `summarizer.py:93`). The model still needs to know *which* film to write the beat in context and to use "the film" only where grammatically necessary — we instruct it not to *restate* the title, we do not withhold the film context. No change to `EventInput` / the payload.
4. **Sentence policy shifts to ONE sentence.** The ticket's point 5 ("Prefer ONE sentence; add a second only if it carries a distinct production fact") supersedes NEU-359's "1–2 sentences". Updated in all three prompt spots (intro line, rules-list line, JSON contract) + the module docstring. `_MAX_TOKENS = 256` is left unchanged — comfortably enough for one sentence.
5. **Strengthen, don't duplicate, the existing "Report only the production fact" rule.** The ticket's point 4 (reinforce leaking negatives: talent enthusiasm/feelings, "approaches release" framing, meta-commentary) is folded **into** that existing rule (adding `"approaches release"` to the `"ahead of" / "in advance of"` list), not added as a competing rule.
6. **No new test for prompt *content*.** Asserting literal prompt substrings is brittle and tests the spec, not behaviour — the same call NEU-359 made. The only test that must change is the config-default assertion. The behaviour the ticket cares about (no title restatement, no non-beat crew, no biography) is validated by Tom's manual re-summarize pass (real Anthropic key, token cost).

## The change

### 1. Prompt — `_INSTRUCTIONS` in `src/upmovies/synthesize/summarizer.py`

Replace the current `_INSTRUCTIONS` with:

```
You write neutral, factual update blurbs for an upcoming-movies tracker.

You are given one tracked film, the TYPE of news beat being reported, and the stories
that report it (each a headline, a short dek, and its publication's name). Write ONE
sentence summarizing this beat for a reader who is already on this film's page and
knows which film it is.

Rules:
- Strict paraphrase. State the facts (who / what / when) entirely in your own words.
  Reproduce no phrasing from the headlines or deks — no quoted fragments, no
  distinctive wording lifted verbatim.
- Neutral register. Report what happened plainly; no hype, opinion, clickbait, or
  editorializing.
- Preserve certainty. Never present a report or rumor as established fact. If the
  sources hedge ("reportedly", "is said to"), hedge; if they confirm, state it
  plainly. Never upgrade the sources' level of certainty.
- Stay within the sources. Add no facts, dates, names, or speculation not present in
  the provided material.
- Do NOT restate the film's title. It renders on the film's own page, so naming the
  film is redundant. Use "the film" only if a reference is grammatically necessary.
- Name only the people party to THIS beat — e.g. the cast member for a casting beat.
  Omit the director and other crew unless the beat is itself about them (e.g. an
  "X to direct" announcement).
- No relational or biographical framing — don't add who someone is related to,
  married to, or reuniting with ("daughter of …", "reuniting with his father").
- Report only the production fact. State who / what / when and stop. Exclude: fan,
  audience, or social-media reactions; whether the news "generated discussion" or
  "circulated on social media"; the talent's stated feelings about their role or the
  project; "ahead of" / "in advance of" / "approaches release" framing that adds no
  fact; and any meta-commentary about the announcement itself. If the summary could
  be replaced by the headline with nothing lost, it has too much filler — cut it back.
- Prefer the canonical shape: state the beat in the film's already-known context and
  nothing more — e.g. "{Star} has joined the cast", "{Star} has been cast as
  {Character}" (character optional), "{Star} will reprise their role", "{Star} will
  make their acting debut".
- ONE sentence. Add a second only if it carries a distinct production fact (not a
  trailer like "Composer X has discussed the process").

Return ONLY a JSON object, no prose or markdown:
{"summary": "<your one-sentence update>"}
```

This maps to the ticket's five points:

| Ticket point | Where it lands in the rewrite |
|---|---|
| 1. Do not restate the film's title | New "Do NOT restate the film's title" rule; old "Refer to the film by its title where natural" line **removed**. |
| 2. Name only people party to this beat | New "Name only the people party to THIS beat" rule. |
| 3. No relational/biographical framing | New "No relational or biographical framing" rule. |
| 4. Reinforce existing leaking negatives | `"approaches release"` added to the existing "Report only the production fact" rule (alongside the NEU-359 negatives, retained). |
| 5. Prefer ONE sentence | Intro "Write ONE sentence …" + final "ONE sentence. Add a second only if …" rule + JSON contract `<your one-sentence update>`. |

**Module docstring** (lines 1–2) says "neutral **1–2 sentence** paraphrase" — update to "single-sentence" for consistency. (Cosmetic; no behaviour.)

`_MAX_TOKENS = 256` and the JSON-envelope contract / `parse_summary` are unchanged.

### 2. Config — `src/upmovies/config.py`

```python
summary_prompt_version: str = Field(default="2", alias="SUMMARY_PROMPT_VERSION")
```

→ change the default to `"3"` (line 40). Env alias `SUMMARY_PROMPT_VERSION` unchanged; prod can still override.

## Components & files touched

| File | Change |
|---|---|
| `src/upmovies/synthesize/summarizer.py` | Rewrite `_INSTRUCTIONS` (remove title-reference line; add no-title / non-beat-crew / no-biography rules; add inline canonical-form rule; fold "approaches release" into the existing production-fact rule; shift to ONE sentence in all three spots). Module docstring "1–2 sentence" → "single-sentence". |
| `src/upmovies/config.py` | `summary_prompt_version` default `"2"` → `"3"`. |
| `tests/unit/test_config.py` | Update the default-value assertion (line 98): `s.summary_prompt_version == "2"` → `"3"`. |

## Testing (TDD, one backend PR)

In the container via `task test`:

1. **Config default** — `tests/unit/test_config.py:98` (`test_settings_summary_defaults`) currently asserts the default is `"2"`. Flip it to `"3"` (write the failing assertion first, then make the source change). The env-override case (`test_settings_summary_overrides_from_env`, line 105/109 sets env `SUMMARY_PROMPT_VERSION="2"` and asserts `"2"`) is **unaffected** — and is now meaningfully distinct from the default, proving the env override wins.
2. **Regeneration is already covered** — `tests/integration/synthesize/test_pipeline.py::test_prompt_version_bump_refreshes` and `::test_select_pending_includes_prompt_version_mismatch` already prove a version change re-summarizes; no new test needed. Confirm they stay green.
3. **No test for prompt content** — per Decision 6.

All of `task test`, `task lint`, `task typecheck`, `task format` must be green before the PR (run the full CI locally per house rules; pre-commit hooks delegate into the container, so commit normally).

## Manual validation (owned by Tom — not a merge blocker)

Per the AC: after merge, re-run `synthesize` against the preview corpus (the `prompt_version` bump regenerates everything), then re-scan. Summaries restating the film title / naming non-beat crew should approach 0. This needs a real Anthropic key and costs tokens, so it is a manual pass, not CI.

## Out of scope

- **Synthesize selection / regeneration logic** — unchanged; it already keys off `prompt_version` mismatch.
- **Migration or schema change** — `event_summary.prompt_version` already exists; only its current value changes.
- **Frontend changes** — summaries render unchanged; only their length/content shifts.
- **Tuning `_MAX_TOKENS`** — 256 already accommodates one sentence.
- **NEU-367 (linker recall / production-stage gate)** — separate PR; the relational-fluff note moved here, but the linker work is independent.

## Acceptance criteria (from the ticket)

- `synthesize/summarizer.py` `_INSTRUCTIONS` rewritten per the five points and `summary_prompt_version` bumped `2`→`3` (auto-regenerates all on next synth). *(Prompt rewrite + config bump above.)*
- After a re-synth + re-scan, summaries restating the film title / naming non-beat crew approach 0. *(Tom's manual pass.)*

🤖 Generated with [Claude Code](https://claude.com/claude-code)
