# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Linear

`linear_initiative: backlotter`
`linear_team: Neuroticsasquatch`
`linear_repos: upcoming-movies-backend`
`specs_dir: docs`

## Companion docs — read before working

- **`AGENTS.md`** — operating rules and container workflow. Note: its architecture description
  (Vite SPA, `createBrowserRouter`, ESLint) is **stale** — see Architecture below for what's
  actually here. Its `task` command table and container rules are accurate.
- **Sibling repo**: `../upcoming-movies-backend`; read its `AGENTS.md` before touching backend code.
- **Project-wide specs live in the backend repo**: `../upcoming-movies-backend/docs/specs/` — a
  ticket in a cross-repo project (e.g. `bl-entity-follows-project-spec.md`) may have no per-ticket
  spec under `docs/specs/` here; read the project spec there instead. Linear tickets write that
  path umbrella-relative as `backend/docs/specs/…`, which is `upcoming-movies-backend/` on disk.

## Everything runs in the container

Do not run `pnpm`, `vitest`, `oxlint`, or `tsc` on the host — use `task` targets, which
`docker compose exec` into the `upmovies-frontend` service (`docker-compose.yml`). Source is
bind-mounted (Vite HMR is live); dependency changes require `task build`. The pre-commit hooks
(`.pre-commit-config.yaml`, `pre-commit install` once) run in the same container, so it must be
up to commit.

Local dev sits on the shared **tbc-localdev-infra** stack (`~/projects/tbc-localdev-infra`:
Traefik + the external `proxy` network); `task up` starts it first. The app is served at
`https://app.upmovies.localhost`; the backend (`upmovies-backend`, from its own repo) must be up
for API calls, which the dev server proxies at `/api` and SSR reaches via `.dev.vars`.

The `Taskfile.yml`, `docker-compose.yml` and `.pre-commit-config.yaml` follow the shared
contract in `~/projects/tbc-localdev-infra/CONVENTIONS.md`; read it before changing any of them.

| Task | Runs |
|---|---|
| `task up` / `task down` / `task restart` / `task build` | container lifecycle (`build` also reinstalls deps and recreates the container) |
| `task test` | `vitest run` (`task test -- src/routes/film.test.tsx` to scope to one file) |
| `task release-notes -- v0.4.1` | Prepend a tag's notes to `RELEASE_NOTES.md` (runs on the host) |
| `task lint` | `oxlint src --max-warnings 0` |
| `task typecheck` | `react-router typegen && tsc -b` (typegen must run first — routes use generated `+types/*` imports) |
| `task format` | `prettier --write` |
| `task format:check` | `prettier --check` (`task format:check -- <files>` to scope) |
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

### SSR requests are signed, browser requests are not

The backend rate-limits public reads per visitor IP (backend `NEU-1344` §4). Every SSR fetch leaves
Cloudflare from a shared egress IP, so loaders sign their fetches: `ssrOriginHeaders(env, request)`
(`lib/ssr-origin.ts`) returns `X-Backlotter-Origin: <SSR_ORIGIN_SECRET>` plus
`X-Backlotter-Client-IP: <CF-Connecting-IP>`, and the public fetchers take them as an optional
`headers` argument. Browser-side calls to the same fetchers pass nothing — they already arrive with
the visitor's own IP. `sitemap.ts` is the one unsigned loader: the backend excludes `/sitemap.xml`
from the rate-limit bucket (crawlers, cached upstream), so it has no visitor to key on.

A **dedicated header, never `X-Forwarded-For`**: Traefik strips forwarded headers from senders
outside its trusted set and the Worker is not in it, so an `X-Forwarded-For` from here dies at the
hop. `SSR_ORIGIN_SECRET` is an ASCII Wrangler secret (`wrangler secret put SSR_ORIGIN_SECRET`), not a var
in `wrangler.jsonc`; unset, loaders send nothing and the backend falls back to the egress IP. Deploy
order matters — backend first, then this secret + the frontend, then flip
`RATE_LIMIT_PUBLIC_ENABLED=true` in Coolify.

### SSR-safety invariant

`publicQueryClient` (`routes/public-layout.tsx`) is a module-level `QueryClient` shared across the
public subtree. It's safe under SSR only because the `["me"]` account query never resolves during
the server render pass — the first client paint is always a logged-out render, avoiding a
hydration mismatch. `refetchOnMount: "always"` then refreshes auth state on the client.

Which logged-out render is chosen by the **timeline hint** (NEU-1468,
`docs/adr/0001-timeline-hint-cookie.md`): a `timeline_hint` cookie the browser writes itself on an
entitled resolve. The public layout's loader reads it from the request and hands it down
(`useTimelineHint`), so the server and the first client paint agree; after hydration the live cookie
is read instead. `useFollowAccess()` answers `hinted` while it is set and `/me` is in flight, and
only the home page and the nav act on that. It is a prediction, never auth.

### Error reporting (Bugsink): three surfaces, one tunnel

Errors go to **Bugsink** (`bugsink.neuroticsasquat.ch`, project `upcoming-movies-frontend`), which
speaks the Sentry protocol — the `@sentry/*` SDKs stay, only the DSNs and upload target point there
(NEU-1594; ops repo `docs/runbooks/bugsink.md`).

- **Browser** (`entry.client.tsx`): `@sentry/react`, `tunnel: SENTRY_TUNNEL_PATH` — envelopes go to
  same-origin `/monitoring` instead of the Bugsink host so ad blockers don't drop them.
- **SSR/Worker** (`workers/app.ts`): `Sentry.withSentry` from `@sentry/cloudflare` wraps the fetch
  handler, catching loader/render errors; DSN comes from the Worker env (`env.SENTRY_DSN`).
- **Tunnel proxy** (`workers/app.ts` `handleSentryTunnel` + `lib/sentry-tunnel.ts`): the Worker
  forwards `/monitoring` POSTs to `https://<dsn host>/api/<id>/envelope/` after validating the
  envelope's `dsn` against its own, so it can't be used as an open relay. **Must read the body as
  raw bytes** (`arrayBuffer`), not text — session-replay envelopes carry a binary payload and a
  UTF-8 round-trip corrupts it.

Two DSN settings, **both the same Bugsink DSN** — the tunnel drops any envelope whose DSN differs
from the Worker's, so they always move together: `VITE_SENTRY_DSN` (Workers Builds build var,
browser) and `SENTRY_DSN` (a Wrangler **secret**, `wrangler secret put SENTRY_DSN`, read at request
time). It is a secret rather than a `wrangler.jsonc` var so the value lives in Cloudflare and a
deploy doesn't overwrite it.

**Source maps.** With `SENTRY_AUTH_TOKEN` set in the build env, `@sentry/vite-plugin` injects debug
IDs, uploads the maps to `SENTRY_URL` (`SENTRY_ORG` defaults to Bugsink's `bugsinkhasnoorgs`,
`SENTRY_PROJECT` to `upcoming-movies-frontend`) and deletes every `.map` from `dist/`, so none is
deployed. No token → no maps, a build warning, and a successful build. The **release** is the
commit SHA (`VITE_GIT_SHA`, else Workers Builds' `WORKERS_CI_COMMIT_SHA`; `vite.config.ts` also
reads `CF_PAGES_COMMIT_SHA` and Coolify's `SOURCE_COMMIT`, ignoring its `"unknown"`), compiled in as `__GIT_SHA__` and read by
both inits through `lib/sentry.ts`; `environment` is the Vite mode. Redeploy by merging to `main`,
never with the dashboard's *Retry build*: a dashboard-started build sets `WORKERS_CI_COMMIT_SHA` to the
branch name, so the release reads `main` instead of the SHA. Add `SENTRY_DSN` and `SENTRY_AUTH_TOKEN` in
the dashboard as type **Secret**, never Text: a Text value is not in `wrangler.jsonc`, so the next deploy
deletes it and prints it in the build log.

**Test errors.** `/debug/error` (unlinked, client-only) has a button that throws a
`BrowserTestError`; any URL with `?__test_error=<token>` makes the Worker throw a `WorkerTestError`, where
`<token>` is the `SENTRY_TEST_ERROR_TOKEN` Wrangler secret (unset → the Worker trigger is off)
(`lib/test-error.ts`). Distinct types, so each lands as its own Bugsink issue.

### Layout (`src/`)

- `routes/` — SSR route modules (loader + component + meta, co-located tests).
- `pages/` — client-only SPA pages (Login, Signup, admin).
- `api/` — `public.ts` (pure fetchers for SSR loaders), `client.ts` (`apiFetch`/`ApiError`/CSRF for
  the SPA), `types.ts`, one module per authenticated domain (`auth.ts`, `runs.ts`, `sources.ts`,
  `moderation.ts`) with TanStack Query hooks alongside their fetchers.
- `components/` — `AuthContext.tsx` (`useAuth`), `RequireAuth`/`RequireAdmin` guards, `layout/`
  (header/nav/admin shells), `ui/` (primitives), feature folders (`feed/`, `film/`, `calendar/`,
  `search/`).
- `lib/` — `load-context.ts` (`cloudflareContext`), `sentry.ts`/`sentry-tunnel.ts`/`test-error.ts`,
  formatting/grouping helpers, each with a co-located test.
- `workers/app.ts` — the Worker entrypoint (SSR request handler + Sentry tunnel proxy).
- `env.ts` — build-time `VITE_*` vars for the SPA/client path.

## Testing (Vitest + RTL + MSW)

- MSW intercepts all HTTP (`onUnhandledFrame: "error"`); override per-test with `server.use(...)`.
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
- Conventional commits with a **scope** and a trailing Linear ID: `feat(auth): add X (NEU-123)`.
  No `Co-Authored-By`. The scope is the component (`auth`, `feed`, `onboarding`, …), not the Linear
  project, and it is load-bearing: `cliff.toml` groups `RELEASE_NOTES.md` by scope, so a scopeless
  commit lands under a catch-all "General" heading.
  Branch per ticket using Linear's generated name. The GitHub↔Linear connector moves ticket status
  automatically — don't touch it.
- Release notes: tag the release, then `task release-notes -- v0.4.1`. git-cliff renders only
  user-facing types (`feat`/`fix`/`perf`/`revert`) and **prepends** the new section —
  `RELEASE_NOTES.md` accumulates per-release chunks and is never rebuilt wholesale. It runs on the
  host, not in the container, because git-cliff reads git history and tags; don't call `git-cliff`
  directly.
