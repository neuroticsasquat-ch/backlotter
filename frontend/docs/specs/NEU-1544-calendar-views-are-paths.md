# NEU-1544 — Every calendar tab × kind combo is a path, so Back returns to the view you left

**Ticket:** [NEU-1544](https://linear.app/neuroticsasquatch/issue/NEU-1544/add-actual-paths-to-each-calendar-tabsubtab-combo) (Bug, no priority)
**Project:** bl: Maintenance (no milestone, no project spec)
**Target repo:** upcoming-movies-frontend only. No backend change, no Worker env change.
**Base branch:** `main`. **Deploy order:** free — every old `/calendar` link keeps working.
**Amends:** D-1412.1 (`docs/specs/NEU-1412-tabbed-calendar.md`) and D-1542.3
(`docs/specs/NEU-1542-calendar-split-and-initial-release-only.md`), both of which made the tab and
the kind component state and "never a URL". The amendment is recorded as
`docs/adr/0002-calendar-views-are-paths.md`; D-1412.2 (panels stay mounted and `hidden`) and
D-1412.3 to D-1412.5 stand.
**Ground truth read (2026-10-09):** `src/routes.ts`, `src/routes/calendar.tsx`,
`src/components/calendar/CalendarView.tsx`, `src/lib/calendar.ts`, `src/api/query-keys.ts`,
`src/lib/seo.ts`, `src/routes/sitemap.ts`, `src/components/layout/{nav-items,PrimaryNav,MobileMenu}.tsx`,
`src/components/follow/access.tsx`, `src/components/AuthContext.tsx`, `src/routes/film.tsx` (404
pattern), `src/routes/all-updates.tsx` (one module, two addresses), `docs/adr/0001-timeline-hint-cookie.md`,
`CONTEXT.md` (**Calendar tab**, **Calendar kind**), the tests in §6.

---

## 1. What to build and why

`/calendar` is one address for four views: the tab (My films / All releases, entitled readers
only) and the kind (In theaters / At home) are both `useState` inside `CalendarView`. That was
chosen twice on purpose — one indexable URL, the nav lands an entitled reader on their own films,
nothing in the document depends on who is looking — and it has a cost the two specs did not weigh:
**the browser's history cannot name a view**. A reader on My films · At home clicks a film, presses
Back, and lands on My films · In theaters; a reader on All releases does the same and lands on My
films. Every return trip resets to the front.

The fix is the one the ticket names: each combo gets a path. The tab strip and the kind control
become links, the page reads its view from the URL, and Back retraces the reader's steps on and
off the page. The page keeps everything else NEU-1412 and NEU-1542 built: one route module, one
`CalendarView`, panels that stay mounted so "View more" survives a switch, the server rendering
the anonymous calendar and the client deciding what to do with it.

### Decisions (2026-10-09 planning session with Tom)

- **D-1544.1 — One meaning per URL, whoever is looking.** Four addresses, segments spelled as
  the controls are on screen (EF-19's rule), the default kind carrying no segment so `/calendar`
  itself does not move:

  | Path | Tab | Kind | Public |
  |---|---|---|---|
  | `/calendar` | All releases | In theaters | yes — the sitemap's existing entry |
  | `/calendar/at-home` | All releases | At home | yes — new sitemap entry, own title |
  | `/calendar/my-films` | My films | In theaters | no — canonical → `/calendar` |
  | `/calendar/my-films/at-home` | My films | At home | no — canonical → `/calendar/at-home` |

  `/calendar` is All releases for **everyone**, including an entitled reader. They still land on
  their own films from the nav because the nav's Calendar item points at `/calendar/my-films`
  for `ready` and `hinted` access (§4). *Rejected:* keeping `/calendar` viewer-dependent (My films
  if entitled) with paths only for the other combos — one address meaning two views is exactly the
  ambiguity a path-per-view exists to remove; an explicit `/calendar/in-theaters` with a 301 off
  `/calendar` — a redirect on the most-linked URL buys symmetry nobody asked for.

- **D-1544.2 — A locked reader on a My films address is replaced onto its public twin.** Once
  the account read has *settled* as anonymous or unentitled, the page navigates with `replace`
  to the same kind under All releases. The URL never names a view the reader cannot see, Back is
  untouched because nothing was pushed, and the mid-session lapsed grant (NEU-1412's
  `refresh()` on a 403) ends on the same path instead of silently re-rendering tab-less under a
  URL that still says my-films. *Rejected:* rendering the public calendar in place (a bookmark
  that lies after logout); a locked panel (NEU-1412 chose no locked state on this page, and the
  pitch lives on the feed routes).

- **D-1544.3 — Switching tab or kind pushes history; the controls are links.** The tab strip is
  `role="tablist"` of `<Link role="tab">`, the kind control `role="radiogroup"` of
  `<Link role="radio">`, with `aria-selected` / `aria-checked` as today. Each click is an ordinary
  navigation: Back retraces in-page switches, middle-click and copy-link work, and the two
  empty-state "Browse all releases" buttons become links because the other calendar now *is* at
  another address. *Rejected:* `navigate(…, { replace: true })` on click — it fixes the
  return-from-film case only and leaves the strip as buttons that happen to rewrite the URL.

---

## 2. The address (`src/lib/calendar.ts`)

`CalendarTab` moves here from `CalendarView.tsx` (exported), beside `CalendarKind`, and the file
gains the address model the route and the view share:

```ts
export type CalendarTab = "films" | "all";

/** One of the four views `/calendar` has an address for (NEU-1544, D-1544.1). */
export interface CalendarAddress {
  tab: CalendarTab;
  kind: CalendarKind;
}

export const DEFAULT_CALENDAR_ADDRESS: CalendarAddress = { tab: "all", kind: "theatrical" };

/** `/calendar` + the segments for an address: nothing for the default tab or kind, `my-films`
 *  and `at-home` otherwise, tab before kind. */
export function calendarPath(address: CalendarAddress): string;

/** The inverse, over the route's splat (`""`, `"at-home"`, `"my-films"`, `"my-films/at-home"`;
 *  a trailing slash is tolerated). `null` for anything else — the loader turns that into a 404. */
export function parseCalendarPath(splat: string | undefined): CalendarAddress | null;
```

`calendarPath(parseCalendarPath(s))` round-trips for the four valid splats; `parseCalendarPath`
is strict about order (`at-home/my-films` is `null`) and spelling (`my-films` only, never `films`
or `mine`; `at-home` only, never `home`). New `src/lib/calendar.test.ts` covers both.

## 3. The route (`src/routes.ts`, `src/routes/calendar.tsx`)

- `route("calendar", …)` becomes **`route("calendar/*", "routes/calendar.tsx")`**: one route id for
  all four addresses, so the element stays mounted across a navigation between them and the
  mounted-panel model (D-1412.2) carries over. The backend's `/calendar/{token}.ics` lives on the
  API origin and does not collide. *Not* four `route(…)` entries sharing the module with distinct
  ids — distinct ids remount the view and lose "View more" progress on every click.
- **Loader:** `parseCalendarPath(params["*"])`; `null` → `throw new Response(null, { status: 404,
  statusText: "Calendar view not found" })` (the `film.tsx` pattern). Otherwise fetch the public
  calendar of **the address's kind** with `ssrOriginHeaders`, as today, and return
  `{ calendar, kind }`. The document for `/calendar/at-home` is now the home calendar, server-
  rendered and indexable; the document for a My films address is its public twin's (the server
  never resolves auth).
- **`shouldRevalidate`:** return `false` when both `currentUrl` and `nextUrl` are calendar
  addresses (parse both; both non-null). A tab or kind click is then a pure client navigation —
  no `.data` round trip through the Worker — and `loaderData` keeps the kind the page was entered
  with. Every other navigation into the route (from a film page, Back from elsewhere, a full
  load) runs the loader as it always has.
- **`meta`:** by address, via `buildMeta`:

  | Address | title | description | canonical |
  |---|---|---|---|
  | all · theatrical | "Release Calendar" (unchanged) | unchanged | self |
  | all · home | "Home Release Calendar" | "Upcoming US digital home releases by date for every film we track." | self |
  | films · theatrical | "My Films Calendar" | the all · theatrical description | `/calendar` |
  | films · home | "My Films Calendar" | the all · home description | `/calendar/at-home` |

  `buildMeta` gains an optional `canonicalPathname?: string` (defaults to `pathname`) used for
  the canonical `<link>` and `og:url`. **No `noindex`** on the My films addresses: their server
  document *is* the public twin's content, and a canonical is the one correct signal for that;
  pairing it with `noindex` is the contradictory combination search engines warn against.
- **`ErrorBoundary`:** gains the 404 branch `film.tsx` has — `isRouteErrorResponse(error) &&
  error.status === 404` renders "That calendar view doesn't exist." with a link to `/calendar`;
  every other error keeps today's copy.
- **`CalendarPage`:** `<CalendarView address={…} seededKind={loaderData.kind} calendar={loaderData.calendar} />`,
  where `address` is `parseCalendarPath(params["*"])!` (the loader already 404'd the rest). The
  heading stays "Calendar" on all four addresses — the tab strip and the kind control say which
  view this is, as they do today.
- **Sitemap:** `injectFeRoutes(…, ["/calendar", "/calendar/at-home"])`.

## 4. The nav (`src/components/layout/nav-items.ts`)

`CALENDAR` stops being one constant: `navItemsFor` returns `{ label: "Calendar", href:
"/calendar/my-films" }` for `ready` and `hinted`, `{ label: "Calendar", href: "/calendar" }`
otherwise. The label does not change — it is still the page's heading. `PrimaryNav` and
`MobileMenu` need nothing: `NavLink` prefix-matches (`end` is set only for `/`), so the item is
lit on all four addresses. The comment on `CALENDAR` ("the same destination for everybody") goes.

> **Resolved in implementation:** the `NavLink` claim above holds only for `href: "/calendar"`. A
> `NavLink` to `/calendar/my-films` does not match `/calendar` or `/calendar/at-home`, so the
> entitled reader's Calendar item would go dark on All releases. `NavItem` gained an optional
> `activePath` (`/calendar` on the entitled item), and both navs render through one
> `NavItemLink` that matches against it and sets `aria-current="page"` itself.

## 5. The view (`src/components/calendar/CalendarView.tsx`)

- **Props:** `{ address: CalendarAddress; seededKind: CalendarKind; calendar: CalendarResponse }`.
  `tab` and `kind` are read from `address`; the `useState` for both goes, and the docstring's
  "never a URL" paragraph is replaced by one that points at D-1544.1 and the ADR.
- **`openedKinds`** stays state, seeded with `seededKind` instead of `"theatrical"`, and grows
  whenever `address.kind` is one it does not hold yet (derive it during render or in an effect —
  implementer's call; the observable rule is unchanged: a kind's panels mount on its first
  appearance and then stay mounted and `hidden`).
- **The seeded panel is the loader's kind, not hardcoded theatrical.** `AllReleasesCalendar`
  (seeded from `calendar`) renders for `k === seededKind`; `BrowserAllReleasesCalendar` for any
  other opened kind, with its skeleton label and error copy parameterised by kind ("Loading
  theatrical releases" / "We couldn't load theatrical releases just now." for the kind the loader
  did not fetch). `publicCalendarFirstPageKey`'s docstring is updated: the loader's kind is
  whichever the address named, not always In theaters.
- **Tabs and kinds are links (D-1544.3):** `CalendarTabButton` → `CalendarTabLink`
  (`<Link role="tab" to={calendarPath({ tab, kind })} aria-selected aria-controls id>`),
  `CalendarKindButton` → `CalendarKindLink` (`<Link role="radio" to={calendarPath({ tab, kind })}
  aria-checked>`). A tab link keeps the current kind; a kind link keeps the current tab. Same
  classes as today. `onShowAllReleases` becomes a path: `MyFilmsCalendarUnavailable` and
  `EmptyMyFilmsCalendar` render `<Button asChild><Link to={calendarPath({ tab: "all", kind })}>Browse
  all releases</Link></Button>` and the "it is a tab change, so a `<button>`" comments are
  rewritten to say the opposite and why.
- **Locked redirect (D-1544.2):** in `CalendarView`, when `address.tab === "films"` and the account
  read has **settled** without a grant — `access === "locked"`, or `access === "anonymous"` with
  `useAuth().resolving === false` — `navigate(calendarPath({ tab: "all", kind: address.kind }),
  { replace: true })` from an effect. `hinted` is in flight by definition and waits.
  **The settled check is load-bearing:** on the first client render `useFollowAccess()` answers
  `"anonymous"` for an entitled reader whose hint cookie has expired, and redirecting on that
  would bounce them off their own calendar before `/me` answers. `resolving` is
  `meQuery.isFetching`, which TanStack sets from the first render of a query that will fetch on
  mount, so it is `true` through the whole in-flight window and `false` after a 401 or a
  failure. Until the effect fires, the render for a not-ready reader on a My films address is
  what it is today (no tab strip, the all-releases panel), so nothing flashes a wrong view.
- Everything below the controls — `MyFilmsCalendar`, its lapsed-grant `refresh()`, paging, the
  three My films states, `CalendarSkeleton`, `CalendarDateGroups` — is unchanged except for the
  `onShowAllReleases` → link change above.

## 6. Acceptance criteria

Tests: `src/lib/calendar.test.ts` (new), `src/routes/calendar.test.tsx`,
`src/components/calendar/CalendarView.test.tsx`, `src/lib/seo.test.ts`,
`src/routes/sitemap.test.ts`, the nav tests that assert `/calendar` hrefs
(`GlobalHeader.test.tsx`, `MobileMenu.test.tsx`, and `nav-items` coverage if any). `CalendarView`
tests must render under `createRoutesStub` at a **calendar address** (not `/`) with the
`calendar/*` path, so `Link`s resolve and the URL can be asserted via a stub route that echoes
`location.pathname`.

1. **Round trip:** `parseCalendarPath` maps `""`, `"at-home"`, `"my-films"`, `"my-films/at-home"`
   (each also with a trailing slash) to the four addresses and `calendarPath` maps them back;
   `"home"`, `"films"`, `"at-home/my-films"`, `"my-films/x"`, `"in-theaters"` are `null`.
2. **Loader by kind:** `/calendar` requests `kind=theatrical`; `/calendar/at-home` and
   `/calendar/my-films/at-home` request `kind=home`; `/calendar/my-films` requests
   `kind=theatrical`; each returns `{ calendar, kind }`. Signing-header tests pass unchanged.
3. **404:** the loader for `/calendar/nope` throws a 404 `Response`; the `ErrorBoundary` renders
   the not-found copy with a link to `/calendar`, and the existing non-404 copy for other errors.
4. **Meta:** titles, descriptions and canonicals exactly as the §3 table; the existing
   `/calendar` meta test passes unchanged. `buildMeta({ canonicalPathname })` sets both the
   canonical `<link>` and `og:url` to it, and defaults to `pathname` when omitted.
5. **Sitemap** contains both `/calendar` and `/calendar/at-home` and nothing for `my-films`.
6. **Nav href:** `navItemsFor("ready")` and `("hinted")` give Calendar `/calendar/my-films`;
   `("anonymous")` and `("locked")` give `/calendar`. The item is active (`aria-current="page"`)
   at `/calendar/my-films/at-home`.
7. **Address drives the view:** rendered entitled at `/calendar/my-films/at-home`, "My films"
   has `aria-selected="true"`, "At home" `aria-checked="true"`, and the My films home rows
   render; at `/calendar/at-home` for an anonymous reader there is no `tablist`, "At home" is
   checked, and the loader's rows render **without** any `/calendar` request (the seeded panel
   is the loader's kind).
8. **Links, not buttons:** every tab and kind control is an `<a>` with the `href` of its
   address, keeping the other axis — on `/calendar/my-films/at-home`, "All releases" links to
   `/calendar/at-home` and "In theaters" links to `/calendar/my-films`. Clicking one changes
   `location.pathname` and the `aria-selected`/`aria-checked` state follows the URL.
9. **History:** at `/calendar` click At home, then My films: `history.length` grew by two and
   two Backs return to `/calendar` (assert through the stub's navigation, or `useNavigate(-1)`).
10. **Panels survive navigation (D-1412.2, over links):** the existing "paging survives a switch"
    and "View more progress survives a kind round trip" tests pass with clicks on links instead
    of buttons, and still assert the exact request counts they do today.
11. **Locked redirect:** at `/calendar/my-films/at-home`, `/me` answering 401 → the URL becomes
    `/calendar/at-home` with no extra history entry, no `tablist`, home rows visible;
    `entitled: false` → same. **Settled guard:** `/me` delayed (resolve after a tick) then
    `entitled: true` → the URL stays `/calendar/my-films/at-home` and the tabs appear; with the
    hint cookie set and `/me` in flight, likewise no redirect.
12. **Lapsed grant:** NEU-1412's test (entitled → `/me/calendar` 403 → `/me` re-read
    `entitled: false`) now ends at the public twin's URL with neither empty nor unavailable copy
    ever shown.
13. **Empty and unavailable states:** "Browse all releases" is a link to
    `calendarPath({ tab: "all", kind })` for the current kind; "Get started" still links to
    `/welcome`.
14. **No revalidation within the route:** `shouldRevalidate({ currentUrl: /calendar, nextUrl:
    /calendar/at-home })` is `false`; from `/film/x` to `/calendar/at-home` it defers to
    `defaultShouldRevalidate` (true).
15. `task test`, `task lint` (zero warnings), `task typecheck` (typegen must regenerate the
    `calendar/*` params type) green; changed files prettier-formatted.

## 7. Docs that change with the code

- `CONTEXT.md` **Calendar tab** and **Calendar kind**: "never a URL" → each combo is an address
  (done in this planning pass, alongside `docs/adr/0002-calendar-views-are-paths.md`).
- Notes atop `NEU-1412-tabbed-calendar.md` and `NEU-1542-calendar-split-and-initial-release-only.md`
  pointing here (done in this planning pass).
- `CLAUDE.md` Architecture's route list says `calendar`; `calendar/*` is close enough not to edit.

## 8. Out of scope / deferred

- **A hinted server render for `/calendar/my-films`** (the My films skeleton when the
  `timeline_hint` cookie is present, as `/` does): ADR-0001 named the tab strip as a candidate.
  Not this ticket; the flash on a full load of a My films address is the one `/calendar` already
  has today, just reached from the nav instead of after it.
- **Remembering the last kind** across visits: still never a preference (D-1542.3's second
  half stands).
- **Arrow-key movement** in the tab strip or kind control: still the shared-primitive ticket
  NEU-1412 deferred. Links already tab-stop and activate on Enter.
- **Paging in the URL** (`?page=`): "View more" progress stays in the mounted panel; a return
  from a film page lands on page one of the view, as it does on the feed.
- **Backend `.ics`, `GET /calendar`, `GET /me/calendar`:** untouched.
