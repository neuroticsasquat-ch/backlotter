# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Companion docs — read before working

- **`AGENTS.md`** — operating rules and container workflow. Note: its architecture description
  (Vite SPA, `createBrowserRouter`, ESLint) is **stale** — see Architecture below for what's
  actually here. Its `task` command table and container rules are accurate.
- **Sibling repo**: `../backend`; read its `AGENTS.md` before touching backend code.

## Everything runs in the container

Do not run `pnpm`, `vitest`, `oxlint`, or `tsc` on the host — use `task` targets, which
`docker compose exec` into the frontend service. Source is bind-mounted (Vite HMR is live);
dependency changes require `task build`.

| Task | Runs |
|---|---|
| `task up` / `task down` / `task build` | container lifecycle (`build` also reinstalls deps) |
| `task test` | `vitest run` (`task test -- src/routes/film.test.tsx` to scope to one file) |
| `task lint` | `oxlint src --max-warnings 0` |
| `task typecheck` | `react-router typegen && tsc -b` (typegen must run first — routes use generated `+types/*` imports) |
| `task format` | `prettier --write` |
| `task build:app` | `react-router build` (SSR + client bundles) |
| `task cf-typegen` | regenerate the Cloudflare `Env` type via `wrangler types` |
| `task deploy` | build + `wrangler deploy` |
| `task shell` / `task logs` | shell in container / stream logs |

Before claiming work done: `task test`, `task lint`, `task typecheck` must be green, and
changed files prettier-formatted. oxlint runs at zero warnings.

## Architecture

React Router v8 in **framework mode with SSR**, deployed as a Cloudflare Worker (`workers/app.ts`,
`wrangler.jsonc`, custom domain `backlotter.com`) — not a client-only SPA. `src/routes.ts` declares
the route tree; `src/root.tsx` is the document shell (`Layout`/`App`/`ErrorBoundary`).

### Two route trees, two data paths

`src/routes.ts` nests two layouts with different runtime models. Picking the wrong data path for a
route silently reads the wrong environment (a build-time var where a request-time one belongs, or
vice versa):

- **Public SSR routes** (`routes/public-layout.tsx` → `feed`, `calendar`, `film/:ref`, `terms`,
  `privacy`, plus `robots.txt`/`sitemap.xml`) — server-rendered, unauthenticated. Their loaders call
  the pure `fetch` functions in `api/public.ts`, passing a `baseUrl` read from the Worker env via
  `cloudflareContext` (`lib/load-context.ts`, set per-request in `workers/app.ts`). No credentials.
- **SPA subtree** (`routes/spa-layout.tsx` → `pages/Login`, `pages/Signup`, and the admin pages)
  — client-only. Uses `apiFetch` from `api/client.ts`, whose base URL is the build-time
  `VITE_API_BASE_URL` (`env.ts`), sends `credentials: "include"`, and attaches the CSRF header on
  mutations. Auth guards (`RequireAuth`, `RequireAdmin`) are **layout routes** in `routes.ts`, not
  JSX wrappers around page components.

### SSR-safety invariant

`publicQueryClient` (`routes/public-layout.tsx`) is a module-level `QueryClient` shared across the
public subtree. It's safe under SSR only because the `["me"]` account query never resolves during
the server render pass — the first client paint is always the logged-out default, avoiding a
hydration mismatch. `refetchOnMount: "always"` then refreshes auth state on the client.

### Sentry: three surfaces, one tunnel

- **Browser** (`entry.client.tsx`): `@sentry/react`, `tunnel: SENTRY_TUNNEL_PATH` — envelopes go to
  same-origin `/monitoring` instead of `ingest.sentry.io` so ad blockers don't drop them.
- **SSR/Worker** (`workers/app.ts`): `Sentry.withSentry` from `@sentry/cloudflare` wraps the fetch
  handler, catching loader/render errors; DSN comes from the Worker env (`env.SENTRY_DSN`).
- **Tunnel proxy** (`workers/app.ts` `handleSentryTunnel` + `lib/sentry-tunnel.ts`): the Worker
  forwards `/monitoring` POSTs upstream after validating the envelope's `dsn` against its own, so it
  can't be used as an open relay. **Must read the body as raw bytes** (`arrayBuffer`), not text —
  session-replay envelopes carry a binary payload and a UTF-8 round-trip corrupts it.

There are two separate DSN/env-var sets: `VITE_SENTRY_DSN` (build-time, browser) and `SENTRY_DSN`
(Worker runtime var in `wrangler.jsonc`/CF dashboard, SSR).

### Layout (`src/`)

- `routes/` — SSR route modules (loader + component + meta, co-located tests).
- `pages/` — client-only SPA pages (Login, Signup, admin).
- `api/` — `public.ts` (pure fetchers for SSR loaders), `client.ts` (`apiFetch`/`ApiError`/CSRF for
  the SPA), `types.ts`, one module per authenticated domain (`auth.ts`, `runs.ts`, `sources.ts`,
  `moderation.ts`) with TanStack Query hooks alongside their fetchers.
- `components/` — `AuthContext.tsx` (`useAuth`), `RequireAuth`/`RequireAdmin` guards, `layout/`
  (header/nav/admin shells), `ui/` (primitives), feature folders (`feed/`, `film/`, `calendar/`,
  `search/`).
- `lib/` — `load-context.ts` (`cloudflareContext`), `sentry-tunnel.ts`, formatting/grouping helpers,
  each with a co-located test.
- `workers/app.ts` — the Worker entrypoint (SSR request handler + Sentry tunnel proxy).
- `env.ts` — build-time `VITE_*` vars for the SPA/client path.

## Testing (Vitest + RTL + MSW)

- MSW intercepts all HTTP (`onUnhandledRequest: "error"`); override per-test with `server.use(...)`.
  `test/msw/handlers.ts` has defaults, `test/msw/me.ts` builds `/me` responses for auth states.
- **Loaders** (public SSR routes): call the exported `loader` directly with a `RouterContextProvider`
  that has `cloudflareContext` set (`context.set(cloudflareContext, { env: { API_BASE_URL } })`) —
  see `routes/film.test.tsx`.
- **Components**: render with `createRoutesStub` from `react-router` to get router context without a
  full app tree, wrapped in `QueryClientProvider` (`{ retry: false }`) and `AuthProvider` as needed.
- Auth resolves asynchronously via the `/me` query — use `findBy*` and key assertions off
  post-auth-only content (e.g. a "Log out" control), not content present before auth resolves.

## Conventions

- Path alias `@/` → `src/`.
- Conventional commits with a trailing Linear ID: `feat: add X (NEU-123)`. No `Co-Authored-By`.
  Branch per ticket using Linear's generated name. The GitHub↔Linear connector moves ticket status
  automatically — don't touch it.
