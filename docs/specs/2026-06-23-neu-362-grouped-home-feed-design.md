# NEU-362 — Group home feed by film per day (design)

- **Ticket:** [NEU-362](https://linear.app/neuroticsasquatch/issue/NEU-362) `[frontend]` — Group home feed by film per day
- **Project / milestone:** Movies: Content Quality · MVP Quality Bar
- **Parent story:** [NEU-363](https://linear.app/neuroticsasquatch/issue/NEU-363) (Home feed shows one card per film per day)
- **Blocked by:** [NEU-364](https://linear.app/neuroticsasquatch/issue/NEU-364) `[backend]` — Per-film-per-day grouping mode for the public feed (the `GET /feed/grouped` endpoint this renders)
- **Date:** 2026-06-23
- **Repo:** `upcoming-movies-frontend`
- **Branch:** `tom/neu-362-frontend-group-home-feed-by-film-per-day`
- **Scope:** one frontend PR, no backend changes.

## Problem

The public `/` feed (`src/routes/feed.tsx`, shipped in NEU-312) renders one card **per event** — it
loads the per-event `GET /feed` and maps each `FeedItem` to a `FeedItemCard`. A film with many
events in a day produces many rows and dominates the home feed. The home feed should read as "which
films have news today": **one card per film per day**, each linking through to the film's timeline.

The backend sibling (NEU-364) adds a dedicated `GET /feed/grouped` returning one row per (film, day)
with a deliberately minimal payload. This ticket is the frontend that renders it.

## What this is

A near-mechanical transform of the merged NEU-312 feed page. The route keeps its
`loader → meta → FeedPage → ErrorBoundary` shape, its `<h1>Latest Updates</h1>`, day-section
layout, empty state, and error boundary. Three things change underneath:

1. **Data source** — the loader calls `getFeedGrouped` (`GET /feed/grouped`) instead of `getFeed`.
2. **Grouping** — the input is already one row per (film, day), so the day-bucketing helper groups
   on the `day` string instead of parsing each item's `created_at`.
3. **Card** — a new `FeedDayCard` (poster + title + beat/count, the whole card linked) replaces
   `FeedItemCard`.

The now-unused per-event frontend pieces are **deleted** (the home page is their only consumer; the
per-event detail still lives on each `/film/{slug}` timeline). The backend per-event `/feed`
endpoint is untouched.

## Decisions (locked with Tom)

| Question | Decision |
|---|---|
| Beat line when a film has multiple events that day | **Beat label always + `+{event_count - 1}` only when `event_count > 1`.** The most-significant beat (e.g. "Release date") is always the headline; a muted `+2` signals the other events. Preserves the specific beat AND signals volume. (3 events → "Release date +2"; 1 event → just "Trailer".) |
| The now-unused per-event FE feed code | **Delete it** — `getFeed`, `FeedItem`/`FeedResponse`, `FeedItemCard` (+ test), and the per-event `groupByDay` (+ test), replaced by grouped equivalents. The home page is their only consumer; YAGNI. Backend `/feed` endpoint stays. |
| Card layout | **Horizontal row list** — small poster on the left, title + beat/count on the right; the **whole card is one `<Link>`** to `/film/{slug}`. A vertical list within each day section, consistent with the current layout, good for scanning "which films have news". (Not a poster grid.) |
| Whole-card link | The card has no inner links now (no summary/sources), so the entire `<article>` is wrapped in a single `<Link>` — a bigger tap target than the title-only link the per-event card used. |
| Pagination | **Recent window only** — loader fetches the default page (`limit 50, offset 0`); no pagination UI. Same as NEU-312; deep history is crawlable via film pages + sitemap. |
| Day heading source | The backend `day` is already a `"YYYY-MM-DD"` UTC date string. `formatDayHeading(day)` is reused as-is: `new Date("2026-06-23")` parses as UTC midnight and the formatter is `timeZone: "UTC"`, yielding "Tuesday, June 23, 2026". No `format.ts` change. |

## Background (what already exists, merged)

- **`src/routes/feed.tsx` (NEU-312).** The public SSR index at `/`. `loader` reads
  `context.get(cloudflareContext).env.API_BASE_URL`, calls `getFeed`, returns `{ feed }`; `meta`
  builds "Latest Updates"; `FeedPage` maps `groupByDay(feed.items)` to day `<section>`s of
  `FeedItemCard`s with an empty state; a generic `ErrorBoundary`.
- **`src/lib/feed-groups.ts` (NEU-312).** `groupByDay(items: FeedItem[]): DayGroup[]` — buckets a
  `created_at`-desc list by UTC day via `dayKey(created_at)`, preserving order.
- **`src/lib/format.ts`.** `formatDayHeading(iso)` (UTC, `en-US`, weekday-long), `dayKey(iso)`,
  `formatEventDate(iso)`. **Reused unchanged.**
- **`src/lib/poster.ts`.** `posterUrl(path: string | null, size: string): string | null` →
  `${tmdbImageBase}/${size}${path}`, `null` when path is null. The film header uses `"w342"`.
  **Reused.**
- **`src/components/film/labels.ts`.** `eventTypeLabel(eventType)` — known map (incl. `other` →
  "Update") + title-case fallback. **Reused.**
- **`src/api/public.ts` / `types.ts`.** `getFilm` + `getFeed`; `FeedItem`/`FeedResponse`/`FilmSource`.
- **`src/components/feed/FeedItemCard.tsx` (NEU-312).** Per-event card: indigo beat badge, a
  module-local `ConfidenceBadge`, date, summary, `SourceLinks`. **Deleted by this ticket.**

## Backend contract consumed (NEU-364)

```
GET /feed/grouped?limit=50&offset=0   → 200 FeedDayResponse
```

```ts
FeedDayItem {
  film_slug: string;
  film_title: string;
  poster_path: string | null;
  day: string;            // "YYYY-MM-DD" (UTC date of event.created_at), one row per (film, day)
  top_event_type: string; // raw event_type, e.g. "release_date"
  event_count: number;    // count of summarized events for that (film, day)
}
FeedDayResponse { items: FeedDayItem[]; total: number; limit: number; offset: number; }
```

- Ordered `day DESC, last_created_at DESC, film.slug ASC` — newest day first, deterministic.
- Inclusion: only films with `slug IS NOT NULL` and ≥1 **summarized** event that day appear. So the
  AC "films with no events that day do not appear" and "each film at most once per day" are
  **backend-guaranteed**; the FE renders exactly what it receives.
- The feed always responds 200 (no 404 branch).

## File-level changes

| File | Action | Responsibility |
|---|---|---|
| `src/api/types.ts` | modify | Remove `FeedItem` + `FeedResponse`; add `FeedDayItem` + `FeedDayResponse`. |
| `src/api/public.ts` | modify | Remove `getFeed`; add `getFeedGrouped(baseUrl, { limit?, offset? })`. `getFilm` untouched. |
| `src/api/public.test.ts` | modify | Replace the `getFeed` tests with `getFeedGrouped` tests. |
| `src/lib/feed-groups.ts` | rewrite | `groupByDay(items: FeedDayItem[]): FeedDayGroup[]`, bucketing on `item.day`. |
| `src/lib/feed-groups.test.ts` | rewrite | Cover the new shape (bucket by `day`, order preserved, empty). |
| `src/components/feed/FeedDayCard.tsx` | create | The new per-(film,day) card. |
| `src/components/feed/FeedDayCard.test.tsx` | create | Card unit tests. |
| `src/components/feed/FeedItemCard.tsx` | delete | Per-event card, superseded. |
| `src/components/feed/FeedItemCard.test.tsx` | delete | Its test. |
| `src/routes/feed.tsx` | modify | Loader → `getFeedGrouped`; `FeedPage` maps groups → `FeedDayCard`. |
| `src/routes/feed.test.tsx` | modify | Loader + render against the grouped shape. |

`format.ts`, `poster.ts`, `labels.ts`, `seo.ts`, `public-layout.tsx`, and the route config
(`routes.ts` — `/` is already the public index) are **unchanged**.

## Components & data types

### Types (`src/api/types.ts`)

Remove `FeedItem` and `FeedResponse`. Add (mirroring NEU-364):

```ts
export interface FeedDayItem {
  film_slug: string;
  film_title: string;
  poster_path: string | null;
  day: string;            // "YYYY-MM-DD" (UTC); one row per film per day
  top_event_type: string; // raw event_type, rendered via eventTypeLabel
  event_count: number;
}

export interface FeedDayResponse {
  items: FeedDayItem[];
  total: number;
  limit: number;
  offset: number;
}
```

### API client (`src/api/public.ts`)

Remove `getFeed`. Add, in the same pure/credential-free style:

```ts
export async function getFeedGrouped(
  baseUrl: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<FeedDayResponse> {
  const url = new URL("/feed/grouped", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET /feed/grouped failed: ${res.status}`);
  return (await res.json()) as FeedDayResponse;
}
```

No credentials/CSRF, base URL injected by the loader. No 404 branch (the feed is always 200).

### Day grouping (`src/lib/feed-groups.ts`, rewritten)

```ts
export interface FeedDayGroup {
  dayKey: string;        // "YYYY-MM-DD" (UTC) — stable React key for the day section
  heading: string;       // formatDayHeading(day), e.g. "Monday, June 23, 2026"
  items: FeedDayItem[];
}

export function groupByDay(items: FeedDayItem[]): FeedDayGroup[];
```

Walk the already-ordered list, opening a new group whenever `item.day` changes; within a group push
items in arrival order. `dayKey = item.day` (already the UTC date string — no `dayKey()` call
needed); `heading = formatDayHeading(item.day)`. Because the backend returns `day DESC,
last_created_at DESC, slug ASC`, groups come out newest-day-first with a deterministic within-day
order — no sorting, no `Date.now()`, so SSR and client output match. Empty input → `[]`.

### Card (`src/components/feed/FeedDayCard.tsx`)

Props `{ item: FeedDayItem }`. A horizontal row; the **entire `<article>` is wrapped in a single
`<Link to={\`/film/${item.film_slug}\`}>`** (no inner links, so the whole card is the tap target):

- **Poster** — `posterUrl(item.poster_path, "w154")` inside a fixed `aspect-[2/3]`, small-width box
  (~48px) so there's no layout shift; `loading="lazy"`, `alt={\`${item.film_title} poster\`}`. When
  `poster_path` is `null` (`posterUrl` → `null`), render a neutral placeholder box of the same
  dimensions — **no broken `<img>`**.
- **Title** — `item.film_title`.
- **Beat line** — an indigo badge `eventTypeLabel(item.top_event_type)` (so `other` → "Update"),
  followed by a muted `+{item.event_count - 1}` span **only when `item.event_count > 1`**
  (`event_count` 3 → "+2"; `event_count` 1 → no suffix).

Visual language (badge colours, rounded border, spacing) mirrors the existing card so the page stays
consistent. `FeedItemCard.tsx` + test are deleted.

### Route component (`src/routes/feed.tsx`)

```ts
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const feed = await getFeedGrouped(env.API_BASE_URL);
  return { feed };
}
```

`FeedPage` maps `groupByDay(feed.items)` to a `<section>` per day (heading
`<time dateTime={group.dayKey}>{group.heading}</time>`), each containing a `FeedDayCard` per item,
keyed by `item.film_slug` (unique within a day). `meta` ("Latest Updates"), the empty state
("No updates yet — check back soon."), and the generic `ErrorBoundary` are unchanged.

## States & error handling

- **Loaded** — `<h1>Latest Updates</h1>` + day-grouped `FeedDayCard`s. HTTP 200, indexable.
- **Empty** (`items: []`) — heading + "No updates yet — check back soon." HTTP 200, **not** an error.
  (After NEU-305's synthesize pipeline merged, real data exists; an empty render means no summarized
  events in the recent window.)
- **Upstream/network error** — `getFeedGrouped` throws; the route-level `ErrorBoundary` renders the
  neutral "We couldn't load the latest updates." with a reload link. No 404 case for the feed.

## Testing (Vitest + MSW + RTL; TDD; all via `task`)

- **`src/api/public.test.ts`** (modify) — `getFeedGrouped`: 200 returns the typed `FeedDayResponse`
  and the request carries `limit`/`offset`; a 500 throws. MSW intercepts. Drops the `getFeed` cases.
- **`src/lib/feed-groups.test.ts`** (rewrite) — `groupByDay` over `FeedDayItem[]`: items sharing a
  `day` bucket together; a new `day` opens a new group; group + item order is preserved (newest day
  first); `dayKey`/`heading` correct; empty input → `[]`.
- **`src/components/feed/FeedDayCard.test.tsx`** (create) — the whole card links to `/film/{slug}`;
  the beat label renders; `+N` appears only when `event_count > 1` and equals `event_count - 1`;
  the poster `<img>` has the `posterUrl` `src` and the alt text; a `null` `poster_path` renders the
  placeholder and **no `<img>`**.
- **`src/routes/feed.test.tsx`** (modify, the AC's core) —
  - **loader:** calls `getFeedGrouped` and returns `{ feed }`. `context` is a
    `RouterContextProvider` with `cloudflareContext` set to `{ env: { API_BASE_URL } }` (copy the
    `film.test.tsx`/existing `feed.test.tsx` pattern); MSW intercepts.
  - **render:** items across multiple days render under day headings, newest day first; each card's
    film links to `/film/{slug}`; the beat label (and `+N` where applicable) shows.
  - **empty:** `items: []` renders the "No updates yet" message.
  - **meta:** returns the templated title (`"Latest Updates · …"`).
- **Gates:** `task test` / `task lint` (zero warnings — unused imports fail) / `task typecheck`
  (`react-router typegen && tsc -b`) all green; `task format` on touched files only. Everything runs
  in the container via `task` (no host Node/pnpm).

## Acceptance-criteria mapping (NEU-362)

| Ticket AC | Where covered |
|---|---|
| Render the grouped feed from the backend per-film-per-day mode | `getFeedGrouped` → `GET /feed/grouped`; `feed.tsx` loader |
| One card per film per day; card shows title + poster, the day's most-significant event type (or "N updates"), links to `/film/{slug}` | `FeedDayCard` (poster + title + beat badge + `+{count-1}`, whole card `<Link>` to `/film/{slug}`); one row per (film, day) from the backend |
| Day-grouped, newest day first; reuse the `groupByDay` / UTC day-heading helpers | rewritten `groupByDay` (bucket by `day`, order preserved) + reused `formatDayHeading` |
| Home feed shows each film at most once per day | Backend `GROUP BY (film, day)`; FE renders one `FeedDayCard` per item |
| Clicking a film card navigates to `/film/{slug}` | Whole-card `<Link to={\`/film/${film_slug}\`}>` |
| Films with no events that day do not appear | Backend inclusion rule (`INNER JOIN event_summary`, `slug IS NOT NULL`); FE renders only returned items |

## Dependency / sequencing

NEU-362 is **blocked by NEU-364** (the `/feed/grouped` endpoint), which is spec'd + planned but
**not yet implemented**. This FE work can be fully built and unit/integration-tested against the
contract (MSW mocks `/feed/grouped`), but cannot be exercised end-to-end against a live backend
until NEU-364 merges. Planning/implementing ahead of the backend is fine; the live `/preview` →
real-data check belongs after NEU-364 ships.

## Out of scope / deferred

- The backend grouping itself (NEU-364) and any change to the per-event `GET /feed`.
- Pagination UI / "load more" (recent window suffices; deep history via film pages + sitemap).
- Summary / source citations / confidence on the grouped card (intentionally minimal; the per-event
  detail lives on the `/film/{slug}` timeline).
- Filtering, per-user/personalized feeds, rich public nav — all later/paid, per the design of record.

## Risks / notes

- **Hydration determinism.** Day headings derive from the `day` string with UTC formatting; order is
  the backend's; no `Date.now()` / relative "Today" labels anywhere — server (UTC) and client output
  match. (Same rule NEU-310/NEU-312 set.)
- **Delete blast radius.** Removing `getFeed`/`FeedItem`/`FeedResponse`/`FeedItemCard`/per-event
  `groupByDay` — grep for every consumer first; the home feed should be the only one. ESLint at zero
  warnings catches any stale import. Run the full suite, not just the new files.
- **Poster nulls + TMDB sizing.** `poster_path` can be `null` (placeholder path) — the placeholder
  box must not emit a broken `<img>`. `"w154"` keeps the thumbnail light.
- **Dev TLS / `workerd ≠ Node`.** The loader's `fetch` runs in the Workers runtime against
  `https://api.upmovies.localhost` (self-signed) in local dev — same caveat as NEU-310/NEU-312;
  tests mock the fetch so CI is unaffected.

## Sources

- NEU-364 design — [2026-06-23-neu-364-per-film-per-day-feed-grouping-design.md](2026-06-23-neu-364-per-film-per-day-feed-grouping-design.md)
  (the `GET /feed/grouped` contract this consumes)
- NEU-312 design — [2026-06-23-neu-312-ssr-feed-landing-design.md](2026-06-23-neu-312-ssr-feed-landing-design.md)
  (the feed page pattern, reusable helpers, determinism rules)
- NEU-310 design — [2026-06-23-neu-310-ssr-film-page-design.md](2026-06-23-neu-310-ssr-film-page-design.md)
  (the `/film/{slug}` target, `posterUrl` usage)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
