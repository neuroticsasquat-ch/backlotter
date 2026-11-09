**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m04-film-search.md
**Depends on:** NEU-400, NEU-398

# NEU-401 `[frontend]` — Search box in header + results view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:test-driven-development` (write the failing test first, watch it fail for the right reason, then make it pass), then `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **One ticket = one PR = one `/implementit` run; do NOT commit per task** — the user commits the whole NEU-401 change once at the end off the ticket branch.

**Goal:** Wire a search affordance into the global header so a visitor can find a tracked film by title. The baseline is a server-rendered `role="search"` GET form that submits to a new `/search` SSR results page (works with zero JS / for crawlers); post-hydration, the input upgrades to a debounced, abortable, accessible **combobox dropdown** of top matches. Every result — on the page and in the dropdown — links to `/film/{slug}`. Backed by `GET /films/search?q=` (NEU-400), mounted into the M3 header slot (NEU-398). Accessible, SSR-safe, graceful on no-results and on error.

**Which part of M4 this realizes:** Story **NEU-388** ("Find a film by title"), frontend half — spec §2.2 in full: (a) the `getFilmSearch` fetcher reusing the index types, (b) the `/search` SSR results page (the no-JS backbone + submit target), and (c) the header search-box island (form baseline + post-hydration combobox dropdown) plus flipping the M3 `Search` nav seat to `enabled: true`. The backend `GET /films/search` endpoint is **NEU-400** (separate ticket); this ticket consumes its `FilmIndexResponse` contract.

**Architecture:** Frontend-only, read-path-only, three layered pieces so the baseline works without JS and the live dropdown is pure enhancement:
1. **Fetcher** — one pure, base-URL-injected `getFilmSearch` beside `getFilms`/`getFilm`/`getFeedGrouped` in `src/api/public.ts`, plus a `signal?: AbortSignal` so the dropdown can cancel stale requests. Reuses the index response type (no new envelope).
2. **`/search` SSR route** — a new route in the `public-layout` block following the `feed.tsx`/`film.tsx` `loader → meta → component → ErrorBoundary` template; `noindex`; renders a poster grid + graceful empty/no-results states; the header form's `action` target.
3. **Header search box island** — an SSR-safe `role="search"` `<form action="/search" method="get">` mounted into the M3 `GlobalHeader` insertion slot, progressively enhanced after hydration into a debounced/abortable WAI-ARIA combobox dropdown. Flips the M3 `NAV_ITEMS` `Search` entry to `enabled: true`.

**No backend change, no new env var, no new dependency.** Everything reuses already-shipped modules and the M3/M4 contracts.

**Tech stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — **all driven through `task` inside the container** (never run `pnpm`/`vitest`/`eslint`/`tsc` on the host).

---

## Pattern precedent (read before coding)

- `src/api/public.ts` — the pure base-URL-injected fetchers (`getFilm`, `getFeedGrouped`): `new URL(path, baseUrl)`, `url.searchParams.set(...)`, `headers: { Accept: "application/json" }`, throw `Error(`GET … failed: ${res.status}`)` on `!res.ok`, cast `(await res.json()) as T`. `getFilmSearch` mirrors this, adding `signal`.
- `src/api/public.test.ts` — the MSW fetcher-test pattern: `const BACKEND = "https://api.upmovies.localhost"`, `server.use(http.get(`${BACKEND}/…`, ({ request }) => …))`, capture `new URL(request.url).searchParams` to assert `q`/`limit`/`offset`, assert `rejects.toThrow(/failed: 500/)`.
- `src/routes/feed.tsx`, `src/routes/film.tsx` — the public SSR route template: `loader({ context, request })` → `const { env } = context.get(cloudflareContext)` → fetcher with `env.API_BASE_URL`; `meta({ location, loaderData })` via `buildMeta({...})`; the `{ name: "robots", content: "noindex" }` idiom (`film.tsx` not-found); the named `ErrorBoundary` export; `import type { Route } from "./+types/search"`.
- `src/routes/feed.test.tsx` — the loader+render test pattern: build a `RouterContextProvider`, `context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } })`, call the loader directly; render the component via `createRoutesStub([{ path, Component, loader }])` + `<Stub initialEntries={[…]} />`; empty-state asserted by stubbing empty `items`.
- `src/routes.ts` — `layout("routes/public-layout.tsx", [ index("routes/feed.tsx"), route("film/:slug", "routes/film.tsx") ])`; add `route("search", "routes/search.tsx")` inside that block.
- **NEU-398 header (hard dep):** `src/components/layout/GlobalHeader.tsx` (the documented search-box insertion slot), `src/components/layout/nav-items.ts` (`NAV_ITEMS` with `{ label: "Search", href: "/search", enabled: false }` + the `WORDMARK` constant), `src/components/layout/PrimaryNav.tsx`, `src/components/layout/HeaderAccount.tsx` (the scoped-provider island precedent).
- `src/components/ui/input.tsx` (a `forwardRef` Tailwind `Input`), `src/components/ui/button.tsx`, `src/lib/cn.ts` (the `cn()` class-merge helper) — reuse for the box styling.
- `src/lib/seo.ts` `buildMeta(...)`, `src/lib/poster.ts` `posterUrl(path, size)`, `src/lib/format.ts` `truncate(...)` — reuse for meta + poster thumbs.
- `src/test/msw/server.ts` + `src/test/msw/me.ts` + `src/test/setup.ts` — the MSW server (`onUnhandledRequest: "error"`), the per-test `server.use(...)` override pattern, and the **handler-factory** convention (`meHandler(...)`/`unauthMeHandler()`) this ticket mirrors with a `filmsSearchHandler(...)`.

---

## Working agreements (read first)

- **Everything runs in the container via `task`.** Keep it up (`task up`). Scope tests with `task test -- <path>`. Gates before done — all green: `task format` (touched files only) → `task lint` (eslint `--max-warnings 0`; **unused imports fail the build**) → `task typecheck` (`react-router typegen` + `tsc -b`) → `task test`.
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`). MSW runs `onUnhandledRequest: "error"` — register per-test handlers with `server.use(...)` from `@/test/msw/server`; the backend base in tests is `https://api.upmovies.localhost` (`env.apiBaseUrl` default). Interactions use `@testing-library/user-event`; await async results with `findBy*`.
- **Determinism / hydration safety.** The header renders **only** the static `role="search"` form on the server; the dropdown is gated client-only (mounted/focused flag) so SSR HTML and first client paint are byte-identical. No `Date.now()` / locale-dependent output in the server-rendered form. The public page body stays **provider-free** (NEU-312/NEU-398 invariant) — the dropdown's debounced fetch needs no TanStack Query.
- **One PR.** If executing via subagents, strip any commit step from implementer prompts; the user commits once at the end.
- **No backend / no env / no dependency changes.** `getFilmSearch` consumes the live NEU-400 endpoint (mocked via MSW in tests); the search box mounts into the already-shipped NEU-398 header slot.
- **Soft relation to NEU-399 (M3 sibling `/browse`, NOT a hard dep) — be resilient (see "Reuse-or-define" below).** NEU-399 is slated to add `FilmIndexItem`/`FilmIndexResponse` FE types, `FilmPosterCard`, and `PAGE_SIZE`/clamp helpers. This ticket **reuses them if present** and **defines minimal local equivalents if absent** — it must not hard-block on NEU-399's landing order.

---

## The contract this consumes (from NEU-400)

- **Endpoint:** `GET /films/search?q=<term>&limit=<n>&offset=<n>` → `200` with a `FilmIndexResponse` body: `{ items: FilmIndexItem[], total, limit, offset }`, each item `{ slug, title, release_year, poster_path, arc_stage }` — **identical** to `GET /films`.
- **Bounds / defaults:** `limit` `ge=1, le=100` (endpoint default `20`), `offset` `ge=0`; out-of-range → `422`.
- **Graceful empty:** blank / whitespace-only / too-short `q` → `200` with `items: []`, `total: 0` (never `422`). The FE also short-circuits blank/short `q` (min length, no request) so a stray empty call never happens — and if it does, it's a cheap empty envelope.
- **Visibility guarantee:** every returned film is publicly visible → openable at `/film/{slug}` (no dead links).
- **Ordering:** `release_date desc` (nulls last), then `id asc` — the FE renders in the order received (no client re-sort).

### Reuse-or-define (NEU-399 soft-dep resolution)

| Artifact | If NEU-399 has landed | If not (resilient fallback) |
|---|---|---|
| `FilmIndexItem` / `FilmIndexResponse` in `src/api/types.ts` | Import and reuse verbatim. | **Add them** in `src/api/types.ts` mirroring the NEU-400 envelope: `FilmIndexItem = { slug: string; title: string; release_year: number \| null; poster_path: string \| null; arc_stage: ArcStage }` and `FilmIndexResponse = { items: FilmIndexItem[]; total: number; limit: number; offset: number }`. (`ArcStage` already exists in `types.ts`.) |
| `FilmPosterCard` (poster grid card) | Reuse on the `/search` results page. | Render a minimal local result card/grid (poster thumb via `posterUrl(item.poster_path, …)` + title + `release_year`, linking to `/film/${item.slug}`) — keep it small and replace with `FilmPosterCard` when NEU-399 merges. |
| `PAGE_SIZE` / `clampToInt` helper | Reuse for the route's page→offset/limit math. | Define a local `PAGE_SIZE` (e.g. `20`, matching the endpoint default) + a tiny `clampToInt` in `search.tsx`. |

The dropdown row (`SearchResultItem`) is always local to `src/components/search/` (it's a compact combobox option, not the grid card).

---

## What changes (files)

| File | Action | Responsibility |
|---|---|---|
| `src/api/types.ts` | reuse / modify | Reuse `FilmIndexItem`/`FilmIndexResponse` from NEU-399; **add them here if absent** (see Reuse-or-define). No new envelope shape. |
| `src/api/public.ts` | modify | Add `getFilmSearch(baseUrl, q, { limit?, offset?, signal? })` → `Promise<FilmIndexResponse>`, mirroring `getFeedGrouped` (`new URL("/films/search", baseUrl)`, set `q`/`limit`/`offset`, `Accept: application/json`, pass `signal` to `fetch`, throw on `!res.ok`). |
| `src/routes.ts` | modify | Add `route("search", "routes/search.tsx")` inside the `layout("routes/public-layout.tsx", […])` block. |
| `src/routes/search.tsx` | create | `loader` (read `q`/`page` from `request` URL → `getFilmSearch` with `env.API_BASE_URL`; empty/short `q` → no fetch, landing prompt), `meta` (`buildMeta` + `noindex`), `SearchPage` (poster grid + empty/no-results states + optional pagination), `ErrorBoundary`. |
| `src/components/layout/nav-items.ts` | modify | Flip the `Search` entry `enabled: false → true` (its `href: "/search"` now resolves). |
| `src/components/layout/GlobalHeader.tsx` | modify | Mount `<SearchBox/>` into the documented insertion slot. |
| `src/components/search/SearchBox.tsx` | create | The `role="search"` `<form action="/search" method="get">` (SSR baseline) + the post-hydration combobox dropdown island. |
| `src/components/search/useDebouncedSearch.ts` | create | Debounce (`setTimeout`) + `AbortController` hook: `useState` for `q`/results/status; min-length gate; aborts the prior request on each keystroke; cleans up on unmount. |
| `src/components/search/SearchResultItem.tsx` | create | One dropdown `role="option"` row: poster thumb + title + year, links to `/film/${slug}`. |
| `src/test/msw/films-search.ts` | create | `filmsSearchHandler(...)` factory (mirror `me.ts`) returning a `FilmIndexResponse` for `GET /films/search`, parameterizable by items / error status. |
| `src/api/public.test.ts` | modify | `getFilmSearch` tests (q/limit/offset params; 200 typed; throws on 500; passes `signal`). |
| `src/routes/search.test.tsx` | create | Loader + render tests (loader fetches on `q`; landing on empty `q`; results render + film links; no-results state; ErrorBoundary on throw). |
| `src/components/search/SearchBox.test.tsx` | create | Form baseline (action/method/`name="q"`/labeled input) + dropdown enhancement (debounce, result render, keyboard nav, no-results, error-degrades). |

No changes to the API, env, dependencies, or `public-layout.tsx`/`PrimaryNav.tsx` beyond the `nav-items` flag.

---

## Architecture & approach

### (a) Fetcher — `getFilmSearch`

A pure, base-URL-injected fetcher beside the existing public fetchers, identical in shape to `getFeedGrouped` plus an optional `AbortSignal`:

- Builds `new URL("/films/search", baseUrl)`, sets `q`, `limit` (default mirroring the endpoint, e.g. `20`), `offset` (default `0`).
- `fetch(url, { headers: { Accept: "application/json" }, signal })`; throw `Error(`GET /films/search failed: ${res.status}`)` on `!res.ok`; return `(await res.json()) as FilmIndexResponse`.
- Two callers, one fetcher: the SSR `/search` loader passes the Worker env (`env.API_BASE_URL`); the client dropdown passes the browser env (`@/env` `env.apiBaseUrl`). The `signal` lets the dropdown cancel stale requests; the loader omits it.
- *(Resilience: keep signatures light — the option-bag shape `{ limit?, offset?, signal? }` and the default `limit` are the implementer's to set; the only load-bearing contract is the URL + the `FilmIndexResponse` return.)*

### (b) `/search` SSR results page — the no-JS backbone + submit target

A new route in the `public-layout` block, following the `feed.tsx`/`film.tsx` template:

- **loader(`{ context, request }`)** — read `env` from `cloudflareContext`; parse `q = (url.searchParams.get("q") ?? "").trim()` and a `page`→`offset`/`limit` (reuse NEU-399's `PAGE_SIZE`/clamp or a local fallback). If `q` is empty/too-short → return `{ q, results: null }` (landing prompt, **no fetch**); else `{ q, results: await getFilmSearch(env.API_BASE_URL, q, { limit, offset }) }`.
- **meta(`{ location, loaderData }`)** — `buildMeta({ title: q ? `Search: “${q}”` : "Search", pathname: location.pathname, … })` **plus** `{ name: "robots", content: "noindex" }` (query-string result pages are thin/infinite — the `film.tsx` not-found idiom). Do **not** add `/search` to the sitemap.
- **SearchPage(`{ loaderData }`)** — three states: `results === null` → "Type a film title to search." (landing, `200`); `results.total === 0` → "No films match “{q}”." (graceful, `200`); otherwise a poster grid of `FilmPosterCard` (or the local fallback card) + optional pagination. Each card links to `/film/{slug}`.
- **ErrorBoundary** — neutral "We couldn't run that search" + a link home (a `getFilmSearch` throw surfaces here; mirror `feed.tsx`'s boundary).

### (c) The header search box — SSR-safe baseline + progressive-enhancement combobox

Mounted into the NEU-398 `GlobalHeader` insertion slot; the M3 `Search` nav seat flips to `enabled: true`.

- **SSR-safe baseline = a real form.** A `role="search"` landmark wrapping `<form action="/search" method="get">` with a **labeled** `name="q"` input (visually-hidden `<label>` or `aria-label`) and a submit control. **Server-rendered, zero JS:** submitting navigates to `/search?q=…`. No client state on the server → no hydration mismatch (server HTML = first client paint).
- **Progressive-enhancement dropdown (the island).** After hydration the input gains a debounced live combobox: as the user types, a debounced `getFilmSearch(env.apiBaseUrl, q, { limit: 8, signal })` populates a dropdown of top matches, each a `<Link to={`/film/${item.slug}`}>` (poster thumb + title + year via `SearchResultItem`), plus a **"See all results for '{q}'"** row → `/search?q=…`. The dropdown renders **only client-side** (gated on a mounted/focused flag) so SSR emits just the form.
- **State (`useDebouncedSearch`).** `useState` for `q`/results/status; a `useEffect` with a `setTimeout` debounce (~250–300 ms) and an `AbortController` that aborts the previous request on each keystroke and on unmount; min query length (≥2) and a blank short-circuit so no request fires below threshold. **No TanStack Query** — the body stays provider-free; the dropdown is ephemeral, not cached server-state. *(Optional later upgrade noted in the spec: a scoped `QueryClientProvider` mirroring `HeaderAccount` — not needed for M4.)*
- **UX states (dropdown):** below min length / empty → closed, no fetch; loading → keep prior results / subtle pending; results → listbox + "See all"; **no-results → "No films match '{q}'"** (`aria-live` announced); **fetch error → quietly close the dropdown** (the form still submits to `/search`, where the ErrorBoundary handles hard failures) — a transient search blip must never break the header.

### Accessibility

- `role="search"` landmark; an associated visually-hidden `<label>` or `aria-label` on the input.
- The dropdown as a WAI-ARIA **combobox**: `role="combobox"` on the input, `aria-expanded`, `aria-controls` → the listbox id, `aria-activedescendant` → the active option id, over a `role="listbox"` of `role="option"` rows.
- **Keyboard:** Down/Up to move the active option, Enter to open the active film (or submit when none active), Escape to dismiss and return focus to the input.
- Result count / "no results" surfaced via `aria-live="polite"`. The no-JS form is inherently keyboard/SR-accessible.
- *(Resilience: hand-roll the combobox with the ARIA attributes above — `cmdk`/`@radix-ui/react-select` are installed but not required; keep it provider-free and small. The load-bearing contract is the ARIA roles + keyboard behavior, not a specific library.)*

---

## Tasks

- [ ] **Task 1 — Fetcher + types (TDD).** *Test first:* in `src/api/public.test.ts` add `getFilmSearch` cases — returns the typed `FilmIndexResponse` on `200`; sends `q`/`limit`/`offset` query params (capture via `({ request }) => new URL(request.url).searchParams`); throws `/failed: 500/` on `500`; passes a provided `signal` to `fetch`. Run `task test -- src/api/public.test.ts` → FAIL. *Implement:* ensure `FilmIndexItem`/`FilmIndexResponse` exist in `src/api/types.ts` (reuse NEU-399's or add per Reuse-or-define); add `getFilmSearch` to `src/api/public.ts`. Re-run → PASS.
- [ ] **Task 2 — `/search` SSR route (TDD).** *Test first:* create `src/routes/search.test.tsx` — (1) loader fetches and returns results when `q` is present (set `cloudflareContext` env, `server.use(filmsSearchHandler(...))`, call the loader directly with a `Request` whose URL has `?q=…`); (2) loader returns the landing shape (no fetch) for empty/short `q`; (3) `SearchPage` renders results as cards each linking to `/film/{slug}` (via `createRoutesStub`); (4) no-results state for `total: 0`; (5) landing prompt for `results: null`. Run `task test -- src/routes/search.test.tsx` → FAIL. *Implement:* add `route("search", …)` to `src/routes.ts`; create `src/routes/search.tsx` (loader/meta+noindex/SearchPage/ErrorBoundary) and the `filmsSearchHandler` factory in `src/test/msw/films-search.ts`; reuse `FilmPosterCard`/`PAGE_SIZE` or the local fallbacks. Re-run → PASS.
- [ ] **Task 3 — Header search box: SSR-safe form baseline (TDD).** *Test first:* create `src/components/search/SearchBox.test.tsx` — render `<SearchBox/>` in a `MemoryRouter`; assert a `role="search"` landmark, a `<form>` with `action="/search"` + `method="get"`, a labeled input with `name="q"`, and a submit control. (No dropdown yet.) Run → FAIL. *Implement:* create `src/components/search/SearchBox.tsx` with the form baseline (reuse `ui/input.tsx`); mount it in `GlobalHeader.tsx`'s insertion slot; flip the `Search` entry in `nav-items.ts` to `enabled: true`. Re-run → PASS.
- [ ] **Task 4 — Progressive-enhancement combobox dropdown (TDD).** *Test first:* extend `SearchBox.test.tsx` (and/or a focused `useDebouncedSearch`/`SearchResultItem` test) — with `server.use(filmsSearchHandler({ items: [...] }))` and `userEvent`, typing a query opens a `role="listbox"` of `role="option"` rows (`await findBy*`), each linking to `/film/{slug}`, plus a "See all results" row → `/search?q=…`; **debounce** fires one request for rapid typing (assert via a request counter / a single handler hit); **keyboard** ArrowDown/ArrowUp move `aria-activedescendant`, Enter opens the active film, Escape closes; **no-results** shows the announced empty message; **error degrades** (handler → `500` closes the dropdown without throwing, form still present). Run → FAIL. *Implement:* create `useDebouncedSearch.ts` (`setTimeout` debounce + `AbortController` + min-length gate) and `SearchResultItem.tsx`; wire the combobox ARIA (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`) + `aria-live` into `SearchBox`; gate rendering client-only (mounted/focused flag). Re-run → PASS.
  *(Debounce timing: prefer asserting "exactly one backend hit after rapid typing" via a request counter; if using `vi.useFakeTimers`, drive `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` — no existing suite uses fake timers, so the counter approach is the lower-risk default.)*
- [ ] **Task 5 — Full verification + handoff.** `task format` (touched files only) → `task lint` (zero warnings; no unused imports) → `task typecheck` (`react-router typegen` + `tsc -b`; the new `search.tsx` route module generates `+types/search`) → `task test` (full suite green). Confirm `git diff --stat` is confined to the files in the table. **Do not commit from task execution** — report the green gates; the user commits the whole NEU-401 change as **one PR** off the ticket branch (Conventional Commits subject, no Linear ID in the commit subject; PR **title** carries `(NEU-401)`; the `🤖 Generated with Claude Code` footer in the **PR body only**; no `Co-Authored-By`). Pre-commit hooks delegate into the container — commit normally with the container up.

---

## Acceptance criteria (from milestone §4)

1. A `role="search"` search box renders in the **global header** on every public page; submitting (or no-JS) navigates to the **`/search?q=` SSR results page**, which lists matches as a poster grid each linking to `/film/{slug}`, with a graceful **no-results** state and an empty/landing state.
2. With JS, the input shows a **debounced** (min-length-gated, `AbortController`-cancelled) live dropdown of top matches each linking to `/film/{slug}`, plus a "See all results" row → `/search?q=`.
3. **SSR-safe:** the server emits **only** the form (no hydration mismatch); the dropdown is post-hydration; the public page body stays **provider-free**. **Accessible:** combobox/listbox semantics, full keyboard nav (Down/Up/Enter/Escape), labeled input, `aria-live` result/no-results announcements.
4. The M3 `Search` nav entry is flipped to `enabled: true`; `getFilmSearch` reuses the `FilmIndexResponse` types; fetch errors degrade gracefully (dropdown closes quietly; the `/search` page → ErrorBoundary). `/search` is `noindex` and not in the sitemap.
5. Tests (Vitest + RTL + MSW) cover the fetcher (q/limit/offset params; 200/throw; `signal`), the `/search` loader + results render + film links + no-results + landing states, and the dropdown (debounce, result rendering, keyboard nav, no-results, error-degrades). `task format`/`lint` (zero warnings)/`typecheck`/`test` all green; touched files Prettier-clean.

---

## TDD testing intent (summary)

| Behavior | Where asserted |
|---|---|
| `getFilmSearch` sends `q`/`limit`/`offset`, returns typed `FilmIndexResponse`, throws on non-OK, passes `signal` | `src/api/public.test.ts` |
| `/search` loader fetches on a present `q`; lands (no fetch) on empty/short `q` | `src/routes/search.test.tsx` (direct loader call + `cloudflareContext`) |
| `/search` results render as cards linking to `/film/{slug}`; no-results + landing states | `src/routes/search.test.tsx` (`createRoutesStub`) |
| `/search` throw → ErrorBoundary | `src/routes/search.test.tsx` |
| Header form: `role="search"`, `action="/search"` `method="get"`, labeled `name="q"` input, submit | `src/components/search/SearchBox.test.tsx` |
| Dropdown: debounce (one request for rapid typing) + AbortController cancels stale | `SearchBox.test.tsx` (request counter) |
| Dropdown: result rendering, keyboard nav (Down/Up/Enter/Escape), "See all" row | `SearchBox.test.tsx` (`userEvent` + `findBy*`) |
| Dropdown: no-results announced; fetch error closes dropdown without breaking the form | `SearchBox.test.tsx` |
| `Search` nav seat now `enabled: true` (resolves `/search`) | covered by the NEU-398 nav/layout tests staying green + the route existing |

---

## Risks / notes

- **Hydration determinism is the one real trap.** The header must render **only** the static `role="search"` form on the server; gate the dropdown to client-only (mounted/focused flag) so SSR and first paint match (the NEU-398 provider-free invariant). No `Date.now()`/locale output in the server-rendered form.
- **Soft NEU-399 coupling.** `FilmIndexItem`/`FilmIndexResponse`, `FilmPosterCard`, and `PAGE_SIZE`/clamp are slated for NEU-399 (independent M3 sibling). Reuse if present, else define local equivalents (see Reuse-or-define) — do **not** block on NEU-399. When it lands, the local fallbacks collapse to imports.
- **Request hygiene.** Debounce (~250–300 ms) + min length (≥2) + `AbortController` to avoid a request per keystroke and stale-response races; the server's blank/short short-circuit makes any stray empty call cheap. Test debounce by counting backend hits (lower-risk than fake timers, which no existing suite uses).
- **Graceful failure.** A failing live-search must never break the header — the dropdown closes quietly and the canonical form still works; only the SSR `/search` page surfaces a hard error via its ErrorBoundary.
- **workerd ≠ Node.** Both the `/search` loader and `getFilmSearch` use only web `fetch`/`URL`/`AbortSignal`; MSW covers tests; dev fetches hit `https://api.upmovies.localhost` (self-signed) from workerd — same caveat as the existing feed/film loaders.
- **Lint strictness.** eslint runs `--max-warnings 0`; the new `search/` and `routes/search.tsx` files must import only what they use. Route modules legitimately export `loader`/`meta`/`ErrorBoundary` alongside the component — carry the same `/* eslint-disable react-refresh/only-export-components … */` header `feed.tsx` uses.

---

## Self-Review

**Spec coverage** (against NEU-401 + M4 spec §2.2 / §4):
- (a) `getFilmSearch` fetcher reusing `FilmIndexResponse`, base-URL-injected, `signal` for cancellation → Task 1, criteria 2/4/5. ✓
- (b) `/search` SSR route (loader/meta+noindex/SearchPage/ErrorBoundary), poster grid, empty + landing + no-results states, film links, not in sitemap → Task 2, criteria 1/4. ✓
- (c) Header `role="search"` form baseline (no-JS → `/search`) + post-hydration debounced/abortable combobox dropdown + `nav-items` `Search` flip → Tasks 3–4, criteria 1/2/3/4. ✓
- SSR-safe (server emits only the form, provider-free body, no mismatch) + accessibility (combobox/listbox, keyboard, labeled input, `aria-live`) → Task 3–4, criterion 3. ✓
- Graceful failure (dropdown closes; page → ErrorBoundary) → Task 2/4, criterion 4. ✓
- Tests across fetcher / loader+render / dropdown behaviors; gates green → Task 5, criterion 5. ✓
- Dependencies honored: NEU-400 endpoint consumed via MSW; NEU-398 header slot + nav seat used; NEU-399 reuse made resilient (reuse-or-define). ✓

**Placeholder scan:** none — every task names its files, its test-first assertions, and its `task` command; code is described (resilient, light on exact signatures) and mapped to concrete tests + existing precedents (`public.ts`/`public.test.ts`, `feed.tsx`/`feed.test.tsx`, `film.tsx`, `me.ts`, `ui/input.tsx`, the NEU-398 header).

**Resilience:** no exact signatures pinned beyond the consumed `FilmIndexResponse` contract and the URL/ARIA/role/method invariants; helper names, the debounce interval, the dropdown `limit`, and `MIN_QUERY_LEN` are the implementer's to set; the NEU-399 soft-dep is handled by an explicit reuse-or-define table; the combobox is hand-rolled (no required library). Touched files are enumerated and bounded.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
