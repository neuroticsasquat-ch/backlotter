# Linker precision: aspirational / wishlist casting trap (NEU-443) — design

**Date:** 2026-06-30
**Status:** Approved (pre-implementation)
**Linear:** NEU-443 (project *backlotter: Maintenance*; related NEU-438, NEU-367)
**Trigger:** A user reported that the JoBlo story *"Madeline Petsch wants to devour men and
save the planet as Poison Ivy in The Batman Part II"* surfaced on
`https://backlotter.com/film/the-batman-part-ii-2027` as a **casting** event whose summary
reads like a real casting announcement. Petsch is **not cast** — the piece is pure
fan-casting ("They haven't made the movie yet, so who knows?").

## Root cause

Story→film links come entirely from the Stage-1 LLM entity-linking classifier
(`link/linker.py`), which sees only each story's **headline + a ~500-char dek**. Its prompt
(`_INSTRUCTIONS`) already excludes interview/enthusiasm color *about an existing beat* — a
cast member who "teases", "reacts to", "opens up on" the film, "can't wait", is "excited
for" it, or anything "ahead of its release" → `not-news`.

It does **not** name the **aspirational / wishlist casting** pattern: talent expressing a
*desire, hope, or campaign* for a role they **do not currently hold** ("wants to play",
"would love to", "hopes to", "is gunning for", fan-casting). This is the single most
dangerous omission in the not-news list, because — unlike a vague "excited for it" quote —
a wishlist quote carries **all the surface features of a real casting beat**: a named actor
+ a named character + the exact, correctly-identified tracked film. So the classifier
returns `about` at high confidence, the clustering stage types it `casting`, and the
synthesize stage renders the wish as a confirmed fact.

### Why this is a *distinct* trap from NEU-438

| | NEU-438 (untracked-franchise) | NEU-443 (aspirational casting) |
|---|---|---|
| Film identified? | **Generically** ("the next Batman") | **Exactly & correctly** ("The Batman Part II") |
| What's wrong | Linked to the **wrong/untracked** film | The **casting itself is hypothetical** |
| Correct label | `no-match` | `not-news` / `interview-quote` |
| Fix axis | franchise-generic disambiguation | wishlist-vs-confirmed news value |

NEU-438's franchise-generic guard cannot catch this — the film *is* the right one. The fix
is on the **news-value axis** (NEU-358 → NEU-367 lineage), not the match axis.

## Constraints from the pipeline (why fix at Stage 1)

- The Stage-1 linker is the only place that sees the wishlist language as language; the
  clusterer assigns `event_type` and synthesis renders certainty, but neither re-decides
  whether the story is news. A `rejected` story is never clustered, so a Stage-1 rejection
  is the durable fix and keeps the event off the public surface entirely.
- Synthesis's "preserve-source-certainty" instruction is a backstop at best: once the beat
  is typed `casting`, the summary frames it as real. **Kill it at link time.**
- This mirrors the established lineage exactly: prompt rule + a labeled regression row in
  `validation_set.json` scored by `compute_news_value_metrics` (NEU-358/367). No new code,
  no schema, no migration.

## The fix

### 1. Prompt rule (`_INSTRUCTIONS` in `link/linker.py`)

Widen the existing interview/enthusiasm bullet with an explicit aspirational-casting rule.
Add, as part of the `not-news` definition:

> Aspirational or "wishlist" casting is also not-news: a story where talent expresses a
> desire, hope, or campaign for a role they do not currently hold — they "want to play",
> "would love to play", "hope to play", are "gunning for", "eyeing", or "fan-cast" in a
> part — reports no production fact and is not-news (category "interview-quote") EVEN WHEN
> it names the exact film and character. A real casting beat reports that a deal closed or
> that the studio/filmmakers confirmed the actor (e.g. "has been cast", "joins the cast",
> "has signed on", or trade-reported "in talks") — an actor merely saying they want the
> role is not that.

The closing sentence preserves recall: genuine trade-reported "in talks" / "has signed on"
beats stay `about`; only the actor's self-expressed wish is excluded.

### 2. Validation regression row (`tests/fixtures/link/validation_set.json`)

Add the Petsch story labeled as an excluded `about` (the film is correctly the subject, the
story is just not production news), keyed to **TMDB id 806704** (*The Batman: Part II*,
status *In Production*):

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

This matches the shape of the existing Famke-Janssen `interview-quote` row (an `about` story
that is correctly excluded). The `ValidationItem` model validator requires
`expected_film_tmdb_id` on `about` rows and `is_production_news = false` whenever
`exclusion_category` is set — both satisfied.

Additional real wishlist rows may be added opportunistically during the manual relabel pass;
the Petsch row is the required regression anchor.

### 3. Prompt-content test (`tests/unit/link/test_linker.py`)

Extend the existing `test_instructions_warn_against_interview_enthusiasm_headlines` to assert
the new phrasing is present (the prompt-content test already exists for this lineage, so this
is not a new brittleness — it guards the rule against silent removal):

```python
assert "wishlist" in lowered
assert "do not currently hold" in lowered
```

(The strings `"wishlist"` and `"do not currently hold"` must appear verbatim in
`_INSTRUCTIONS` — bake them into the rule text in step 1.)

## Verification (manual — Tom's pass, not a merge blocker)

Run in the container with a real key (costs a small amount of tokens), per the NEU-358/367
precedent:

```
task shell
python scripts/validate_linking.py
```

Confirm: the Petsch row classifies `not-news`, `compute_news_value_metrics` shows the
`interview-quote` leak count unchanged-or-lower, and there are **no new false negatives** on
genuine casting rows (recall on real beats holds). Prompt tuning is probabilistic — success
is measured against the validation set, not proven absolutely.

## Out of scope

- Synthesis-layer guardrails (link-time rejection is the fix).
- A structured "rumor vs confirmed" axis on `news.event`.
- Any franchise-generic / wrong-film handling (that is NEU-438, already shipped).

## Linear shape

One backend ticket = one PR (NEU-443). Branch
`tom/neu-443-improve-linker-precision-against-aspirationalwishlist`. Assigned to Tom.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
