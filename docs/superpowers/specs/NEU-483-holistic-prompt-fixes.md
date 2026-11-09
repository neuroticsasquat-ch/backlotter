# NEU-483 — Holistic prompt fixes across LINK / CLUSTER / SUMMARIZE

- **Ticket:** [NEU-483](https://linear.app/neuroticsasquatch/issue/NEU-483/bugs-2026-07-03) `[backend]`
- **Project / milestone:** backlotter: Maintenance
- **Shape:** single backend PR. No migration, no DTO/public-shape change, no frontend change, no config keys added.

## Problem

NEU-483 logs 11 concrete bugs observed in one day's pipeline output (2026-07-03), each grounded in a screenshot of the actual rendered event. Normalizing them against the three prompt sources (`link/linker.py`, `link/cluster.py`, `synthesize/summarizer.py`) shows they cluster into a handful of *reusable* gaps, not 11 unrelated one-offs:

| # | Symptom (screenshot) | Stage | Gap |
|---|---|---|---|
| 1 | IMDb "first-look" = a GQ cover-story repost | source-quality | Not a prompt bug — IMDb aggregation. Out of scope here (see below). |
| 2 | "released in an additional format or venue" for a Roblox tie-in game | CLUSTER → SUMMARIZE | Companion-product news mistyped as `release_date`; SUMMARIZE forced into vague filler to describe a beat that isn't what it claims to be |
| 3 | "The film is scheduled to release on July 10" — date known for months, headline claims a "move" | CLUSTER | No instruction to compare a claimed date-change against `film.release_date` already in the payload |
| 4 | "...a date that was announced alongside confirmation of Aaron Taylor-Johnson" | CLUSTER + SUMMARIZE | Same stale-date gap as #3, plus SUMMARIZE never states the actual date |
| 5 | "A performer has been cast as the Joker" — no one is named | LINK + CLUSTER | Source's real subject is a different-medium project (animated TV series); CLUSTER fabricates a casting event with no performer named |
| 6 | "...featuring a brief appearance by the lead actor as his character" | SUMMARIZE | Over-applies the paraphrase rule into vagueness — actor/character names are facts, not verbatim headline text |
| 7 | Monica Barbaro casting logged twice, 2 days apart | CLUSTER | No consolidation rule for casting (trailer/first_look have one, casting doesn't) |
| 8 | "Multiple casting announcements remain forthcoming" | LINK + CLUSTER | Zero-fact "coming soon" story; same no-performer-named gap as #5 |
| 9 | Chase Yi / Sonia Mena casting logged 4× across 3 days | CLUSTER | Same missing consolidation as #7 — clearest, highest-volume proof of the gap |
| 10 | "...as an organ delivery duo in an action thriller" | SUMMARIZE | Redundant genre-label filler tacked onto an otherwise-fine sentence |
| 11 | Title change mentioned inside a delay summary | SUMMARIZE | Weak evidence (no clean screenshot) — folded into a general "stay on-beat" tightening rather than a dedicated fix |

Two related enablers are already shipped and do **not** need work here:
- NEU-457 (run-date anchor) is Done — `as_of_date` is already in all three payloads. Bugs #3/#4 are a missing *comparison instruction*, not a missing anchor.
- NEU-456 (admin Sources page) is Done — downgrading IMDb's trust tier is an operational action you take in that UI, not a code change. **Out of scope for this ticket.**

## Chosen approach

Locked in brainstorming (2026-07-03):

- **IMDb (#1):** handled operationally via the existing admin Sources override (downgrade to `low`), not via prompt changes. Out of scope here.
- **Casting dedup (#7, #9):** prompt-only — strengthen CLUSTER's consolidation instruction to cover casting the same way it already covers trailer/first_look, rather than building a deterministic entity-matching guardrail. Cheaper, and the model is already shown the existing events it needs to attach to.
- Everything else: targeted additions to the three `_INSTRUCTIONS` constants, each mapped to a specific bug above. No schema, config, or DB changes — this is a pure prompt-tuning pass, the same shape as NEU-443/449/451/453.

## The changes

### LINK — `link/linker.py`

One addition to `_INSTRUCTIONS`, inserted after the "other-film developments" trap (ends `:101`) and before the `as_of_date`/output-format paragraph (`:103`):

> Be strict about medium/project mismatches: a story about a DIFFERENT production sharing the same characters, setting, or franchise name — a spin-off TV series, an animated series, a video game, a stage adaptation, or any project in a different medium — is NOT about the tracked film merely because it names the same characters or franchise. A character's casting or appearance in a TV series, game, or other adjacent project is not a casting fact about the tracked FILM. Return no-match for it (or "mention" if the tracked film is named only in passing) unless the story also reports a new production fact about the film itself.

Fixes #5 at the source: the "Joker" story's real subject was a Batman animated series, not the tracked film.

### CLUSTER — `link/cluster.py`

Four additions to `_INSTRUCTIONS` (`:76`–`138`):

**1. Casting consolidation** — insert immediately after the existing trailer/first-look consolidation sentence (`:84`–`86`, "A single trailer or first-look reveal reported across several days by many outlets is ONE event — attach later stories to the existing event rather than opening a new one."):

> The same applies to casting: when a new story names a performer who already appears in an EXISTING casting event — alone or alongside others — attach it there. A fuller cast list, an additional outlet, or a repeat report of the same signing is a continuation of that casting beat, not a new one. Open a new casting event only for a genuinely different performer or role.

Fixes #7, #9.

**2. Casting requires a named performer** — insert after the existing casting-type bullet (`:99`, "A bare role announcement with no imagery or footage is 'casting'."):

> A "casting" event requires an actual performer's name. A story that reports a role or character joining without naming who plays them, or that says casting is "expected," "forthcoming," "yet to be announced," or otherwise teases future announcements with nobody confirmed, is not a casting beat — classify it "other" (or "off_topic" if it reports no fact about this film at all).

Fixes #5 (no performer named for "the Joker") and #8 ("multiple announcements remain forthcoming").

**3. Tie-in products are never `release_date`** — insert into the existing release_date paragraph (`:124`–`128`), right after "A 'release_date' event requires a story announcing a NEW or CHANGED release date.":

> A "release_date" event is about the FILM's own theatrical, streaming, or home-video release — never a tie-in or companion product (a video game, soundtrack, book, or other merchandise release) even when the story uses the word "release" or ties its timing to the film's release date. Such tie-in news, if newsworthy at all, is "other" — never "release_date."

Fixes #2 (Nolan/Roblox companion game mistyped as a release-date beat, which cascaded into SUMMARIZE's vague "additional format or venue").

**4. Compare claimed dates against the film's known release date** — insert into the same release_date paragraph, right after the existing "restates the film's already-known release date... is NOT a new release_date beat" sentence (`:125`–`128`):

> Compare the story's claimed date against `film.release_date` in the payload: if the story frames the date as new, changed, or "moved" but the date given matches the film's already-known release_date, this is not a new beat regardless of how the headline frames it — put it in its own group with "type": "off_topic" and "confidence": null, same as a plain restatement.

Fixes #3 (Evil Dead Burn "moves to July 10" — already the known date) and the CLUSTER half of #4 (Werwulf).

### SUMMARIZE — `synthesize/summarizer.py`

Four additions to `_INSTRUCTIONS` (`:38`–`87`):

**1. State the actual date** — insert into the date-handling rules (`:77`–`81`, near "Date the beat by its OWN date..."):

> For a "release_date" beat, state the actual date (or an unambiguous relative time, e.g. "in two weeks") plainly. Never describe the announcement only in relational terms — e.g. "a date that was announced alongside confirmation of X" — without giving the date itself.

Fixes the SUMMARIZE half of #4 (Werwulf: date-less "AI speak").

**2. Names are not a paraphrase violation** — insert right after the existing "Name only the people party to THIS beat..." bullet (`:58`–`60`):

> Always name them by their actual name — do not substitute a vague descriptor ("the lead actor," "his character") for a name the sources provide. Reproducing a person's name or character name is not a paraphrase violation; the "strict paraphrase" rule is about sentence construction, not about omitting names.

Fixes #6 (Jailer 2 teaser: "the lead actor as his character" instead of naming Rajinikanth / "Tiger" Muthuvel Pandian).

**3. No genre-label filler** — new bullet, adjacent to the existing "Report only the production fact" bullet (`:63`–`67`):

> Do not tack on a genre label ("in an action thriller," "in a horror film") unless the genre itself is the news. It repeats context the reader already has from the film's own page and adds no fact.

Fixes #10 (Runner trailer: "...as an organ delivery duo in an action thriller").

**4. Stay on THIS beat** — strengthen the existing "Report only the production fact..." bullet (`:63`–`67`) with a concrete example:

> ...(existing bullet text)... Omit unrelated history about the film — e.g. a prior title change — unless it is itself the beat being reported.

Best-effort fix for #11 (weak evidence, but this is a correct general tightening regardless).

## Scope boundaries

**In scope:**
- The nine prompt-text additions above (1 in LINK, 4 in CLUSTER, 4 in SUMMARIZE).
- Tests for each addition (below).
- `SUMMARY_PROMPT_VERSION` default bump (current value `"7"` per `config.py:47`) so existing stored summaries regenerate under the new SUMMARIZE prompt — bump to `"8"`.

**Out of scope (deliberate):**
- IMDb source-tier downgrade — operational action in the admin Sources page (NEU-456, already shipped), not code.
- A deterministic entity-matching guardrail for casting dedup — prompt-only per the locked approach; revisit only if the prompt-only fix proves insufficient in a future triage pass.
- Bug #11's root cause beyond the general SUMMARIZE tightening — evidence was too thin (no clean screenshot) to diagnose a precise mechanism; if it recurs with a clear repro, file a follow-up.
- Any LINK/CLUSTER prompt-cache-affecting change: the LINK addition sits inside the already-cached system block, so this PR's LINK change will bust the roster cache once (expected, one-time; matches the NEU-457 precedent of editing `_INSTRUCTIONS`).

## Testing (TDD — failing test first)

Existing suites use capture-based fakes and pure-assembly tests — extend them, don't replace the pattern:

- **LINK** (`tests/unit/link/test_linker.py`): new case where a story's dek is about a same-franchise TV series/game naming a tracked film's characters — assert the model call would classify it no-match. Since LINK is a pure prompt-instruction change (no code branching), this is primarily an instruction-content assertion (the trap sentence is present in `_INSTRUCTIONS`) plus, if a fixture/eval harness exists for LINK behavior, a fixture case mirroring bug #5.
- **CLUSTER** (`tests/unit/link/test_cluster_pure.py`, `tests/unit/link/test_cluster.py`, `tests/integration/link/test_cluster.py`): 
  - Assert the four new sentences are present in `_INSTRUCTIONS`.
  - `apply_cluster_decisions`: since the casting-requires-a-name and tie-in/release_date rules are LLM-typing decisions (not code-level validation), add integration cases via `FakeClient` returning a casting group with no name-bearing story / a tie-in-typed-as-release_date response, confirming the harness plumbing (existing-events shown, `film.release_date` present in payload) supports the model making the right call — i.e. the payload assembly test proves the *inputs* the new instructions depend on (`film.release_date`, existing casting events with performer names in headlines) are actually present.
  - Reuse the `validate_clustering` harness (per NEU-448 precedent) for the casting-consolidation and stale-date cases as a non-blocking manual/eval check, since these are language-understanding fixes, not deterministic logic.
- **SUMMARIZE** (`tests/unit/synthesize/test_summarizer.py`):
  - Assert the four new sentences are present in `_INSTRUCTIONS`.
  - `parse_summary`: no new parsing behavior, so no new cases there — the fixes are instruction-only. If a golden-output eval harness exists (mirroring NEU-453's approach), add fixture cases for #4 (date-less filler), #6 (vague descriptor), #10 (genre tack-on) modeled directly on these screenshots.
  - Assert `summary_prompt_version` default is `"8"`.

Where a fix is purely a system-instruction change with no new code branch to unit-test deterministically (true for most of these — they're LLM judgment calls, not parsing/validation logic), the test asserts the instruction text is present and unchanged system-block byte-stability holds elsewhere; actual behavioral verification happens via a manual re-run against today's fixture stories (same screenshots) before merge, per `superpowers:verification-before-completion`.

## Definition of done

- All nine prompt-text additions present in `_INSTRUCTIONS` across the three files, each traceable to the bug(s) it fixes.
- `SUMMARY_PROMPT_VERSION` default bumped `"7"` → `"8"`.
- New/updated tests green; `task test`, `task lint`, `task typecheck` all green (`task format` applied).
- Manual spot-check: re-run LINK/CLUSTER/SUMMARIZE against the 11 screenshot cases (or their underlying story text) and confirm each no longer reproduces.
- One backend PR on the `tom/neu-483-bugs-2026-07-03` branch (per the ticket's `gitBranchName`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
