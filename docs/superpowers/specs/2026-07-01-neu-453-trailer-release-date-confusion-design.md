# NEU-453 — Fix trailer/release-date temporal confusion + cross-film mis-attribution

**Ticket:** NEU-453 (backlotter: Maintenance, Bug)
**Related:** NEU-457 (run-date anchor — **done**, PR #100), NEU-450 (spinoff date → wrong film — overlapping surface, not retired here)
**Repo:** `upcoming-movies-backend`
**Status:** Design approved 2026-07-01

## Problem

The film page for a Telugu film (Akhil Akkineni; wide release Jul 10 2026, run date ~Jul 1 2026) showed two independent, co-located errors in its "latest updates":

| # | Symptom | Layer | Root cause |
|---|---------|-------|-----------|
| A | TRAILER blurb reads *"A trailer was released on **July 10**, featuring…"* — July 10 is the film's **future** release date, not the trailer's date. | **SUMMARIZE** (`synthesize/summarizer.py`) | The trailer's source stories mention the film's release date; the summarizer attributed that date to the trailer, and stated a past beat (the trailer, already out ~Jul 1) as occurring on a date after `as_of_date`. |
| B | A RELEASE DATE event reads *"Another Telugu film was postponed to avoid releasing on the same date as this film."* — that beat is about a **different** film, logged as **this** film's release-date event. | **LINK → CLUSTER** (`link/linker.py`, `link/cluster.py`) | LINK linked a story that names this film only as a scheduling comparison; CLUSTER then typed that story `release_date` for this film. |

NEU-457 already threads the pipeline run date (`as_of_date`) into all three prompts (LINK, CLUSTER, SUMMARIZE). This ticket is the follow-up that makes each prompt *use* that anchor correctly and adds a cross-film-attribution guardrail. Both defects are fixed under this one ticket (cross-layer PR by explicit decision).

## Goals

1. A beat's blurb states the beat's own date/tense; a film's future release date never surfaces as the date a past beat (trailer, casting) happened.
2. A development whose actual subject is a *different* film — even one that names a tracked film as context — is neither linked to nor logged as an event on the tracked film.
3. Existing bad blurbs are repaired (prompt-version bump forces re-summarization).

## Non-goals

- Not inferring production status from event types (owned by NEU-452 / locked decision #1).
- Not a general rewrite of the LINK/CLUSTER/SUMMARIZE prompts — targeted rules only.
- Not retiring NEU-450; the LINK/CLUSTER changes here are general cross-film hardening that also helps NEU-450, but NEU-450 keeps its own scope. The plan notes the shared prompt surface to avoid collision.

## Design

Three prompt-layer fixes plus one small backstop code path.

### 1. SUMMARIZE (`synthesize/summarizer.py`)

Add two rules to `_INSTRUCTIONS`:

- **Beat-date discipline:** *Date the beat by its own date, never by another date mentioned in the sources. A film's release date, a future premiere, or another beat's date appearing in the story is context — not the date of THIS beat. If you cannot tell when this beat happened, state no date for it.*
- **Future-date sanity** (strengthens the NEU-457 rule in the opposite direction): *A beat being reported now (a trailer that dropped, a casting that closed) has already happened — never state it as occurring on a date after `as_of_date`. A date after `as_of_date` is a scheduled/future date (e.g. the release), not when this beat occurred.*

Bump `SUMMARY_PROMPT_VERSION` **5 → 6** in `config.py`. The synthesize pipeline (`_select_pending`) re-summarizes every event whose stored `prompt_version` differs, so this repairs the offending blurb (and any siblings) in prod on the next run.

### 2. LINK (`link/linker.py`)

Sharpen the `about` / `mention` boundary in `_INSTRUCTIONS`:

- *A development (a release-date move, a casting, a delay) that belongs to a DIFFERENT film is not "about" a tracked film merely because that film is named as context — e.g. "Film X was moved to avoid clashing with [tracked film]" is about Film X; the tracked film is a scheduling comparison → **mention**, not linked. Classify "about" only when the NEW development is the tracked film's own.*

`mention` is already a reject path (`link_note="mention"`), so no code change — the story simply never reaches CLUSTER.

### 3. CLUSTER (`link/cluster.py`) — backstop

LINK is the primary gate; CLUSTER is defense-in-depth for the case where a mis-linked story still arrives.

**Prompt** (`_INSTRUCTIONS`):

- *Every event must be a beat in THIS film's own life. If a new story's actual subject is a different film — even one that names this film as context — do not log it as this film's event; put it in a group with type `"off_topic"` so it is dropped.*

**Code** (`apply_cluster_decisions`, mirroring the existing `is_stale_stage` reject path):

- Recognize a new-event group with `type == "off_topic"`: reject each of its stories (`link_status="rejected"`, `film_id=None`, `link_confidence=None`, `link_note="off-topic"`), mark them assigned, and increment `stories_rejected`. Do **not** create an event.
- `"off_topic"` is a control sentinel handled before the `_VALID_TYPES` check; it is never persisted as an `Event.event_type`. No DB/schema/migration change.

This fully removes the mis-linked story rather than leaving a spurious `other` event on the film (the rejected alternative was prompt-only "type it `other`").

## Verification

Behavior of prompt wording is verified by the offline eval harnesses (live LLM against labeled fixtures), not the fake-completer unit tests. Unit tests cover plumbing only.

### LINK / CLUSTER
- Add labeled row(s) to `tests/fixtures/link/validation_set.json` for the "another film's postponement names this tracked film" case: `relation: "mention"` (no `expected_film_tmdb_id` / `event_type`). If a matching real story exists in the corpus, use it; otherwise add a representative row.
- Run in-container (`task shell`) with a live key:
  - `python scripts/validate_linking.py` — confirm the mention case is rejected and overall about/mention precision does not regress.
  - `python scripts/validate_clustering.py` — confirm no cluster-purity regression.
- Record the numbers in this spec's "Results" section (filled during implementation).

### SUMMARIZE (new eval harness)
- Build `scripts/validate_summaries.py`, mirroring the `validate_clustering.py` shape: read a small labeled fixture, run the real summary model per case, score with an **LLM-judge** (a stronger model) against explicit pass/fail criteria:
  1. uses the beat's own date (or states no date), not another date from the story;
  2. never states a past beat as occurring after `as_of_date`;
  3. does not restate the film's release date as the beat's date.
- Add a fixture (e.g. `tests/fixtures/synthesize/summary_cases.json`): the trailer/release-date case (Akhil Akkineni-style: trailer stories that also mention a future release date) plus 2–3 controls (a normal casting beat; a release_date beat where stating the date IS correct).
- The harness prints per-case pass/fail and an aggregate; it is a manual/offline gate (like the clustering harness), not part of `task test`.

### Unit tests
- `tests/unit/link/test_cluster.py` (or `test_cluster_pure.py`): an `off_topic` group rejects its stories (`link_status="rejected"`, note `"off-topic"`) and creates no event; `stories_rejected` increments.
- `tests/unit/synthesize/test_summarizer.py`: `as_of_date` is present in the payload (already covered by NEU-457 — extend if needed).

## Acceptance criteria

1. A trailer blurb states the trailer's own date/tense; a future release date never appears as the trailer's date.
2. A different film's postponement that only references this film is not linked (LINK → `mention`) and, if it slips through, not logged as this film's event (CLUSTER → `off_topic` drop).
3. `SUMMARY_PROMPT_VERSION` bumped 5 → 6 so existing blurbs re-summarize.
4. LINK/CLUSTER eval harnesses show no regression on the updated fixture; the new SUMMARIZE eval passes on the seeded cases.
5. `task test`, `task lint`, `task typecheck` all green.

## Results

_(Filled during implementation: eval-harness numbers before/after, and the re-summarized blurb for the offending event.)_
