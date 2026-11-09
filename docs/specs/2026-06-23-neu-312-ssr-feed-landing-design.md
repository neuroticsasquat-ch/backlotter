# SSR Feed Landing Page (NEU-312) — Design

- **Date:** 2026-06-23
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-frontend` — the public SSR feed at `/` (the index of the public
  layout), a `getFeed` public API fetcher + types, a pure day-grouping helper, a `FeedItemCard`
  presentational component, a minimal public header, and the `/`-swap that moves the authed Home to
  `/app`. No backend changes.
- **Linear:** NEU-312 `[frontend] SSR feed landing page` · project *Movies: Synthesis & Update Log* ·
  milestone **M4 — Global "updated today" feed** · parent NEU-302 (Story).
- **Blocked by (all merged):**
  - NEU-311 `[backend] Global "updated today" feed API` — provides `GET /feed` (PR #35).
  - NEU-310 `[frontend] SSR film update-log page` — the FE pattern this mirrors; links target
    `/film/{slug}`; ships the reusable `SourceLinks` / `labels.ts` / `format.ts` (PR #6).
  - NEU-307 `[frontend] SEO primitives` — `buildMeta()` (PR #5).
  - NEU-306 `[frontend] React Router v7 SSR foundation` — framework mode + `ssr: true` on Cloudflare
    Workers; `PublicLayout`; the public server-`loader` pattern; `cloudflareContext` (PR #4).
- **Blocks:** nothing — this is the last ticket in M4 and the public front door.
- **Refs:** spike NEU-260; design-of-record
  [2026-06-22-synthesis-update-log-design.md](2026-06-22-synthesis-update-log-design.md) §4.2 /
  "Frontend — SSR public surface"; sibling design
  [2026-06-23-neu-310-ssr-film-page-design.md](2026-06-23-neu-310-ssr-film-page-design.md).

## What this is

The public discovery front door: a server-rendered, crawlable landing feed at `/` showing what
changed across **all** tracked films, **grouped by day, newest first**. Each item shows the film
(linking to its `/film/{slug}` page), the neutral summary, its beat (event type) + confidence, the
date, and outbound source links. The public root becomes this feed; the current authed Home stub
moves aside to `/app`. It builds entirely on the four merged foundations (feed API, SSR shell, SEO
helper, film page) and adds no backend and no new runtime infrastructure.

## Background (what already exists)

- **Backend — `GET /feed` (NEU-311, merged).** Public, no-auth. Returns `FeedResponse`:
  - `items[]`, `total` (int), `limit` (int), `offset` (int). Pagination is offset/limit; `limit`
    defaults to **50** (1–100), `offset` defaults to **0** (≥0). Out-of-range → 422.
  - Each `FeedItem`: `film_slug`, `film_title`, `event_type`, `confidence`
    (`confirmed` | `rumored`), `occurred_at` (ISO timestamp), `created_at` (ISO timestamp), `summary`
    (the neutral paraphrase), `sources[]`.
  - Each source: `url`, `source`, `title`, `published_at` (ISO timestamp | null) — **identical shape
    to the film page's `FilmSource`**.
  - Items are ordered by **`event.created_at` descending** (the "updated today" axis) — the client
    groups by day from this ordered list. Summary-less events are omitted server-side.
- **Frontend SSR shell (NEU-306, merged).** React Router framework mode, `ssr: true`, on Cloudflare
  Workers. `src/routes.ts` is the route config; public routes nest under
  `layout("routes/public-layout.tsx", […])`. `PublicLayout` is currently bare (`min-h-screen` +
  `<Outlet/>`) with a comment "Real header/nav lands in M3/M4." A loader reads the backend base URL
  from `context.get(cloudflareContext).env.API_BASE_URL` — see `src/routes/film.tsx` and
  `src/routes/sitemap.ts`. Public routes use **loader data only** (no TanStack Query / Auth provider)
  so they never fire `/me`.
- **Film page (NEU-310, merged).** `src/routes/film.tsx` is the loader→meta→component→`ErrorBoundary`
  template this mirrors. It shipped reusable pieces:
  - `src/components/film/SourceLinks.tsx` — outbound source anchors (`target="_blank"`,
    `rel="noopener noreferrer nofollow"`), typed by `FilmSource`. **Film-agnostic; reused as-is.**
  - `src/components/film/labels.ts` — `eventTypeLabel(eventType)` (known map + title-case fallback).
    **Reused as-is.**
  - `src/lib/format.ts` — `formatEventDate(iso)` (`Intl`, `en-US`, `timeZone: "UTC"`),
    `truncate(text, n)`. **Reused; extended with day-key/day-heading helpers.**
  - `src/components/film/EventCard.tsx` — the film-page event card. Renders an indigo beat badge, a
    local `ConfidenceBadge` (green/amber/neutral), a right-aligned `<time>`, the summary, and
    `SourceLinks`. `ConfidenceBadge` is **module-local (not exported)**.
- **SEO (NEU-307, merged).** `src/lib/seo.ts` `buildMeta({ title?, description?, pathname, image?,
  type? })` → `MetaDescriptor[]` (title template `"<title> · Upcoming Movies Tracker"`, description,
  OG, Twitter, canonical).
- **Current routing & root-path assumptions.** `/` is today the **authed** Home:
  `index("pages/Home.tsx")` nested under `spa-layout → RequireAuth → AppLayout`. Things that assume
  `/` means the authed home: `Login.tsx` (post-login `params.get("next") || "/"`), `Signup.tsx`
  (`navigate("/")`), `AppLayout.tsx` (brand `Link to="/"`), `RequireAdmin.tsx` (non-admin bounce
  `Navigate to="/"`). `RequireAuth.tsx` already encodes `next = pathname + search` and redirects to
  `/login?next=…`, so authed deep-links round-trip correctly. Logout (`AuthContext`) does not
  navigate.

## Decisions (locked with Tom)

| Question | Decision |
|---|---|
| Authed Home relocation | **Move to `/app`.** `index("pages/Home.tsx")` → `route("app", "pages/Home.tsx")`. Post-login/signup and the authed brand/bounce links retarget to `/app`. Clean public-vs-app split. |
| Pagination | **Recent window only.** The loader fetches the default page (`limit 50, offset 0`); no pagination UI. Deep per-film history is already crawlable via the film pages + sitemap; the feed's job is "what's new." Matches NEU-310's deferral and the AC's "pagination **or** recent window." |
| Card reuse | **Focused `FeedItemCard`** in a new `components/feed/`, reusing `SourceLinks` + `labels.ts` + `format.ts` as-is. The two small beat/confidence badge spans are duplicated from `EventCard` (which keeps `ConfidenceBadge` module-local) — **zero changes to the just-shipped film code.** |
| Day grouping | Group the `created_at`-desc list by **UTC calendar date**, preserving order → newest day first, newest within day first. A pure, unit-tested `groupByDay` helper. |
| Date determinism | **Absolute date headers only** (e.g. `Monday, June 23, 2026`). **No "Today/Yesterday"** — relative labels need the current date (non-deterministic SSR vs client, a `Date.now()` dependency, hydration-mismatch risk). Same rule NEU-310 set for event dates. |
| Homepage copy | `<h1>` and `<title>` = **"Latest Updates"**. |
| `/preview` placeholder | **Retire it.** The NEU-306 throwaway proof route is superseded by two real public pages; delete `preview.tsx` + `preview.test.tsx` + its `routes.ts` line so crawlers don't index a placeholder. |
| Public header | **Add a minimal header to `PublicLayout`** — just a brand wordmark linking to `/` (no menu), giving the feed + film pages a consistent public shell. Fulfils `PublicLayout`'s own "header/nav lands in M3/M4" note. |
| SSR data layer | **Same as NEU-310 (Approach 1):** dedicated public API module, base-URL injected. New `getFeed(baseUrl, opts)` beside `getFilm`; the loader supplies the Worker-env base URL. The authed `apiFetch` (client-only, credentials/CSRF) is untouched. |

## Architecture

```
  GET /  (public-layout index)
        │  (Cloudflare Worker, RR framework mode)
        ▼
  src/routes/feed.tsx
    loader({ context })
      └─ env = context.get(cloudflareContext).env            // API_BASE_URL
      └─ getFeed(env.API_BASE_URL)                            // src/api/public.ts → FeedResponse
            ├─ 200 → FeedResponse { items, total, limit, offset }
            └─ non-OK/network → throw ─────────────► route ErrorBoundary (generic, neutral)
      └─ return { feed }
    meta() → buildMeta({ title: "Latest Updates", description, type: "website" })
    default FeedPage({ loaderData })
      └─ <h1>Latest Updates</h1>
      └─ groupByDay(feed.items)            // src/lib/feed-groups.ts (pure)
           → <section> per day: <time> day heading + FeedItemCard*    // empty → "No updates yet"
                FeedItemCard → <Link to=/film/{slug}> + beat + confidence + date + summary + SourceLinks
    ErrorBoundary (generic "couldn't load updates" + link), rendered inside PublicLayout (+ header)
```

### File layout

| File | Action | Responsibility |
|---|---|---|
| `src/routes.ts` | modify | Add `index("routes/feed.tsx")` to the `public-layout` block; change `index("pages/Home.tsx")` → `route("app", "pages/Home.tsx")`; remove the `preview` line. |
| `src/routes/feed.tsx` | create | Route module: `loader`, `meta`, default `FeedPage`, generic route-level `ErrorBoundary`. |
| `src/routes/public-layout.tsx` | modify | Add the minimal public header (brand wordmark `Link to="/"`). |
| `src/api/public.ts` | modify | Add `getFeed(baseUrl, { limit?, offset? }): Promise<FeedResponse>`. |
| `src/api/types.ts` | modify | Add `FeedItem` + `FeedResponse` (sources reuse `FilmSource`). |
| `src/lib/feed-groups.ts` | create | Pure `groupByDay(items): DayGroup[]`. |
| `src/lib/format.ts` | modify | Add `dayKey(iso)` (UTC `YYYY-MM-DD`) + `formatDayHeading(iso)` (UTC, `en-US`, weekday-long). |
| `src/components/feed/FeedItemCard.tsx` | create | One feed item: film link + beat badge + confidence badge + date + summary + `SourceLinks`. |
| `src/pages/Login.tsx` | modify | Post-login default `params.get("next") \|\| "/"` → `\|\| "/app"`. |
| `src/pages/Signup.tsx` | modify | Post-signup `navigate("/")` → `navigate("/app")`. |
| `src/components/AppLayout.tsx` | modify | Brand `Link to="/"` → `to="/app"`. |
| `src/components/RequireAdmin.tsx` | modify | Non-admin bounce `Navigate to="/"` → `to="/app"`. |
| `src/routes/preview.tsx`, `src/routes/preview.test.tsx` | delete | Retire the NEU-306 placeholder. |

(Tests listed under **Testing**.)

## Components & data types

### Types (`src/api/types.ts`, mirroring NEU-311 DTOs)

```ts
export interface FeedItem {
  film_slug: string;
  film_title: string;
  event_type: string;
  confidence: string; // "confirmed" | "rumored" (backend free text; rendered via a map)
  occurred_at: string;
  created_at: string; // the "updated today" axis; feed is ordered by this, descending
  summary: string;
  sources: FilmSource[]; // identical shape to the film page's source
}

export interface FeedResponse {
  items: FeedItem[];
  total: number;
  limit: number;
  offset: number;
}
```

`FilmSource` is reused unchanged (no new source type).

### `src/api/public.ts`

```ts
export async function getFeed(
  baseUrl: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<FeedResponse> {
  const url = new URL("/feed", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET /feed failed: ${res.status}`);
  return (await res.json()) as FeedResponse;
}
```

No credentials, no CSRF, no `import.meta.env` — base URL injected by the caller; runs in the Workers
runtime and under test. Unlike `getFilm` there is no 404 branch (the feed is always 200).

### Day grouping (`src/lib/feed-groups.ts`, pure)

```ts
export interface DayGroup {
  dayKey: string;   // "YYYY-MM-DD" (UTC) — stable React key
  heading: string;  // formatDayHeading(firstItem.created_at)
  items: FeedItem[];
}

export function groupByDay(items: FeedItem[]): DayGroup[];
```

Iterates the already-`created_at`-desc list, opening a new group whenever `dayKey(created_at)`
changes. Because the input is ordered, groups come out newest-day-first and items stay
newest-first within a day — no sorting, no `Date.now()`. An empty input yields `[]`.

### Date helpers (`src/lib/format.ts`, additions)

- `dayKey(iso: string): string` → the UTC `YYYY-MM-DD` of the timestamp (e.g.
  `new Date(iso).toISOString().slice(0, 10)`, which is UTC-correct because the value is an absolute
  instant). Used only for bucketing + React keys.
- `formatDayHeading(iso: string): string` → `Intl.DateTimeFormat("en-US", { weekday: "long",
  year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })` → e.g. `Monday, June 23, 2026`.

### `FeedItemCard` (`src/components/feed/FeedItemCard.tsx`)

Props `{ item: FeedItem }`. Mirrors `EventCard`'s visual language but is feed-specific:

- The **film title as a `<Link to={\`/film/${item.film_slug}\`}>`** — the headline of the card (the
  film page's card omits this because you're already on the film).
- A beat badge (`eventTypeLabel(item.event_type)`) and a confidence badge (`confirmed` → green
  "Confirmed", `rumored` → amber "Rumored", fallback neutral) — the same small markup as
  `EventCard`'s, duplicated here (its `ConfidenceBadge` is module-local). ~6 lines; intentional, per
  the "zero changes to shipped film code" decision.
- `formatEventDate(item.created_at)` as a `<time dateTime={item.created_at}>`.
- The `item.summary`.
- `<SourceLinks sources={item.sources} />` (reused).

### Public header (`src/routes/public-layout.tsx`)

A minimal header band above `<Outlet/>`: a single brand wordmark
`<Link to="/">Upcoming Movies Tracker</Link>` in a `max-w-4xl` container. No menu, no auth — public
pages stay provider-free. Shared by the feed and film pages.

## `meta` and SEO (`src/routes/feed.tsx`)

```ts
export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Latest Updates",
    description:
      "The latest casting, trailers, release dates, and production updates across every movie we track.",
    pathname: location.pathname,
    type: "website",
  });
}
```

`<title>` → `"Latest Updates · Upcoming Movies Tracker"`; canonical/og:url → the site root. No
og:image (no site-wide default OG asset — deferred, same as NEU-310). `meta` needs no loader data
(the feed always renders), so it does not depend on `loaderData`.

## States & error handling

- **Loaded:** `<h1>Latest Updates</h1>` + day-grouped `FeedItemCard`s. HTTP 200, indexable.
- **Empty** (`items: []` — e.g. no summarized events yet): the heading + "No updates yet — check
  back soon." HTTP 200, indexable. **Not** an error.
- **Upstream/network error:** `getFeed` throws; the route-level `ErrorBoundary` renders a neutral
  "We couldn't load the latest updates. Please try again in a moment." with a link. There is no 404
  case for the feed. (Edge/server error reporting stays out of scope, per NEU-306.)

## The `/`-swap, in detail

1. **`routes.ts`:** add `index("routes/feed.tsx")` inside `layout("routes/public-layout.tsx", [...])`
   (the public layout currently has no index, so `/` resolves to the feed); change the SPA tree's
   `index("pages/Home.tsx")` to `route("app", "pages/Home.tsx")`; delete the `preview` route line.
   Layouts don't require an index, so `SpaLayout`/`AppLayout` are fine without one.
2. **Redirect retargets to `/app`:** `Login.tsx` default (`|| "/"` → `|| "/app"`), `Signup.tsx`
   (`navigate("/")` → `navigate("/app")`), `AppLayout.tsx` brand link, `RequireAdmin.tsx` bounce.
3. **`RequireAuth` unchanged:** an unauthed hit on `/app` encodes `next=/app` and round-trips through
   `/login?next=/app`; Login honours `next` first and only falls back to `/app`.
4. **`film.tsx` ErrorBoundary** keeps its "Back to home → `/`" link — now correctly the public feed.

## Testing (Vitest + MSW + RTL; TDD; all via `task`)

- **`src/api/public.test.ts`** (modify) — `getFeed`: 200 returns the typed `FeedResponse` and the
  request carries `limit`/`offset` query params; a 500 throws. MSW intercepts the backend fetch.
- **`src/lib/feed-groups.test.ts`** (create) — `groupByDay`: items on the same UTC day bucket
  together; a day boundary opens a new group; group + item order is newest-first; empty input → `[]`.
- **`src/components/feed/FeedItemCard.test.tsx`** (create) — renders the film title as a link to
  `/film/{slug}`; shows the beat label, confidence badge, formatted date, and summary; source links
  are outbound (`target="_blank"`, `rel` contains `noopener`).
- **`src/routes/feed.test.tsx`** (the AC's core) —
  - **loader:** calls the feed API and returns `{ feed }`. The loader `context` is a
    `RouterContextProvider` with `cloudflareContext` set to a stub `{ env: { API_BASE_URL } }`
    (copy the `film.test.tsx` / `sitemap.test.ts` pattern); MSW intercepts the fetch.
  - **render:** items across multiple days render under day headings, newest day first; each card's
    film title links to `/film/{slug}`; beat, confidence, date, and summary show.
  - **empty:** `items: []` renders the "No updates yet" message under the heading.
  - **meta:** returns the templated title (`"Latest Updates · …"`), a description, and the canonical
    link.
- **`src/routes/public-layout.test.tsx`** (create) — the brand wordmark renders and links to `/`.
- **Swap tests** (modify, where they assert a redirect target): `Login` / `Signup` / `RequireAdmin`
  now expect `/app`. (Plan confirms which of these test files exist.)
- **Gates:** `task test` / `task lint` (zero warnings — unused imports fail) / `task typecheck`
  (`react-router typegen && tsc -b`) all green; `task format` on touched files only. Everything runs
  in the container via `task` (no host Node/pnpm).

## Acceptance-criteria mapping (NEU-312)

| Ticket AC | Where covered |
|---|---|
| SSR public landing route `/` (public root becomes the feed; authed Home moves aside) on the public layout; loader fetches `GET /feed` | `routes.ts` (`index` under `public-layout`; `Home` → `/app`) + `feed.tsx` `loader` → `getFeed(env.API_BASE_URL)` |
| Updates **grouped by day**, newest first; each item shows film, neutral summary, beat + confidence, and **links to `/film/{slug}`** | `groupByDay` + `FeedPage` day sections + `FeedItemCard` (film `<Link>`, beat/confidence badges, summary) |
| `<title>` / meta / OG; pagination (or recent window); empty state | `meta()` via `buildMeta`; recent-window (default page, no UI); empty state in `FeedPage` |
| API client + types for the feed endpoint | `getFeed` in `src/api/public.ts` + `FeedItem`/`FeedResponse` in `types.ts` |
| Tests: Vitest + MSW cover loader + render (day grouping, film links, empty); `tsc -b` + eslint green | `feed.test.tsx` + `feed-groups.test.ts` + `FeedItemCard.test.tsx` + `public.test.ts`; gates above |

## Out of scope / deferred

| Deferred item | Home |
|---|---|
| Feed pagination UI / "load more" / crawlable prev-next pages | Later (recent window suffices for v1; deep history via film pages + sitemap) |
| Filtering by confidence / event type (confirmed-only, etc.) | Paid tier (design-of-record "Out of v1") |
| Per-user / personalized feed | Paid tier (public surface is anonymous in v1) |
| Rich public nav (menus, search, footer) | Later — this ticket adds only the brand wordmark |
| Site-wide default OG image asset; per-event icons | Later |
| Real-time / incremental feed refresh | Later (SSR snapshot per request is fine) |

## Risks / notes

- **Hydration determinism.** All date formatting (`formatEventDate`, `formatDayHeading`, `dayKey`)
  is locale- and timezone-fixed (`en-US`, UTC). No `Date.now()` / relative "Today" labels / locale-
  dependent rendering anywhere in the component tree, or the server (UTC) and client (user TZ)
  diverge → hydration mismatch.
- **`workerd ≠ Node`.** The loader's `fetch` runs in the Workers runtime; `getFeed` uses only web
  `fetch`/`URL`. `vite preview` exercises the real runtime before deploy.
- **Dev TLS.** In local dev the loader fetches `https://api.upmovies.localhost` (self-signed) from
  workerd, which may reject the cert — same caveat as the NEU-307 sitemap proxy and NEU-310 film
  page. Tests mock the fetch, so CI is unaffected.
- **Swap blast radius.** Changing `/` is global. The plan greps for every `to="/"` / `navigate("/")`
  / `next` assumption (enumerated above) and updates affected component tests, so login/signup/admin
  flows keep working. Verified by running the full suite, not just the new files.
- **`/preview` removal.** Confirm no other route/test/import references `preview` before deleting
  (grep). It was a standalone NEU-306 proof; nothing should depend on it.

## Sources

- React Router — route module (`loader`, `meta`, `ErrorBoundary`), `index` routes —
  https://reactrouter.com/start/framework/routing
- NEU-311 plan — [../plans/2026-06-22-neu-311-feed-api.md](../plans/2026-06-22-neu-311-feed-api.md)
  (the `GET /feed` contract this consumes)
- NEU-310 design — [2026-06-23-neu-310-ssr-film-page-design.md](2026-06-23-neu-310-ssr-film-page-design.md)
  (the FE pattern, reusable components, determinism rules)
- NEU-306 design — [2026-06-22-neu-306-ssr-foundation-design.md](2026-06-22-neu-306-ssr-foundation-design.md)
- NEU-307 design — [2026-06-23-neu-307-seo-primitives-design.md](2026-06-23-neu-307-seo-primitives-design.md)
- Design of record — [2026-06-22-synthesis-update-log-design.md](2026-06-22-synthesis-update-log-design.md)
