# NEU-1469 — Search shows that it is running

**Ticket:** [NEU-1469](https://linear.app/neuroticsasquatch/issue/NEU-1469/search-is-very-slow)
**Project:** bl: Maintenance (no milestone) · **Related:** NEU-1430 (the header search box),
NEU-1355 (the follows-page add-follow box), NEU-1358 (the onboarding people grid), NEU-1419
(`useEntitySearch`)
**Target repos:** both. This file is the **frontend half** (the visual indicator). The backend
half (the speed: a stored, trigram-indexed fold) is
`backend/docs/specs/NEU-1469-search-fold-index.md`. The two are independent — no API contract
changes — and deploy in either order. **Base branch:** `release/v1.1.1` (the current release
branch; the skills resolve it from the checkout).
**Blocked by:** nothing · **Blocks:** nothing

## What to build and why

Search is slow today (2.8 s for people on the dev database; the backend half fixes that), and
while it runs nothing on screen says so:

- The **header box** (`components/search/SearchBox.tsx`) opens the dropdown as soon as
  `useDebouncedSearch` reports `loading`, but `groups` is still `null` at that point, so what
  opens is an empty bordered box with one pixel of padding. On a re-query the previous query's
  groups stay on screen with no sign that they are stale and a new answer is coming.
- The **follows-page box** (`components/follow/FollowEntitySearch.tsx`) sets `aria-busy` on the
  results region and nothing visible. Each query is a new TanStack key, so `data` is `undefined`
  until the answer lands: the list goes blank, then fills. Between two and three seconds of
  blank, today.
- The **onboarding people grid** (`components/onboarding/PeopleStep.tsx`) shares
  `useEntitySearch` and has the same gap.

Three decisions from the planit session (Tom, 2026-09-26), each the recommended option:

- **D-1469.5 The indicator is a spinner in the input's trailing edge.** A small animated
  spinner overlaid at the right end of the search input while a request is in flight, on all
  three surfaces. It works whether the results area is closed, empty, or showing the previous
  query's hits, and it never moves the results. The screen-reader status region says
  "Searching…" while it shows.
- **D-1469.6 Previous results stay on screen until the new answer lands.** The header already
  behaves this way (`useDebouncedSearch` does not clear `groups` on a new query). The follows
  box and the onboarding grid adopt TanStack's `placeholderData: keepPreviousData` in
  `useEntitySearch` so they match. No dimming: the spinner is the only signal that the list is
  stale, and once the backend answers in tens of milliseconds a dim would flash.
- **D-1469.7 No frontend speed changes.** The debounces (300 ms header, 250 ms the other two)
  and the header's wait-for-all-four stay. With each endpoint answering in tens of
  milliseconds the slowest-of-four is invisible, and progressive per-group rendering would add
  reorder churn for nothing. Shortening the debounce would spend more requests from the
  public rate-limit bucket for no felt gain.

## Decisions in detail

### The spinner

One small component, `components/ui/spinner.tsx` (the `ui/` folder is where the primitives
live), rendering `lucide-react`'s `Loader2` with `animate-spin` (already used by
`CalendarView` / `TimelinePage` skeletons via Tailwind), sized `h-4 w-4`, colour
`text-muted-foreground`, `aria-hidden="true"` — the announcement is the status region's job,
not the icon's. It is positioned by its caller: each of the three inputs wraps in a
`relative` container and places the spinner `absolute right-3 top-1/2 -translate-y-1/2`, and
the input gains `pr-9` so text never runs under it. (`type="search"` inputs draw a native
clear button in some browsers; the right padding covers that too.)

### Header box (`SearchBox.tsx`, `useDebouncedSearch.ts`)

- Spinner shows while `status === "loading"`.
- The dropdown no longer opens on `loading` alone: `showDropdown` becomes
  `mounted && groups !== null && !dismissed && status !== "error"`. With previous groups held
  (D-1469.6) the dropdown stays open across a re-query showing the old hits plus the spinner
  in the input, and on a first query it opens when the first answer lands. The empty box goes
  away. The test comment in `SearchBox.test.tsx` ("the listbox opens on `loading`") becomes
  false — update it; the test itself already waits for a rendered hit.
- The persistent `role="status"` region announces `"Searching…"` while loading and no groups
  are held yet; once an answer lands it goes back to the count / no-results text it has today.
  While a re-query is loading over held groups, keep the previous announcement (announcing
  "Searching…" on every debounce over a list that is still visible would be noise).
- `useDebouncedSearch` is otherwise unchanged. It already exposes `status`.

### Follows box (`FollowEntitySearch.tsx`) and onboarding grid (`PeopleStep.tsx`) via `api/entities.ts`

- `useEntitySearch` adds `placeholderData: keepPreviousData` (`@tanstack/react-query` 5, as
  `api/users.ts` already does for the accounts page). `isFetching` is the spinner condition —
  it is true during the placeholder window and false once the new key resolves. Note
  `keepPreviousData` holds data across **any** key change, including switching the tab: the
  People list stays visible for a beat with the spinner while the Companies answer arrives,
  which is the D-1469.6 behaviour and is fine. `enabled: false` (query below
  `MIN_QUERY_LEN`) yields `data: undefined` — the "Type at least 2 characters" copy still
  shows, not stale results, because `placeholderData` does not apply to a disabled query
  (verify in a test).
  *As built:* that premise is false — TanStack 5.103 applies `placeholderData` to a disabled
  query too — and `keepPreviousData` hands over the last query that *had* data, so a query
  typed after cutting below the minimum would revive the list from two queries ago. The hook
  instead holds what it last returned (cleared while disabled) through a `placeholderData`
  function, and passes none while disabled; the follows-box test pins both.
- `FollowEntitySearch`: spinner in the input while `isFetching`; `aria-busy` stays. The
  "No people match" copy must not flash during the placeholder window: it already gates on
  `data && results.length === 0`, and held placeholder data has the *previous* results, so an
  empty previous list plus a new query in flight would show "No people match "<new query>"" —
  gate that copy on `!isFetching` as well.
- `PeopleStep`: spinner in its search input while `search.isFetching` (the popular-people
  grid's own loading is not this ticket's concern; leave its `aria-busy` as is).

## Acceptance criteria

1. **Header:** typing two characters shows the spinner in the input; no dropdown opens until
   the first answer lands; the dropdown then opens with the groups. Typing more keeps the
   previous groups visible with the spinner showing until the new answer replaces them. No
   empty dropdown at any point.
2. **Header a11y:** the status region reads "Searching…" during a first query and the result
   count once answered; `aria-expanded` is false while no groups are held.
3. **Follows box:** typing shows the spinner; the previous list stays until the new one lands;
   "No people match" never shows for a query still in flight; switching tabs shows the spinner
   over the old list, then the new list.
4. **Onboarding grid:** spinner in the search input while a search is in flight.
5. **Speed:** no debounce values change; the header still fires exactly one request per
   endpoint per debounced query (the existing test pins it).
6. Tests for 1–4 in the three components' existing test files, using MSW's `delay()` to hold
   a response open so the loading window is observable. `task test`, `task lint`,
   `task typecheck` green; changed files prettier-formatted.

## Out of scope

- **Progressive per-group rendering in the header** (D-1469.7).
- **Dimming stale results** (D-1469.6 chose no dim).
- **Any backend change** — the other half of this ticket, in the backend repo.
- **The popular-people grid's own loading state** on `/welcome`.
