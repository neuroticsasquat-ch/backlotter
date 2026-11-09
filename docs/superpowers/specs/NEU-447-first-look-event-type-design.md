# NEU-447 — Reclassify non-video visual reveals as a new `first_look` event type

- **Ticket:** NEU-447 (Bug) — *First footage/photographs are news but shouldn't be classified as a trailer*
- **Project:** backlotter: Maintenance
- **Date:** 2026-06-30
- **Status:** Design approved; ready for implementation plan

## Problem

The cluster classifier (`upcoming-movies-backend/src/upmovies/link/cluster.py`, `_INSTRUCTIONS`)
maps *any* footage or in-film visual reveal to the `trailer` event type. So press coverage of
footage that was merely **screened or described** at an event/presentation — e.g. the Dynamic Duo
"first footage" story — is clustered into a `trailer` event whose synthesized summary reads
*"the first trailer for the film has been released."* That is factually wrong: no public trailer
exists. Footage screened at an event, concept art, character designs, and first-look photos are
**news**, not a trailer drop.

The classification is entirely LLM-driven; there is no keyword/regex fallback. The relevant rules
today (cluster.py lines ~67–75) explicitly send footage and in-film art to `trailer`, while a
promotional actor-in-costume still goes to `other` (hidden).

## Goal

- `trailer` means an actual promotional **video released for the public to watch** (a real
  trailer/teaser drop).
- Introduce a new `first_look` event type that captures **every other visual reveal**.
- The new type is **visible** in the public event feed but **off the arc** (does not advance the
  film's arc stepper).
- The fix is **forward-only** — no backfill or re-clustering of already-stored events.

## Decisions (settled during brainstorming)

1. **Trailer boundary:** `trailer` requires a publicly released, watchable promotional video.
   Footage screened/described (not a public video) is not a trailer.
2. **New type:** add a dedicated `first_look` event type (rather than folding footage into
   `other` or `announced`).
3. **Scope of `first_look`:** **all** non-video visual reveals — footage screened or described at
   an event/presentation, concept art, CGI/animated character designs, first-look photos, AND
   promotional actor-in-costume stills. This collapses today's split rules
   ("in-film footage = trailer" vs "promo still = other") into one boundary. Promo stills, hidden
   today as `other`, become visible as `first_look`.
4. **Arc placement:** `first_look` is **off the arc**. It surfaces in the film's event feed with a
   "First look" badge but does **not** advance the arc stepper
   (`announced → cast → shooting → wrapped → dated → trailer → released`). No `ArcStepper` /
   `ArcStage` changes.
5. **Existing data:** **forward-only**. Existing `trailer` events are left as-is; the known
   Dynamic Duo event stays mislabeled until corrected separately.

## Classification boundary (the heart of the change)

Rewrite the visual-reveal rules in `_INSTRUCTIONS` so the model classifies on the question
*"can the public watch a released video?"*:

- **`trailer`** — a trailer/teaser **video released** for public viewing (the audience can watch
  it now). Incidental cast names do not change this.
- **`first_look`** — any visual reveal that is **not** a released video: footage screened or
  described at an event/presentation, concept art, CGI/animated character designs, first-look
  photos, and promotional actor-in-costume stills. Incidental cast names do not change this.
- **Unchanged:** a bare role announcement with no imagery or footage stays `casting`; a release
  date mentioned in passing inside a casting story stays `casting`.

The dominant-beat precedence established by NEU-445 still applies: classify by the dominant,
headline beat; incidental details never change the type.

## Backend changes (`upcoming-movies-backend`)

- **`src/upmovies/news/models.py`** — add `'first_look'` to the `ck_event_type` CHECK constraint
  (lines ~75–79).
- **Alembic migration** (`migrations/versions/`) — drop and recreate `ck_event_type` to include
  `first_look` (Postgres; `op.execute` ALTER TABLE in `upgrade`, original set restored in
  `downgrade`). Model column already enumerated via `create_all` for tests; add the migration for
  prod. Generate with `task makemigration -- "add first_look event type"` and review the output.
- **`src/upmovies/link/cluster.py`**
  - Add `"first_look"` to `_VALID_TYPES`.
  - Add `first_look` to the prompt's `"type"` enumeration line.
  - Rewrite the visual-reveal rules per the boundary above.
  - **Do not** add `first_look` to `_STALE_EVENT_TYPES` — like `trailer`, a first look can
    legitimately appear at any stage (including post-wrap), so it must not be stale-gated.
- **`src/upmovies/public/arc.py`** — **no** entry in `_EVENT_STAGE` (off the arc). `first_look`
  therefore ranks like `other` (−1) in `most_significant_event_type`. **Verify** the feed's
  day-group "top type" still surfaces a visible `first_look` rather than a hidden `other` when a
  film has both types on the same day (since both rank −1, tie-break order matters — see Edge
  cases).
- **`src/upmovies/public/service.py`** — **do not** add `first_look` to `_HIDDEN_EVENT_TYPES`, so
  it reaches the public event feed.

## Frontend changes (`upcoming-movies-frontend`)

- **`src/components/film/labels.ts`** — add `first_look: "First look"` to `EVENT_TYPE_LABELS`.
  This is the only required change: `EventCard` renders any `event_type` as a badge + summary, and
  `event_type` is free-text in `types.ts` (no enum to extend). `ArcStepper` / `ArcStage` are
  untouched because `first_look` is off the arc.

## Edge cases

- **Day-group top type:** `most_significant_event_type` ranks types not in `_EVENT_STAGE` at −1, so
  `first_look` and `other` tie. If a single film has both a `first_look` and an `other` event on the
  same day, the representative type the feed shows could be the hidden `other` ("Update") instead of
  the visible `first_look`. The implementation should confirm the grouping operates over
  visible events only (or otherwise prefers `first_look` over `other`); the plan must verify this
  with a test.

## Testing

- **Backend**
  - Prompt-assertion unit test in `tests/unit/link/test_cluster_pure.py` (mirroring the NEU-445
    `test_instructions_state_primary_beat_precedence` pattern) asserting `_INSTRUCTIONS` encodes the
    released-video-vs-first-look distinction and lists `first_look` as a valid type.
  - Cluster tests (unit + integration) for a `first_look` event being created from a footage/photo
    story, surfacing as **visible** in the public feed, and **not** advancing the arc stage.
  - Run full `task test`, `task lint`, `task typecheck`, and `task migrate` in-container before
    claiming done.
- **Frontend**
  - Label test: `eventTypeLabel("first_look")` → `"First look"`.
  - Run `tsc -b`, eslint, and vitest locally before pushing.

## Out of scope

- Re-clustering or backfilling existing `trailer` events (forward-only). The known Dynamic Duo
  event remains mislabeled until handled separately.
- Adding a `first_look` node to the arc stepper.
- Per-type icons or colors on event cards.

## Implementation / PR structure

This change spans both repos. Per the standing convention (1 ticket = 1 PR; split cross-stack
stories into per-stack sub-tickets), the implementation plan should split NEU-447 into:

- **Backend sub-issue** — models CHECK constraint + migration, `cluster.py` (`_VALID_TYPES`,
  prompt rewrite), `arc.py` / `service.py` verification, and tests.
- **Frontend sub-issue** — the `labels.ts` entry + label test.

Both under NEU-447, with the frontend slice blocked by / following the backend (the backend defines
and emits the new type).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
