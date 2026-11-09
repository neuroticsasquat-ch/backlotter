# NEU-1468 — The home page stops flashing "All updates" at a reader who has a timeline

**Ticket:** [NEU-1468](https://linear.app/neuroticsasquatch/issue/NEU-1468/all-updates-page-flickers-into-view-before-my-feed-for-logged-in-users)
**Project:** bl: Maintenance (no milestone) · **Related:** NEU-1354 (the client-side swap this
amends, D-12), NEU-1410 (the nav that swaps with it), NEU-1392 (the `entitled` flag the hint
mirrors), NEU-1412 (the calendar's copy of the same swap, out of scope here)
**Target repo:** upcoming-movies-frontend only. **Base branch:** `release/v1.1.1` (the current
release branch; the skills resolve it from the checkout).
**Blocked by:** nothing · **Blocks:** nothing

## What to build and why

A signed-in, entitled reader loading `/` sees three paints: the global feed headed "All
updates", then the "My feed" skeleton, then their timeline. The header nav flips with it, from
"Updates" to "My feed" / "All updates". The same flash greets them after logging in.

This is not a bug in the swap; it is the swap working as NEU-1354 specified it. `/` server-renders
the global feed for everyone because the `["me"]` account query is client-only (the
**SSR-never-resolves-auth** invariant, `routes/public-layout.tsx`). `TimelineOrFeed` swaps to the
timeline only once `/me` has answered, and the spec forbade a loading state in the meantime so
the anonymous page would not regress into a spinner. Every full load of `/` by a subscriber
therefore starts as the anonymous page.

The fix is a **timeline hint**: a first-party cookie on the site origin that the browser writes
for itself when the account last resolved entitled. It proves nothing and grants nothing. It
lets the server render the timeline _skeleton_ instead of the global feed, so the document is
right from the first byte, and lets the nav render its two-item form from the first paint. Auth
is still resolved only on the client; the hint only picks which shell to show while that
happens.

### Ground truth from what shipped

- `routes/feed.tsx` loader → `loadGlobalFeed`, unchanged by NEU-1354 on purpose. The page
  component renders `TimelineOrFeed`, which reads `useFollowAccess()` and swaps to
  `TimelinePage` on `"ready"`, else renders `GlobalFeed` (the SSR'd feed).
- `useFollowAccess()` (`components/follow/access.tsx`) has three states: `anonymous` (no user,
  which is also what SSR and the first client paint see), `locked`, `ready`. It reads only
  `useAuth().user`.
- `navItemsFor(access)` (`components/layout/nav-items.ts`) renders `[My feed, All updates,
Calendar]` for `ready` and `[Updates, Calendar]` otherwise. `PrimaryNav` and `MobileMenu`
  both call it under the public layout's `AuthProvider`.
- `TimelinePage` owns `TimelineSkeleton` (module-private today): the "My feed" heading, the
  section-split explainer, and three pulsing day blocks under `aria-label="Loading your
timeline"`.
- `AuthProvider` writes `["me"]` in four places: the query function (success, and `null` on
  401), `login` and `signup` `onSuccess`, and `logout` `onSuccess`. `Settings` and `Verify`
  also `setQueryData(["me"], …)` but never change `entitled`.
- Three separate `QueryClient`s hold their own `["me"]`: `publicQueryClient` (public layout),
  `spa-layout.tsx`'s client, and `accountQueryClient` (the header's avatar island). After a
  login in the SPA, the public client is cold or holds a stale `null`; `refetchOnMount:
"always"` refetches, but the cached `null` renders first. That is the post-login flash.
- The session cookie is host-only on `api.backlotter.com` (`COOKIE_DOMAIN` unset), so the Worker
  on `backlotter.com` cannot see it. Nothing sets `Cache-Control` on `/`; the "cacheable
  document" rationale in NEU-1354 is aspirational today.
- The existing test "shows no loading state while /me is still in flight"
  (`routes/feed.test.tsx`) pins the anonymous behaviour. It stays: it is the no-hint case.

## Decisions

- **D-1468.1 The timeline hint is a first-party cookie the browser writes for itself.**
  `timeline_hint=1`, `Path=/`, `SameSite=Lax`, `Secure` when the page is `https:`, `Max-Age` 30
  days (the backend's `SESSION_TTL_DAYS` default), re-stamped on every entitled resolve so it
  slides with the session. Written via `document.cookie` from a small `lib/timeline-hint.ts`
  (`writeTimelineHint(user)`, `readTimelineHint(cookieHeader | document.cookie)`). The backend
  cannot set it: its cookies live on the API origin. Its value carries nothing — presence is the
  hint.
- **D-1468.2 It is written from resolved accounts only, in `AuthContext`.** `writeTimelineHint`
  is called at the four `["me"]` writers in `AuthProvider`: query function success (set when
  `user.entitled`, else clear), query function 401 (clear), `login`/`signup` `onSuccess` (set or
  clear on `entitled`), `logout` `onSuccess` (clear). An unresolved or errored query never
  touches it. `Settings`/`Verify` do not call it: they cannot change `entitled`. Calling it
  synchronously in `login`'s `onSuccess` matters: `Login` navigates to `/` after that resolves,
  and the loader that runs for that navigation must already see the cookie.
- **D-1468.3 The server reads it in a new `routes/public-layout.tsx` loader.** The loader does
  nothing but parse the request's `Cookie` header: `{ timelineHint: boolean }`. No fetch. It
  runs on the document request and on every client navigation _into_ the public subtree (so the
  post-login landing sees the cookie), and not on navigations within it (where `["me"]` is
  warm). A `useTimelineHint()` hook reads it via `useRouteLoaderData("routes/public-layout")`;
  when there is no such loader data (the SPA subtree, which renders client-only behind a null
  `HydrateFallback`) it reads `document.cookie` directly, which is safe there because nothing in
  that subtree is server-rendered. The SSR document and the first client paint therefore agree
  by construction; a hydration mismatch is impossible in either subtree.
- **D-1468.4 `useFollowAccess()` gains a fourth state, `hinted`.** Returned when there is no
  user, the hint is present, and an account read is in flight. `AuthContext` exposes
  `resolving: boolean` (`meQuery.isFetching`) for the last clause. Order of precedence:
  a cached user wins (`ready`/`locked` as today); no user and hint and resolving → `hinted`; no
  user otherwise → `anonymous`. So a cold cache with the cookie is `hinted`; a stale cached
  `null` with a refetch in flight and the cookie is `hinted` (the post-login case); a hint with
  no fetch in flight — the read failed, or answered 401 — is `anonymous`.
- **D-1468.5 Two consumers act on `hinted`; every other one treats it as `anonymous`.**
  `TimelineOrFeed` renders `TimelineSkeleton` (exported from `TimelinePage`, unchanged in
  markup). `navItemsFor` renders the two-item nav for `hinted` as it does for `ready`. Follow
  buttons, `LockedPanel` callers, `CalendarView` (`tabbed = access === "ready"`) and anything
  else keep their anonymous rendering until the account resolves. The type is widened, not the
  callers' behaviour: an exhaustiveness check that only lists three states must be updated to
  name `hinted` explicitly and route it to the anonymous branch.
- **D-1468.6 The loader for `/` still fetches the global feed when hinted.** One loader, one
  code path. A stale hint (session expired, grant lapsed) then falls back from the skeleton to
  the SSR'd global feed with no extra request and no notice: the reader simply sees the page
  an anonymous visitor sees, and the header's account menu already says whether they are
  signed in. The cost is one signed backend call per subscriber load that usually goes unused.
- **D-1468.7 The timeline request stays sequential.** `useTimeline` remains gated on a resolved,
  entitled account. Nothing is prefetched on the hint, so nothing new can 401/403 into the
  cache and `TimelinePage`'s lapsed-grant refresh keeps its single trigger. The skeleton covers
  the extra round trip.
- **D-1468.8 D-12 is amended, not replaced.** "`/` always server-renders the global feed"
  becomes "`/` always _loads_ the global feed and server-renders either it or the timeline
  skeleton, chosen by the timeline hint; auth is still never resolved server-side". Recorded
  as frontend ADR-0001 (`docs/adr/0001-timeline-hint-cookie.md`). No backend PR: the backend
  copy of D-12 (`../backend/docs/specs/bl-consumer-pivot-project-spec.md`) points at
  NEU-1354's spec, and this spec plus the ADR are the record. If `/` is ever edge-cached, the
  cache key must vary on the `timeline_hint` cookie; note that beside the ADR, not as work here.

## Acceptance criteria

All in `upcoming-movies-frontend`; `task test && task lint && task typecheck` green, prettier-clean.

**The cookie (`lib/timeline-hint.ts`, `AuthContext`)**

- `writeTimelineHint` sets the cookie with the attributes in D-1468.1 for an entitled user and
  expires it (`Max-Age=0`) for `null` or an unentitled user; `readTimelineHint` answers `true`
  only when `timeline_hint` is present in the header or `document.cookie` it is given.
- Rendering `AuthProvider` with `/me` answering entitled writes the cookie; answering
  unentitled or 401 clears it; `logout()` clears it; `login()` of an entitled account writes it
  before `login` resolves.

**The loader and hook (`routes/public-layout.tsx`)**

- The layout loader returns `{ timelineHint: true }` for a request whose `Cookie` header
  carries `timeline_hint=1` and `{ timelineHint: false }` otherwise, and makes no fetch.
- `useTimelineHint()` reads the loader data when present and `document.cookie` when not.

**The access state (`components/follow/access.tsx`)**

- With the hint and `/me` held open, `useFollowAccess()` is `hinted`; without the hint it is
  `anonymous`. Once `/me` answers, it is `ready`/`locked`/`anonymous` exactly as today, hint or
  no hint.

**The home page (`routes/feed.test.tsx`)**

- With the hint and `/me` held open then answering entitled: the "My feed" heading and the
  `Loading your timeline` region are up before `/me` answers; the "All updates" heading is
  never rendered; the timeline's days land afterwards.
- With the hint and `/me` answering 401: the skeleton, then the SSR'd global feed with its
  days; no `/me/timeline` request; no error UI.
- With the hint and `/me` answering unentitled: the global feed, and the cookie cleared.
- Without the hint: every existing test unchanged, including "shows no loading state while
  /me is still in flight".
- The post-login shape: a query client holding `["me"] = null`, the hint set, and a refetch in
  flight renders the skeleton, not the global feed.

**The nav (`PrimaryNav` / `MobileMenu`)**

- With the hint while `/me` is in flight, the nav lists "My feed" and "All updates"; when `/me`
  then answers 401, it collapses to "Updates". Without the hint it lists "Updates" throughout.

**The server render**

- Rendering `/` through the server entry with a `Cookie: timeline_hint=1` header produces the
  skeleton markup (the "My feed" heading, no "All updates"); without the header it produces the
  global feed as today. Hydrating either in a test emits no hydration warning.

## Out of scope

- **The header's account island** (`HeaderAccount`, its own `accountQueryClient`): the avatar
  menu still shows its anonymous form until _its_ `/me` answers. Same flicker class, separate
  island; would need the hint to render a neutral avatar. Reopen if it grates.
- **`/calendar`'s tab strip** (NEU-1412, `CalendarView`): appears after `/me` resolves, same
  class. Treating `hinted` as tabbed would show a "My films" tab whose query is gated on
  `entitled`, so it needs its own decision about what the pending tab holds.
- **Follow buttons** on film/person/studio/franchise pages: they keep their anonymous look during
  `hinted` by D-1468.5.
- **Unifying the three `QueryClient`s** so `/me` is fetched once per page rather than up to
  twice. The hint papers over the visible symptom; the duplicate read remains.
- **Prefetching the timeline on the hint** (D-1468.7) and **skipping the global feed fetch when
  hinted** (D-1468.6): both rejected for now, both cheap to revisit.
- **Edge caching of `/`** and any `Cache-Control` on it.
- Any backend change.
