# SSR Film Update-Log Page (NEU-310) — Design

- **Date:** 2026-06-23
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-frontend` — a new public SSR route `/film/{slug}`, a public API
  fetcher + types, a TMDB poster helper, and the film-page presentational components. No backend
  changes.
- **Linear:** NEU-310 `[frontend] SSR film update-log page` · project *Movies: Synthesis & Update
  Log* · milestone **M3 — Per-movie update log** · parent NEU-301.
- **Blocked by (all merged):**
  - NEU-309 `[backend] Public film index/detail API + sitemap` — provides `GET /films/{slug}`.
  - NEU-306 `[frontend] React Router v7 SSR foundation` — framework mode + `ssr: true` on
    Cloudflare Workers; `PublicLayout`; the public server-`loader` pattern; `cloudflareContext`.
  - NEU-307 `[frontend] SEO primitives (meta/OG + robots)` — `buildMeta()` and the `getLoadContext`
    wiring that exposes `API_BASE_URL` to loaders.
- **Blocks:** NEU-312 `[frontend] SSR feed landing page`.
- **Refs:** spike NEU-260; design-of-record
  [2026-06-22-synthesis-update-log-design.md](2026-06-22-synthesis-update-log-design.md) §3.3 /
  "Frontend — SSR public surface".

## What this is

The first real public capability page: the per-movie chronological update log at `/film/{slug}`,
server-rendered and crawlable. It shows a film's poster/title, a 7-stage **status-arc** indicator
with the current stage highlighted, and a chronological **timeline** of summarized events — each
with its beat (event type), confidence, date, and outbound source links. It builds entirely on the
three merged foundations (SSR shell, SEO helper, public API); it adds no backend and no new runtime
infrastructure.

## Background (what already exists)

- **Backend — `GET /films/{slug}` (NEU-309, merged).** Returns `FilmDetailResponse`:
  - `slug`, `title`, `release_date` (ISO date | null), `release_year` (int | null),
    `poster_path` (TMDB-relative path like `/abc.jpg` | null), `arc_stage` (one of the seven),
    `events[]`.
  - Each event: `event_type`, `confidence` (`confirmed` | `rumored`), `occurred_at` (ISO
    timestamp), `summary` (the neutral paraphrase), `sources[]`.
  - Each source: `url`, `source`, `title`, `published_at` (ISO timestamp | null).
  - Events are returned **chronologically ascending** (`occurred_at` asc); events without a stored
    summary are omitted. `arc_stage` is **server-derived** (`film.status` baseline advanced by the
    furthest event type) — the FE only displays it. Unknown slug → **404**.
- **Frontend SSR shell (NEU-306, merged).** React Router framework mode, `ssr: true`, on Cloudflare
  Workers. `src/routes.ts` is the route config; public routes nest under
  `layout("routes/public-layout.tsx", […])`. `src/routes/preview.tsx` is the worked example
  (`loader` + `meta` + default component, typed via the generated `./+types/preview`). `root.tsx`
  is the document shell and exports a root `ErrorBoundary` using `isRouteErrorResponse`. Public
  routes use **loader data only** — no TanStack Query / Auth provider — so they never fire `/me`.
- **SSR backend access (NEU-306/307, merged).** `src/lib/load-context.ts` defines
  `cloudflareContext` carrying `{ env: { API_BASE_URL } }`; `workers/app.ts` sets it per request.
  A server loader reads it with `context.get(cloudflareContext)` and fetches the backend — see
  `src/routes/sitemap.ts` (and `sitemap.test.ts` for the test pattern). Client code uses
  `@/env` (`apiBaseUrl`, `publicSiteUrl`) sourced from `import.meta.env`.
- **SEO (NEU-307, merged).** `src/lib/seo.ts` `buildMeta({ title?, description?, pathname, image?,
  type? })` returns `MetaDescriptor[]` (title template `"<title> · Upcoming Movies Tracker"`,
  description, OG, Twitter, canonical). `image` is resolved through `new URL(image, publicSiteUrl)`,
  so an already-absolute URL passes through unchanged. Per-film OG poster passthrough was explicitly
  **deferred to this ticket**.
- **UI primitives.** `src/components/ui/` has only `button`, `input`, `label` (no Badge). Tailwind
  v4. New film-page pieces are purpose-built presentational components.

## Decisions (locked with Tom)

| Question | Decision |
|---|---|
| Page layout | **Single-column editorial.** Compact poster + title + arc as a header band, then the timeline full-width below. Article/blog feel, strong for crawlable long-form. |
| Status-arc style | **Dotted stepper** — seven named stages as circles joined by connector lines; passed = filled, current = ringed accent, future = hollow. All seven stay named (AC). Narrow screens scroll/wrap. |
| Timeline order | **Oldest-first (ascending)** — matches the arc's left→right direction and the API's native order; no client-side reversal. |
| SSR data layer | **Approach 1 — dedicated public API module, base-URL injected.** New `src/api/public.ts` `getFilm(baseUrl, slug)`; the loader passes `env.API_BASE_URL` from `cloudflareContext`. The authed `apiFetch` (client-only, credentials/CSRF) is left untouched. |
| Poster source | **Build-time `VITE_TMDB_IMAGE_BASE`** (default `https://image.tmdb.org/t/p`) + a `posterUrl(path, size)` helper. Public CDN constant, not a secret; identical in SSR + client. |
| Per-film OG image | The page poster (an absolute TMDB URL) is passed to `buildMeta({ image })` — fulfilling NEU-307's deferred passthrough. |
| `meta` description | The **latest event summary, truncated to ~155 chars**, with a templated fallback when the log is empty. |
| Date formatting | `Intl.DateTimeFormat("en-US", { …, timeZone: "UTC" })` → e.g. `Mar 14, 2025`. Fixed locale + UTC to keep SSR and client identical (no hydration mismatch). |

### Approaches considered for the SSR data layer

- **Approach 1 (chosen): dedicated public API module, base-URL injected.** `getFilm(baseUrl, slug)`
  wraps a plain `fetch`; the loader supplies the Worker-env base URL. Matches the merged
  `sitemap.ts` pattern, carries no credentials/CSRF, satisfies the AC's "API client + types", and is
  unit-testable with a fake base URL + MSW. A second fetch helper beside `apiFetch` is intentional
  (server/public vs client/authed).
- **Approach 2 (rejected): generalize `apiFetch` to be isomorphic.** One helper, but invasive on the
  authed path and drags credentials/CSRF/`import.meta.env` into a public SSR path that doesn't want
  them — regression risk in login/admin for no benefit.
- **Approach 3 (rejected): inline `fetch` in the loader** (like the sitemap proxy). Least code, but
  fails the AC ("API client + types") and isn't reusable by NEU-312 or unit-testable on its own.

## Architecture

```
  GET /film/{slug}
        │  (Cloudflare Worker, RR framework mode)
        ▼
  src/routes/film.tsx
    loader({ params, context })
      └─ env = context.get(cloudflareContext).env        // API_BASE_URL
      └─ getFilm(env.API_BASE_URL, params.slug)          // src/api/public.ts
            ├─ 200 → FilmDetail
            ├─ 404 → null  ──► loader throws Response(404) ──► route ErrorBoundary (noindex)
            └─ other/network → throw ──────────────────────► route ErrorBoundary (generic)
      └─ return { film }
    meta({ data, location }) → buildMeta({ title, description, image: posterUrl(...), type:"article" })
    default FilmPage({ loaderData })
      └─ FilmHeader (poster + title + year + ArcStepper)
      └─ EventTimeline → EventCard* → SourceLinks      (empty events[] → "No updates yet")
    ErrorBoundary  (isRouteErrorResponse → 404 "Film not found" | generic), rendered in PublicLayout
```

### File layout

| File | Action | Responsibility |
|---|---|---|
| `src/routes.ts` | modify | Add `route("film/:slug", "routes/film.tsx")` inside the `public-layout` block. |
| `src/routes/film.tsx` | create | Route module: `loader`, `meta`, default `FilmPage`, route-level `ErrorBoundary`. |
| `src/api/public.ts` | create | `getFilm(baseUrl, slug): Promise<FilmDetail \| null>` — typed `fetch` wrapper. |
| `src/api/types.ts` | modify | Add `ArcStage`, `FilmSource`, `FilmEvent`, `FilmDetail` (mirror NEU-309 DTOs). |
| `src/lib/poster.ts` | create | `posterUrl(path, size)` → TMDB CDN URL (or `null`). |
| `src/lib/format.ts` | create | `formatEventDate(iso)` (UTC, `en-US`); `truncate(text, n)` for the meta description. |
| `src/components/film/ArcStepper.tsx` | create | The dotted-stepper arc. |
| `src/components/film/EventTimeline.tsx` | create | Maps events → `EventCard`s; renders the empty state. |
| `src/components/film/EventCard.tsx` | create | One event: beat + confidence + date + summary + `SourceLinks`. |
| `src/components/film/SourceLinks.tsx` | create | Outbound source anchors. |
| `src/components/film/FilmHeader.tsx` | create | Poster + title + year + `ArcStepper`. |
| `src/components/film/labels.ts` | create | `ARC_STAGES` order + `EVENT_TYPE_LABELS` + arc-stage labels. |
| `src/env.ts` | modify | Add `tmdbImageBase` from `VITE_TMDB_IMAGE_BASE`. |
| `.env.example` | modify | Add `VITE_TMDB_IMAGE_BASE=https://image.tmdb.org/t/p`. |

(Tests listed under **Testing**.)

## Components & data types

### Types (`src/api/types.ts`, mirroring NEU-309 DTOs)

```ts
export type ArcStage =
  | "announced" | "cast" | "shooting" | "wrapped" | "dated" | "trailer" | "released";

export interface FilmSource {
  url: string;
  source: string;
  title: string;
  published_at: string | null;
}
export interface FilmEvent {
  event_type: string;
  confidence: string; // "confirmed" | "rumored" (mirrors backend free text; rendered via a map)
  occurred_at: string;
  summary: string;
  sources: FilmSource[];
}
export interface FilmDetail {
  slug: string;
  title: string;
  release_date: string | null;
  release_year: number | null;
  poster_path: string | null;
  arc_stage: ArcStage;
  events: FilmEvent[];
}
```

### `src/api/public.ts`

```ts
export async function getFilm(baseUrl: string, slug: string): Promise<FilmDetail | null> {
  const res = await fetch(new URL(`/films/${encodeURIComponent(slug)}`, baseUrl), {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /films/${slug} failed: ${res.status}`);
  return (await res.json()) as FilmDetail;
}
```

No credentials, no CSRF, no `import.meta.env` — the base URL is injected by the caller, so this is
pure and works in the Worker runtime and under test.

### Presentational components (small, isolated, testable)

- **`ArcStepper`** — props `{ current: ArcStage }`. Renders `ARC_STAGES` as the dotted stepper.
  Done/current/future is `index < cur` / `index === cur` / `index > cur`, where `cur =
  ARC_STAGES.indexOf(current)`. If `current` is somehow off-list (`indexOf` → `-1`), every stage
  renders as "future" (a safe, non-crashing default).
- **`FilmHeader`** — props `{ film }`. Poster (`posterUrl(film.poster_path, "w342")`, omitted when
  null), title, release year, and `ArcStepper`.
- **`EventTimeline`** — props `{ events }`. Renders `EventCard`s in the given (ascending) order; when
  `events` is empty, renders the **empty state** ("No updates yet — check back soon.").
- **`EventCard`** — props `{ event }`. Beat badge (`EVENT_TYPE_LABELS[event_type]`, title-cased
  fallback), confidence badge (`confirmed` → green "Confirmed", `rumored` → amber "Rumored",
  fallback neutral), `formatEventDate(event.occurred_at)`, the `summary`, and `SourceLinks`.
- **`SourceLinks`** — props `{ sources }`. One `<a>` per source, labeled by `source.source`
  (tooltip/`title` = `source.title`), `target="_blank" rel="noopener noreferrer nofollow"`.

### Helpers

- `posterUrl(path: string | null, size: string): string | null` →
  `path ? \`${env.tmdbImageBase}/${size}${path}\` : null`. Page uses `w342`; OG image uses `w780`.
- `formatEventDate(iso: string): string` → `Intl.DateTimeFormat("en-US", { year: "numeric",
  month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso))`.
- `truncate(text: string, max = 155): string` for the meta description.

## `meta` and SEO

```ts
export function meta({ data, location }: Route.MetaArgs): Route.MetaDescriptors {
  if (!data?.film) {
    return [
      ...buildMeta({ title: "Film not found", pathname: location.pathname }),
      { name: "robots", content: "noindex" },
    ];
  }
  const { film } = data;
  const title = film.release_year ? `${film.title} (${film.release_year})` : film.title;
  const latest = film.events.at(-1)?.summary;
  const description = latest
    ? truncate(latest)
    : `Release dates, casting, trailers, and the full update timeline for ${title}.`;
  return buildMeta({
    title,
    description,
    pathname: location.pathname,
    image: posterUrl(film.poster_path, "w780") ?? undefined,
    type: "article",
  });
}
```

- `og:image`/`twitter:image` only when a poster exists (the helper already gates on `image`).
- On a loader 404/error, RR's thrown `Response` makes the HTTP status a real **404** — the
  authoritative crawler signal. When `meta` runs for the errored route (`data` undefined), the
  not-found branch additionally emits `robots: noindex` as belt-and-suspenders. Whether `meta`
  executes for a thrown-loader route is **verified during implementation**; the 404 status holds
  regardless.

## States & error handling

- **Loaded:** `FilmHeader` + `EventTimeline` of summarized events. HTTP 200, indexable.
- **Empty** (`events: []`, e.g. a real film whose events have no summaries yet): `FilmHeader` + the
  "No updates yet" message. **Not** a 404 — the film exists; HTTP 200, indexable (thin pages are
  acceptable for v1; a future noindex-for-thin-pages policy is out of scope).
- **404** (unknown slug): the loader throws `new Response(null, { status: 404 })`. `film.tsx`'s
  route-level `ErrorBoundary` (using `isRouteErrorResponse`) renders a "Film not found" card with a
  link to `/` inside `PublicLayout`; the response status is 404 (the authoritative crawler signal),
  and `meta` adds `robots: noindex` when it runs for the errored route — see the note under `meta`.
- **Upstream/network error:** `getFilm` throws; the same `ErrorBoundary`'s generic branch renders a
  neutral error message. (Edge/server error reporting stays out of scope, per NEU-306.)

## Configuration

- **New FE env `VITE_TMDB_IMAGE_BASE`** (default `https://image.tmdb.org/t/p`) — added to `env.ts`
  and `.env.example`. Build-time, isomorphic, no secret.
- **Existing `API_BASE_URL`** (Worker runtime env, already in `wrangler.jsonc`) — read by the loader
  via `cloudflareContext`, same as the NEU-307 sitemap proxy. No new Worker var.
- **Existing `VITE_PUBLIC_SITE_URL`** — used by `buildMeta` for canonical/og:url. Unchanged.

## Testing (Vitest + MSW + RTL; TDD)

- **`src/api/public.test.ts`** — `getFilm`: 200 returns the typed object; 404 returns `null`; 500
  throws. MSW intercepts the backend fetch.
- **`src/components/film/ArcStepper.test.tsx`** — stage math: the current stage is highlighted and
  earlier stages read as done for a representative `arc_stage`; an off-list value renders safely.
- **`src/routes/film.test.tsx`** (the AC's core) —
  - **loader:** calls the API with the slug and returns film data; a 404 from the API makes the
    loader throw a 404 `Response`. The loader `context` is built by copying the existing
    `sitemap.test.ts` pattern (a `RouterContextProvider` with `cloudflareContext` set to a stub
    `{ env: { API_BASE_URL } }`); MSW intercepts the fetch.
  - **render:** the arc highlights the correct stage; events render in ascending order; each card
    shows beat, confidence, formatted date, and summary; **source links are outbound**
    (`target="_blank"`, `rel` contains `noopener`).
  - **empty:** `events: []` renders the "No updates yet" message with the arc still present.
  - **404:** the `ErrorBoundary` renders "Film not found".
  - **meta:** success returns the templated title, a description, `og:image`, and the canonical
    link; the not-found case includes `robots: noindex`.
- **Gates:** `task test` / `task lint` (zero warnings — unused imports fail) / `task typecheck`
  (`react-router typegen && tsc -b`) all green; `task format` on touched files only. Everything runs
  in the container via `task` (no host Node/pnpm).

## Acceptance-criteria mapping (NEU-310)

| Ticket AC | Where covered |
|---|---|
| SSR route `/film/{slug}` on the public layout; loader fetches `GET /films/{slug}` | `routes.ts` (under `public-layout`) + `film.tsx` `loader` → `getFilm(env.API_BASE_URL, slug)` |
| Status-arc indicator (7 named stages) with current highlighted | `ArcStepper` (dotted stepper) driven by the server-supplied `arc_stage` |
| Chronological event timeline: summary, beat, confidence, date, outbound source links | `EventTimeline` / `EventCard` / `SourceLinks`, ascending order |
| Per-film `<title>`/meta/OG via the SEO helper; empty + 404 states | `meta()` via `buildMeta` (+ poster og:image); empty state in `EventTimeline`; 404 via route `ErrorBoundary` |
| API client + types for the film endpoints | `src/api/public.ts` `getFilm` + `FilmDetail`/`FilmEvent`/`FilmSource`/`ArcStage` in `types.ts` |
| Tests: Vitest + MSW cover loader + render (timeline, arc, source links, 404); `tsc -b` + eslint green | `public.test.ts` + `film.test.tsx` + `ArcStepper.test.tsx`; gates above |

## Out of scope / deferred

| Deferred item | Home |
|---|---|
| `GET /films` index fetch + film index/cards | NEU-312 (feed landing) / later |
| Extracting `EventCard`/`SourceLinks` into shared components for reuse | NEU-312, if/when it needs them |
| Site-wide default OG image asset; per-stage icons | Later |
| Pagination / virtualization of very long update logs | Later (not needed at current volumes) |
| `noindex` policy for thin/empty films | Later |
| Edge/server-side error reporting (`@sentry/cloudflare`) | Later (NEU-306 kept Sentry client-only) |

## Risks / notes

- **Hydration determinism.** Date formatting MUST be locale- and timezone-fixed (`en-US`, UTC) or
  the server (UTC) and client (user TZ) renders diverge → hydration mismatch. No `Date.now()` /
  locale-dependent rendering in the component tree.
- **`workerd ≠ Node`.** The loader's `fetch` runs in the Workers runtime; `getFilm` uses only web
  `fetch`/`URL` (no Node APIs). `vite preview` exercises the real runtime before deploy.
- **Dev TLS.** In local dev the loader fetches `https://api.upmovies.localhost` (self-signed) from
  workerd, which may reject the cert — same caveat as the NEU-307 sitemap proxy. Tests mock the
  fetch, so CI is unaffected; live local verification may need the cert trusted.
- **`arc_stage` trust.** The FE treats `arc_stage` as authoritative (server-derived) and only
  highlights; it does not re-derive the stage from event types.
- **`meta` on errored routes.** Confirm during implementation whether RR framework mode calls a
  route's `meta` export when its `loader` threw. If it does not, the `robots: noindex` on the 404
  is dropped — acceptable, because the HTTP 404 status is itself the authoritative no-index signal.

## Sources

- React Router — route module (`loader`, `meta` with `data`, `ErrorBoundary`) —
  https://reactrouter.com/start/framework/route-module
- React Router — client/server data & error handling (`isRouteErrorResponse`) —
  https://reactrouter.com/how-to/error-boundary
- NEU-309 design — [2026-06-22-neu-309-public-film-api-design.md](2026-06-22-neu-309-public-film-api-design.md)
- NEU-306 design — [2026-06-22-neu-306-ssr-foundation-design.md](2026-06-22-neu-306-ssr-foundation-design.md)
- NEU-307 design — [2026-06-23-neu-307-seo-primitives-design.md](2026-06-23-neu-307-seo-primitives-design.md)
- TMDB image URLs (`{base}/{size}{path}`) — https://developer.themoviedb.org/docs/image-basics
