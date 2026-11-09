# React Router v7 SSR Foundation — Design (NEU-306)

- **Date:** 2026-06-22
- **Status:** Approved (pending implementation)
- **Component:** `upcoming-movies-frontend`
- **Linear:** NEU-306 `[frontend] React Router v7 SSR foundation`; project *Movies: Synthesis & Update Log*, milestone **M2 — Public rendering foundation**
- **Blocks:** NEU-307 (SEO primitives), NEU-310 (SSR film page), NEU-312 (SSR feed landing)
- **Builds on / refs:** project design of record
  [2026-06-22-synthesis-update-log-design.md](2026-06-22-synthesis-update-log-design.md) §2.1; spike NEU-260

## What this is

The first **unauthenticated, server-rendered, crawlable** surface in the product. Today the
frontend is a pure client-side SPA (Vite + `react-router` v7 data router, hydrated by
`ReactDOM.createRoot`) deployed as static files to **Cloudflare Pages** (`public/_redirects` =
`/*  /index.html  200`). Every existing page sits behind `RequireAuth`; there is no server.

NEU-306 introduces SSR on the existing React Router v7 stack and the **public layout** that
M3/M4's real public pages (film update-log, "updated today" feed) will build on. It ships one
placeholder public route as end-to-end proof; the real public pages and SEO helpers land in
later tickets.

## Decisions (locked with Tom)

| Question | Decision |
|---|---|
| SSR runtime / deploy target | **Cloudflare edge.** SSR runs at the edge, not a Node server. |
| Cloudflare product | **Migrate Cloudflare Pages → Cloudflare Workers** (`@cloudflare/vite-plugin` + Wrangler + Workers Static Assets). RR7's first-class CF target; Pages is the de-emphasized legacy path. |
| SSR style | **React Router v7 framework mode** (`@react-router/dev`), `ssr: true`. Not hand-rolled `createStaticHandler`. A continuation of the existing `react-router` v7 — no new framework. |
| Public ↔ authed boundary | **One unified app.** Public routes SSR with server `loader`s; the existing authed/auth routes become **client-only** via a `clientLoader` + `HydrateFallback` parent so the server emits only a shell and the client hydrates into today's exact cookie + CSRF `/me` flow. |
| Proof route | A single placeholder public SSR route at **`/preview`**. `/` stays the authed home; the `/`→public-feed swap is deferred to M4 (NEU-312). |
| Delivery | **One NEU-306 PR** (the ticket's "split into runtime + port routes" is a fallback only if the diff balloons). |

## Why edge + framework mode

- The product is discovery-driven; public pages must be crawlable → SSR (locked in the project
  design of record).
- The FE already lives on Cloudflare; staying on the edge avoids standing up and operating a new
  long-running Node service. Cloudflare shipped first-party RR7 support in the `@cloudflare/vite-plugin`
  1.0 (April 2025): `vite build` emits client+server bundles, `vite preview` runs the **Workers
  runtime** locally (prod parity), and `wrangler deploy` ships the Vite build with no extra bundling.
- Framework mode is the idiomatic, officially-supported RR7-on-Cloudflare path. Hand-rolling
  `createStaticHandler` + `renderToReadableStream` inside a Worker would mean owning the fetch
  handler, asset serving, head injection, and hydration on workerd by hand. Framework mode also
  gives NEU-307 its per-route `meta`/`links` exports for free.

## Architecture

```
                         Cloudflare Worker (single deployment)
   request ──────────────────────────────────────────────────────────────►
                         workers/app.ts  (createRequestHandler + getLoadContext)
                                   │
                                   ▼
                         src/root.tsx  (document shell: <Meta/> <Links/> <Scripts/>)
                                   │
                ┌──────────────────┴───────────────────────┐
                ▼                                           ▼
        PublicLayout  (SSR)                        SpaLayout  (client-only)
          server loader + meta                       clientLoader.hydrate + HydrateFallback
          rendered into HTML head/body               server renders only a shell
                │                                           │
                ▼                                  ┌────────┴───────────────┐
          /preview  (placeholder)                  /login   /signup    RequireAuth
          loader → (no backend call needed)                              └ AppLayout
                                                                            ├ index → Home
                                                                            └ RequireAdmin
                                                                               └ admin/ingest → AdminIngest
```

Server `loader`s read runtime config (e.g. the backend base URL) from the Worker env via
`context.cloudflare.env`; client code keeps `import.meta.env.VITE_API_BASE_URL`.

## Build, deploy & config

Adopt the structure the official `create-cloudflare` React Router template produces (align exact
dep set/versions with the current template, per the "latest versions" preference):

- **`react-router.config.ts`** — `{ ssr: true, appDirectory: "src" }` (keep the existing `src/`
  root and the `@/` → `src` alias).
- **`vite.config.ts`** — add the React Router plugin and `@cloudflare/vite-plugin`; keep
  `@tailwindcss/vite`; keep the `@` alias. Reconcile the existing dev-server block (host
  `0.0.0.0`, `strictPort` 5173, `allowedHosts: ["app.upmovies.localhost"]`, the `wss` HMR for
  Traefik, polling watch) with the new plugin setup so containerized dev still works behind Traefik.
- **`wrangler.jsonc`** — Worker name, `compatibility_date`, `compatibility_flags`
  (`nodejs_compat` as needed), Static Assets config, and `vars` (`API_BASE_URL` for SSR fetches;
  secrets via `wrangler secret`/dashboard).
- **`workers/app.ts`** — the Worker `fetch` entry: RR `createRequestHandler` + a `getLoadContext`
  that exposes `cloudflare.env` to loaders/actions.
- **Pipeline change (in scope):** replace the Cloudflare **Pages** deploy with `wrangler deploy`;
  remove the `public/_redirects` SPA hack (the Worker now owns routing). Document the chosen deploy
  target explicitly in the PR (AC requirement).

## Framework-mode migration (file-level)

**Add**

- `src/root.tsx` — the document (`<html>`, `<head>` with `<Meta/>`/`<Links/>`, `<body>` with
  `<Outlet/>`, `<Scripts/>`, `<ScrollRestoration/>`), the global CSS via `links` (Tailwind
  `globals.css`), and the root `ErrorBoundary` (see Error handling).
- `src/routes.ts` — the route config (tree above).
- `src/entry.client.tsx` — `hydrateRoot` + `<HydratedRouter/>`; **client-only init lives here**
  (Sentry `Sentry.init`, moved out of the deleted `main.tsx`).
- `src/entry.server.tsx` — `handleRequest` using `renderToReadableStream` (web streams on
  workerd), with `isbot` bot handling per the template.
- `src/routes/public-layout.tsx` — `PublicLayout` (unauthenticated shell, distinct from
  `AppLayout`); `<Outlet/>` for public children.
- `src/routes/preview.tsx` — the placeholder public route: a server `loader` (no backend call
  required for the proof) + `default` component + `meta`. Clearly marked temporary; replaced when
  real public pages (M3/M4) land.
- `src/routes/spa-layout.tsx` — a **pathless client-only layout** wrapping all current routes.
  Exports `clientLoader` (`clientLoader.hydrate = true`) + `HydrateFallback`, and provides
  `QueryClientProvider` + `AuthProvider` (+ `Toaster`) for the authed subtree. Because this parent
  is client-only, the entire authed subtree renders the fallback on the server and hydrates on the
  client — preserving today's behavior exactly.

**Convert** — `src/pages/*` (`Login`, `Signup`, `Home`, `AdminIngest`) become route modules with
`default` exports, referenced from `routes.ts`. Guard components `RequireAuth`/`RequireAdmin` stay
as layout-route components (they already render `null` while `useAuth()` loads). `AppLayout` becomes
the authed layout route.

**Replace / remove** — `index.html`, `src/main.tsx`, `src/router.tsx` (their roles move into
`root.tsx`, the entry files, and `routes.ts`).

**Keep** — `src/api`, `src/components` (minus the routing wiring noted above), `src/lib`,
`src/styles`. `react-router typegen` generates `Route.*` types into a gitignored `.react-router/`;
typecheck is `tsc -b`.

## Provider & client-state placement

Public SSR routes use **loader data only** — no `QueryClientProvider`, no `AuthProvider`, so a
public page never fires a `/me` request and stays lean. `QueryClientProvider`, `AuthProvider`, and
`Toaster` are mounted in **`SpaLayout`** (the client-only authed subtree). On the server they never
execute (the fallback renders instead); on the client they reproduce today's bootstrap. Sentry
initializes once in `entry.client.tsx`.

## Data loading & config split

- Public route data comes from React Router `loader`s (server-side `fetch`), **not** TanStack
  Query — so there is no query dehydration/hydration to manage. TanStack Query remains the
  server-state tool for the authed client subtree only.
- The backend public API NEU-306's real pages will consume (`GET /films`, `/films/{slug}`,
  `/feed`, `/sitemap.xml`) is already merged on the backend, but the `/preview` placeholder needs
  no backend call.
- **API base URL:** a small helper resolves the backend URL from `context.cloudflare.env`
  (e.g. `API_BASE_URL`) inside server loaders, and from `import.meta.env.VITE_API_BASE_URL` in
  client code. SSR→backend fetches hit the public, no-auth API (no cookies forwarded).

## Error handling & 404

`root.tsx` exports a root `ErrorBoundary` that uses `isRouteErrorResponse` to render thrown errors
and 404s. A catch-all + root boundary is sufficient for NEU-306; per-route 404 / empty states for
real public pages (unknown film slug, empty timeline) are M3/M4 concerns.

## Testing & CI

- **Vitest + MSW** assert the `/preview` route's `loader` and SSR render (head + content) — the
  AC's "head tags render for a sample public route" hook for NEU-307 to build on.
- Existing authed-route tests (RTL + `MemoryRouter`) must stay green through the route-module
  conversion — verify, don't rewrite, behavior.
- **Typecheck:** `react-router typegen && tsc -b`. **Lint:** ESLint at zero warnings (unused
  imports fail). Prettier-format only touched files.
- **Local dev parity:** dev now runs through the Workers runtime via the Cloudflare Vite plugin.
  Update the Docker `dev` stage CMD, the compose healthcheck, and the Traefik service port (5173)
  accordingly. Dev stays **Docker-only — no host Node/pnpm** (per repo convention); everything via
  `task`.

## Acceptance criteria — how this design meets each (from the ticket)

| Ticket requirement | How this design satisfies it |
|---|---|
| Adopt RR7 SSR (framework mode / Vite SSR), no new framework | Framework mode via `@react-router/dev`, `ssr: true` — a continuation of the existing `react-router` v7 |
| Server entry + hydration entry; public routes SSR + hydrate cleanly | `src/entry.server.tsx` (renderToReadableStream) + `src/entry.client.tsx` (hydrateRoot); public routes SSR via server `loader`s |
| New unauthenticated public layout + server-side loader pattern | `PublicLayout` (distinct from `AppLayout`/`RequireAuth`) with public routes carrying server `loader`s |
| Existing authed routes keep working unchanged | All current routes move under the client-only `SpaLayout`; they stay client-rendered with today's cookie+CSRF `/me` flow |
| One public route SSR end-to-end as proof | `/preview` placeholder route |
| Decide + document SSR runtime / deploy target in the PR | **Cloudflare Workers (edge)** — documented here and to be restated in the PR |
| Tests: Vitest+MSW loader+render of a public route; `tsc -b` + eslint green | `/preview` loader+render covered by Vitest+MSW; `react-router typegen && tsc -b`; ESLint zero-warnings |

## Out of scope / deferred

| Deferred item | Home |
|---|---|
| Per-route `<title>`/meta/OG SEO helper + `robots.txt` | NEU-307 (uses framework mode's `meta`/`links`) |
| `sitemap.xml` wiring | NEU-307 / backend (already provides `/sitemap.xml`) |
| Real public pages (film update-log, feed) + 404/empty states | M3 (NEU-310), M4 (NEU-312) |
| `/` → public feed swap; moving the authed home aside | M4 (NEU-312) |
| Edge/server-side error reporting (e.g. `@sentry/cloudflare`) | Later; Sentry stays client-only here |
| Service bindings / auxiliary Workers | Not needed; also currently unsupported with RR-as-framework |

## Risks / notes

- **workerd ≠ Node.** No full Node APIs at runtime; keep server code (loaders, `entry.server`,
  `workers/app.ts`) within the Workers runtime + `nodejs_compat`. `vite preview` exercises the real
  runtime before deploy — use it.
- **No SSR of authed content.** The client-only `SpaLayout` parent is what guarantees authed
  components never execute on the server (avoids both leaking authenticated UI and crashing on
  browser globals). Don't add server `loader`s to the authed subtree.
- **Hydration parity.** The authed shell the server renders (`HydrateFallback`) must match the
  client's initial render (today: `RequireAuth` returns `null` while loading) to avoid mismatch.
- **Deploy cutover.** Pages → Workers is a real pipeline change; coordinate DNS/custom domain and
  drop `public/_redirects` as part of the cutover.

## Sources

- React Router (formerly Remix) · Cloudflare Workers docs —
  https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/
- Cloudflare Vite plugin —
  https://developers.cloudflare.com/workers/vite-plugin/
- "Just use Vite"… with the Workers runtime (RR7 1.0 support, April 2025) —
  https://blog.cloudflare.com/introducing-the-cloudflare-vite-plugin/
- React Router — client data (`clientLoader` / `HydrateFallback`) —
  https://reactrouter.com/how-to/client-data
- React Router — route module exports —
  https://reactrouter.com/start/framework/route-module
