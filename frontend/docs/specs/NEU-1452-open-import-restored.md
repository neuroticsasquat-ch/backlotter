# NEU-1452 — An open import is restored on `/welcome` and announced on the timeline

**Ticket:** [NEU-1452](https://linear.app/neuroticsasquatch/issue/NEU-1452/frontend-an-imports-review-list-is-lost-once-the-user-leaves-welcome)
**Project:** bl: Entity Follows · **Milestone:** M5 — Imports you review · **Story:** NEU-1427
**Blocked by:** NEU-1453 (`GET /me/import/active`, spec `../../../backend/docs/specs/NEU-1453-me-import-active.md`) — deploy it first
**Related:** NEU-1449 (two-phase job, backend PR #366), NEU-1450 (review list, frontend PR #171, whose review found this gap)
**Decisions honoured:** EF-22 (the import is two-phase; a new import discards an unconfirmed one), D-17 (`/welcome` is re-enterable and every step is skippable), D-41 (a locked account is told, not walked into 403s)
**Target repo:** upcoming-movies-frontend · **Base branch:** `release/v1.0.0`
**Glossary:** the backend's `CONTEXT.md` — *Import*, *Open import*

## What to build and why

An import that reaches `awaiting_review` follows nothing until the user confirms its list. Today
the list lives only in `pages/Welcome.tsx`'s `jobId` state. A reload, leaving `/welcome`, or
going Continue → Done → timeline drops it, and the job sits open, unannounced, until the next
upload supersedes it.

Planned 2026-09-23, choosing **option B** of the ticket: the backend answers "the caller's open
import" (NEU-1453), so the id no longer has to survive in the browser. Two surfaces use it:

1. **`/welcome` restores the open import.** On mount, an entitled user's open job — `queued`,
   `running` or `awaiting_review` — becomes `jobId`, so `ImportStep` renders its progress bar or
   its review list exactly as if it had just been started here.
2. **The timeline announces a waiting list.** While a job is `awaiting_review`, `/` shows a
   one-line notice linking to `/welcome`. The timeline is where Done sends the user, and where an
   empty feed would otherwise read as the import having done nothing.

Option A (remembering both job ids in localStorage) was rejected: the backend half of B is one
route over an existing query, and A would have kept the per-browser limitation for the one case
that matters.

## The API layer

`api/imports.ts` gains:

- `fetchActiveImport(): Promise<ImportJob | null>` — `GET /me/import/active`. `apiFetch`
  returns `undefined` for the 204; this function must turn it into `null`, because TanStack
  Query rejects a query function that resolves to `undefined`.
- `useActiveImport(enabled: boolean)` — `useQuery` on `activeImportKey`, `retry: false` for the
  same reason `useImportJob` has it (a 403 for a lapsed grant is permanent). No polling: the
  restored job's own `useImportJob` poll takes over on `/welcome`, and the timeline notice is a
  once-per-mount read.

`api/query-keys.ts` gains `activeImportKey = ["me", "import", "active"]`. Under the `["me"]`
prefix on purpose, unlike `importJobKey`: which import is open is a property of the account, so
`AuthContext.refresh()` (login, logout, entitlement flip) should re-read it. Add a sentence
beside `importJobKey`'s comment saying why the two differ.

**Every mutation that changes which job is open touches the key:**

| Mutation | Effect on `activeImportKey` |
|---|---|
| `useConfirmImport` success | `setQueryData(activeImportKey, null)` — the confirm closes the only open job, and the timeline notice must not survive a navigation to `/` from a cache that still says `awaiting_review` (same-route staleness has bitten this codebase before) |
| `useConfirmImport` 409 | invalidate, alongside the existing job refetch |
| `useStartLetterboxdImport` success, `useSubmitTmdbApproval` success | invalidate — a new job is open and any old one is superseded |

## `/welcome`

In `pages/Welcome.tsx`:

- Call `useActiveImport(access !== "locked")`. A locked account never calls the route: it would
  403, and `LockedWelcome` is the whole page for that account (D-41).
- When it answers a job **and `jobId` is still `null`**, seed the poll's cache with the answer
  (`qc.setQueryData(importJobKey(job.id), job)`) and `setJobId(job.id)`. Seeding avoids a second
  request and a flash of the empty step before the list appears.
- The `jobId === null` guard is what settles the race with the TMDB return leg: if the callback's
  202 lands first, the new job wins and an older open job the read may still answer with is
  ignored (it is superseded server-side anyway). If the read lands first and restores an old
  job, the callback's later `setJobId` replaces it, which is correct for the same reason.
- The read failing (network, 5xx) restores nothing and shows nothing. The upload box still works
  and a new upload supersedes whatever was open, so there is nothing the user must be told.
- No new copy on `/welcome`. `ImportReview`'s "Here is what we found on your watchlist" already
  reads correctly for a list the user is returning to; `RunningProgress` likewise.
- The flow still starts at step 0 on every mount (D-17). A restored job renders in step 0's
  `ImportStep` and rides along to steps 1 and 2 as today.

## The timeline notice

A new component, `components/onboarding/PendingImportNotice.tsx`, rendered by
`components/feed/TimelinePage.tsx` between `TimelineHeading` and the content, in both the empty
and the populated state, in the final (non-skeleton, non-error) return only. `TimelinePage` is
only mounted for entitled readers, so it calls `useActiveImport(true)`.

- Renders **only** when the read answered a job whose `status` is `awaiting_review`. A `queued`
  or `running` job shows nothing here: the user has nothing to do yet, and the panel that shows
  progress is `/welcome`'s.
- One sentence and a link, no count: "Your import is waiting for you to review its list. Nothing
  is followed until you confirm it." with a `Link` to `/welcome` reading "Review the list".
  No count, because a list whose rows are all greyed (every title out of window or unmatched)
  still has to be confirmed, and "0 films to review" would read as nothing to do.
- Quiet styling in keeping with the page (a bordered `bg-muted/30` block like `ImportProgress`),
  `role="status"`.
- Nothing while the read is pending or failed.

## `lib/tmdb-import.ts` and `TmdbConnect`

Unchanged in behaviour. `TmdbConnect` still reads the remembered TMDB job id for its "Last
imported from @user" line, which needs a *succeeded* job and so cannot come from the active
read. Narrow the module's doc comment: the per-browser caveat now applies to the provenance line
only, and an open import is found through `GET /me/import/active` (NEU-1453) instead. If the
remembered id and the restored job are the same job, they share `importJobKey` and one poll.

## Acceptance criteria

`pages/Welcome.test.tsx`, with a `GET /me/import/active` handler added to `test/msw/imports.ts`:

1. The route answering an `awaiting_review` job with candidates: a fresh mount renders that job's
   review list on step 0, and confirming it renders the succeeded report, invalidates follows,
   and sets the active cache to `null` (assert a later `/` mount shows no notice without a
   second request, or assert the cache entry directly).
2. The route answering a `running` job: the progress bar renders and the poll continues.
3. The route answering 204: the upload box, no progress panel, no alert.
4. The route answering 500: identical to 3. Nothing restored, no alert.
5. A locked account: the handler is never hit.
6. Arriving from TMDB with an approved token while the route answers an older open job: the
   review shown is the callback's new job, not the old one.

`components/feed/TimelinePage.test.tsx` (or wherever the timeline page's tests live):

7. `awaiting_review` → the notice renders with a link to `/welcome`.
8. `running` and 204 → no notice. The feed renders as today in both.

`api/imports.test.ts` (or the nearest api test): `fetchActiveImport` maps a 204 to `null`.

Before claiming done: `task format`, then `task test && task lint && task typecheck`, in the
container.

## Deploy

After NEU-1453. The frontend calls the route on every `/welcome` and timeline mount, so against
a backend without it every entitled reader would see a 404 from the active read — silent by
this spec's rules, but wasted. Backend first, then this.

## Out of scope

- Clock-based expiry of `awaiting_review` jobs (project spec §8).
- An app-wide or header notice. The timeline is the one page; widen it later if it proves
  insufficient.
- Retiring `lib/tmdb-import.ts`. It needs a "latest job of any status" read the backend was
  deliberately not given (NEU-1453 spec, out of scope).
- Warning before a new upload supersedes a waiting list. Today it supersedes silently, and the
  superseded panel copy already explains what happened.
- Renaming the account menu's "Redo onboarding" item.
