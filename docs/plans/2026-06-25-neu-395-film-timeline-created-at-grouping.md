**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m02-polish-existing-pages.md
**Depends on:** NEU-394

# NEU-395: Group film-page timeline by `created_at` (consistency switch) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development (write the failing test first), then superpowers:subagent-driven-development or superpowers:executing-plans to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/film/{slug}`, switch the event timeline's grouping, day labels, ordering, and the page-meta "latest summary" pick from the per-event `occurred_at` axis to `created_at` — the same axis the home feed already uses — so an event lands under the **same day** on the film page as it does on the feed. No visual change ships: same grouping algorithm, same headings, same `EventCard`; only *which* timestamp drives the day a given event lands under moves.

**Realizes (M2):** Story NEU-386 — *"Event dates are consistent between the home feed and film pages."* This is the **frontend half**. The backend half (NEU-394, the ticket this one is **blocked by**) renames the film-detail event DTO field `occurred_at` → `created_at` and orders the event log by `Event.created_at.asc()`. This ticket consumes that merged DTO contract and is the only FE consumer that must change in lockstep.

**Architecture:** Frontend-only, no backend change. NEU-394 already flipped the backend so `GET /films/{slug}` returns each event with a `created_at` instead of `occurred_at`, still ascending (the order the timeline relies on and reverses to newest-first). This ticket is a **mechanical field rename through the film-page read path**: the `FilmEvent` type, the day-bucketing helper (`groupEventsByDay`), the timeline React key, the `EventCard` `<time>` label, and the `film.tsx` meta "newest summary" sort all stop reading `event.occurred_at` and read `event.created_at`. The reverse-a-copy → bucket-adjacent grouping algorithm (deterministic, no `Date.now()`, SSR-safe) is untouched — only the field name it keys off moves.

**Tech Stack:** React 19 + TypeScript, react-router (framework mode, SSR), Tailwind v4, Vitest + Testing Library + MSW. Everything runs in the container via `task` (no host pnpm/vitest/eslint/tsc).

## Global Constraints

- **Frontend-only.** No backend, schema, DTO, or API change here — NEU-394 already shipped the DTO. Repo: `upcoming-movies-frontend` (under the `~/projects/upcoming-movies/` umbrella).
- **Prerequisite (merged DTO contract from NEU-394).** Each item in `FilmDetailResponse.events` now carries **`created_at`** and **no longer carries `occurred_at`**. Confirm this is live (NEU-394 merged) before starting — the FE type must match the real payload or the loader will deserialize an event whose `created_at` is `undefined`. All other event fields (`event_type`, `confidence`, `summary`, `sources`) are unchanged.
- **Branch:** the Linear-provided branch for NEU-395 (one ticket = one PR).
- **Run everything in the container via `task`** — never `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the `upmovies-frontend` container up.
- **Green before done:** `task test`, `task lint`, `task typecheck` must all pass; ESLint runs at **zero warnings** (an unused import fails the build); run `task format` on touched files only.
- **Determinism preserved.** Keep the render path pure — no `Date.now()` / argless `new Date()`. The existing `dayKey()` / `formatDayHeading()` (UTC-forced) and the reverse-a-copy bucketing stay exactly as they are; only their input field changes. SSR and client output must still match.
- **Don't regress what shipped.** NEU-371 (film-timeline day grouping) and NEU-369 (home-feed row density) are live. The grouping/SSR behavior is unchanged — this is a field rename, not an algorithm change. Existing grouping semantics (newest day first, within-day newest first, day headings, empty state) must keep passing once their fixtures use the renamed field.
- **Don't touch the feed.** The grouped-feed path (`groupByDay`, `FeedDayItem`, `src/routes/feed.tsx`) keys off its own `day` field and is unaffected. The per-event `FeedItem` DTO still carries both timestamps on the backend; nothing on the feed FE references the film-detail `occurred_at`.
- **Don't reformat unrelated files** (some files carry pre-existing Prettier drift on `main`). Format only what you touch.
- **Commits:** do NOT commit per task. Implement all tasks, get the full local CI green, then a **single** commit + one PR for the whole ticket. Conventional-commit subject with the Linear ID parenthetical; keep the `🤖 Generated with Claude Code` footer in the **PR body only** (never in the commit message); no `Co-Authored-By` trailer.

---

## The contract this consumes (from NEU-394)

State it precisely — the whole ticket hinges on it:

- **Field rename, not an additive field.** `EventOut` on the backend was renamed `occurred_at: datetime` → `created_at: datetime`. The FE `FilmEvent` type must mirror this exactly: rename the field, do **not** keep a now-dead `occurred_at`. Leaving `occurred_at` on the FE type would invite a future change to silently reintroduce the very feed/film divergence NEU-386 closes.
- **Ordering is unchanged in shape.** `GET /films/{slug}` still returns events ascending (now by `created_at`, tiebroken by `id`). The timeline's reverse-a-copy-to-newest-first logic is correct as-is against this axis.
- **Only the film-detail event shape changed.** No other endpoint, type, or component is affected.

---

## File Structure (all under `src/`)

| File | Change |
|---|---|
| `api/types.ts` | `FilmEvent.occurred_at: string` → `created_at: string` (the single source-of-truth rename). |
| `lib/feed-groups.ts` | `groupEventsByDay` buckets on `event.created_at`; update the docstring that names `occurred_at`. `groupByDay`/`FeedDayGroup` untouched. |
| `components/film/EventTimeline.tsx` | React `<li>` key reads `event.created_at`. |
| `components/film/EventCard.tsx` | `<time dateTime>` + `formatEventDate(...)` read `event.created_at`. |
| `routes/film.tsx` | `meta()` "latest summary" sort key → `created_at`; update the inline comment. |
| `lib/feed-groups.test.ts` | `event(...)` factory + assertions use `created_at`. |
| `components/film/EventTimeline.test.tsx` | `makeEvent` factory + per-test overrides use `created_at`. |
| `components/film/EventCard.test.tsx` | event fixture + the `dateTime` assertion use `created_at`. |
| `routes/film.test.tsx` | the `film` fixture (served via MSW `server.use`) + the out-of-order meta fixture use `created_at`. |

There are **no shared MSW handler fixtures** for film detail in `src/test/msw/` — the film-detail payload is built inline in `routes/film.test.tsx` and served per-test via `server.use(http.get(...))`. `src/api/public.test.ts` does not build an event fixture, so it needs no change (verify with a grep, below).

---

## Tasks (TDD: red → green per task)

> Across the FE, every `occurred_at` lives in exactly the files above. A quick inventory before and after: `task shell` then `grep -rn "occurred_at" src/` — at the end the only remaining hits should be **none** (the film-detail FE path no longer references it). Use this grep as the completeness check.

### Task 1 — Rename the type (compiler-driven red)

- [ ] In `src/api/types.ts`, rename the `FilmEvent` field `occurred_at: string` → `created_at: string`. Leave every other field and the rest of the file alone.
- [ ] Run `task typecheck`. **Expected red:** every consumer that still reads `event.occurred_at` (timeline key, EventCard `<time>`, `film.tsx` meta sort) and every test fixture that sets `occurred_at` now fails to compile. This compiler error list *is* the worklist for Tasks 2–3 — the type is the single point that forces the rest.

### Task 2 — Switch the consumers to `created_at`

- [ ] **`src/lib/feed-groups.ts`** — in `groupEventsByDay`, bucket on `dayKey(event.created_at)`. Update the function docstring that says input is "ascending by `occurred_at` (the order `GET /films/{slug}` returns)" to name `created_at`, and the trailing "UTC day key derived from `occurred_at`" line likewise. Leave `groupByDay`, `FeedDayGroup`, and the reverse-a-copy algorithm exactly as they are.
- [ ] **`src/components/film/EventTimeline.tsx`** — the `<li>` React key `${event.event_type}-${event.occurred_at}-${i}` → `${event.event_type}-${event.created_at}-${i}`.
- [ ] **`src/components/film/EventCard.tsx`** — `<time dateTime={event.occurred_at}>` and `formatEventDate(event.occurred_at)` both read `event.created_at`.
- [ ] **`src/routes/film.tsx`** — the `meta()` "latest summary" pick sorts `film.events` by the date field to grab the newest summary for the description; switch the sort comparator key from `occurred_at` to `created_at` (it stays an order-independent max-by-date; ISO-8601 strings still compare chronologically). Update the inline comment that names `occurred_at`.
- [ ] Run `task typecheck` again. **Expected:** the source-side compile errors clear; remaining errors (if any) are only in the test fixtures, fixed in Task 3.

### Task 3 — Update tests to the renamed field (TDD coverage)

These tests already prove the *behavior* NEU-371 shipped (newest-day-first grouping, within-day newest-first, day headings, the order-independent meta pick, the `<time>` label). The behavior is unchanged; only the fixture field name moves. Update fixtures/assertions so the same behavior is now driven by `created_at`, then watch them go green against the Task-2 source.

- [ ] **`src/lib/feed-groups.test.ts`** — the local `event(occurred_at, summary)` factory builds a `FilmEvent` with `occurred_at`; rename its param/field to `created_at` (and the "ascending by occurred_at" comment + the "derives ... from occurred_at" test name). The day-key/heading/ordering assertions stay identical — they now flow through `created_at`.
- [ ] **`src/components/film/EventTimeline.test.tsx`** — the `makeEvent` factory default and every per-test `occurred_at` override → `created_at`. The grouping/heading/within-day-order assertions are unchanged.
- [ ] **`src/components/film/EventCard.test.tsx`** — the `event` fixture's date field → `created_at`; the assertion `toHaveAttribute("dateTime", "...")` keeps the same value, now sourced from `created_at`.
- [ ] **`src/routes/film.test.tsx`** — the top-level `film` fixture's two events and the out-of-order `outOfOrder` meta fixture use `created_at`. This fixture is the **MSW payload** (served via `server.use(http.get(\`${BACKEND}/films/...\`, ...))`) for the loader/render tests, so renaming it keeps the MSW-intercepted film detail shaped exactly like NEU-394's DTO. The loader test, the "newest event's summary" meta test, and the "timeline newest-first" render test assertions are otherwise unchanged.
- [ ] Run `task test`. **Expected:** all of `feed-groups`, `EventTimeline`, `EventCard`, and `film` specs green; no other spec touched. Re-run the `grep -rn "occurred_at" src/` inventory and confirm **zero** remaining hits.

### Task 4 — Full verification + ship

- [ ] Run the full local CI gate and confirm green: `task test`, `task lint` (zero warnings — confirm no unused imports introduced), `task typecheck`.
- [ ] `task format` on touched files; `git status` shows only this ticket's files changed (no unrelated Prettier drift staged).
- [ ] *(Optional smoke)* With the stack up, open `https://app.upmovies.localhost/film/{slug}` for a film with events spanning multiple days and confirm the day a given event sits under matches the day it sits under on `/`. (Pre-NEU-394 data where `occurred_at` and `created_at` diverge is the most revealing.)
- [ ] Single commit on the ticket branch + one PR. Subject/PR title: `refactor: group film timeline by created_at for feed parity (NEU-395)` (or `feat:` if preferred). PR body ends with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer; no `Co-Authored-By`.

---

## TDD testing intent (what the suite proves)

- **Grouping keys off `created_at`** (`feed-groups.test.ts`): given an ascending-by-`created_at` event list, `groupEventsByDay` returns days newest-first and events newest-first within a day, with UTC day keys/headings derived from `created_at`. (Same assertions as NEU-371, field renamed.)
- **Timeline renders by `created_at`** (`EventTimeline.test.tsx`): newest-day-first grouping, per-day headings, and within-day newest-first all driven by the events' `created_at`.
- **Meta picks the newest by `created_at`** (`film.test.tsx`): with events listed out of array order, the meta `description` uses the summary of the event with the maximum `created_at` (order-independent), proving the sort key moved.
- **`<time>` labels `created_at`** (`EventCard.test.tsx`): the card's `<time dateTime=…>` and visible date come from `created_at`.
- **MSW fixtures match the NEU-394 DTO** (`film.test.tsx`): the film-detail payload served via `server.use` carries `created_at` (not `occurred_at`) on each event, so the loader→render path exercises the real post-NEU-394 shape end to end.
- **No regression:** the empty-state, source-link, confidence-badge, 404, and feed (`groupByDay`) tests are untouched and stay green; SSR determinism (no `Date.now()`) is preserved.

---

## Acceptance criteria

1. The film-page timeline groups, labels (`<time>` + day heading), and orders events by **`created_at`**; for any event, the day it appears under on `/film/{slug}` equals the day it appears under on `/` (both now `created_at`-derived).
2. The `FilmEvent` FE type exposes `created_at` and **no longer references `occurred_at`** — `grep -rn "occurred_at" src/` returns zero hits.
3. The `film.tsx` meta "latest summary" pick selects the newest event by `created_at`, order-independently.
4. No visual/behavioral change beyond the date axis: grouping algorithm, headings, `EventCard`, empty state, and SSR determinism are unchanged; the NEU-371/NEU-369 tests pass with only their fixture field renamed.
5. Frontend-only — no backend/DTO/API/migration change in the diff; the feed path (`groupByDay`, `FeedDayItem`, `feed.tsx`) is untouched.
6. `task test` / `task lint` (zero warnings) / `task typecheck` are all green; only this ticket's files changed.

---

## Key files touched

- `src/api/types.ts` — `FilmEvent.occurred_at` → `created_at` (the rename that drives everything else).
- `src/lib/feed-groups.ts` — `groupEventsByDay` buckets on `created_at`; docstring updated.
- `src/components/film/EventTimeline.tsx` — React key reads `created_at`.
- `src/components/film/EventCard.tsx` — `<time>` + `formatEventDate` read `created_at`.
- `src/routes/film.tsx` — meta "latest summary" sort key → `created_at`; comment updated.
- `src/lib/feed-groups.test.ts`, `src/components/film/EventTimeline.test.tsx`, `src/components/film/EventCard.test.tsx`, `src/routes/film.test.tsx` — fixtures/assertions (incl. the MSW-served film payload) renamed to `created_at`.
- *(reference only, not modified)* `src/lib/format.ts` (`dayKey`/`formatDayHeading`/`formatEventDate` are field-agnostic — they take an ISO string, so no change), `src/api/public.ts` / `src/api/public.test.ts` (no event fixture — verify via grep).

---

## Self-Review

**Spec coverage** (against NEU-395 + M2 §"Story NEU-386"):
- "`src/api/types.ts` — `FilmEvent.occurred_at` → `created_at`" → Task 1. ✓
- "`src/lib/feed-groups.ts` — bucket on `created_at`, update docstring" → Task 2. ✓
- "`EventTimeline.tsx` key" / "`EventCard.tsx` `<time>` + `formatEventDate`" → Task 2. ✓
- "`film.tsx` meta 'latest summary' pick switches sort key to `created_at`" → Task 2. ✓
- "Tests switch fixtures/assertions to `created_at`; MSW fixtures use the renamed field" → Task 3. ✓
- "Depends on NEU-394 (merged DTO contract)" → header `**Depends on:** NEU-394` + the "contract this consumes" section + the prerequisite global constraint. ✓
- "No visual change; grouping/SSR unchanged; don't regress NEU-371/369" → Global Constraints + AC 4. ✓

**Resilience:** the plan pins the *field rename* and *which files/symbols move* (load-bearing), but deliberately avoids transcribing exact code blocks/signatures — the type rename in Task 1 makes the TypeScript compiler enumerate the remaining edit sites, and the `grep -rn "occurred_at" src/` inventory is the objective completeness gate. This survives minor drift in the current source (e.g. line numbers, surrounding refactors from sibling tickets).

**Type consistency:** one rename at the `FilmEvent` source of truth; all consumers and fixtures follow. `groupByDay`/`FeedDayGroup`/`FeedDayItem` and `format.ts` helpers are field-agnostic and untouched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
