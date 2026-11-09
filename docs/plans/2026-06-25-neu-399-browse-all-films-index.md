**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md

# Browse / All-Films Index Page (NEU-399) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **TDD** plan — write the failing test first in every task, watch it fail, then implement.

**Goal:** Ship a public, server-rendered film index at **`/browse`** — every tracked film (those with ≥1 summarized event) as a poster grid (poster + title + year), with crawlable `?page=` pagination, a graceful empty state, SEO `<head>` via `buildMeta`, and a `/browse` entry injected into the FE sitemap. Built entirely on the **already-shipped** `GET /films` index endpoint — **no backend change**.

**Architecture:** A sibling of the merged NEU-312 feed (`/`) and NEU-310 film page (`/film/:slug`). A new public route `src/routes/browse.tsx` under the existing `public-layout` block, following the established `loader → meta → component → ErrorBoundary` template. The loader reads `page` from the query string, maps it to `offset`/`limit`, and fetches `GET /films` via a new pure `getFilms(baseUrl, { limit, offset })` fetcher in `src/api/public.ts` (mirroring `getFeedGrouped`). The page renders a Tailwind poster grid of `FilmPosterCard`s (reusing the existing `posterUrl` helper, which returns `null` → placeholder tile) plus a `Pagination` control of real `<Link>`s. The FE `routes/sitemap.ts` proxy is extended to inject one `<url>` for `/browse` into the upstream XML. No new endpoint, no new env var, no new dependency.

**Tech stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — all driven through `task` inside the container.

**Design of record:** `docs/specs/2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md` (§2.4 the `/browse` route, §2.5 sitemap injection, §4 NEU-399 acceptance). Pattern precedents already on `main`:
- `src/routes/feed.tsx` + `src/routes/feed.test.tsx` — the public `loader/meta/component/ErrorBoundary` template, the `cloudflareContext`-env loader, and the `createRoutesStub` render-test shape.
- `src/api/public.ts` `getFeedGrouped` — the pure, base-URL-injected `{ limit, offset }` fetcher to clone for `getFilms`.
- `src/lib/poster.ts` `posterUrl(path, size)` (+ `poster.test.ts`) — null-safe TMDB URL builder; `FilmHeader.tsx` shows the `poster && <img/>` render-or-omit pattern.
- `src/lib/seo.ts` `buildMeta(...)` — the shared SEO descriptors.
- `src/routes/sitemap.ts` + `src/routes/sitemap.test.ts` — the proxy + its loader test to extend.

**Backend contract (read-only, already shipped — do not modify):**
- `GET /films?limit=<1..100,def 50>&offset=<≥0,def 0>` → `FilmIndexResponse` = `{ items: FilmIndexItem[]; total; limit; offset }`.
- `FilmIndexItem` = `{ slug: str; title: str; release_year: int|null; poster_path: str|null; arc_stage: str }` (source: `upcoming-movies-backend/src/upmovies/public/dto.py`).
- The index already returns **only** films with ≥1 visible summarized event, ordered `release_date` desc (nulls last) then `id`. The FE renders the server's order verbatim — **no** client-side filtering or sorting.

---

## Working agreements (read first)

- **All commands run in the container via `task`.** Never run `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the container up (`task up`). Scope tests with `task test -- <path>`.
- **One PR.** NEU-399 ships as a **single frontend PR**; the user commits once at the end (final task). Do **NOT** commit per task. If executing via subagents, strip any commit step from implementer prompts.
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`). MSW runs with `onUnhandledRequest: "error"`; add per-test handlers via `server.use(...)` from `@/test/msw/server`. The backend base URL in tests is `https://api.upmovies.localhost`.
- **ESLint at zero warnings** — unused imports/vars fail the build. Import only what you use. Route files that export `loader`/`meta`/`ErrorBoundary` beside the component need the `/* eslint-disable react-refresh/only-export-components ... */` header (copy it verbatim from `feed.tsx`).
- **Typecheck = `react-router typegen` + `tsc -b`.** A new route module is typed via the generated `./+types/browse`; that type only exists after the route is registered in `routes.ts` and typegen runs (`task typecheck` runs both). Type-only imports are erased by Vite, so Vitest runs green before typegen — but `task typecheck` must be run before claiming done.
- **Format only what you touch** (`task format`). `AuthContext.*` has pre-existing Prettier drift on `main` — don't reformat unrelated files.
- **Determinism / hydration safety.** No `Date.now()`, no relative dates, no locale-dependent output in the render tree. `/browse` rows show only the static `release_year` integer — no date formatting needed. Everything in the page body is provider-free (no React Query / Auth) — preserving the NEU-312 invariant that public loaders/bodies never fire `/me` during SSR.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/api/types.ts` | modify | Add `FilmIndexItem` + `FilmIndexResponse` mirroring the backend DTO. |
| `src/api/public.ts` | modify | Add `PAGE_SIZE` constant + `getFilms(baseUrl, { limit?, offset? })`. |
| `src/api/public.test.ts` | modify | `getFilms` tests: 200 + default/explicit `limit`/`offset` query params; non-OK throws. |
| `src/components/browse/FilmPosterCard.tsx` | create | One grid cell: poster (or placeholder tile) + title + year, the whole cell a `Link to="/film/{slug}"`. |
| `src/components/browse/FilmPosterCard.test.tsx` | create | Render: film link href, title, year, poster `<img>` present; placeholder when `poster_path` is null. |
| `src/components/browse/Pagination.tsx` | create | Prev/Next as real `<Link>`s carrying `?page=`, disabled/omitted at the ends, "Page N of M" label. |
| `src/components/browse/Pagination.test.tsx` | create | Link hrefs at a middle page; Prev disabled on page 1; Next disabled on the last page; single-page hides both. |
| `src/routes/browse.tsx` | create | Route module: `loader` (page → offset/limit → `getFilms`), `meta`, `BrowsePage`, `ErrorBoundary`. |
| `src/routes/browse.test.tsx` | create | Loader (page→offset; MSW `GET /films`), meta (title/canonical/rel/noindex), render (grid + film links + pagination), empty state. |
| `src/routes.ts` | modify | Add `route("browse", "routes/browse.tsx")` inside the `public-layout` block. |
| `src/routes/sitemap.ts` | modify | Inject a `/browse` `<url>` into the proxied upstream XML (pure helper). |
| `src/routes/sitemap.test.ts` | modify | Assert the `/browse` `<loc>` is present in the proxied output; failure fallback unchanged. |

No backend changes, no new env vars, no new dependencies.

---

## Task 1: `getFilms` fetcher + index types

**Files:** modify `src/api/types.ts`, `src/api/public.test.ts`, `src/api/public.ts`.

- [ ] **Step 1 — add the index types.** In `src/api/types.ts`, append (mirroring the backend DTO exactly; `arc_stage` stays a plain `string` here — it is not rendered on the grid in v1, so do not narrow it to the `ArcStage` union):

```ts
export interface FilmIndexItem {
  slug: string;
  title: string;
  release_year: number | null;
  poster_path: string | null; // raw TMDB path; FE builds the URL via posterUrl()
  arc_stage: string;
}

export interface FilmIndexResponse {
  items: FilmIndexItem[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] **Step 2 — write the failing fetcher tests.** In `src/api/public.test.ts`, import `getFilms` (and `PAGE_SIZE`) plus the `FilmIndexResponse` type and add a `describe("getFilms")`. Cover, MSW-mocked on `${BACKEND}/films` (capture the request `URL` to assert query params):
  - returns the typed response on 200 and sends the **default** `limit=<PAGE_SIZE>` + `offset=0` when called with no options;
  - sends the **explicit** `limit`/`offset` when passed `{ limit, offset }`;
  - throws `/failed: 5\d\d/` (or similar) on a non-OK (e.g. 500) response.

  Run `task test -- src/api/public.test.ts` → **FAIL** (`getFilms` not exported).

- [ ] **Step 3 — implement `getFilms`.** In `src/api/public.ts`, import `FilmIndexResponse`, export a grid-friendly page-size constant, and add the fetcher cloned from `getFeedGrouped` (pure, base-URL-injected, no credentials, no 404 branch — the index is always 200):

```ts
/** Grid-friendly page size for the /browse index; within the backend's 1..100 limit bound. */
export const PAGE_SIZE = 36;

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

  Run `task test -- src/api/public.test.ts` → **PASS** (existing `getFilm`/`getFeedGrouped` tests plus the new ones).

**Resilience notes:** keep `arc_stage` as `string` (forward-compatible with new backend stages). `PAGE_SIZE` lives in `public.ts` so both the fetcher default and the route's offset math share one source of truth — do not redefine it in the route.

---

## Task 2: `FilmPosterCard` (one grid cell)

**Files:** create `src/components/browse/FilmPosterCard.tsx` + `.test.tsx`.

- [ ] **Step 1 — failing render test.** Create `src/components/browse/FilmPosterCard.test.tsx`. The card uses `<Link>`, so render inside `MemoryRouter`. Assert:
  - the whole cell links to `/film/{slug}` (`getByRole("link")` → `href`);
  - the title and the `release_year` are shown;
  - with a non-null `poster_path`, an `<img>` is present with the `posterUrl(path, "w342")` `src` and a meaningful `alt` (e.g. `"{title} poster"`);
  - with `poster_path: null`, **no broken `<img>`** renders — instead a neutral placeholder tile is present (assert via a `data-testid` like `poster-placeholder`, or `queryByRole("img")` being null);
  - with `release_year: null`, the year line is omitted (no stray empty node).

  Run `task test -- src/components/browse/FilmPosterCard.test.tsx` → **FAIL** (module missing).

- [ ] **Step 2 — implement `FilmPosterCard`.** Create `src/components/browse/FilmPosterCard.tsx`. Reuse `posterUrl` from `@/lib/poster` and `Link` from `react-router`. Shape (representative — keep Tailwind utility classes, exact classes are non-load-bearing):
  - compute `const poster = posterUrl(item.poster_path, "w342");`
  - the cell is `<Link to={\`/film/${item.slug}\`}>` wrapping: `poster ? <img src={poster} alt={\`${item.title} poster\`} .../> : <div data-testid="poster-placeholder" .../>` (a neutral aspect-ratio box, no broken image), then the `item.title`, then `item.release_year && <p>{item.release_year}</p>`.
  - Use a fixed poster aspect box (2:3) so the placeholder and real poster occupy the same footprint and the grid stays even.

  Run `task test -- src/components/browse/FilmPosterCard.test.tsx` → **PASS**.

**Resilience notes:** mirror `FilmHeader.tsx`'s `poster && <img/>` null-guard; never emit an `<img>` with an empty/`null` src. The placeholder is a styled `<div>`, not an image.

---

## Task 3: `Pagination` (crawlable page links)

**Files:** create `src/components/browse/Pagination.tsx` + `.test.tsx`.

- [ ] **Step 1 — failing test.** Create `src/components/browse/Pagination.test.tsx`, rendering inside `MemoryRouter`. The component takes the current `page` and `totalPages`. Assert:
  - on a middle page (e.g. `page=2, totalPages=5`): a **Prev** link to `?page=1` and a **Next** link to `?page=3`, and a "Page 2 of 5" label;
  - on `page=1`: **Prev** is absent or inert (not a navigating link), **Next** → `?page=2`;
  - on the last page (`page=totalPages`): **Next** is absent or inert, **Prev** → `?page={page-1}`;
  - when `totalPages <= 1`: neither Prev nor Next renders (single page needs no nav) — but the component may still render nothing or just the label; assert no Prev/Next links exist.

  Run `task test -- src/components/browse/Pagination.test.tsx` → **FAIL** (module missing).

- [ ] **Step 2 — implement `Pagination`.** Create `src/components/browse/Pagination.tsx`. Props `{ page: number; totalPages: number }`. Render real `<Link to={\`?page=${n}\`}>` for Prev (`page-1`, only when `page > 1`) and Next (`page+1`, only when `page < totalPages`); render disabled ends as inert muted `<span aria-disabled>` (no `href`, not a link) or omit them — keep them **non-navigating** so crawlers get no dead links. Show a "Page {page} of {totalPages}" label. Return `null` (or just the bare label) when `totalPages <= 1`.

  Run `task test -- src/components/browse/Pagination.test.tsx` → **PASS**.

**Resilience notes:** links are **relative `?page=N`** so they resolve against `/browse` without hardcoding the path. The `rel="prev"`/`rel="next"` SEO hints are emitted by the route's `meta()` (Task 4), **not** here — keep this component presentational.

---

## Task 4: `/browse` route + wiring

**Files:** create `src/routes/browse.tsx` + `src/routes/browse.test.tsx`; modify `src/routes.ts`.

- [ ] **Step 1 — failing route tests.** Create `src/routes/browse.test.tsx`, mirroring `feed.test.tsx` (a `RouterContextProvider` with `cloudflareContext` env stub for direct `loader`/`meta` calls, and `createRoutesStub` for render). Cover:
  - **loader → default page:** MSW `GET /films` returns a sample `FilmIndexResponse`; calling `loader` with a request URL of `/browse` (no query) fetches with `offset=0` and returns the films plus paging info; assert the returned `total`/first-item `slug`.
  - **loader → page maps to offset:** request URL `/browse?page=2` fetches with `offset = PAGE_SIZE` (capture the upstream `URL`'s `offset` param, or assert the loader's returned `page === 2`). Also assert `page` clamps to ≥1 for `?page=0` / `?page=-3` / `?page=abc` → treated as page 1.
  - **meta:** returns the templated title (e.g. `"Browse · Upcoming Movies Tracker"`), a `description`, and a `canonical` `link`. For a middle page, includes `rel="next"`/`rel="prev"` link descriptors. For an out-of-range page (`page > totalPages` with `total > 0`), includes `{ name: "robots", content: "noindex" }`.
  - **render — grid + pagination:** via `createRoutesStub` with a stub loader returning a 2-item page across `totalPages > 1`, assert both film links (`/film/{slug}`), both titles, and a Next pagination link render.
  - **render — empty state:** stub loader returns `{ items: [], total: 0 }` → a friendly "No films tracked yet" message renders (HTTP 200, not an error).

  Run `task test -- src/routes/browse.test.tsx` → **FAIL** (`@/routes/browse` missing).

- [ ] **Step 2 — implement the route module.** Create `src/routes/browse.tsx` with the `feed.tsx` eslint-disable header and the four exports. Behavior (resilient — derive everything from the loader so `meta` and the component agree):

  - **`loader({ request, context })`:**
    - `const { env } = context.get(cloudflareContext);`
    - parse `page` from `new URL(request.url).searchParams.get("page")` → integer, **clamped to ≥ 1** (non-numeric / `<1` → `1`);
    - `const limit = PAGE_SIZE; const offset = (page - 1) * limit;`
    - `const films = await getFilms(env.API_BASE_URL, { limit, offset });` (a thrown error falls through to `ErrorBoundary`);
    - `const totalPages = Math.max(1, Math.ceil(films.total / limit));`
    - return `{ films, page, totalPages }`.
  - **`meta({ data, location })`** (use `Route.MetaArgs`; read the loader's `data`): start from `buildMeta({ title: "Browse", description: "Browse every upcoming film we track…", pathname: location.pathname, type: "website" })`. Then, from `data` (guard for undefined on error renders):
    - append `{ tagName: "link", rel: "prev", href: <canonical>?page={page-1} }` when `page > 1`;
    - append `{ tagName: "link", rel: "next", href: ...?page={page+1} }` when `page < totalPages`;
    - append `{ name: "robots", content: "noindex" }` when `page > totalPages` (out-of-range, only meaningful when `total > 0`).
    - Build the prev/next hrefs against the canonical site URL (reuse the `buildMeta` canonical/`env.publicSiteUrl` convention; the bare `pathname` + `?page=` is acceptable as long as it's consistent with the canonical host).
  - **`default BrowsePage({ loaderData })`:** `const { films, page, totalPages } = loaderData;`
    - `films.total === 0` → an empty-state block (heading + "No films tracked yet — check back soon."); this is the indexable 200 state, **not** an error;
    - else a responsive Tailwind **grid** of `<FilmPosterCard item={f} key={f.slug} />` for each `films.items`, followed by `<Pagination page={page} totalPages={totalPages} />`.
    - Note: a valid page past the end (`page > totalPages`) returns empty `items` → the grid is empty; render the same friendly "nothing on this page" / empty message rather than a blank screen. (Keeping the empty branch keyed on `films.items.length === 0` covers both `total === 0` and out-of-range pages.)
  - **`ErrorBoundary()`:** neutral "couldn't load" copy + a `Link to="/"` home, same shape as `feed.tsx` (no 404 branch — the index never 404s).

  Run `task test -- src/routes/browse.test.tsx` → **PASS**.

- [ ] **Step 3 — register the route.** In `src/routes.ts`, add `route("browse", "routes/browse.tsx")` inside the existing `public-layout` block, beside `index("routes/feed.tsx")` and `route("film/:slug", "routes/film.tsx")` (`route` is already imported). So `/browse` inherits the shared public layout for free.

  Run `task typecheck` → `react-router typegen` generates `./+types/browse`, then `tsc -b` reports 0 errors.

**Resilience notes:** the loader is the single source of `page`/`totalPages`; `meta` and the component both read it so SEO hints and the rendered nav never disagree. Clamp `page` defensively in the loader (the page is user/crawler-controlled). The page body stays provider-free (no React Query / Auth import) — it must never fire `/me` during SSR.

---

## Task 5: `/browse` sitemap injection (FE-only)

**Files:** modify `src/routes/sitemap.ts` + `src/routes/sitemap.test.ts`. **No backend change** — the backend sitemap is untouched; the FE proxy injects the `/browse` `<url>`.

- [ ] **Step 1 — failing test.** In `src/routes/sitemap.test.ts`, extend the existing happy-path test (or add one): the MSW `GET /sitemap.xml` upstream returns a `<urlset>` containing a root `<url><loc>https://app.upmovies.localhost/</loc></url>`; after proxying, assert the response body **contains** `<loc>https://app.upmovies.localhost/browse</loc>` (derived from the upstream root host, not hardcoded) while still preserving the root entry. Keep the existing content-type + `cache-control` assertions. Leave the 503-fallback test asserting the failure path is unchanged (the empty-urlset fallback need not contain `/browse`).

  Run `task test -- src/routes/sitemap.test.ts` → **FAIL** (no `/browse` loc yet).

- [ ] **Step 2 — implement the injection.** In `src/routes/sitemap.ts`, add a small **pure** helper (e.g. `injectBrowseUrl(xml: string): string`) and call it on the upstream body before constructing the success `Response`:
  - derive the canonical base from the **first** `<loc>…</loc>` in the upstream XML (the backend's `…/`) and strip the trailing slash → `base`;
  - insert `<url><loc>${base}/browse</loc></url>` immediately before the closing `</urlset>`;
  - **resilient fallbacks:** if no `<loc>` or no `</urlset>` is found, return the XML unchanged (never corrupt the document); only inject on the success path — keep the existing 503 empty-urlset fallback exactly as-is.
  - Preserve the existing pass-through `status`, `Content-Type`, and `Cache-Control` headers.

  Keeping the helper pure makes it unit-testable without the network (the spec's intent); the loader test above exercises it end-to-end through MSW.

  Run `task test -- src/routes/sitemap.test.ts` → **PASS**.

**Resilience notes:** derive the host from what the backend advertises so dev (`https://app.upmovies.localhost`) and prod stay consistent. `routes/robots.ts` already allows `/` except `/login`/`/signup`/`/admin/`, so `/browse` is crawlable with no change there.

---

## Task 6: Full verification + handoff

**Files:** none (verification only).

- [ ] **Step 1 — format touched files:** `task format`. Do not stage unrelated `AuthContext.*` drift.
- [ ] **Step 2 — lint:** `task lint` → `eslint src --max-warnings 0` passes (no unused imports; route file has the `react-refresh/only-export-components` disable header).
- [ ] **Step 3 — typecheck:** `task typecheck` → `react-router typegen` + `tsc -b` report 0 errors (incl. the generated `./+types/browse`).
- [ ] **Step 4 — full suite:** `task test` → the entire Vitest suite is green (new `getFilms`/`FilmPosterCard`/`Pagination`/`browse`/`sitemap` tests plus all untouched suites).
- [ ] **Step 5 — hand off for commit (user).** Do **NOT** commit from task execution. Report the green gates. The user commits the whole NEU-399 change as **one PR** off the ticket branch, using `/commit-msg` (Conventional Commits subject, no Linear ID, no `Co-Authored-By`) and `/pr-desc` (PR title carries `(NEU-399)`; body keeps the `🤖 Generated with Claude Code` footer). Pre-commit hooks delegate into the container — commit normally with the container up.

---

## Acceptance criteria (NEU-399, from spec §4)

- A public SSR route **`/browse`** lists all tracked films (≥1 summarized event) via `GET /films`, in the server's `release_date`-desc order (no FE re-sort/filter).
- Renders a **poster grid** (poster + title + year; neutral **placeholder** for a null poster — no broken image), with **pagination** (`?page=`, Prev/Next + "Page N of M", real crawlable `<Link>`s, inert at the ends), and a graceful **empty state** (HTTP 200, indexable — not an error).
- **SEO:** `meta()` via `buildMeta` (title/description/OG/canonical); `rel=prev`/`rel=next` on paginated views; out-of-range pages emit `robots: noindex`; `/browse` is present in the FE sitemap and crawlable in robots.
- New `getFilms` fetcher + `FilmIndexItem`/`FilmIndexResponse` types mirror the backend DTO.
- **No backend change.** Tests (Vitest + MSW) cover the loader (page → offset/limit; MSW-mocked `GET /films`), grid render + film links, pagination math/boundaries, empty state, and the sitemap injection. `task test` / `task lint` (zero warnings) / `task typecheck` green; touched files prettier-clean.

## Which part of M3 this realizes

This is the **second of M3's two standalone `[frontend]` tickets** — it builds the **Browse / all-films index page** (spec §2.4 + §2.5). It is **independent of NEU-398** (the auth-aware global header/footer): the two only meet at the header's `Browse` nav entry (`{ href: "/browse", enabled: true }`), and can land in either order. Shipping NEU-399 makes that nav target live. **No backend work** and **no change to `/`** (zero blast radius on the feed).

---

## Self-review

**Spec coverage** (`…-mvp-launch-polish-m03-navigation-site-structure.md` §2.4–§2.5, §4):
- New public SSR `/browse` under `public-layout`, `loader → meta → component → ErrorBoundary` → Task 4 (`browse.tsx` + `routes.ts`); asserted by the loader/render tests.
- Loader consumes `GET /films` with `offset`/`limit` from `?page=` → Task 1 (`getFilms`) + Task 4 (page→offset math, `PAGE_SIZE`); asserted by the loader page-mapping test.
- `getFilms` fetcher + `FilmIndexItem`/`FilmIndexResponse` mirroring the backend DTO → Task 1; asserted by `public.test.ts`.
- Poster grid (poster + title + year; null→placeholder via `posterUrl`) → Task 2 (`FilmPosterCard`); asserted by the card tests (incl. the null-poster placeholder).
- Crawlable pagination (`?page=`, Prev/Next + "Page N of M", inert ends) → Task 3 (`Pagination`) + Task 4 render; asserted by the pagination boundary tests.
- Graceful empty state (200, indexable) → Task 4 (`films.items.length === 0` branch); asserted by the empty-state render test.
- SEO meta (`buildMeta` title/desc/OG/canonical; `rel=prev/next`; out-of-range `noindex`) → Task 4 `meta`; asserted by the meta test.
- FE-side sitemap `/browse` `<url>` injection (host derived from upstream root `<loc>`; failure fallback preserved) → Task 5; asserted by the extended `sitemap.test.ts`.
- No backend change; gates green → Task 6.

**Type/name consistency:** `getFilms(baseUrl, { limit?, offset? }): Promise<FilmIndexResponse>` (Task 1) is called as `getFilms(env.API_BASE_URL, { limit: PAGE_SIZE, offset })` in the loader (Task 4). `PAGE_SIZE` is exported once from `@/api/public` (Task 1) and imported by the loader for offset math (Task 4) — never redefined. `FilmIndexItem` fields (`slug`, `title`, `release_year`, `poster_path`, `arc_stage`) match the backend `dto.py` and are read by `FilmPosterCard` (Task 2: `item.slug`/`item.title`/`item.release_year`/`item.poster_path`). The loader's return `{ films, page, totalPages }` is read identically by `meta` (rel/noindex) and `BrowsePage` (grid + `<Pagination page totalPages/>`) in Task 4. `posterUrl`/`buildMeta`/`cloudflareContext`/`Link` are reused from their shipped modules; the only shipped file modified beyond the new files is `routes.ts` (one added route) and `sitemap.ts` (the injection) + their tests.

**Placeholder scan:** no "TBD"/"similar to Task N"/"add error handling later" — each task has explicit red→green steps, the exact `task` command to run, and the expected FAIL/PASS outcome. Code is given as signatures + the load-bearing snippets (fetcher, sitemap helper contract) and behavioral contracts elsewhere, intentionally resilient to minor naming/markup choices.
