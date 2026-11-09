# NEU-450 — Sibling/spin-off film's release date mislinked & mis-evented onto the flagship

**Ticket:** NEU-450 (backlotter: Maintenance, Bug)
**Repo:** `upcoming-movies-backend`
**Related:** NEU-438 (untracked-franchise casting trap — shipped), NEU-443 (aspirational casting — shipped), NEU-453 (trailer/release-date temporal confusion + cross-film mis-attribution — shipped; explicitly did **not** retire NEU-450), NEU-448 (split trailer events)
**Status:** Design approved 2026-07-02

## Problem

News about *Shrek 5* (set for **June 30, 2027**) also announces a **Donkey origin spin-off** coming **June 2028**. The pipeline took the spin-off's June 2028 release date, linked it to *Shrek 5*, and created a `release_date` event on *Shrek 5* — the wrong movie. Source embeds on the ticket: one article is primarily about Shrek 5 and mentions the spin-off in passing; the other is *entirely* about the spin-off ("Shrek spin-off movie finally sets release date").

This surfaces as two distinct, co-located failure modes:

| Mode | Symptom | Layer | Root cause |
|---|---|---|---|
| 1 | The standalone *"Shrek spin-off sets release date"* story is **linked to Shrek 5** and becomes a `release_date` event on Shrek 5. | **LINK → CLUSTER** (`link/linker.py`, `link/cluster.py`) | The Donkey spin-off is **not in the roster**; Shrek 5 is the only tracked "Shrek". LINK links the spin-off story to Shrek 5 and CLUSTER types it `release_date`. |
| 2 | The Shrek 5 article (correctly linked to Shrek 5) causes Shrek 5's release-date beat to read **June 2028** — the spin-off's date, co-mentioned in the same story. | **SUMMARIZE** (`synthesize/summarizer.py`) | A *different film's* release date appears in the sources; the summarizer attributes it to this film's beat. |

## Why the existing guards don't catch it

The three neighboring rules are already in the prompts (NEU-438/453) but each is written for an adjacent case, leaving a sibling-film-shaped hole:

- **LINK franchise-generic rule** (`linker.py:71–77`) is written around *generic* references — "the next Batman", "a new Spider-Man". A *"Shrek spin-off"* / *"Donkey origin movie"* is a **specifically identified but untracked sibling film**, not a generic franchise reference, so the rule does not reliably fire — the classifier reasons "this is Shrek-related, Shrek 5 is the Shrek film" and links it.
- **LINK other-film-as-context rule** (`linker.py:79–84`) targets a different film's development where the tracked film is a *scheduling comparison* ("Film X moved to avoid clashing with [tracked film]"). The standalone spin-off article is not that shape.
- **CLUSTER `off_topic` rule** (`cluster.py:102–106`) already drops a new story whose "actual subject is a DIFFERENT film" — this is the correct backstop for Mode 1, but does not name the sibling/spin-off case explicitly.
- **SUMMARIZE beat-date rule** (`summarizer.py:77–83`) forbids dating a beat by "another **event's** date" of the same film, but does **not** name a *different film's* release date (a spin-off/sequel/prequel co-mentioned in the same story) — the exact Mode 2 vector.

## Goals

1. A distinct, untracked sibling film (spin-off, sequel, prequel, origin/"…-verse" entry) in a tracked film's franchise is **not linked** to the tracked flagship, even when the story states a release date. (Mode 1)
2. If such a story slips past LINK, CLUSTER **drops** it (`off_topic`) rather than recording a `release_date` event on the flagship. (Mode 1 backstop)
3. A different film's release date co-mentioned in a story is **never** stated as this film's release-date beat. (Mode 2)
4. Existing bad blurbs are repaired via a `SUMMARY_PROMPT_VERSION` bump (forces re-summarization on the next run).

## Non-goals

- No structural "related films" / franchise-sibling field on `Film` (rejected as YAGNI — a schema/ingest change for a probabilistic prompt problem).
- No CLUSTER date-ownership gate — CLUSTER does not extract dates; date reasoning stays in SUMMARIZE.
- Not a general rewrite of the LINK/CLUSTER/SUMMARIZE prompts — targeted rule extensions only.
- Not re-doing NEU-453's cross-film scheduling-comparison or beat-vs-release-date work; this sharpens the *sibling-film* sub-case those rules leave open.

## Design

Prompt-only. Extend three existing rules, add regression rows, bump the summary prompt version. No new code paths, no schema, no migration, no new harness (all three eval harnesses and fixtures already exist).

### 1. LINK — `link/linker.py` `_INSTRUCTIONS` (Mode 1)

Extend the existing franchise-generic bullet (`linker.py:71–77`) to explicitly cover a **distinct, identified sibling film**: a spin-off, sequel, prequel, or origin/companion film that is a *different* entry in a tracked film's franchise and is **not itself in the roster**. Such a story returns **`no-match`**, *even when it states a release date*, unless it unambiguously identifies the exact roster film (distinct subtitle / year / director). The closing clause preserves recall: a story that genuinely is about the exact tracked film still links `about`.

Marker phrasing to bake in verbatim (for the prompt-content unit test): the words **`spin-off`** and **`not itself tracked`** must appear in the rule.

### 2. CLUSTER — `link/cluster.py` `_INSTRUCTIONS` (Mode 1 backstop)

Add a clause to the existing `off_topic` rule (`cluster.py:102–106`) naming the sibling case: a spin-off / sequel / prequel of this film's franchise is a **different film**, so a story whose real subject is that sibling — even when it names this film as context — goes to `off_topic` and is dropped, not recorded as this film's `release_date` event. **No code change** — the `off_topic` sentinel path already rejects such stories (`apply_cluster_decisions`).

### 3. SUMMARIZE — `synthesize/summarizer.py` `_INSTRUCTIONS` (Mode 2)

Sharpen the beat-date rule (`summarizer.py:77–83`). After "another event's date … is context," add: **a different film's release date — a spin-off, sequel, or prequel named in the same story — is likewise context, never this film's date.** Bump `SUMMARY_PROMPT_VERSION` **6 → 7** in `config.py`; the synthesize pipeline re-summarizes every event whose stored `prompt_version` differs, repairing the offending Shrek 5 blurb (and any siblings) on the next run.

Marker phrasing to bake in verbatim (for the prompt-content unit test): **`different film`** and **`spin-off`** must appear in the rule.

## Verification

Prompt-wording behavior is verified by the offline eval harnesses (live LLM against labeled fixtures), not the fake-completer unit tests. Unit tests cover plumbing/prompt-content only.

### LINK
- `tests/fixtures/link/validation_set.json`: add the *"Shrek spin-off movie finally sets release date"* story as `no-match` (no `expected_film_tmdb_id`), plus 1–2 sibling analogues (e.g. a "Donkey origin movie" / Puss-in-Boots-style spin-off release-date story). If a matching real story exists in the corpus, use it; otherwise add representative rows.
- Run in-container (`task shell`) with a live key: `python scripts/validate_linking.py` — confirm the sibling stories reject with **no new false negatives** on genuine roster stories. Record numbers in Results.

### CLUSTER
- Add a labeled row for "a sibling/spin-off story reaches clustering for the flagship" → expected `off_topic` (dropped, no event). Run `python scripts/validate_clustering.py` — confirm no cluster-purity regression.

### SUMMARIZE
- `tests/fixtures/synthesize/summary_cases.json`: add a Mode 2 case — a Shrek-5-style event whose sources state the film's own date (2027) **and** a co-mentioned spin-off date (2028). LLM-judge pass criteria: the blurb states the film's own date (2027) or **no** date, and **never** the spin-off's date (2028). Keep the existing controls.
- Run `python scripts/validate_summaries.py` — the new case passes; controls unchanged.

### Unit tests
- `tests/unit/link/test_linker.py`: extend the prompt-content test to assert the new sibling-rule markers (`"spin-off"`, `"not itself tracked"`) appear in `_INSTRUCTIONS`.
- `tests/unit/synthesize/test_summarizer.py`: assert the sharpened beat-date markers (`"different film"`, `"spin-off"`) appear in `_INSTRUCTIONS`.
- `tests/unit/link/test_cluster*.py`: the `off_topic` reject path already has coverage (NEU-453); extend only if a sibling-specific assertion adds value.

## Acceptance criteria

1. A distinct untracked sibling/spin-off story does not link to the tracked flagship (LINK → `no-match`); if it slips through, CLUSTER drops it (`off_topic`), so no spurious `release_date` event is created on the flagship.
2. A different film's release date co-mentioned in a story is never stated as this film's release-date beat.
3. `SUMMARY_PROMPT_VERSION` bumped 6 → 7 so existing blurbs re-summarize.
4. LINK/CLUSTER/SUMMARIZE eval harnesses show no regression on the updated fixtures; the new sibling cases pass.
5. `task test`, `task lint`, `task typecheck` all green.

## Linear / PR shape

One backend ticket = one PR (NEU-450), cross-layer (LINK + CLUSTER + SUMMARIZE) by explicit decision, mirroring NEU-453. Branch `tom/neu-450-…` (Linear-provided). No schema/migration. Note the shared LINK/CLUSTER/SUMMARIZE prompt surface with NEU-453 to avoid edit collisions if both are ever in flight simultaneously.

## Results

_(Filled during implementation: eval-harness numbers before/after, and the re-summarized blurb for the offending Shrek 5 event.)_

🤖 Generated with [Claude Code](https://claude.com/claude-code)
