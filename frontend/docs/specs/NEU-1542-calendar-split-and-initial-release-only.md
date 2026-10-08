# NEU-1542 — The calendar splits by where you watch, physical leaves the model, and the where-to-watch box goes (frontend)

**Ticket:** [NEU-1542](https://linear.app/neuroticsasquatch/issue/NEU-1542) (no priority)
**Project:** bl: Maintenance (no milestone, no project spec)
**Target repos:** upcoming-movies-frontend (this file) **and** upcoming-movies-backend. The
decisions D-1542.1 to D-1542.9 and the backend acceptance live in
`../../../backend/docs/specs/NEU-1542-calendar-split-and-initial-release-only.md`; this file
restates the decisions that bind the frontend and spells out the frontend work in full.
**Base branch:** `main`. **Deploy order:** free (§5). No Worker env change.
**Related:** NEU-1412 (`docs/specs/NEU-1412-tabbed-calendar.md`, D-1412.1 to D-1412.5 — the
tab is state, panels stay mounted and `hidden`, one component for both tabs), NEU-1443 (the
tabs read "My films" / "All releases"), NEU-1377 (home-release dates, the where-to-watch box
and calendar buckets, now partly reversed), NEU-1402 / D-28 (JustWatch attribution on
`now_available` rows — stays), D-26 / D-29 / D-34 (amended or superseded upstream), ADR-0023
in the backend repo.
**Ground truth read (2026-10-08):** `src/routes/calendar.tsx`, `src/components/calendar/{CalendarView,
CalendarDateGroups,CalendarFilmRow,release-labels}.ts(x)`, `src/lib/calendar-groups.ts`,
`src/lib/calendar.ts`, `src/api/{types,public,me,query-keys}.ts`, `src/routes/film.tsx`,
`src/components/film/{WhereToWatch,JustWatchAttribution,ExternalLinks,FilmHeader,ReleaseDates}.tsx`,
`src/pages/Settings.tsx` (`CalendarSection`), `src/pages/Welcome.tsx:254`, `CONTEXT.md`
(**All-releases calendar**, **My films calendar**, **Calendar tab**), the tests listed in §4.

---

## 1. What to build and why

Tom's argument, in short: Backlotter follows a film from announcement to the first day you can
watch it at home, and nothing after. Three surfaces on the web say otherwise:

- **`/calendar` mixes theatrical and home dates** under each date. Split it into two views.
- **"Physical"** is a bucket on the calendar and a row on the film page. Nobody waits for the
  disc; it goes everywhere.
- **The where-to-watch box** lists a film's *current* carriers from a daily snapshot, which
  promises an accuracy over time the site does not provide. It goes; the first-observation
  `now_available` cards on the feed and the film page stay, and a chip linking out to TMDB's
  own watch page takes the box's place once the film is out.

### Decisions that bind this repo (from the shared planning session, 2026-10-08)

- **D-1542.1** The home view is **upcoming US digital dates** only — the backend's
  `kind=home`. Observed availability never appears on a calendar.
- **D-1542.2** `GET /calendar` and `GET /me/calendar` take `kind=theatrical | home`; paging
  (`limit`/`offset` over distinct dates) and `total` are **per kind**. The frontend always
  sends one. `CalendarItem.release_type` is now `limited | wide | digital`.
- **D-1542.3** One in-page segmented control, **"In theaters" / "At home"**, for every reader;
  component state, never a URL, never remembered, opens on In theaters; shared across the two
  tabs; a kind's panel mounts on first selection and then stays mounted and `hidden`; the home
  view omits the bucket heading.
- **D-1542.4** The `.ics` subscription stays one feed carrying both kinds minus physical; the
  Settings copy follows.
- **D-1542.7** `FilmDetail.where_to_watch` is gone from the API. The `WhereToWatch` component,
  its type and its tests go. `JustWatchAttribution` stays for `now_available` rows.
- **D-1542.8** A **"Where to watch (TMDB)"** chip in `ExternalLinks`, to
  `https://www.themoviedb.org/movie/{tmdb_id}/watch?locale=US`, rendered only when the film has
  a US displayable release date on or before today, decided in the **loader**.

---

## 2. The calendar page

### 2.1 State and layout (`src/components/calendar/CalendarView.tsx`)

- New `type CalendarKind = "theatrical" | "home"` (exported from `src/lib/calendar.ts` beside
  `DATES_PER_PAGE`, so the API layer and the view share it) and
  `const [kind, setKind] = useState<CalendarKind>("theatrical")` in `CalendarView`, next to
  the existing `tab` state. Neither reads nor writes the URL or `localStorage` (D-1412.1's
  reasoning, restated in the component docstring).
- Render order under the `<h1>Calendar</h1>`: the tab strip (entitled readers only, as today),
  then the **kind control**, then the panels. The kind control renders for every reader,
  including anonymous and unentitled ones, in the same slot whether or not the tabs exist.
- **The kind control** is a `role="radiogroup"` with `aria-label="Calendar kind"` holding two
  `<button type="button" role="radio" aria-checked>` children, "In theaters" and "At home",
  styled as a segmented pair (bordered current, muted other — the tab strip's look, so the two
  controls read as one family; a distinct shape from the tab strip is fine but not required).
  Hand-rolled like `CalendarTabButton`; arrow-key movement is out of scope for both strips, as
  NEU-1412 recorded.
- **Panels.** `AllReleasesCalendar` and `MyFilmsCalendar` each take `kind` and are rendered
  **once per kind that has ever been selected**: a `Set` (or two booleans) of mounted kinds in
  `CalendarView` state, `theatrical` present from the start. Each kind-panel is `hidden` unless
  it is the active kind *and* its tab is the active tab. So a reader who never touches the
  control gets exactly today's render and today's network, and switching back and forth keeps
  each panel's "View more" progress (D-1412.2's rule, extended to the second axis).
- The `tabpanel` wrappers keep their ids and `aria-labelledby`; the kind panels sit inside
  them. The kind control is not a tab and gets no `aria-controls`.

### 2.2 Data (`src/api/public.ts`, `src/api/me.ts`, `src/api/query-keys.ts`)

- `getCalendar(baseUrl, { kind, limit, offset, headers })` sets `kind` on the URL. `kind` is
  required in the signature (the loader passes `"theatrical"`), so no caller can fall back to
  the mixed list by accident.
- `fetchMyFilmsCalendar({ kind, limit, offset })` → `/me/calendar?kind=…&limit=…&offset=…`.
  `useMyFilmsCalendar({ kind, limit, offset })` keys on
  `myFilmsCalendarPageKey(kind, limit, offset)`; `myFilmsCalendarKey` is unchanged, so the
  `followsKey` prefix invalidation still covers both kinds.
- `AllReleasesCalendar` for `kind === "theatrical"` is seeded from the loader as today; for
  `kind === "home"` it starts empty and fetches page one client-side with `getCalendar(env.apiBaseUrl,
  { kind: "home", limit: DATES_PER_PAGE, offset: 0 })` on mount, showing the existing skeleton
  pattern (reuse `MyFilmsCalendarSkeleton`, renamed to `CalendarSkeleton` with its aria-label
  parameterised) while in flight, and the public empty copy when `total === 0`. A failed first
  fetch shows a small inline retry (copy: "We couldn't load home releases just now." + a
  "Try again" button) — not the route `ErrorBoundary`, which would take the server-rendered
  theatrical calendar down with it.
- `MyFilmsCalendar` is unchanged except for `kind` threading; the lapsed-grant 403 handling,
  the stamped later pages and the three states stay as they are.

### 2.3 Copy

- Kind labels: **In theaters**, **At home**.
- Public empty state, per kind: "No upcoming theatrical releases yet — check back soon." /
  "No upcoming home releases yet — check back soon."
- `EmptyMyFilmsCalendar`, per kind: "None of the films you follow has a theatrical date yet." /
  "None of the films you follow has a home release date yet." Second line and buttons
  unchanged.
- `MyFilmsCalendarUnavailable` unchanged.
- `routes/calendar.tsx` meta description: "Upcoming movie releases by date — limited and wide
  theatrical openings and US digital home releases for every film we track." (no "physical").
- `src/pages/Settings.tsx` `CalendarSection`: "Subscribe your calendar to the release dates of
  the films you follow — in theaters and at home, each as an all-day event that moves when the
  date does."
- `src/pages/Welcome.tsx:254` already says "the day you can watch it at home" — unchanged.

### 2.4 Buckets and labels (`release-labels.ts`, `calendar-groups.ts`, `CalendarDateGroups.tsx`)

- `RELEASE_BUCKET_LABELS` loses `physical`; header comment rewritten ("the theatrical arc —
  wide + limited — and the US digital home release; D-26 as amended by NEU-1542"). The
  title-case fallback stays.
- `calendar-groups.ts`: the stale `"premiere" | "limited" | "wide"` comment on
  `CalendarBucketGroup.bucket` becomes `"limited" | "wide" | "digital"`. No logic change.
- `CalendarDateGroups({ items, bucketHeadings = true })`: when `false`, the `h5` is not
  rendered and the films of the date's (single) bucket render directly under the date. The
  home panels pass `false`; the theatrical panels pass nothing.
- `src/api/types.ts`: `CalendarItem.release_type` comment lists three buckets;
  `ReleaseDate.type_label` comment lists `"Limited" | "Wide" | "Digital"` (plus `""` for the
  primary-date fallback row, which `ReleaseDates` already handles).

---

## 3. The film page

### 3.1 Where to watch goes

- Delete `src/components/film/WhereToWatch.tsx` and `WhereToWatch.test.tsx`; remove the import
  and the `<WhereToWatch …/>` line from `src/routes/film.tsx`; delete `WatchProvider`,
  `WhereToWatchBox` and `FilmDetail.where_to_watch` from `src/api/types.ts`; drop the
  `whereToWatch` fixture and the two box tests in `src/routes/film.test.tsx`.
- `JustWatchAttribution` and every `now_available` use of it (`EventCard`, `FeedDayCard`,
  `UpdateTypeGroups`) are **unchanged**, as are their tests. `logoUrl` in `src/lib/poster.ts`
  stays (search results, entity and studio pages use it).

### 3.2 The TMDB watch chip (`ExternalLinks.tsx`, `FilmHeader.tsx`, `routes/film.tsx`)

- `ExternalLinks({ tmdbId, imdbId, watchable })`: when `watchable`, a third chip after TMDB
  reading **Where to watch (TMDB)**, `href="https://www.themoviedb.org/movie/${tmdbId}/watch?locale=US"`,
  same `target="_blank" rel="noopener noreferrer"` and chip class as the other two. No
  attribution text: the page hosts no provider data.
- `FilmHeader({ film, watchable })` passes it through.
- `routes/film.tsx` loader returns `{ film, watchable }` where
  `watchable = isWatchable(film.release_dates, todayUtc())` from a new pure helper in
  `src/lib/film-release.ts` (or beside `formatHeadlineRelease` in `src/lib/format.ts`):
  true when some row has `country === "US"`, `type_label !== ""`, and `date.slice(0, 10) <=
  today` (ISO strings compare lexically). `today` is computed **in the loader** (`new
  Date().toISOString().slice(0, 10)`), never in render, so SSR and hydration agree. The helper
  is unit-tested; the loader test asserts the flag for a released and an unreleased fixture.

---

## 4. Tests

Beyond the deletions in §3.1:

- `src/components/calendar/CalendarView.test.tsx`: existing tab tests unchanged; add — the
  kind control renders for anonymous, unentitled and entitled readers; it opens on In theaters;
  selecting At home fetches `/calendar?kind=home` once (msw) and renders its dates without a
  bucket heading; switching back shows the server-rendered theatrical list without a refetch;
  for an entitled reader, switching tab keeps the kind and the My films panel requests
  `/me/calendar?kind=home`; paging progress on one kind survives a round trip through the
  other; the home panel's failed first fetch shows the inline retry and the theatrical panel is
  untouched.
- `src/routes/calendar.test.tsx`: the loader sends `kind=theatrical`; the meta description
  contains no "physical"; `renders the home-release buckets with their own labels, in backend
  order` becomes a theatrical-order test (`["Wide", "Limited"]`) and the
  `calendarWithHomeRelease` fixture loses its physical row; add a `kind=home` render test
  asserting no `h5`.
- `src/components/calendar/release-labels.test.ts`: the `"Physical"` case goes; add "title-cases
  an unknown bucket such as physical" if the fallback test does not already cover it.
- `src/api/public.test.ts` `getCalendar` cases assert `kind` on the URL; `src/api/me.test.ts`
  "My films calendar" cases assert `kind` in the URL and the key.
- `src/test/msw/calendar.ts` handlers read `kind` and answer the matching fixture.
- `src/components/film/ExternalLinks.test.tsx`: chip present when `watchable`, absent
  otherwise, correct href and rel. `FilmHeader.test.tsx:215` extended for the prop.
  `src/lib/film-release.test.ts` (new): US wide yesterday → true; US digital today → true;
  US wide tomorrow → false; FR wide yesterday → false; fallback row (`type_label: ""`) → false;
  empty → false.
- `src/components/film/ReleaseDates.test.tsx` and `src/routes/film.test.tsx:355`: physical
  fixtures become digital; the assertions name "Digital" only.
- `src/pages/Settings.test.tsx` `calendar (D-34)` cases: unchanged unless they assert the copy;
  update the string if so.

---

## 5. Deploy

- **Order is free.** Frontend first: the old backend ignores `kind`, so for a few hours both
  views show both kinds and any physical row renders with the title-case fallback. Backend
  first: the old frontend sends no `kind` and gets both kinds minus physical, and
  `where_to_watch` is already optional in its type.
- Owed after deploy, unticketed unless Tom wants it: a phone eyeball of the kind control under
  the tab strip at 375px (two rows of controls), and of a date with Wide and Limited under
  In theaters.

---

## 6. Docs in this repo (same PR)

- `CONTEXT.md`: new **Calendar kind** entry (In theaters / At home; a view on the page, not a
  place; not a preference; shared across the tab; the home kind holds the US digital date and
  nothing observed; *Avoid:* filter, mode, category, "rent/buy/stream view", "digital tab");
  **My films calendar** gains "it has both kinds, and the `.ics` feed is their union";
  **Calendar tab** notes the kind cuts across it. Under *The feed and the film page*, a
  one-line **Where to watch** (retired) entry: the D-29 box is gone, the phrase survives only
  as the chip that links to TMDB's watch page once the film is out.
- `docs/specs/NEU-1412-tabbed-calendar.md`: a dated note at the top that D-1412.1/.2 now also
  govern the kind control (this ticket).

---

## 7. Out of scope

- Remembering the kind or the tab, or putting either in the URL.
- A per-kind `.ics` subscription (D-1542.4).
- Arrow-key navigation for either strip (NEU-1412's standing deferral).
- Any change to `now_available` cards or where JustWatch is credited.
- Film-row linking on `/me/follows` and the other open calendar-adjacent items already
  recorded in the project memory.
