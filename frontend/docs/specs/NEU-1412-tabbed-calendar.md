# NEU-1412 — Tabbed calendar: the reader's watchlist by default, all releases alongside

**Ticket:** [NEU-1412](https://linear.app/neuroticsasquatch/issue/NEU-1412/tabbed-calendar-the-readers-watchlist-by-default-all-releases)
**Project:** bl: Consumer Pivot (no milestone) · **Related:** NEU-1410 (page heading is "Calendar", merged PR #152)
**Blocked by:** NEU-1411 (`GET /me/calendar`, **Done**, backend PR #346, spec `../backend/docs/specs/NEU-1411-me-calendar-json.md`) · **Blocks:** nothing
**Decisions honoured:** D-12 (the SSR'd document is the anonymous one; who is looking is decided on the client), D-13 (follows produce timeline rows only), D-34 (the calendar is the watchlist's), D-37/D-39/D-41 (closed by default; a 403 is a state to render, not a failure to report)
**Target repo:** upcoming-movies-frontend · **Base branch:** `release/v1.0.0`
**Glossary:** `CONTEXT.md` — *All-releases calendar*, *Watchlist calendar*, *Calendar tab* (seeded by this ticket; the backend's `CONTEXT.md` owns the set and the date rule)

## What to build and why

`/calendar` is one page today: the all-releases calendar, server-rendered for everyone. NEU-1411
gave the backend a JSON form of the reader's own calendar, so the page can now show an entitled
reader the films *they* are waiting for, without giving up the public page that anonymous
visitors and search engines see.

For an **entitled** reader the page gains two tabs under its heading and opens on the first:

| Tab | Source | Set |
|---|---|---|
| **My watchlist** (default) | `GET /me/calendar` via `apiFetch` | the reader's watchlist items, derived ones included; never the follow graph |
| **All releases** | the loader's `GET /calendar` (already SSR'd) | every tracked film |

For everyone else — anonymous, or signed in without a live grant — the page is **exactly what it
is today**: the all-releases calendar, no tab strip, no locked tab, no disabled tab. The
subscription pitch is NEU-1409's and lives on the feed routes, not here.

Both tabs render the same rows through the same grouping, page the same way, and differ in one
thing only: which fetcher is called.

### Ground truth from what shipped (NEU-1411)

Design against the endpoint as merged, not the ticket text:

- `GET /me/calendar?limit=&offset=` answers `CalendarResponse` — the exact type
  `api/types.ts` already declares for `/calendar`. Nothing to add to `types.ts`.
- `limit`/`offset` count **distinct release dates**, soonest first, and `total` is the number
  of distinct upcoming dates for this user. Default limit 20, max 200. Same meaning as the
  public route, so `DATES_PER_PAGE = 20` and `offset = dayGroups.length` carry over unchanged.
- Upcoming-only (`governing_date >= today`), no popularity/runtime/adult cuts, slug required.
  A film with a theatrical and a digital date is two rows on two dates.
- 401 anonymous; 403 `{"detail": "entitlement_required"}` for a signed-in reader without a
  grant — `isEntitlementError` in `api/me.ts` already recognises it; **200 with
  `items: [], total: 0`** for an empty watchlist or one with nothing upcoming. Empty is not an
  error and must not render as one.
- Read-only, cookie-authed, no CSRF. `apiFetch` sends credentials.

## Design

### D-1412.1 — The tab is component state, and the SSR'd document never changes

The loader keeps fetching the public calendar with `ssrOriginHeaders`, exactly as it does now.
The server render, and the first client paint, are the anonymous branch: `useFollowAccess()`
returns `"anonymous"` until the `["me"]` query resolves, which it never does during SSR
(`routes/public-layout.tsx` invariant). So the tab strip and the watchlist panel appear only on
the client, after the account lands, and there is no hydration mismatch — the same shape of
decision `TimelineOrFeed` makes for `/`.

The active tab is `useState` inside the page, defaulting to **My watchlist** whenever the tabs
exist at all. It is **not** a query parameter and **not** remembered in `localStorage`:
`/calendar` stays one indexable URL, the nav item lands an entitled reader on their own films
every time, and nothing about the document depends on who is looking.

*Rejected:* `?tab=all` (a second URL for the same page that would need canonicalising and
ignoring during SSR); remembering the last tab per browser (persistence nobody asked for).

### D-1412.2 — Both panels stay mounted; the inactive one is `hidden`

The tab strip follows the pattern already in `FollowEntitySearch` and `AdminResolution`:
hand-rolled `role="tablist"` / `role="tab"` buttons with `aria-selected` and `aria-controls`,
no new UI primitive. Each panel is a `role="tabpanel"` with `aria-labelledby` pointing at its
tab, and the inactive panel carries the `hidden` attribute rather than being unmounted.

Consequences, chosen deliberately:

- **Paging survives a switch.** "View more" progress on either tab is kept when the reader
  looks at the other and comes back.
- **The SSR'd public calendar is never refetched.** The All releases panel is the same component
  instance the anonymous render already produced, holding the loader's data; switching tabs
  costs no request.
- **The watchlist request fires as soon as the tabs exist**, even if the reader immediately
  clicks All releases. One request, for the reader's own calendar, is the right price for the
  two points above.

### D-1412.3 — The watchlist calendar is cached under the watchlist

`api/query-keys.ts` gains:

```ts
/** Under `watchlistKey`, not beside `timelineKey`: the watchlist calendar is a view of the
 *  watchlist, so adding or removing a film — which already invalidates the `["me","watchlist"]`
 *  prefix — must refresh it without any new wiring, and a re-read of the account, which is what
 *  flips `entitled`, drops it with the collection it belongs to. */
export const watchlistCalendarKey = [...watchlistKey, "calendar"] as const;
export const watchlistCalendarPageKey = (limit: number, offset: number) =>
  [...watchlistCalendarKey, limit, offset] as const;
```

`useToggleWatchlist` and `useUpdateAlertPrefs` already call
`qc.invalidateQueries({ queryKey: watchlistKey })` on settle; because that is a prefix match,
the calendar pages refetch with no change to those mutations. `AuthContext.refresh()`
invalidates `["me"]`, so a lapsed or restored grant refreshes it too.

*Rejected:* a standalone `["watchlist-calendar", …]` key on the timeline's reasoning about paged
keys. The timeline is invalidated by *follow* mutations, which have no natural prefix over it;
the calendar has one, and using it is cheaper and harder to forget than an extra
`invalidateQueries` in two mutations.

### D-1412.4 — One fetcher and one hook in `api/me.ts`, shaped like the timeline's

```ts
/** One page of the reader's watchlist calendar (NEU-1411): `/calendar`'s exact shape, narrowed
 *  to their watchlist. Pages count distinct release dates, as the public route's do. */
export const fetchWatchlistCalendar = ({ limit, offset }: { limit: number; offset: number }) =>
  apiFetch<CalendarResponse>(`/me/calendar?limit=${limit}&offset=${offset}`);

export function useWatchlistCalendar({ limit, offset }: { limit: number; offset: number }) {
  const enabled = useFollowGraphEnabled();
  return useQuery({
    queryKey: watchlistCalendarPageKey(limit, offset),
    queryFn: () => fetchWatchlistCalendar({ limit, offset }),
    enabled,
    staleTime: 60_000,
    refetchOnMount: "always",
  });
}
```

`refetchOnMount: "always"` for the timeline's reason: the reader goes to a film page, adds it to
the watchlist, comes back, and the calendar they return to has to show it. The mutation's
invalidation covers the case where they never leave.

Pages 2+ are fetched imperatively with `fetchWatchlistCalendar` and appended in local state
stamped with the first-page response they were appended to, exactly as `TimelinePage` does
(`more.from === first.data`), so a refreshed page one drops them rather than splicing dates from
two different watchlists together.

### D-1412.5 — Extract the rendering; fork nothing

`routes/calendar.tsx` currently inlines the year → month → day → bucket tree and its own "View
more" button. Move that tree into **`components/calendar/CalendarDateGroups.tsx`**:

```ts
export function CalendarDateGroups({ items }: { items: CalendarItem[] })
```

It calls `groupByReleaseDate` and `nestByYearMonth` and renders `CalendarFilmRow` per film,
with the sticky year/month headings unchanged. Both panels render it. The inline button is
replaced by the existing `ViewMoreButton` from `components/feed/FeedDayGroups` (same markup,
same "Loading…"/"View more" labels); importing it across feature folders is acceptable here and
moving it to `components/ui/` is welcome but not required.

Nothing in `lib/calendar-groups.ts`, `CalendarFilmRow.tsx` or `release-labels.ts` changes.

### Component structure

```
routes/calendar.tsx
  loader        — unchanged (public calendar, signed SSR fetch, DATES_PER_PAGE)
  meta          — unchanged (`<title>` stays "Release Calendar"; NEU-1410 left titles alone)
  CalendarPage  — <main> + <h1>Calendar</h1> + <CalendarView calendar={loaderData.calendar} />
  ErrorBoundary — unchanged (a loader failure is a public-calendar failure)

components/calendar/CalendarView.tsx
  CalendarView({ calendar })
    access = useFollowAccess()
    access !== "ready" → <AllReleasesCalendar calendar={calendar} />          (no tab strip)
    access === "ready" → tab strip + two mounted panels, My watchlist selected

  AllReleasesCalendar({ calendar })
    today's page body minus the heading: loader items + loadMore via
    getCalendar(env.apiBaseUrl, { limit: DATES_PER_PAGE, offset: dayGroups.length })
    — browser-side, so no signing headers (existing test guards this).
    Empty copy unchanged: "No upcoming releases yet — check back soon."

  WatchlistCalendar({ onShowAllReleases })
    first = useWatchlistCalendar({ limit: DATES_PER_PAGE, offset: 0 })
    lapsed = first.isError && isEntitlementError(first.error) → void refresh()  (see below)
    isPending || lapsed → skeleton (aria-busy, aria-label "Loading your watchlist calendar")
    isError            → WatchlistCalendarUnavailable
    total === 0        → EmptyWatchlistCalendar
    else               → <CalendarDateGroups items /> + <ViewMoreButton />
```

`DATES_PER_PAGE` moves out of the route module to wherever both panels can import it
(`lib/calendar-groups.ts` or a `lib/calendar.ts` beside `lib/global-feed.ts`'s
`DAYS_PER_PAGE`); the loader keeps using it.

### The tab strip

- Container: `role="tablist"` with `aria-label="Calendar view"`, rendered directly under the
  `<h1>`, styled like `AdminResolution`'s strip (underlined/bordered current tab, muted others).
- Tabs, in this order and with these exact labels: **My watchlist**, **All releases**. Never a
  label built on "follow".
- Each tab: `role="tab"`, `type="button"`, `aria-selected`, `aria-controls` → its panel id,
  `id` → referenced by the panel's `aria-labelledby`. Click selects; no keyboard roving-tabindex
  work beyond what the two existing strips do.
- Panels: `role="tabpanel"`, `hidden` when inactive (D-1412.2).

### The three watchlist states that must not be confused

**Empty** — an entitled reader whose watchlist has nothing upcoming. Own copy, an instruction
rather than an apology, a button that switches to the other tab (it is a tab change, so a
`<button>`, not a `<Link>`), and the onboarding link the timeline's empty state also uses:

> **Nothing on your watchlist has a date yet.**
> Add films from any film page, or import your watchlist to fill this in.
> [Browse all releases] (button → All releases tab) · [Get started] (link → `/welcome`)

**Unavailable** — the request failed for any reason other than the entitlement 403. Distinct
copy, same tab-switch button, no `/welcome` link (sending someone to import films because a
request failed names the wrong problem):

> We couldn't load your watchlist calendar just now.
> Please try again in a moment — every release is still on the other tab.
> [Browse all releases] (button → All releases tab)

**Lapsed grant** — the request came back 403 `entitlement_required` because the cached
account still said `entitled`. Handled as `TimelinePage` handles it: `void refresh()` from
`useAuth`, show the skeleton meanwhile. The re-read flips `entitled` to false,
`useFollowAccess()` becomes `"locked"`, and `CalendarView` re-renders as the tab-less public
calendar. No error copy is ever shown for this case.

### What does not change

- The loader, its signing headers, its page size, and every existing loader test.
- `meta()`: title "Release Calendar", description, canonical.
- `ErrorBoundary` and its copy.
- The public empty state and its copy.
- `CalendarFilmRow`, `lib/calendar-groups.ts`, `release-labels.ts`, `api/public.ts`.
- `api/types.ts` — `CalendarResponse` is already the right type.

## Acceptance criteria

Tests live in `routes/calendar.test.tsx` (extended), `components/calendar/CalendarView.test.tsx`
(new, or fold into the route test), `api/me.test.ts` and `api/query-keys` coverage as noted.
Because `CalendarView` calls `useAuth`, **every render test of `CalendarPage` now needs
`QueryClientProvider` + `AuthProvider` and a `/me` handler**, the way `routes/feed.test.tsx`'s
`renderHome` does; the existing render tests are re-wrapped with `unauthMeHandler()` and must
keep passing unchanged in what they assert. A `test/msw/calendar.ts` with `/me/calendar`
handlers (populated, empty, locked, failing) beside `test/msw/timeline.ts` is the expected
shape.

1. **Anonymous:** no `tablist` in the document; the SSR'd rows render; `/me/calendar` is never
   requested.
2. **Signed in, unentitled** (`meHandler({ entitled: false })`): same as 1 — no tab strip, no
   locked or disabled tab, no `/me/calendar` request.
3. **Entitled** (`meHandler({ entitled: true })`): a `tablist` labelled "Calendar view" with two
   tabs "My watchlist" and "All releases"; "My watchlist" has `aria-selected="true"`; the
   watchlist rows render from the `/me/calendar` response; the All releases panel is in the DOM
   and `hidden`.
4. **Loader never touches `/me/calendar`:** the loader tests stay as they are; a loader call
   with no `/me/calendar` handler registered does not error (MSW's `onUnhandledRequest:
   "error"` is the guard).
5. **Switching to All releases** shows the loader's rows without any request to `/calendar`
   (register a handler that records calls; assert zero).
6. **Paging survives a switch:** on My watchlist with `total: 2`, click View more, switch to
   All releases, switch back — the second date is still rendered and `/me/calendar` was called
   exactly twice (offsets 0 and 1).
7. **Watchlist paging** requests `offset = number of dates rendered`, `limit = 20`, with
   credentials and without the SSR signing headers.
8. **Empty watchlist** (`{ items: [], total: 0 }`): the empty copy renders; "Browse all
   releases" switches the tab (assert `aria-selected` moves and the public rows are visible);
   "Get started" links to `/welcome`. The unavailable copy is absent.
9. **Failed load** (500): the unavailable copy renders; the empty copy and the `/welcome` link
   are absent; "Browse all releases" switches the tab.
10. **Lapsed grant:** `/me` first answers `entitled: true`, `/me/calendar` answers 403
    `entitlement_required`, `/me` then answers `entitled: false` — the tab strip disappears
    and the public rows render, with neither empty nor unavailable copy ever shown.
11. **Watchlist mutation refreshes the tab:** after `useToggleWatchlist` settles, the
    `/me/calendar` page-one query is refetched (assert a second request, or assert
    `watchlistCalendarPageKey(20, 0)` starts with `watchlistKey`).
12. **Fetcher:** `fetchWatchlistCalendar({ limit: 20, offset: 1 })` requests
    `/me/calendar?limit=20&offset=1` through `apiFetch`.
13. **Refactor is invisible:** all existing calendar render assertions (date headings, bucket
    labels, links, poster count, DOM order, home-release labels, multi-month headings, View
    more, empty copy, error boundary) pass after `CalendarDateGroups` is extracted.
14. `task test`, `task lint` (zero warnings), `task typecheck` green; changed files
    prettier-formatted.

## Out of scope / deferred

- **The subscription offer on this page** for unentitled readers — NEU-1409 owns that copy
  and puts it on the feed routes; the calendar shows nothing extra to them.
- **A tab in the URL, or a remembered tab** — D-1412.1.
- **Per-row watchlist controls** (remove, alert prefs) on calendar rows — `CalendarItem` is the
  shared public shape and carries no user fields (NEU-1411 out-of-scope list). If wanted, it is
  a backend DTO change first.
- **Past or recently-released dates on the watchlist tab** — the endpoint is upcoming-only by
  decision D-1411.1.
- **Renaming `<title>` from "Release Calendar"** — NEU-1410 chose to leave titles and
  descriptions alone for SEO; same here.
- **Keyboard arrow-key navigation between tabs** — neither existing tab strip does it; a
  shared accessible tabs primitive would be its own ticket.
- **Prefetching `/me/calendar` from the nav** or on hover — not asked for.
