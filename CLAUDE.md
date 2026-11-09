# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Linear

`linear_initiative: backlotter`
`linear_team: Neuroticsasquatch`
`linear_repos: backlotter`

## Monorepo layout

This is the **backlotter** app monorepo (NEU-2236, renamed from `upcoming-movies-backend`): the
FastAPI backend at the root, unchanged, and the SSR frontend (React Router on a Cloudflare Worker)
under `frontend/`, its history imported from the archived `upcoming-movies-frontend`. One version
and one tag per release, one `cliff.toml`, one compose file, one Taskfile, one pre-commit config.
One `docs/` tree and one set of guides too (NEU-2260): **read [Frontend](#frontend-frontend)
below, and `AGENTS.md` → *Frontend*, before touching `frontend/`.** Every frontend task is
`task fe:<x>` at the root.

## Companion docs — read before working

- **`AGENTS.md`** — operating rules, production/deploy flow, gotchas. Authoritative on process.
- **`CONTEXT.md`** — the domain glossary. Terms there are *enforced in code* (e.g. `provenance` vs
  `news_backed`, "total stage failure" vs partial failure). When naming a concept in code, tests, or
  a PR, use the glossary's term and avoid the listed synonyms.
- **`docs/adr/`** — 27 ADRs covering retrieval, clustering, LLM routing, sweep, feed grouping and
  (0026–0027) the web app. Read the ones touching your area; flag explicitly if your change
  contradicts one.
- **`docs/specs/NEU-*.md`** — per-ticket specs (`specs_dir: docs`). Implementation work is spec-driven.
  A ticket with a backend and a frontend half may have two specs; the frontend one carries a
  `-frontend` suffix when the names collided. `docs/plans/`, `docs/superpowers/` (the retired
  layout), `docs/deploy/` and `docs/measurements/` hold the older planning docs, versioned since
  NEU-2260.

## Everything runs in the container

Never run `pytest`, `ruff`, `pyright`, `alembic`, or `python` on the host — always via `task`, which
`docker compose exec`s into the backend service. Source is bind-mounted, so uvicorn `--reload` picks
up edits. Dependencies install from `uv.lock` (`uv sync --locked`, into the container's system
Python), so the image runs exactly the set CI tests. To change a dependency, edit `pyproject.toml`,
run `task deps:lock`, then `task build` (or `task deps:add -- <pkg>` / `task deps:add-dev -- <pkg>`,
then `task build`); an edit without re-locking fails the build. The Taskfile, compose file and hooks
follow `~/projects/tbc-localdev-infra/CONVENTIONS.md`.

| What | Command |
|---|---|
| Build / start / stop / restart | `task build` / `task up` / `task down` / `task restart` |
| Add / remove a dependency | `task deps:add -- <pkg>` / `task deps:add-dev -- <pkg>` / `task deps:remove -- <pkg>` |
| Re-lock deps after a `pyproject.toml` edit | `task deps:lock` |
| Shell in container | `task shell` |
| Logs | `task logs` |
| Full suite | `task test` |
| Unit / integration only | `task test:unit` / `task test:integration` |
| Single test | `task test -- tests/unit/path/test_x.py::test_name` (`--` forwards to pytest) |
| Lint / format / format check / typecheck | `task lint` / `task format` / `task format:check` / `task typecheck` |
| Coverage (HTML in `./htmlcov`) | `task coverage` |
| Migrate / new migration | `task migrate` / `task makemigration -- "message"` |
| Release notes for a tag (host) | `task release-notes -- v0.4.1` |
| Create local DBs | `task db:init` |
| Refresh local content from prod | `task db:refresh` |
| Frontend: lint / format / typecheck / test / build | `task fe:lint` / `task fe:format` / `task fe:typecheck` / `task fe:test` / `task fe:build` |
| Frontend: Worker deploy dry run / deps | `task fe:deploy-dry-run` / `task fe:deps:add -- <pkg>` (`fe:deps:add-dev`, `fe:deps:remove`) |

`task up` starts both containers: `upmovies-backend` (`https://api.upmovies.localhost`) and
`upmovies-frontend` (`https://app.upmovies.localhost`). The frontend's SSR loaders reach the backend
at `API_BASE_URL` from the gitignored `frontend/.dev.vars` (copy `frontend/.dev.vars.example`).

**Before claiming work done:** `task format`, then `task test && task lint && task typecheck` must all
pass; for a frontend change, `task fe:lint && task fe:typecheck && task fe:test` too. Run the frontend
suite in its container (Node 22, as CI): on the host's newer Node about 150 jsdom tests fail.

**CI** is `.github/workflows/ci.yml`, on the shared workflows (`neuroticsasquat-ch/workflows@v1`).
A `changes` path filter gates `python` (anything outside `frontend/`: ruff check, `ruff format
--check`, pyright, a single Alembic head, `alembic upgrade head && alembic check`, pytest, against
Postgres 17 set up by `.github/ci/setup.sh` with `.github/ci/env`), `image` (the prod stage builds
and doesn't run as root) and `js` (`frontend/`: lint, typecheck, test, build). `ci` is the one
required check. The ruff and pyright scope is set in `pyproject.toml`, so CI and the tasks run them
bare. `dependencies.yml` runs the `updates/dependencies` branch.

## Architecture

Single FastAPI container (Python 3.13, SQLAlchemy 2 async + asyncpg, Alembic, Pydantic v2, httpx,
`uv`). Two entrypoints share the same code:

- **`upmovies.main:app`** — the HTTP service. `create_app()` mounts routers; `lifespan` calls
  `validate_stage_configuration(settings)` (a stage routed at an unpriced/uncredentialed
  `(provider, model)` kills the container at boot, not mid-publish),
  `validate_mail_configuration(settings)` and `validate_rate_limit_configuration(settings)`,
  cancels runs orphaned by a crash, and opens the one process-wide `MailGateway` that
  `deps.get_mailer` hands to routes.
- **`python -m upmovies.pipeline_run {daily|hourly|sweep|providers|notify|digest {daily|weekly}}`**
  — the Coolify scheduled tasks, a *separate process* that re-runs the stage and mail validation
  (not the rate-limit one — it serves no HTTP). `daily` = tmdb → feeds(per-film) →
  link → synthesize, sequential and fail-fast; `hourly` = light feeds pass; `sweep` runs on its own
  slot ~2h ahead of daily and is deliberately **not** in the daily chain (ADR-0013); `providers`
  is the D-27 watch-provider poll, on a fourth slot for the same reasons; `notify` is M7's
  decision pass (D-31) alone — it queues digest rows and sends nothing, the digest being the only
  delivery (ADR-0021) — scheduled after the daily chain because it reads what that chain
  published; `digest {daily|weekly}` mails each
  user on that cadence the digest rows `notify` queued, with the "your slate" section weekly
  and — daily — on `SLATE_WEEKDAY` (D-33, DC-2), on one slot per cadence after `notify`. Each
  pings an Uptime Kuma push deadman (`?status=up` on success, `?status=down&msg=` on
  failure, no start ping — NEU-1582).

### Layout (`src/upmovies/`)

`app/` auth & accounts (models/repos/services) · `catalog/` Film/TMDB spine · `news/` stories, feeds,
events · `ingest/` run tracking + TMDB ingest + `sweep/` · `link/` story→film linking, `retrieval/`,
clustering, source gate · `synthesize/` event summarization · `llm/` gateway + provider adapters +
pricing · `mail/` transactional mail: gateway + Resend adapter + Jinja templates · `public/` read
models for feed/film/calendar/sitemap · `routers/` FastAPI routers.

### Cross-cutting patterns

- **Layering:** routers → services → repos → models. Callers own the transaction.
- **Model registration:** `upmovies/models.py` aggregate-imports every model module and `db.py`
  imports it last, so `Base.metadata` is complete (and cross-schema FKs resolve) even for standalone
  scripts. **Register new model modules there.**
- **Postgres schemas:** `app`, `catalog`, `news`, `ingest`. Tests build them with `create_all`; prod
  uses Alembic. Add the model column first (tests pick it up immediately), then generate and review
  the migration. The suite proves the two agree: `tests/integration/test_migrations.py` builds a
  scratch DB with `alembic upgrade head`, diffs its columns/constraints/indexes against the
  `create_all` schema (by name and definition, so a hand-named constraint in a migration needs the
  same `name=` in the model), and round-trips the head revision.
- **Pipelines** take `(session_factory, run_id, …)`, commit per item, and always finalize their run —
  `failed` on crash — because `routers/ingest_admin.py` reuses the same runners.
- **LLM gateway** resolves a provider per *stage* (link, cluster, summarize, source_judge, resolve),
  never per model, and **never falls back** — answering one stage from another provider would
  misattribute cost and latency. The set is closed: `ingest.llm_call` and `ingest.run_llm_usage`
  check-constrain `stage` to the same list, so a new stage needs a migration too.
- **Rate limiting** is one dependency, `Depends(rate_limit("<bucket>"))` (`app/rate_limit.py`):
  per-IP token buckets, in-process, keyed on `request.client.host` — which is the real caller only
  because both CMDs pass `--proxy-headers`. A request signed with `SSR_ORIGIN_SECRET` names its
  visitor instead. `RATE_LIMIT_ENABLED=false` bypasses everything, which is how the suite runs.
- **Admin auth is two things:** `require_admin` (bearer `ADMIN_TOKEN`, machine-facing) vs
  `require_current_admin` (session cookie + `is_admin`, human-facing UI). `require_csrf` guards
  cookie-authed mutations.

## Testing

- pytest-asyncio in `auto` mode with session-scoped loops — no `@pytest.mark.asyncio`.
- `tests/conftest.py` points `DATABASE_URL` at `TEST_DATABASE_URL`, drops/recreates the four schemas
  per session, and truncates between tests via the `session` fixture.
- HTTP is mocked with **respx**; never hit the live network.
- After Core-level upserts, re-read with `execution_options={"populate_existing": True}`.
- Running a single *integration* test file in isolation errors (pytest-asyncio quirk) — run the whole
  suite or scope to a directory.
- Async-fixture errors usually mean a stale container: restart the backend service.

## Conventions

- Type hints use `X | None` / `X | Y` — no `Optional`/`Union`, no `from __future__ import annotations`.
- Ruff: line length 100, rules `E,F,W,I,B,UP`. Use `import x as x` re-exports in `__init__.py`.
- Commits and PR titles: Conventional Commits with a **scope** and a trailing Linear ID —
  `feat(auth): add X (NEU-123)`. The scope is the component (`auth`, `mail`, `retrieval`, `feed`,
  …), not the Linear project, and it is load-bearing rather than decorative: `cliff.toml` groups
  `RELEASE_NOTES.md` by scope, so a scopeless commit lands under a catch-all "General" heading.
  Branch per ticket using Linear's generated name.
- Release notes: tag the release, then `task release-notes -- v0.4.1`. git-cliff renders only
  user-facing types (`feat`/`fix`/`perf`/`revert`) and **prepends** the new section —
  `RELEASE_NOTES.md` accumulates per-release chunks and is never rebuilt wholesale. This is the
  one task that runs on the host rather than in the container, because git-cliff reads git
  history and tags; don't call `git-cliff` directly.
- The frontend is under `frontend/`; see [Frontend](#frontend-frontend) below.

## Frontend (`frontend/`)

React Router v8 in **framework mode with SSR**, deployed as a Cloudflare Worker (`workers/app.ts`,
`wrangler.jsonc`, custom domain `backlotter.com`) — not a client-only SPA. `src/routes.ts` declares
the route tree; `src/root.tsx` is the document shell (`Layout`/`App`/`ErrorBoundary`). Paths in this
section are relative to `frontend/`, except that module paths without a `src/` prefix (`routes/…`,
`api/…`, `lib/…`, `pages/…`, `components/…`, `test/…`, `env.ts`) are under `frontend/src/`. Its
working rules (container, conventions, gotchas) are in `AGENTS.md` → *Frontend*.

### Commands

Everything runs in the `upmovies-frontend` container; never run `pnpm`, `vitest`, `oxlint` or `tsc`
on the host.

| Task | Runs |
|---|---|
| `task fe:test` | `vitest run` (`task fe:test -- src/routes/film.test.tsx` to scope to one file) |
| `task fe:lint` | `oxlint src --max-warnings 0` |
| `task fe:typecheck` | `react-router typegen && tsc -b` (typegen must run first — routes use generated `+types/*` imports) |
| `task fe:format` / `task fe:format:check` | `prettier --write` / `prettier --check` (`-- <files>` to scope) |
| `task fe:build` | `react-router build` (SSR + client bundles), what Workers Builds runs |
| `task fe:cf-typegen` | regenerate the Cloudflare `Env` type via `wrangler types` |
| `task fe:deploy-dry-run` / `task fe:deploy` | build, then `wrangler deploy --dry-run` / deploy the last build (Workers Builds normally deploys) |
| `task fe:shell` / `task fe:logs` | shell in the container / stream its logs |

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

The backend rate-limits public reads per visitor IP (`docs/specs/NEU-1344-rate-limiter.md` §4).
Every SSR fetch leaves Cloudflare from a shared egress IP, so loaders sign their fetches:
`ssrOriginHeaders(env, request)` (`lib/ssr-origin.ts`) returns
`X-Backlotter-Origin: <SSR_ORIGIN_SECRET>` plus `X-Backlotter-Client-IP: <CF-Connecting-IP>`, and
the public fetchers take them as an optional `headers` argument. Browser-side calls to the same
fetchers pass nothing — they already arrive with the visitor's own IP. `sitemap.ts` is the one
unsigned loader: the backend excludes `/sitemap.xml` from the rate-limit bucket (crawlers, cached
upstream), so it has no visitor to key on.

A **dedicated header, never `X-Forwarded-For`**: Traefik strips forwarded headers from senders
outside its trusted set and the Worker is not in it, so an `X-Forwarded-For` from here dies at the
hop. `SSR_ORIGIN_SECRET` is an ASCII Wrangler secret (`wrangler secret put SSR_ORIGIN_SECRET`), not
a var in `wrangler.jsonc`; unset, loaders send nothing and the backend falls back to the egress IP.
Deploy order matters — backend first, then this secret + the frontend, then flip
`RATE_LIMIT_PUBLIC_ENABLED=true` in Coolify.

### SSR-safety invariant

`publicQueryClient` (`routes/public-layout.tsx`) is a module-level `QueryClient` shared across the
public subtree. It's safe under SSR only because the `["me"]` account query never resolves during
the server render pass — the first client paint is always a logged-out render, avoiding a
hydration mismatch. `refetchOnMount: "always"` then refreshes auth state on the client.

Which logged-out render is chosen by the **timeline hint** (NEU-1468,
`docs/adr/0026-timeline-hint-cookie.md`): a `timeline_hint` cookie the browser writes itself on an
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
reads `CF_PAGES_COMMIT_SHA` and Coolify's `SOURCE_COMMIT`, ignoring its `"unknown"`), compiled in as
`__GIT_SHA__` and read by both inits through `lib/sentry.ts`; `environment` is the Vite mode.
Redeploy by merging to `main`, never with the dashboard's *Retry build*: a dashboard-started build
sets `WORKERS_CI_COMMIT_SHA` to the branch name, so the release reads `main` instead of the SHA. Add
`SENTRY_DSN` and `SENTRY_AUTH_TOKEN` in the dashboard as type **Secret**, never Text: a Text value
is not in `wrangler.jsonc`, so the next deploy deletes it and prints it in the build log.

**Test errors.** `/debug/error` (unlinked, client-only) has a button that throws a
`BrowserTestError`; any URL with `?__test_error=<token>` makes the Worker throw a
`WorkerTestError`, where `<token>` is the `SENTRY_TEST_ERROR_TOKEN` Wrangler secret (unset → the
Worker trigger is off) (`lib/test-error.ts`). Distinct types, so each lands as its own Bugsink
issue.

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
- Path alias `@/` → `src/`.

### Testing (Vitest + RTL + MSW)

- MSW intercepts all HTTP (`onUnhandledFrame: "error"`); override per-test with `server.use(...)`.
  `test/msw/handlers.ts` has defaults, `test/msw/me.ts` builds `/me` responses for auth states.
- **Loaders** (public SSR routes): call the exported `loader` directly with a `RouterContextProvider`
  that has `cloudflareContext` set (`context.set(cloudflareContext, { env: { API_BASE_URL } })`) —
  see `routes/film.test.tsx`.
- **Components**: render with `createRoutesStub` from `react-router` to get router context without a
  full app tree, wrapped in `QueryClientProvider` (`{ retry: false }`) and `AuthProvider` as needed.
- Auth resolves asynchronously via the `/me` query — use `findBy*` and key assertions off
  post-auth-only content (e.g. a "Log out" control), not content present before auth resolves.
