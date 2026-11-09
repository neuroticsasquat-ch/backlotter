**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m06-release-calendar.md
**Depends on:** NEU-408

# NEU-409 `[frontend]` — `/calendar` release-calendar SSR page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **TDD** plan — write the failing test first in every task, watch it fail for the right reason, then implement. One ticket = one PR = one `/implementit` run; **do not commit per task** — the user commits the whole NEU-409 change once at the end.

**Goal:** Ship a public, server-rendered **release calendar** at **`/calendar`** — upcoming theatrical releases grouped **by date (soonest-first) → release type (premiere → limited → wide)**, each film a card linking to `/film/{slug}`. It consumes the new `GET /calendar` endpoint (NEU-408), flips the global header's inert **Calendar** nav seat (NEU-398) live, adds SEO `<head>` via `buildMeta` + a `/calendar` entry in the FE sitemap, and shows a graceful empty state. Built on the **already-shipped** SSR/feed/poster/sitemap primitives — **no backend change** in this ticket.

**Realizes (M6):** Story **NEU-373** ("Public release calendar"), frontend half — parent acceptance: `/calendar` lists upcoming releases soonest-first grouped by date + type, reachable from the header. This is **NEU-409**; it is **blocked by NEU-408** (the `GET /calendar` endpoint, whose `CalendarResponse` contract this consumes) and **related to NEU-398** (the global header, whose `Calendar` nav seat this activates). Realizes the milestone-acceptance bullet **"NEU-409 — `/calendar` SSR route (frontend)"** (M6 §4).

**Architecture:** A sibling of the merged NEU-312 feed (`/`) and the NEU-399 browse index (`/browse`). A new public route `src/routes/calendar.tsx` under the existing `public-layout` block, following the established `loader → meta → component → ErrorBoundary` template (`feed.tsx` is the closest sibling — a flat list grouped at render time, no pagination UI). The loader reads the Worker env and fetches `GET /calendar` via a new pure `getCalendar(baseUrl, { limit?, offset? })` in `src/api/public.ts` (cloned from `getFeedGrouped` — always 200, no 404 branch). The page groups the backend-ordered flat list with a pure `groupByReleaseDate` helper (adjacency walk, mirrors `groupByDay`) and renders date sections (UTC headings via the existing `formatDayHeading`) → per-type sub-groups of `CalendarFilmCard`s (poster + title, reusing `posterUrl`). The header's `Calendar` nav seat (`enabled: false`) is flipped live; the FE `routes/sitemap.ts` proxy injects a `/calendar` `<url>`. No new endpoint, no new env var, no new dependency.

**Tech stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — all driven through `task` inside the container.

**Design of record:** `docs/specs/2026-06-25-mvp-launch-polish-m06-release-calendar.md` (§2.4 the response envelope, §2.5 the `/calendar` route + file table, §3.4 SEO/sitemap, §3.5 determinism, §4 NEU-409 acceptance). Pattern precedents already on `main`:
- `src/routes/feed.tsx` + `src/routes/feed.test.tsx` — the public `loader/meta/component/ErrorBoundary` template, the `cloudflareContext`-env loader, the day-section render (`<time dateTime>` heading + grouped cards + empty state), and the `RouterContextProvider`/`createRoutesStub` test shapes.
- `src/lib/feed-groups.ts` `groupByDay` + `src/lib/feed-groups.test.ts` — the pure adjacency-walk grouping helper (no client sort, no `Date.now()`) to mirror.
- `src/lib/format.ts` `formatDayHeading`/`dayKey` (both `timeZone: "UTC"`) + `src/lib/format.test.ts` — UTC day headings; `formatDayHeading("YYYY-MM-DD")` parses as UTC midnight and renders e.g. `"Saturday, July 4, 2026"`. **Reuse as-is — no change needed.**
- `src/api/public.ts` `getFeedGrouped` + `src/api/public.test.ts` — the pure, base-URL-injected `{ limit, offset }` fetcher (always 200) to clone for `getCalendar`.
- `src/lib/poster.ts` `posterUrl(path, size)` + the NEU-399 `FilmPosterCard` null-poster→placeholder pattern (poster `<img>` or neutral placeholder tile — never a broken `<img>`).
- `src/lib/seo.ts` `buildMeta(...)` — the shared SEO descriptors (title templated as `"<title> · <SITE_NAME>"`, OG/Twitter/canonical).
- `src/routes/sitemap.ts` + `src/routes/sitemap.test.ts` — the proxy loader + its tests to extend with a `/calendar` `<url>` injection (the NEU-399 `/browse` injection is the precedent).
- **NEU-398** `src/components/layout/nav-items.ts` — the single `NAV_ITEMS` config seating the inert `{ label: "Calendar", href: "/calendar", enabled: false }` entry, and `PrimaryNav` rendering enabled items as `NavLink`s / disabled items as inert seats.

**Backend contract (read-only, defined by NEU-408 — mirror exactly, do not modify):**
- `GET /calendar?limit=<1..200, def 100>&offset=<≥0, def 0>` → `200` with `CalendarResponse` = `{ items: CalendarItem[]; total; limit; offset }`. Always 200 (empty → `items: []`, `total: 0`); never 404.
- `CalendarItem` = `{ film_slug: string; film_title: string; poster_path: string | null; release_date: string ("YYYY-MM-DD", US date); release_type: string (bucket "premiere" | "limited" | "wide") }`.
- Items arrive **server-ordered** `release_date ASC, release_type ASC, popularity DESC NULLS LAST, slug ASC` → date-then-type **adjacent**, so the FE groups by walking the list (no client sort → SSR/CSR byte-identical, the NEU-312/364 determinism rule). `release_type` is the bucket **string** — the FE never sees TMDB's raw int.

---

## Working agreements (read first)

- **All commands run in the container via `task`.** Never run `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the container up (`task up`). Scope tests with `task test -- <path>`.
- **One PR.** NEU-409 ships as a **single frontend PR**; the user commits once at the end (final task). Do **NOT** commit per task. If executing via subagents, strip any commit step from implementer prompts.
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`). MSW runs with `onUnhandledRequest: "error"`; add per-test handlers via `server.use(...)` from `@/test/msw/server`. The backend base URL in tests is `https://api.upmovies.localhost`.
- **ESLint at zero warnings** — unused imports/vars fail the build. Import only what you use. The route file that exports `loader`/`meta`/`ErrorBoundary` beside the component needs the `/* eslint-disable react-refresh/only-export-components ... */` header (copy it verbatim from `feed.tsx`).
- **Typecheck = `react-router typegen` + `tsc -b`.** The new route module is typed via the generated `./+types/calendar`; that type only exists after the route is registered in `routes.ts` and typegen runs (`task typecheck` runs both). Type-only imports are erased by Vite, so Vitest runs green before typegen — but `task typecheck` must pass before claiming done.
- **Format only what you touch** (`task format`). `AuthContext.*` has pre-existing Prettier drift on `main` — don't reformat unrelated files.
- **Determinism / hydration safety (load-bearing).** `groupByReleaseDate` does **no** client sort and **no** `Date.now()` — it relies on the server order and `timeZone: "UTC"` formatting, so SSR HTML and first client paint are byte-identical. The page body stays **provider-free** (no React Query / Auth import) — preserving the NEU-312 invariant that public loaders/bodies never fire `/me` during SSR (only NEU-398's `HeaderAccount` island touches auth).

---

## Task 1: `getCalendar` fetcher + `CalendarItem`/`CalendarResponse` types

**Files:** modify `src/api/types.ts`, `src/api/public.test.ts`, `src/api/public.ts`.

- [ ] **Step 1 — add the calendar types.** In `src/api/types.ts`, append (mirroring the NEU-408 DTOs exactly; keep `release_type` a plain `string` — the bucket set is the backend's concern, and a plain string is forward-compatible if a bucket is added later):

```ts
export interface CalendarItem {
  film_slug: string;
  film_title: string;
  poster_path: string | null; // raw TMDB path; FE builds the URL via posterUrl()
  release_date: string; // "YYYY-MM-DD" (US date)
  release_type: string; // bucket: "premiere" | "limited" | "wide" — rendered via releaseBucketLabel
}

export interface CalendarResponse {
  items: CalendarItem[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] **Step 2 — write the failing fetcher tests.** In `src/api/public.test.ts`, import `getCalendar` + the `CalendarResponse` type and add a `describe("getCalendar")`, MSW-mocked on `${BACKEND}/calendar` (capture the request `URL` to assert query params). Cover:
  - returns the typed response on 200 and sends the **default** `limit=100` + `offset=0` when called with no options;
  - sends **explicit** `limit`/`offset` when passed `{ limit, offset }`;
  - throws (`/failed: 5\d\d/`) on a non-OK (e.g. 500) response.

  Run `task test -- src/api/public.test.ts` → **FAIL** (`getCalendar` not exported).

- [ ] **Step 3 — implement `getCalendar`.** In `src/api/public.ts`, add `CalendarResponse` to the `./types` import and append the fetcher cloned from `getFeedGrouped` (pure, base-URL-injected, `Accept: application/json`, **no credentials, no 404 branch** — the calendar is always 200; default `limit = 100`, `offset = 0`; `throw` on non-OK). Re-run `task test -- src/api/public.test.ts` → **PASS** (existing `getFilm`/`getFeedGrouped` tests plus the new ones).

**Resilience notes:** default `limit = 100` matches the endpoint's window default (§2.5) — the FE renders the whole window without paging in v1. Keep `release_type` as `string` (don't narrow to a literal union) so a future bucket needs no FE type change.

---

## Task 2: `release-labels.ts` + `groupByReleaseDate` grouping helper

**Files:** create `src/components/calendar/release-labels.ts` + `.test.ts`; create `src/lib/calendar-groups.ts` + `.test.ts`.

- [ ] **Step 1 — failing label tests.** Create `src/components/calendar/release-labels.test.ts`. Assert `releaseBucketLabel("premiere") === "Premiere"`, `("limited") === "Limited release"`, `("wide") === "Wide release"`, and that an **unknown** bucket falls back to a non-empty human string (e.g. the raw value or a Title-cased form — never blank). Run → **FAIL** (module missing).

- [ ] **Step 2 — implement the labels.** Create `src/components/calendar/release-labels.ts` exporting `RELEASE_BUCKET_LABELS` (`{ premiere: "Premiere", limited: "Limited release", wide: "Wide release" }`) and `releaseBucketLabel(bucket: string): string` (map lookup with a safe fallback for an unmapped value). Run → **PASS**.

- [ ] **Step 3 — failing grouping tests.** Create `src/lib/calendar-groups.test.ts`. With a small fixture of `CalendarItem`s in **backend order** (`release_date ASC`, then `release_type ASC`), assert `groupByReleaseDate(items)`:
  - returns `[]` for no items;
  - opens one date section per distinct `release_date`, **in input order** (soonest-first), each with a `dateKey` (`"YYYY-MM-DD"`) and a UTC `heading` (e.g. contains `"July 4, 2026"`);
  - within a date, buckets adjacent same-`release_type` items into one sub-group, **preserving the premiere→limited→wide order the server emitted** (no re-sort): e.g. a date with a premiere then two wide items → sub-groups `[premiere, wide]` with the wide sub-group holding both films;
  - each bucket sub-group carries the bucket key, its `label` (via `releaseBucketLabel`), and its `films`;
  - a second date with only `limited` items opens a fresh date section.

  Run → **FAIL** (`@/lib/calendar-groups` missing).

- [ ] **Step 4 — implement `groupByReleaseDate`.** Create `src/lib/calendar-groups.ts`, mirroring `feed-groups.ts` `groupByDay`'s adjacency walk but **two-level** (date → bucket). Import `formatDayHeading` from `@/lib/format` and `releaseBucketLabel` from `@/components/calendar/release-labels`. Representative shape (exact field names are the contract the route reads — keep them stable):

```ts
export interface CalendarBucketGroup {
  bucket: string; // "premiere" | "limited" | "wide"
  label: string; // releaseBucketLabel(bucket)
  films: CalendarItem[];
}
export interface CalendarDateGroup {
  dateKey: string; // "YYYY-MM-DD" — stable React key + <time dateTime>
  heading: string; // formatDayHeading(release_date), UTC, e.g. "Saturday, July 4, 2026"
  buckets: CalendarBucketGroup[];
}
export function groupByReleaseDate(items: CalendarItem[]): CalendarDateGroup[];
```

  Walk the list once: open a new `CalendarDateGroup` when `release_date` changes; within the current date, open a new `CalendarBucketGroup` when `release_type` changes, else push the film. **No `.sort()`, no `Date.now()`** — rely entirely on the server order (the determinism rule). Run → **PASS**.

**Resilience notes:** the helper is pure and order-preserving — it must never reorder; if the server order ever changed, the page would reflect it verbatim. `formatDayHeading` already lives in `format.ts` and is UTC — do **not** add a new date formatter. Keeping `label` inside the group (vs. recomputing in the component) is a minor choice that matches the spec's §2.5 shape; either is acceptable as long as the route reads whatever shape this returns.

---

## Task 3: `CalendarFilmCard` (one film cell)

**Files:** create `src/components/calendar/CalendarFilmCard.tsx` + `.test.tsx`.

- [ ] **Step 1 — failing render test.** Create `src/components/calendar/CalendarFilmCard.test.tsx`. The card uses `<Link>`, so render inside `MemoryRouter`. Assert:
  - the whole cell links to `/film/{slug}` (`getByRole("link")` → `href`);
  - the `film_title` is shown;
  - with a non-null `poster_path`, an `<img>` is present with the `posterUrl(path, "w185")` `src` and a meaningful `alt` (e.g. `"{title} poster"`);
  - with `poster_path: null`, **no broken `<img>`** renders — a neutral placeholder tile is present instead (assert via a `data-testid` like `poster-placeholder`, or `queryByRole("img")` being null).

  Run → **FAIL** (module missing).

- [ ] **Step 2 — implement `CalendarFilmCard`.** Create `src/components/calendar/CalendarFilmCard.tsx`, mirroring the NEU-399 `FilmPosterCard` null-guard pattern. Reuse `posterUrl` from `@/lib/poster` and `Link` from `react-router`. Compute `const poster = posterUrl(item.poster_path, "w185");` then render `<Link to={\`/film/${item.film_slug}\`}>` wrapping `poster ? <img src={poster} alt={\`${item.film_title} poster\`} .../> : <div data-testid="poster-placeholder" .../>` and the `item.film_title`. Use a fixed 2:3 poster aspect box so placeholder and real poster share a footprint. (Tailwind utility classes only; exact classes are non-load-bearing.) Run → **PASS**.

**Resilience notes:** never emit an `<img>` with a `null`/empty `src` (mirror `FilmHeader.tsx` / `FilmPosterCard`). `w185` is a smaller poster than `/browse` (`w342`) since calendar cells are denser — non-load-bearing, adjust freely.

---

## Task 4: `/calendar` route + wiring

**Files:** create `src/routes/calendar.tsx` + `src/routes/calendar.test.tsx`; modify `src/routes.ts`.

- [ ] **Step 1 — failing route tests.** Create `src/routes/calendar.test.tsx`, mirroring `feed.test.tsx` (a `RouterContextProvider` with a `cloudflareContext` env stub for direct `loader`/`meta` calls, and `createRoutesStub` for render). Cover:
  - **loader:** MSW `GET /calendar` returns a sample `CalendarResponse`; `loader` fetches it and returns the data (assert `total` / first-item `film_slug`).
  - **meta:** returns the templated title and a canonical `link`. Assert the title **contains** `"Release Calendar"` (e.g. `t.title?.startsWith("Release Calendar")` or `/Release Calendar/`) rather than hardcoding the full `"· <SITE_NAME>"` suffix — `SITE_NAME` is owned by NEU-392 (M1) and may rename to BackLotter; also assert a `description` descriptor and a `tagName: "link", rel: "canonical"` descriptor exist (the `feed.test.tsx` meta-test pattern).
  - **render — grouped by date → type, soonest-first:** via `createRoutesStub` with a stub loader returning items spanning **two dates** and, within the first date, **two release types** (in backend order premiere→wide). Assert: both date headings render (UTC, e.g. `/July 4, 2026/` and `/July 11, 2026/`) in soonest-first DOM order; the per-type labels render (`"Premiere"`, `"Wide release"`); each film links to `/film/{slug}`. (A DOM-order assertion — e.g. the earlier date's heading precedes the later one — pins "soonest-first".)
  - **empty state:** stub loader returns `{ items: [], total: 0 }` → a friendly "No upcoming releases yet" message renders (HTTP 200, indexable — not an error).
  - **error boundary:** export and smoke-test `ErrorBoundary` renders the neutral "couldn't load" copy + a `Link` home (mirror `feed.test.tsx` if it covers this; otherwise a light render assertion).

  Run `task test -- src/routes/calendar.test.tsx` → **FAIL** (`@/routes/calendar` missing).

- [ ] **Step 2 — implement the route module.** Create `src/routes/calendar.tsx` with the `feed.tsx` eslint-disable header and the four exports:
  - **`loader({ context })`:** `const { env } = context.get(cloudflareContext); const calendar = await getCalendar(env.API_BASE_URL); return { calendar };` (a thrown fetch error falls through to `ErrorBoundary`).
  - **`meta({ location })`:** `buildMeta({ title: "Release Calendar", description: "Upcoming movie releases by date — premieres, limited, and wide theatrical openings for every film we track.", pathname: location.pathname, type: "website" })`.
  - **`default CalendarPage({ loaderData })`:** `const groups = groupByReleaseDate(loaderData.calendar.items);` then `groups.length === 0` → an empty-state block ("No upcoming releases yet — check back soon."), the indexable 200 state; else map each `CalendarDateGroup` to a `<section>` with a `<time dateTime={group.dateKey}>{group.heading}</time>` heading, and inside it map each `CalendarBucketGroup` to a small label (`bucket.label`) + a grid/list of `<CalendarFilmCard item={f} key={f.film_slug} />` (key by `film_slug`; films are distinct per (date, bucket) per the backend's de-dup). Mirror `feed.tsx`'s `<main>`/`<section>`/`<time>` structure.
  - **`ErrorBoundary()`:** neutral "We couldn't load the release calendar." copy + a `Link to="/"` home, same shape as `feed.tsx` (no 404 branch — the calendar never 404s).

  Run `task test -- src/routes/calendar.test.tsx` → **PASS**.

- [ ] **Step 3 — register the route.** In `src/routes.ts`, add `route("calendar", "routes/calendar.tsx")` inside the existing `public-layout` block, beside `index("routes/feed.tsx")` and `route("film/:slug", "routes/film.tsx")` (`route` is already imported). So `/calendar` inherits the shared public layout (header/footer) for free. Run `task typecheck` → `react-router typegen` generates `./+types/calendar`, then `tsc -b` reports 0 errors.

**Resilience notes:** the page body imports only `getCalendar`, `cloudflareContext`, `buildMeta`, `groupByReleaseDate`, and `CalendarFilmCard` — **no React Query / Auth** (the provider-free invariant). The grouping is driven entirely by the loader data; SSR and first client paint match by construction.

---

## Task 5: Activate the header `Calendar` nav link (NEU-398 seat → live)

**Files:** modify `src/components/layout/nav-items.ts`; update the NEU-398 nav test(s) that assert `Calendar` is inert.

- [ ] **Step 1 — failing test (flip the assertion).** NEU-398 ships `nav-items.ts` with `{ label: "Calendar", href: "/calendar", enabled: false }` and a test (`src/components/layout/PrimaryNav.test.tsx`, and/or `public-layout.test.tsx`) asserting `Calendar` renders as an **inert, non-link** seat. Update that assertion to its opposite: `Calendar` is now a live link — `getByRole("link", { name: /calendar/i })` with `href="/calendar"` (and no longer `aria-disabled`). Optionally add a focused config test asserting the `NAV_ITEMS` `Calendar` entry has `enabled: true`. Run the affected test(s) → **FAIL** (still inert).

- [ ] **Step 2 — flip the flag.** In `src/components/layout/nav-items.ts`, change the `Calendar` entry `enabled: false` → `enabled: true`. No other header change — `PrimaryNav` already renders enabled items as `NavLink`s (NEU-398 did the wiring; this is the one-line activation the spec §2.5 calls for). Re-run → **PASS**.

**Resilience notes (NEU-398 ordering):** NEU-398 is a hard precedent for the seat but a *related*, not blocking, ticket. **If `src/components/layout/nav-items.ts` does not yet exist** (NEU-398 unmerged at implementation time), do **not** restructure the header — instead, when the file lands, add/flip the `Calendar` entry to `enabled: true`; until then this task is a no-op stub and the route (Tasks 1–4) plus sitemap (Task 6) still ship a fully-reachable `/calendar` (direct URL + sitemap). Drive the test off the `NAV_ITEMS` config / `PrimaryNav` rendering, not hardcoded markup, so a later header restyle doesn't churn it.

---

## Task 6: `/calendar` sitemap injection (FE-only)

**Files:** modify `src/routes/sitemap.ts` + `src/routes/sitemap.test.ts`. **No backend change** — the backend sitemap is untouched; the FE proxy injects the `/calendar` `<url>` (mirrors the NEU-399 `/browse` injection, §3.4).

- [ ] **Step 1 — failing test.** In `src/routes/sitemap.test.ts`, extend the happy-path test: the MSW `GET /sitemap.xml` upstream returns a `<urlset>` containing a root `<url><loc>https://app.upmovies.localhost/</loc></url>`; after proxying, assert the body **contains** `<loc>https://app.upmovies.localhost/calendar</loc>` (host derived from the upstream root `<loc>`, not hardcoded) while preserving the root entry. Keep the existing content-type + `cache-control` assertions, and leave the 503-fallback test unchanged (the empty-urlset fallback need not contain `/calendar`). Run `task test -- src/routes/sitemap.test.ts` → **FAIL** (no `/calendar` loc yet).

- [ ] **Step 2 — implement the injection.** In `src/routes/sitemap.ts`, inject a `/calendar` `<url>` into the upstream body on the success path, following the NEU-399 contract:
  - derive the canonical base from the **first** `<loc>…</loc>` in the upstream XML and strip the trailing slash → `base`;
  - insert `<url><loc>${base}/calendar</loc></url>` immediately before the closing `</urlset>`;
  - **resilient fallbacks:** if no `<loc>` or no `</urlset>` is found, return the XML unchanged (never corrupt the document); only inject on the success path — keep the existing 503 empty-urlset fallback exactly as-is; preserve the pass-through `status`, `Content-Type`, and `Cache-Control` headers.
  - **Coordinate with NEU-399:** if NEU-399's `injectBrowseUrl` helper already exists in this file, prefer **generalizing** it to a list-driven helper (e.g. `injectFeRoutes(xml, ["/browse", "/calendar"])`) so both routes inject through one code path; if NEU-399 has **not** landed, create the injection helper from scratch (pure, unit-testable) injecting `/calendar` — written so NEU-399 can later add `/browse` to the same list. End-state: every FE-owned public route (`/calendar`, and `/browse` if NEU-399 merged) appears once in the proxied sitemap.

  Run `task test -- src/routes/sitemap.test.ts` → **PASS**.

**Resilience notes:** derive the host from what the backend advertises so dev (`https://app.upmovies.localhost`) and prod stay consistent. `routes/robots.ts` already `Allow: /` everything except `/login`/`/signup`/`/admin/`, so `/calendar` is crawlable with **no robots change**. The empty state and default window are HTTP 200, indexable — a single canonical page, no `?page=` thin-page concern.

---

## Task 7: Full verification + handoff

**Files:** none (verification only).

- [ ] **Step 1 — format touched files:** `task format`. Do not stage unrelated `AuthContext.*` drift.
- [ ] **Step 2 — lint:** `task lint` → `eslint src --max-warnings 0` passes (no unused imports; the route file carries the `react-refresh/only-export-components` disable header).
- [ ] **Step 3 — typecheck:** `task typecheck` → `react-router typegen` + `tsc -b` report 0 errors (incl. the generated `./+types/calendar`).
- [ ] **Step 4 — full suite:** `task test` → the entire Vitest suite is green (new `getCalendar`/`release-labels`/`calendar-groups`/`CalendarFilmCard`/`calendar`/`sitemap` tests + the updated nav test + all untouched suites).
- [ ] **Step 5 — hand off for commit (user).** Do **NOT** commit from task execution. Report the green gates. The user commits the whole NEU-409 change as **one PR** off the ticket branch, using `/commit-msg` (Conventional Commits subject, no Linear ID in the subject, no `Co-Authored-By`) and `/pr-desc` (PR title carries `(NEU-409)`; body keeps the `🤖 Generated with Claude Code` footer). Pre-commit hooks delegate into the container — commit normally with the container up.

---

## Acceptance criteria (NEU-409, from spec §4)

1. A public SSR route **`/calendar`** consumes `GET /calendar` and renders upcoming releases **grouped by date (soonest-first) then by release type** (premiere → limited → wide), each film a card linking to `/film/{slug}` (poster + title; placeholder for a null poster).
2. The header's **Calendar** nav entry is **live** (`enabled: true`) — reachable from the global header.
3. **SEO:** `meta()` via `buildMeta` (title "Release Calendar" + description/OG/canonical); `/calendar` present in the FE sitemap; crawlable in robots (no robots change needed).
4. **Empty state** is a graceful 200 ("No upcoming releases yet"); a fetch failure surfaces the neutral `ErrorBoundary`.
5. New `getCalendar` fetcher + `CalendarItem`/`CalendarResponse` types mirror the backend DTOs; `groupByReleaseDate` is a pure, deterministic (no client sort, no `Date.now()`, UTC headings) grouping helper.
6. Tests (Vitest + RTL + MSW) cover: the loader (MSW-mocked `GET /calendar`), the date→type grouped render + film links + label mapping + soonest-first ordering, the empty state, the error boundary, the nav-entry-live flip, the sitemap `/calendar` injection, and `groupByReleaseDate` / `releaseBucketLabel` unit tests. `task test` / `task lint` (zero warnings) / `task typecheck` green; touched files prettier-clean.

## Which part of M6 this realizes

This is the **frontend half** of Story **NEU-373** ("Public release calendar") — spec **§2.5** (the `/calendar` SSR route + its API fetcher/types + the date→type grouping render + the nav flip + the sitemap injection + SEO meta). It **consumes** the NEU-408 `CalendarResponse` contract (§2.4) and **activates** the NEU-398 `Calendar` nav seat. It adds **no backend** work and does not touch the NEU-404 release-dates schema (M6 only reads it, via NEU-408). Realizes the milestone-acceptance bullet **"NEU-409 — `/calendar` SSR route (frontend)"** (§4).

## TDD testing intent (summary)

| Behavior | Where asserted |
|---|---|
| `getCalendar` returns typed `CalendarResponse`; sends default/explicit `limit`/`offset`; throws on non-OK | `src/api/public.test.ts` |
| `releaseBucketLabel` maps premiere/limited/wide → labels; safe fallback for unknown | `src/components/calendar/release-labels.test.ts` |
| `groupByReleaseDate` buckets by date → type, soonest-first, adjacency-walk, UTC headings, no re-sort | `src/lib/calendar-groups.test.ts` |
| `CalendarFilmCard` links to `/film/{slug}`; poster `<img>` or placeholder (null-safe) | `src/components/calendar/CalendarFilmCard.test.tsx` |
| Route loader fetches `GET /calendar`; meta title/canonical; grouped render (date→type, soonest-first, film links, labels); empty state; error boundary | `src/routes/calendar.test.tsx` |
| Header `Calendar` nav entry is now a live link (`enabled: true`) | `src/components/layout/PrimaryNav.test.tsx` (NEU-398's, updated) / nav-config test |
| FE sitemap proxy injects `/calendar` `<url>`; failure fallback unchanged | `src/routes/sitemap.test.ts` |

## Key files touched

- `src/api/types.ts` — add `CalendarItem` + `CalendarResponse` (mirror NEU-408 DTOs).
- `src/api/public.ts` — add `getCalendar(baseUrl, { limit?, offset? })` (clone of `getFeedGrouped`, always 200).
- `src/api/public.test.ts` — `getCalendar` tests (200 + default/explicit params; non-OK throws).
- `src/components/calendar/release-labels.ts` *(new)* + `.test.ts` — `RELEASE_BUCKET_LABELS` + `releaseBucketLabel`.
- `src/lib/calendar-groups.ts` *(new)* + `.test.ts` — pure `groupByReleaseDate` (date → type adjacency walk, mirrors `groupByDay`).
- `src/components/calendar/CalendarFilmCard.tsx` *(new)* + `.test.tsx` — one film cell (poster/placeholder + title, linked).
- `src/routes/calendar.tsx` *(new)* + `src/routes/calendar.test.tsx` *(new)* — route module (`loader`, `meta`, `CalendarPage`, `ErrorBoundary`).
- `src/routes.ts` — add `route("calendar", "routes/calendar.tsx")` inside the `public-layout` block.
- `src/components/layout/nav-items.ts` — flip the `Calendar` entry `enabled: false → true` (+ update NEU-398's nav test). *Resilient:* if the file doesn't exist yet (NEU-398 unmerged), add/flip the entry when it lands; do not restructure the header.
- `src/routes/sitemap.ts` + `src/routes/sitemap.test.ts` — inject a `/calendar` `<url>` (generalize NEU-399's `injectBrowseUrl` if present, else create the injection helper).
- *(reference only, not modified)* `src/lib/format.ts` (`formatDayHeading`/`dayKey`, UTC — reused as-is), `src/lib/poster.ts` (`posterUrl`), `src/lib/seo.ts` (`buildMeta`), `src/routes/feed.tsx` + `src/lib/feed-groups.ts` (the templates mirrored).

---

## Self-review

**Spec coverage** (`…-m06-release-calendar.md` §2.4–§2.5, §3.4–§3.5, §4):
- New public SSR `/calendar` under `public-layout`, `loader → meta → component → ErrorBoundary` → Task 4 (`calendar.tsx` + `routes.ts`); asserted by the loader/render tests.
- Loader consumes `GET /calendar` via `getCalendar`; `CalendarItem`/`CalendarResponse` mirror the backend DTOs → Task 1; asserted by `public.test.ts`. ✓
- Grouped by date (soonest-first) → release type (premiere→limited→wide), reusing `formatDayHeading`/UTC headings, no client sort → Task 2 (`groupByReleaseDate`) + Task 4 render; asserted by `calendar-groups.test.ts` + the route render test. ✓
- Film card: poster (or placeholder) + title, linked to `/film/{slug}` → Task 3 (`CalendarFilmCard`); asserted by the card tests. ✓
- Header `Calendar` nav entry live (`enabled: true`), no header surgery → Task 5; asserted by the updated NEU-398 nav test. ✓
- SEO meta via `buildMeta`; FE sitemap `/calendar` injection; robots unchanged → Task 4 `meta` + Task 6; asserted by the meta + sitemap tests. ✓
- Graceful empty state (200, indexable) + neutral `ErrorBoundary` → Task 4; asserted by the empty-state + error-boundary tests. ✓
- Determinism: adjacency grouping, UTC formatting, provider-free body (no `/me` during SSR) → Working agreements + Tasks 2/4. ✓
- Realizes M6 "NEU-409 — `/calendar` SSR route (frontend)" / Story NEU-373 FE half; blocked by NEU-408, related to NEU-398 → Realizes / Which-part sections. ✓

**Type/name consistency:** `getCalendar(baseUrl, { limit?, offset? }): Promise<CalendarResponse>` (Task 1) is called as `getCalendar(env.API_BASE_URL)` in the loader (Task 4). `CalendarItem` fields (`film_slug`, `film_title`, `poster_path`, `release_date`, `release_type`) match the NEU-408 DTOs and are read by `groupByReleaseDate` (Task 2), `CalendarFilmCard` (Task 3: `item.film_slug`/`item.film_title`/`item.poster_path`), and `CalendarPage` (Task 4). The grouping return shape (`CalendarDateGroup` → `dateKey`/`heading`/`buckets[]` of `CalendarBucketGroup` → `bucket`/`label`/`films[]`) is produced in Task 2 and read identically in Task 4. `releaseBucketLabel` (Task 2) is imported by `calendar-groups.ts` (Task 2). `formatDayHeading`/`posterUrl`/`buildMeta`/`cloudflareContext`/`Link` are reused from their shipped modules; the only shipped files modified beyond new files are `routes.ts` (one route), `nav-items.ts` (one flag), and `sitemap.ts` (the injection) + their tests.

**Resilience:** light on exact signatures — fetcher/grouping/route described by contract + the load-bearing shapes (the `CalendarResponse` it consumes, the group shape the route reads), not verbatim code. NEU-398 ordering has an explicit "if `nav-items.ts` doesn't exist yet, defer the flip; the route still ships reachable" escape. NEU-399 sitemap coupling has an explicit "generalize `injectBrowseUrl` if present, else create from scratch" branch. The meta test asserts the title *contains* "Release Calendar" rather than the full `· <SITE_NAME>` suffix, surviving the NEU-392 (M1) wordmark rename. `release_type` stays a plain `string`, forward-compatible with a future bucket.

**Placeholder scan:** no "TBD"/"similar to Task N"/"add error handling later" — each task names its files, its test-first red→green steps, the exact `task` command, and the expected FAIL/PASS. Code is given as signatures + load-bearing snippets (types, fetcher default, group shape, sitemap-injection contract) and behavioral contracts elsewhere, intentionally resilient to minor naming/markup choices.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
</content>
</invoke>
