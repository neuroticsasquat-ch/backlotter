# NEU-541 — Make event summaries write-once (no auto-regeneration)

**Ticket:** [NEU-541](https://linear.app/neuroticsasquatch/issue/NEU-541) · backlotter: Maintenance · Priority: Medium
**Branch:** `tom/neu-541-backend-make-event-summaries-write-once-no-auto-regeneration`
**Repo:** `upcoming-movies-backend`
**Status of this spec:** implementation-ready — the design is fully locked in the ticket; no open questions. This file materializes it at the convention path and records verification against the live code.

## What & why

Make an event's summary **immutable once generated**. The synthesize pipeline summarizes each event exactly once and never auto-regenerates it.

Two reasons:

1. **Notification immutability (forward-looking).** Once watchlist notifications land, a summary that has already been emitted must not silently change out from under it. Write-once guarantees that.
2. **Material change ⇒ new event, not a mutation.** A genuinely new fact should form a *new* event (already the direction of [NEU-492](https://linear.app/neuroticsasquatch/issue/NEU-492) per-performer casting dedup), leaving the existing event and its summary untouched. So there is no legitimate need to re-summarize an existing event.

This is the enabler/precondition for the admin-edit story ([NEU-538](https://linear.app/neuroticsasquatch/issue/NEU-538) / [NEU-539](https://linear.app/neuroticsasquatch/issue/NEU-539)): an event that already has a summary is never re-picked, so admin edits are inherently safe and "reset to AI" becomes simply *delete the row → re-summarized fresh next run*.

## The change

**File:** `src/upmovies/synthesize/pipeline.py`, `_select_pending` (currently lines 59–75).

Reduce the selection predicate from a 3-way OR to a single clause:

```python
# before (pipeline.py:69-73)
.where(
    EventSummary.event_id.is_(None)
    | (Event.updated_at > EventSummary.source_updated_at)   # drop — staleness
    | (EventSummary.prompt_version != prompt_version)         # drop — prompt bump
)
# after
.where(EventSummary.event_id.is_(None))
```

An event is summarized only when it has **no summary row yet**.

Also update the `_select_pending` docstring (pipeline.py:60–63), which currently describes the stale / prompt-version reselection behavior being removed.

**Verified against live code:** the "before" block matches `pipeline.py:69-73` exactly as of this spec.

## Consequences (intended)

- **Prompt-version bumps are forward-looking only.** A `SUMMARY_PROMPT_VERSION` bump stamps *new* rows going forward but never regenerates existing summaries. This deliberately retires the old "bump version → auto-regenerate the whole corpus" lever (used pre-launch, e.g. NEU-359/368).
- **No mass re-gen.** Refreshing an existing summary is a per-event action via NEU-539's reset-to-AI (delete row → re-summarized next run). **No bulk tool** — decided.
- `source_updated_at` and `prompt_version` columns **stay** (still stamped on every write via `_upsert_summary`, useful as record). `source_updated_at` simply no longer drives selection.
- **No migration** — pure query change.

## Acceptance criteria / observable outcomes

- An event whose `updated_at` advances past its summary's `source_updated_at` is **not** reselected.
- An existing summary whose `prompt_version` differs from the current one is **not** reselected.
- A brand-new event (no summary row) **is** selected and stamped with the current `prompt_version` (forward-looking stamping still works).
- `task test`, `task lint`, `task typecheck` all green (run `task format` first).

## Tests (TDD)

Follow the repo's write-the-failing-test-first rule. Suite: `tests/integration/synthesize/test_pipeline.py`.

**Flip these two existing tests** (they currently assert the removed reselection paths):

- `test_select_pending_includes_stale_event` (line 93) → an event whose `updated_at` is now later than its summary's `source_updated_at` yields `pending == []`. Rename to reflect "not reselected" (e.g. `test_select_pending_skips_stale_event`).
- `test_select_pending_includes_prompt_version_mismatch` (line 113) → a summary with a differing `prompt_version` yields `pending == []`. Rename accordingly.

**Update the integration test asserting the old corpus-bump behavior:**

- `test_prompt_version_bump_refreshes` (line 262) → a v1→v2 prompt bump over an event that already has a summary now produces `(new, refreshed, failed) == (0, 0, 0)` and the stored row keeps `prompt_version == "1"`. Rename to reflect "prompt bump does not refresh existing" (or replace with an equivalent no-refresh assertion).

**Keep green (regression guards, no change expected):**

- `test_select_pending_includes_new_event_and_maps_input` (line 57) — new event still selected and mapped, stamped with current `prompt_version`.
- `test_select_pending_skips_up_to_date_event` (line 75) — already asserts `pending == []`.

## Out of scope / deferred

- Any bulk / corpus re-summarization tool — explicitly decided against.
- The admin edit + revert flow itself (NEU-539) and the admin UI (NEU-538) — this ticket only removes auto-regeneration so those become safe.
- No schema/migration changes; columns are retained.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
