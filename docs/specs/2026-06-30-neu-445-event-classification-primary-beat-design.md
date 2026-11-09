# NEU-445 — Primary-beat precedence for event classification

**Ticket:** [NEU-445](https://linear.app/neuroticsasquatch/issue/NEU-445) · Bug · Project: backlotter: Maintenance
**Date:** 2026-06-30
**Status:** Design approved — ready for implementation plan

## Problem

A news story that is fundamentally a **trailer / first-look footage release** but which
also names cast members gets misclassified as a **`casting`** event.

Concrete failing case (from the ticket):

- Sources: People, Tribune, AOL coverage of *The Angry Birds Movie 3* "first look exclusive"
  revealing Walker Scobell & Emma Myers as the voice cast of Red and Silver's teenage children.
- Film: `backlotter.com/film/the-angry-birds-movie-3-2026`
- Event the pipeline produced: **`[Casting]` Walker Scobell and Emma Myers have been cast to
  voice the teenage children of Red and Silver.**
- Expected: the event should be classified **`trailer`** — the footage/first-look release is the
  headline beat; the cast names are incidental context.

### Root cause

Event `event_type` is assigned in **Stage 2 (clustering)** by an LLM, from the instruction
string `_INSTRUCTIONS` in `src/upmovies/link/cluster.py:54-76` (model: `claude-sonnet-4-6`,
`CLUSTER_MODEL`). That prompt enumerates the seven valid types
(`announced, casting, production_start, production_wrap, release_date, trailer, other`) and
tells the model to group stories that report "the SAME beat", **but gives no guidance on which
beat wins when a single story carries more than one** (e.g. a trailer release that also names
cast). The model latches onto the prominent actor names and returns `casting`.

This is an **under-specified prompt, not a code defect.** The fix belongs in the prompt.

The taxonomy is enforced downstream by a DB `CheckConstraint`
(`src/upmovies/news/models.py:75-79`) and a `_VALID_TYPES` set
(`src/upmovies/link/cluster.py:28-36`); neither changes here.

## Goals / non-goals

**Goal:** when a story carries multiple beats, the classifier picks the **dominant/headline
beat**; incidental mentions (cast named in a trailer story, a date noted inside a casting
story) do not change the type. The Angry Birds first-look case classifies as `trailer`.

**Non-goals (explicitly out of scope):**
- No deterministic post-LLM keyword override (considered and rejected — see Alternatives).
- No new "first look" event type.
- No Stage-1 linker changes (the linker only decides linked/rejected, not type).
- No clustering prompt-versioning field. The cluster instruction is a static string today
  (unlike summarization's `summary_prompt_version`); adding versioning is an optional future
  follow-up, not part of this ticket.

## Approach (selected: prompt-only + gold fixtures)

### 1. Prompt precedence rule — the core change

Add a general **"primary beat wins"** principle to `_INSTRUCTIONS` in
`src/upmovies/link/cluster.py`, near the type list. The rule is principle-based and general
(it covers `release_date` and production milestones too, not just trailer-vs-casting); it does
**not** hardcode worked examples.

Intent of the inserted guidance (exact wording to be finalized in implementation):

> Classify each new event by the story's **dominant / headline beat** — the development the
> coverage is actually about. Incidental details do not change the type: a trailer or
> first-look footage release that names cast is **`trailer`**, not `casting`; a date mentioned
> in passing inside a casting story stays `casting`. When a story genuinely reports two
> co-equal beats, split it.

This is ~1-2 sentences inserted into the existing prompt. No structural change to the JSON
contract, the parser, or the apply logic.

### 2. Regression guard — gold fixtures + validation harness

Add the three real ticket stories to **`tests/fixtures/link/validation_set.json`** (the default
fixture used by `scripts/validate_clustering.py`) as `ValidationItem` rows
(`src/upmovies/link/validation.py`):

- `relation: "about"`, `expected_film_tmdb_id`: The Angry Birds Movie 3's TMDB id
  (look up during implementation; the film must also exist in the dev DB — see Constraints).
- All three share **one** `event_group` label (so they cluster into a single event — this also
  exercises purity/pairwise grouping).
- Gold `event_type: "trailer"`.
- Leave `is_production_news` unset (defaults to `None`, which the harness treats as a
  clustering-eligible production-news row).

### Verification / acceptance

Automated (CI, deterministic):
- `task lint`, `task typecheck`, `task test` all green. Existing pure-parse tests
  (`tests/unit/link/test_cluster_pure.py`) are unaffected by a prompt-string change.

Manual (in-container, one live Sonnet call per scoreable film):
- `task shell` → `python scripts/validate_clustering.py`
- **Pass condition:** the new Angry Birds event is predicted **`trailer`** (visible in the
  secondary `event_type agreement` line), **and** `purity` + `pairwise_f1` stay in the GREEN
  band (no clustering regression).
- Record the re-measured numbers in
  `docs/specs/2026-06-25-neu-300-stage2-cluster-purity-design.md`, per the harness docstring.

### Constraints to respect

- `scripts/validate_clustering.py` reads films from the live dev DB
  (`select(Film)`); the Angry Birds Movie 3 row must be present or the rows are skipped.
- The harness costs one live `claude-sonnet-4-6` call per scoreable film and is a **manual**
  validation step — it is **not** part of `task test`.
- `event_type agreement` is a **secondary, non-gating** metric (the NEU-300 gate is
  purity + pairwise_f1). The trailer-flip is therefore a directional confirmation, not a hard
  automated gate; "the case flips to `trailer`" is the human pass condition.

## Alternatives considered

- **B. Prompt + deterministic guard rail** — post-LLM heuristic overriding `casting → trailer`
  on trailer keywords. Rejected: brittle keyword lists, a second source of truth that drifts
  from the prompt, and new false-positive risk (e.g. "in the upcoming trailer" inside a real
  casting story). The bug is a missing instruction, not missing code.
- **C. Few-shot examples in the prompt** — declined in favor of a general principle.
- **Add a new "first look" event type** — declined; the product decision is that these are
  `trailer` events.

## Files touched

- `src/upmovies/link/cluster.py` — `_INSTRUCTIONS` precedence guidance.
- `tests/fixtures/link/validation_set.json` — 3 gold rows (one shared `event_group`,
  `event_type: "trailer"`).
- `docs/specs/2026-06-25-neu-300-stage2-cluster-purity-design.md` — record re-measured harness
  numbers.
