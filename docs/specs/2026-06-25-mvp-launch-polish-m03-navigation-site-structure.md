# M3 — Navigation & site structure — Milestone Design

- **Date:** 2026-06-25
- **Status:** Approved (ready for per-ticket implementation plans)
- **Product:** BackLotter — public SSR tracker of per-film update logs.
- **Component:** `upcoming-movies-frontend` only. **No backend changes** in this milestone.
- **Project / milestone:** *Movies: MVP Launch Polish* · milestone **M3 — Navigation & site
  structure** (foundational). Two standalone `[frontend]` tickets, no Story parent:
  - **NEU-398** — Auth-aware global header + footer.
  - **NEU-399** — Browse / all-films index page.
- **Builds on (shipped):**
  - **NEU-306** — React Router framework-mode SSR on Cloudflare Workers; `ssr: true`;
    `src/routes.ts` route config; `routes/public-layout.tsx`; the server-`loader` pattern;
    `cloudflareContext` (Worker env → loaders).
  - **NEU-307** — SEO primitives: `src/lib/seo.ts` `buildMeta(...)`; FE `routes/sitemap.ts`
    proxy of the backend `GET /sitemap.xml`; `routes/robots.ts`.
  - **NEU-310 / NEU-312** — the SSR film page (`/film/:slug`) and grouped feed (`/`); the
    `loader → meta → component → ErrorBoundary` route template, `posterUrl`, `eventTypeLabel`,
    `format.ts`; the current minimal `PublicLayout` brand header ("Real header/nav lands in M3/M4").
  - **NEU-309** — public film API incl. `GET /films` (index) + `GET /films/{slug}` + feeds.
  - **M1 (brand)** — the **BackLotter** wordmark/identity this header carries (see *Dependencies*).
- **Refs:** sibling design
  [2026-06-23-neu-312-ssr-feed-landing-design.md](2026-06-23-neu-312-ssr-feed-landing-design.md)
  (the public SSR pattern, provider-free page body, determinism rules);
  [2026-06-23-neu-307-seo-primitives-design.md](2026-06-23-neu-307-seo-primitives-design.md)
  (`buildMeta`, sitemap proxy).

---

## 1. Purpose & scope

Give the public surface its connective tissue. Today the public surface is two SSR pages (`/`
grouped feed, `/film/:slug`) sitting under a **bare** `PublicLayout` — a single brand wordmark and
nothing else. There is no global nav, no way to reach a full film index, no footer, and no surface
that reflects whether the visitor is signed in. This milestone adds:

1. **A persistent, auth-aware global header + footer** (NEU-398) that wraps every public page:
   the BackLotter wordmark, primary nav (Home / Browse / Search / Calendar), an account area that
   shows an **account menu** when signed in (via `AuthContext` / `/me`) and **Login / Sign up**
   when not, and a simple footer.
2. **A Browse / all-films index page** (NEU-399) — a new public SSR route (`/browse`) listing every
   tracked film (those with ≥1 summarized event) as a poster grid with pagination, an empty state,
   SEO meta, and a sitemap entry — built entirely on the **existing** `GET /films` index endpoint.

**In scope:** the shared public chrome (header + footer), the `/browse` route + its API
fetcher/types, pagination, sitemap-entry injection, SEO meta, and tests.

**Explicitly out of scope (this milestone):** any backend change; a personalized/watchlist
homepage (a **FUTURE project**, not here); the Search **page/box** itself (M4) and the Calendar
page (a later milestone) — M3 only seats their **nav entries**; any visual redesign / design-system
work. See §5.

Both anonymous and signed-in visitors land on the same public feed at `/`. There is **no
auth-conditional homepage** in this milestone.

---

## 2. Architecture & approach

### 2.1 Where the chrome slots in

Today:

```
layout("routes/public-layout.tsx", [          // bare: <header><brand/></header> + <Outlet/>
  index("routes/feed.tsx"),                    //  /
  route("film/:slug", "routes/film.tsx"),      //  /film/:slug
])
```

`PublicLayout` becomes the single home of the global chrome — header above `<Outlet/>`, footer
below it — so **every** public route (feed, film, and the new `/browse`) inherits it for free with
no per-route wiring:

```
PublicLayout
  <GlobalHeader/>      // wordmark + primary nav + account area (auth-aware)
  <Outlet/>            // the routed public page (provider-free body — unchanged)
  <GlobalFooter/>      // wordmark + static links + copyright
```

Proposed files:

| File | Action | Responsibility |
|---|---|---|
| `src/routes/public-layout.tsx` | modify | Render `<GlobalHeader/>` + `<Outlet/>` + `<GlobalFooter/>`; `min-h-screen` flex column so the footer sits at the bottom. |
| `src/components/layout/GlobalHeader.tsx` | create | Wordmark (`Link to="/"`) + `<PrimaryNav/>` + `<HeaderAccount/>`. Server-rendered, SSR-safe. |
| `src/components/layout/PrimaryNav.tsx` | create | Renders the nav from a single `NAV_ITEMS` config (see §2.3). |
| `src/components/layout/HeaderAccount.tsx` | create | The **auth-aware client island** (see §2.2). |
| `src/components/layout/GlobalFooter.tsx` | create | Static footer: wordmark, a small link list, `© {year} BackLotter`. Fully server-rendered, no auth. |
| `src/components/layout/nav-items.ts` | create | `NAV_ITEMS` source-of-truth array (label, href, `enabled`). |

`src/routes/public-layout.test.tsx` is updated (it currently asserts the bare wordmark).

### 2.2 The SSR-vs-client-auth resolution (NEU-398's central question)

**The constraint.** Auth is a **client-only** cookie + CSRF `/me` flow: `AuthContext` resolves the
user via a TanStack Query `["me"]` query that calls `apiFetch("/me")` (`credentials: "include"`,
runs against `env.apiBaseUrl` from the browser). The public layout was deliberately kept
**provider-free** (NEU-312) precisely so public pages never fire `/me` during SSR. We now *want* the
header to reflect auth — but the server has no session context and crawlers don't run JS, so the
header **cannot** know the viewer's identity at SSR time.

**The resolution — neutral SSR, hydrate the account area on the client.**

- **Server renders a neutral, logged-out-default header.** The wordmark, primary nav, and the
  account area's **Login / Sign up** default are all emitted server-side. This is the HTML crawlers
  see and index — stable and identity-free.
- **The account area is a self-contained client island, `HeaderAccount`.** It reuses the existing
  `AuthContext` by mounting `QueryClientProvider` + `AuthProvider` **scoped to itself** (a stable
  module-level `QueryClient`, mirroring `spa-layout.tsx`). Scoping the providers to the island —
  rather than wrapping the whole layout — keeps the **page body provider-free**, preserving the
  NEU-312 invariant (feed/film loaders never touch React Query/Auth) and confining the client `/me`
  call to the header.
- **No hydration mismatch, by construction.** React Query does **not** run its `queryFn` during SSR,
  so on the server `useAuth().user` is `null`. `HeaderAccount` renders the **Login / Sign up**
  default whenever `!user` — which is exactly the server output *and* the first client render
  (cache cold → `user` still `null`). Server HTML and first client paint are byte-identical → clean
  hydration. After mount, the `["me"]` query fires; if it resolves to a user, the account area swaps
  to the **account menu**. We intentionally render **no distinct "loading" state** — the logged-out
  default *is* the pre-resolution state, which avoids a skeleton-vs-content flash and keeps SSR/CSR
  agreement trivial.
- **Tradeoff (accepted for v1):** a signed-in visitor briefly sees Login / Sign up until `/me`
  resolves (one short post-hydration flash). Acceptable; can be smoothed later (e.g. dehydrating
  `/me` is impossible without a server session, so an optimistic cookie-presence hint is the only
  lever — deferred). Each public page view also fires one client-side `/me` (a 401 for anonymous
  users) — a negligible cost, and **SSR/crawlers are unaffected** because the call is client-only.

**`HeaderAccount` behavior:**

- `!user` → **Login** (`Link to="/login"`) + **Sign up** (`Link to="/signup"`).
- `user` → an **account menu**: display name, **Log out** (`useAuth().logout()`), and an **Admin**
  link (`/admin/ingest`) gated on `user.is_admin` — mirroring `AppLayout.tsx`'s existing pattern.
- `logout()` clears the session; the area falls back to the logged-out default.

### 2.3 Nav entries for not-yet-built pages (Search / Calendar)

Primary nav is driven by one config array so the header's final shape is established now and later
milestones just flip a flag:

```ts
// src/components/layout/nav-items.ts
export const NAV_ITEMS = [
  { label: "Home",     href: "/",        enabled: true  },
  { label: "Browse",   href: "/browse",  enabled: true  }, // NEU-399, this milestone
  { label: "Search",   href: "/search",  enabled: false }, // route lands in M4
  { label: "Calendar", href: "/calendar",enabled: false }, // route lands in a later milestone
] as const;
```

`PrimaryNav` renders **enabled** items as active `NavLink`s (with `aria-current` styling) and
**disabled** items as **inert, muted placeholders** (`aria-disabled`, no `href`, not focusable, no
navigation) so they never produce a dead/404 link for users or crawlers. Activating Search/Calendar
later is a one-line `enabled: true` + the route landing — no header surgery. **Home** points at the
public feed `/` for everyone (no auth split). **Browse** works immediately.

### 2.4 The `/browse` route (NEU-399)

A new public SSR route under the same `public-layout`, following the established
`loader → meta → component → ErrorBoundary` template (`feed.tsx` / `film.tsx`):

```
route("browse", "routes/browse.tsx")   // added to the public-layout block in routes.ts
```

```
GET /browse?page=N
  └─ loader({ request, context })
       ├─ env = context.get(cloudflareContext).env             // API_BASE_URL
       ├─ page = clampToInt(new URL(request.url).searchParams.get("page"), min 1)
       ├─ const limit = PAGE_SIZE; offset = (page - 1) * limit
       └─ getFilms(env.API_BASE_URL, { limit, offset })        // src/api/public.ts → FilmIndexResponse
            ├─ 200 → { items, total, limit, offset }
            └─ non-OK/network → throw ──────────► route ErrorBoundary (neutral)
  meta() → buildMeta({ title: "Browse", description, type: "website", pathname })
  default BrowsePage({ loaderData })
       ├─ total === 0 → empty state ("No films tracked yet — check back soon.")  // 200, indexable
       └─ poster grid of FilmPosterCard*  +  <Pagination/>
```

Proposed files:

| File | Action | Responsibility |
|---|---|---|
| `src/routes.ts` | modify | Add `route("browse", "routes/browse.tsx")` inside the `public-layout` block. |
| `src/routes/browse.tsx` | create | `loader` (page → offset/limit → `getFilms`), `meta`, `BrowsePage`, `ErrorBoundary`. |
| `src/api/public.ts` | modify | Add `getFilms(baseUrl, { limit?, offset? }): Promise<FilmIndexResponse>`. |
| `src/api/types.ts` | modify | Add `FilmIndexItem` + `FilmIndexResponse` (mirror backend DTO). |
| `src/components/browse/FilmPosterCard.tsx` | create | One grid cell: poster + title + year, the whole cell a `Link to="/film/{slug}"`. |
| `src/components/browse/Pagination.tsx` | create | Prev/Next (+ "Page N of M") as real `<Link>`s carrying `?page=`. |
| `src/routes/sitemap.ts` | modify | Inject a `/browse` `<url>` into the proxied sitemap (see §2.5). |

**Data shape** — mirror the backend `FilmIndexResponse` (`src/upmovies/public/dto.py`), envelope
identical to the feed:

```ts
// src/api/types.ts
export interface FilmIndexItem {
  slug: string;
  title: string;
  release_year: number | null;
  poster_path: string | null;   // raw TMDB path; FE builds the URL via posterUrl()
  arc_stage: string;            // ArcStage; not rendered on the grid in v1
}
export interface FilmIndexResponse { items: FilmIndexItem[]; total: number; limit: number; offset: number; }
```

**Fetcher** — a pure, base-URL-injected fetcher beside `getFilm`/`getFeedGrouped` (no
credentials/CSRF; runs in workerd and under MSW), no 404 branch (the index is always 200):

```ts
// src/api/public.ts
export async function getFilms(
  baseUrl: string,
  { limit = PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<FilmIndexResponse> {
  const url = new URL("/films", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET /films failed: ${res.status}`);
  return (await res.json()) as FilmIndexResponse;
}
```

The backend index already returns only films with ≥1 visible **summarized** event, ordered
`release_date` desc (nulls last), then `id` — so the FE renders the server's order verbatim and
needs no client-side filtering or sorting.

**Poster grid (`FilmPosterCard`).** A responsive Tailwind grid of cards; each card is a
`Link to={\`/film/${slug}\`}` wrapping `posterUrl(item.poster_path, "w342")` + the title + the year
(`release_year` when present). `poster_path` is nullable → render a neutral **placeholder tile**
(no broken image) when it's `null`, reusing the existing `posterUrl` helper (returns `null` for a
null path).

**Pagination.** Offset/limit, page-numbered via `?page=N`. `PAGE_SIZE` is a grid-friendly constant
(e.g. **36**) within the backend's `1–100` limit bound. `totalPages = Math.max(1, Math.ceil(total /
limit))`. Render **Prev**/**Next** as real `<Link>`s to `?page=N±1` (omitted/disabled at the ends)
plus a "Page N of M" label, so pagination is crawlable. Add `rel="prev"`/`rel="next"` hints via
`meta()` for SEO. **Boundary handling:** `page` is clamped to ≥ 1; a page past the end yields an
empty `items` array → render the empty state (still HTTP 200). To avoid thin/duplicate indexed
pages, out-of-range pages (`page > totalPages` when `total > 0`) get a `robots: noindex` meta hint.

**Empty state.** `total === 0` (no tracked-and-summarized films yet) → a friendly "No films tracked
yet" message under the heading. This is a **200, indexable** state — **not** an error.

**Errors.** `getFilms` throwing (upstream/network) surfaces the route-level `ErrorBoundary` with a
neutral "couldn't load" message + a link home — same shape as `feed.tsx`/`film.tsx`. No 404 case.

### 2.5 Sitemap entry — frontend-only

The backend `GET /sitemap.xml` emits `/` + every `/film/{slug}`; the FE `routes/sitemap.ts` simply
**proxies** it. NEU-399 requires a `/browse` sitemap entry **with no backend change**, so the FE
proxy **injects** one `<url>` for `/browse` into the upstream XML before re-serving:

- After fetching the upstream body, derive the canonical base from the existing root `<loc>` entry
  (the backend's `…/`) so the injected URL uses the exact host the backend advertises, then insert
  `  <url><loc>{base}/browse</loc></url>` immediately after the root entry (before `</urlset>`).
- Keep the existing pass-through, content-type, and cache headers; on upstream failure keep the
  current empty-urlset fallback. Injection is a pure string operation — unit-testable without the
  network. `routes/sitemap.test.ts` is extended to assert the `/browse` loc is present.

(`routes/robots.ts` already `Allow: /` everything except `/login`, `/signup`, `/admin/` — `/browse`
is crawlable with no change.)

---

## 3. Cross-cutting decisions

| Decision | Rationale |
|---|---|
| **Shared public chrome lives in `PublicLayout`.** Header + footer are added once to the public layout; every public route inherits them. | One source of truth; zero per-route wiring; fulfils `PublicLayout`'s own "header/nav lands in M3" note. The authed SPA keeps its separate `AppLayout` header — no merge. |
| **Neutral SSR + client-hydrated account area** (§2.2); auth providers **scoped to the `HeaderAccount` island**, not the layout. | SSR-safe, crawlable, no hydration mismatch; preserves the provider-free public page body (NEU-312) and confines the client `/me` call. |
| **No auth-split homepage.** `/` stays the public grouped feed for everyone; signed-in users are **not** redirected to a personalized home. | The watchlist/personalized home is a **FUTURE project**, explicitly deferred. M3 only makes the header reflect identity, not the routing. |
| **Reuse the existing API + envelope.** `/browse` consumes the already-shipped `GET /films` (offset/limit, `{items,total,limit,offset}`); no new/changed endpoint. | Zero backend work; `getFilms` mirrors `getFeedGrouped`/`getFilm` exactly. |
| **SEO consistency.** Every new/changed page routes its head through `buildMeta(...)`; `/browse` gets title/description/OG/canonical; pagination uses `?page=` real links + `rel=prev/next`; `/browse` is added to the sitemap and is crawlable in robots. | Matches NEU-307/310/312; keeps the public surface uniformly indexable. |
| **Single `NAV_ITEMS` config** drives the nav; disabled entries render inert. | Search/Calendar seats are established now; activating them later is a flag flip, not a header rewrite. |
| **BackLotter wordmark sourced from M1.** The header/footer consume M1's brand asset/string. | See *Dependencies*: if M1 lands first, use it; otherwise the header ships with the current wordmark as a placeholder and is swapped on M1 merge. |

### Dependencies & sequencing

- **M1 (brand) supplies the BackLotter wordmark.** This milestone *carries* it. If M1 has merged,
  `GlobalHeader`/`GlobalFooter` use the M1 wordmark component/string and the SEO `SITE_NAME` rename
  is M1's concern (not changed here). If M3 implements first, ship with the existing
  "Upcoming Movies Tracker" wordmark and retarget to the BackLotter asset when M1 merges — a
  one-token change isolated to the header/footer.
- **NEU-398 and NEU-399 are independent** and can land in either order. They only *meet* at the
  Browse nav entry (`enabled: true`, `/browse`): if the header ships before `/browse` exists, the
  Browse `NavLink` is simply a not-yet-live route — flip it to `enabled` when NEU-399 lands, or land
  NEU-399 first. No hard blocker either way.

---

## 4. Milestone acceptance

**NEU-398 — Auth-aware global header + footer**
- A persistent global **header** renders on **every** public page (`/`, `/film/:slug`, `/browse`):
  BackLotter wordmark (links to `/`) + primary nav (Home / Browse / Search / Calendar) + an account
  area.
- The header is **SSR-safe**: server emits a neutral, logged-out-default header; **no hydration
  mismatch**; crawlers receive identity-free HTML.
- The account area is **auth-aware on the client**: signed-in → account menu (display name, Log out,
  Admin link iff `is_admin`); anonymous → Login / Sign up. Driven by `AuthContext` / `/me`.
- **Home** and **Browse** nav entries are live; **Search** and **Calendar** render as inert,
  non-navigating placeholders (no 404).
- A global **footer** renders on every public page (wordmark, static links, copyright).
- Tests (Vitest + RTL + MSW) cover: neutral SSR/anonymous default, the signed-in account menu
  (`meHandler`), the admin-gated link, nav enabled-vs-disabled rendering, and footer presence.
  `task test` / `task lint` (zero warnings) / `task typecheck` green; touched files prettier-clean.

**NEU-399 — Browse / all-films index page**
- A public SSR route `/browse` lists all tracked films (≥1 summarized event) via `GET /films`, in
  the server's `release_date`-desc order.
- Renders a **poster grid** (poster + title + year; placeholder for null poster), with **pagination**
  (`?page=`, Prev/Next + "Page N of M", crawlable links), and a graceful **empty state** (200).
- **SEO**: `meta()` via `buildMeta` (title/description/OG/canonical); `rel=prev/next`; out-of-range
  pages `noindex`; `/browse` present in the FE sitemap; reachable in robots.
- New `getFilms` fetcher + `FilmIndexItem`/`FilmIndexResponse` types mirror the backend DTO.
- **No backend change.** Tests cover the loader (page → offset/limit; MSW-mocked `GET /films`),
  grid render + film links, pagination math/boundaries, empty state, and the sitemap injection.
  Gates as above.

---

## 5. Out of scope / deferred

| Item | Where it lives |
|---|---|
| **The Search page and the header search box/input** | **M4.** M3 seats only the (inert) Search nav entry. **Seam:** the actual search affordance lands *inside this header* in M4 — `GlobalHeader` should leave a documented insertion slot for the input next to/within the nav, and M4 flips `Search` to `enabled` + mounts the box. M3 builds neither the input nor the route. |
| **The Calendar page** | A later milestone. M3 seats only the inert Calendar nav entry; activation = `enabled: true` + the route. |
| **Personalized / watchlist homepage; any auth-conditional routing of `/`** | **A FUTURE project.** `/` stays the public feed for all viewers this milestone. |
| **Any visual redesign / design-system / theming work** | Not here. M3 reuses existing Tailwind/utility styling; no restyle of the feed or film pages beyond adding the shared header/footer. |
| **Backend changes** (new endpoints, `/films` shape, server-side sitemap edits) | None — reuse `GET /films`; the `/browse` sitemap entry is injected FE-side in the proxy. |
| **`/me` SSR dehydration / server-known auth** | Impossible without a server session; the account area stays client-hydrated (accepted brief logged-out flash for signed-in users). |
| **Mobile hamburger / responsive nav drawer, account dropdown polish** | Header is functional and responsive-friendly; rich menu interactions can follow. Not a milestone gate. |

---

## 6. Risks / notes

- **Hydration determinism.** The account area must render the **logged-out default whenever
  `!user`** (covering server, first client paint, and anonymous) and only swap on a truthy `user` —
  no separate loading skeleton, no `Date.now()`, no locale-dependent output. Footer's `© {year}`
  should derive from a build-time/server-stable value or be acceptable as client-rendered text that
  matches (a fixed year string avoids any mismatch).
- **Provider scoping.** Keep `QueryClientProvider` + `AuthProvider` **inside** `HeaderAccount`
  (stable module-level `QueryClient`, per `spa-layout.tsx`), so the feed/film/browse loaders and
  bodies stay provider-free and never fire `/me` during SSR.
- **workerd ≠ Node.** `getFilms` uses only web `fetch`/`URL`; the loader runs in the Workers runtime.
  Tests mock the fetch (MSW); `vite preview` exercises the real runtime before deploy. Dev fetches
  hit `https://api.upmovies.localhost` (self-signed) from workerd — same caveat as the existing feed
  loader and sitemap proxy.
- **Sitemap injection robustness.** Inject by deriving the base from the upstream root `<loc>` (not
  a hardcoded host) so prod/dev hosts stay consistent with what the backend advertises; preserve the
  upstream failure fallback.
- **`/` blast radius is nil.** Unlike NEU-312, this milestone does **not** move `/`; the header's
  Home link and the existing feed root are unchanged.
- **Wordmark coupling to M1.** Isolate the wordmark to `GlobalHeader`/`GlobalFooter` so swapping the
  M1 brand asset later is a localized change.

## Sources

- React Router framework mode — route modules (`loader`/`meta`/`ErrorBoundary`), nested layouts,
  `NavLink` — https://reactrouter.com/start/framework/routing
- Backend `GET /films` contract — `src/upmovies/routers/public.py` + `src/upmovies/public/dto.py`
  (`FilmIndexResponse`/`FilmIndexItem`) + `service.get_film_index`.
- Sibling FE design — [2026-06-23-neu-312-ssr-feed-landing-design.md](2026-06-23-neu-312-ssr-feed-landing-design.md)
  (public SSR pattern, provider-free body, determinism).
- SEO primitives — [2026-06-23-neu-307-seo-primitives-design.md](2026-06-23-neu-307-seo-primitives-design.md)
  (`buildMeta`, sitemap proxy, robots).
