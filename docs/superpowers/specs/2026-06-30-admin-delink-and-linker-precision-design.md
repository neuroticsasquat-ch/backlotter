# Mislinked stories: admin delink tooling + linker precision — design

**Date:** 2026-06-30
**Status:** Approved (pre-implementation)
**Trigger:** A user reported the top story on `https://backlotter.com/film/the-batman-part-ii-2027`
("Warner Bros. Officially Casts The Next Batman", ScreenRant) is mislinked — the article is
actually about *Batman: Knightfall*, not Matt Reeves' *The Batman: Part II*.

## Root cause

Story→film links are produced entirely by an LLM entity-linking classifier
(`link/linker.py`), which sees only each story's **headline + a ~500-char dek** (never the full
article) and picks at most one film from a roster of tracked films. A story appears on a film
page only when the clustering stage attaches it to an `Event` of that film (the public page
renders **events**, whose sources come from `event_story → story`; nulling `story.film_id`
alone does not hide it).

This is the **untracked-film trap**:

- The article is about *Batman: Knightfall*, which is **not in the catalog** (below TMDB's
  popularity floor / not ingested).
- The headline launders Knightfall as "the next Batman."
- *The Batman: Part II* is the **only** Batman film in the roster.

With a "Batman" + casting signal and only one Batman candidate, the classifier returns
`about` at confidence ≥ floor and links to Part II. The clustering stage then builds a
"casting" event whose summary asserts Batman was recast.

The classifier already handles the explicit case well (every "Batman: **Knightfall**" headline
in the dev DB is correctly `no-match`); it fails only when the headline names the franchise
generically.

There is **no manual override** anywhere in the codebase — links are set solely by the
pipeline. Two responses follow: (A) reduce this class of false positive; (C) give admins a way
to correct the ones that slip through.

## Pipeline facts that constrain the design

- **Link stage** processes only `link_status = 'pending'` stories within the recency window
  (`link/pipeline.py`). A `linked`/`rejected` story is never reprocessed.
- **Cluster stage** processes only `linked` stories with a non-null `film_id` that are not yet
  in an `event_story`. So a story with `film_id = NULL` is never re-attached.
- **Synthesize stage** re-summarizes an event when
  `Event.updated_at > EventSummary.source_updated_at` (or summary missing / prompt_version
  changed) — `synthesize/pipeline.py`.
- **Public render** (`public/service.py`): events with `event_type != 'other'` and a summary;
  each event's sources are `cap_sources()`-limited to `SOURCE_CAP = 3`, **deduped by outlet**.
  An event can therefore have more source stories than chips shown.
- `news.event_story.event_id` and `news.event_summary.event_id` both FK the event with
  `ondelete CASCADE`. `story.url` is globally unique.

---

## (A) Linker precision — untracked-franchise casting trap

**Goal:** a casting/announcement story that names a franchise generically must not link to a
specific roster film unless it unambiguously identifies that exact film.

1. **Validation set** (`tests/fixtures/link/validation_set.json`): add the offending story as
   `untracked_film` / no-match, plus a few sibling "generic franchise casting" headlines, so
   the regression is captured and measurable.
2. **Prompt** (`_INSTRUCTIONS` in `link/linker.py`): extend the existing
   "same-titled / substring traps" rule to also cover **franchise-generic casting** — when a
   story names a franchise generically ("the next Batman") and the only roster candidate is a
   *different* entry in that franchise, return `no-match`. Link only when the story
   unambiguously identifies the exact roster film (distinct subtitle / year / director).
3. **Verify:** run `scripts/diagnose_linking.py` and confirm this false positive disappears
   with **no new false negatives** on the genuine Part II stories (logo reveal, Penguin /
   Charles Dance casting, etc.); review the floor sweep. "Done" = validation set clean, no
   regressions. (Prompt tuning is probabilistic — success is measured against the validation
   set, not proven absolutely.)

**Out of scope for A:** tracking *Batman: Knightfall* in the catalog (a separate
ingest/popularity-floor decision).

---

## (C) Admin delink tooling

When an admin is logged in, the **public film detail page** grows inline moderation controls;
all other users see the page unchanged. **Delink-only** in v1 — no relink-to-another-film.

### Operations

- **Delink one source** — an `×` on each source chip; removes that story from its event.
- **Remove whole event** — a button on the event card; rejects all the event's stories and
  deletes the event.

### Core operation (shared, durable)

For each story being delinked:

1. `link_status = 'rejected'`, `film_id = NULL`, `link_confidence = NULL`,
   `link_note = 'manual-unlink'`, `linked_at = now()`.
2. Delete its `news.event_story` row.

Then per affected event:

- **Now empty** → delete the `Event` (`event_summary` + any remaining `event_story` cascade).
- **Still has sources** → set `event.updated_at = now()` so the synthesize pipeline
  re-summarizes from the reduced source set on its next run (reuses the existing staleness
  check; no special-casing).

Step 1 is what makes the correction **stick**: `rejected` keeps the link stage out (it only
touches `pending`); `film_id = NULL` keeps the cluster stage from re-attaching it.

### Identifier strategy

- **Per-source delink** → by `story.url` (globally unique; already present as `SourceOut.url`).
- **Whole-event delete** → by `event_id`. Because displayed sources are capped/deduped, the FE
  does not hold every source URL, so whole-event cannot be done by URL list. `event_id` is
  added to the public `EventOut` for everyone (an opaque UUID; grants non-admins nothing since
  the endpoints require an admin session).

### Backend (PR 1 — backend-only)

- **DTO:** add `event_id: UUID` to `EventOut`.
- **Service:** new `src/upmovies/link/moderation.py` — `delink_story(session, event_id, url)`
  and `delete_event(session, event_id)`. DB-I/O orchestration; caller owns the commit (matches
  existing router → service → repo layering).
- **Router:** new `routers/moderation_admin.py`, both endpoints guarded by
  `require_current_admin` (session cookie + `user.is_admin` — the human-facing admin mode, same
  as `/admin/runs`):
  - `POST /admin/events/{event_id}/delink` body `{ "url": "<story url>" }` — per-source.
    Resolves the story by URL, verifies it belongs to `event_id`. 404 on unknown event or
    URL, and 404 when the story exists but is not linked to that event (treated as
    not-found within the event).
  - `DELETE /admin/events/{event_id}` — whole event.
  - Both return a small summary, e.g. `{ delinked, event_removed, resummarize_queued }`.
- **Tests (integration, `session` fixture):**
  - delink that empties an event → event deleted;
  - delink that leaves a remainder → `event.updated_at` bumped, summary survives until
    re-synth;
  - whole-event delete → all stories rejected, event + summary + event_story cascade gone;
  - non-admin → 403; unknown event/url → 404;
  - stickiness — a subsequent link + cluster run leaves the story `rejected` and unattached.

### Frontend (PR 2 — frontend-only; blockedBy PR 1)

- **`api/types.ts`:** add `event_id` to `FilmEvent`.
- **`api/moderation.ts`:** `delinkSource(eventId, url)` and `deleteEvent(eventId)` via
  `apiFetch` (CSRF auto-attached).
- **`EventCard` / `SourceLinks`:** when `useAuth().user?.is_admin`, render the per-chip `×` and
  a "Remove event" button. Whole-event delete is confirmed via a Radix dialog
  ("Reject N sources and remove this event?"); per-source is immediate with a `sonner` success
  toast (error toast on failure). On success, **`useRevalidator().revalidate()`** re-runs the
  film loader so the page refreshes — the film page is a React Router framework-mode loader
  route (`routes/film.tsx`), **not** TanStack Query, so query invalidation does not apply.
- **Tests (Vitest + RTL + MSW, `meHandler({ is_admin })`):** controls render for admins only;
  clicking calls the correct endpoint and refreshes; anon / non-admin users see no controls.

**Out of scope for C:** relink-to-a-different-film; a dedicated admin moderation page; an audit
log beyond `link_note = 'manual-unlink'`.

---

## Linear shape (per project conventions)

- **A** — one backend ticket: *"Improve linker precision against untracked-franchise casting
  traps."*
- **C** — `Story`-labeled parent *"Admin: manually delink mislinked stories"* with:
  - **C1 (backend):** delink endpoints + service + `event_id` in `EventOut`.
  - **C2 (frontend):** admin delink controls + API client; `blockedBy` C1.
- 1 ticket = 1 PR. All assigned to the user. A and C are independent (no blocker between them).

## Immediate cleanup (outside this plan)

The live mislinked story is corrected directly on prod via a dry-run-first Python snippet run
in the backend container (no psql client on the VM): reject the story, delete its
`event_story`, delete the now-empty event. This snippet has been handed to the user to run; it
performs the exact operation that C1's service encapsulates.
