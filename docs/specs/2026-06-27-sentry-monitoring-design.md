# Sentry monitoring for Backlotter (backend + frontend) — design

**Date:** 2026-06-27
**Status:** Design (approved in brainstorming; pending written-spec review)
**Repos:** `upcoming-movies-backend`, `upcoming-movies-frontend`
**Related deploy docs:** `2026-06-27-backend-prod-deployment-coolify-design.md`, `2026-06-27-frontend-prod-deployment-cloudflare-workers-design.md`

## Goal

Stand up working Sentry error + performance monitoring across both apps in production:
backend API (FastAPI on Coolify → `api.backlotter.com`), frontend (React Router v8 SSR on
Cloudflare Workers → `backlotter.com`), and the scheduled ingestion crons. The scaffolding
mostly exists but is **dormant** — no Sentry projects exist, the frontend DSN is never injected
(so the browser SDK never initializes), SSR server-side errors are uncaptured, release tags are
incomplete, and there is no missed-cron alerting.

Coverage scope (chosen): **activate + fix basics → SSR server-side capture → ingestion cron coverage** (the deepest of the three levels).

## Current state (audited 2026-06-27)

**Sentry account:** org `neuroticsasquatch` exists (used by `tvbf-*`, `boone-gifts-*`). **No
project for this app yet.**

**Backend** (`sentry-sdk[fastapi]` installed):
- `sentry_sdk.init` in `src/upmovies/main.py` is wired well — `FastApiIntegration` +
  `SqlalchemyIntegration`, `traces_sample_rate=0.1`, `environment` from `ENVIRONMENT`, `release`
  from `GIT_SHA`. Guarded by `if dsn := os.environ.get("SENTRY_DSN")`.
- `docker-compose.prod.yml` already passes `SENTRY_DSN` + `ENVIRONMENT=production`.
- **Gap:** `GIT_SHA` is read but never set in prod compose → release is always `"unknown"`.
- **Gap:** no `SENTRY_DSN` value set yet (no project) → SDK inert.
- **Gap:** scheduled crons (`daily-pipeline.yml`, `hourly-feeds.yml`) have no missed-run alerting.

**Frontend** (`@sentry/react` installed):
- Browser `Sentry.init` in `src/entry.client.tsx` (browserTracing + replay), guarded by
  `if (dsn) { ... }` reading `import.meta.env.VITE_SENTRY_DSN`. `release` from `VITE_GIT_SHA`.
- `Sentry.ErrorBoundary` wraps the SPA subtree in `src/routes/spa-layout.tsx`.
- **Gap:** `VITE_SENTRY_DSN` / `VITE_GIT_SHA` are never injected by any build → guard always false →
  **browser SDK never initializes in prod.**
- **Gap:** SSR (`workers/app.ts` Cloudflare Workers fetch handler + `entry.server.tsx`) has **zero**
  instrumentation. `@sentry/react` is browser-only. The entire public SSR product runs here
  uninstrumented — total blind spot for loader/render errors.
- **Gap:** the real catch-all error UI (`src/root.tsx` `ErrorBoundary`, covers public + SPA routes)
  does not report to Sentry; only the narrower SPA-subtree boundary does.
- **Gap:** no source-map upload → minified prod stack traces.

**Crons** (backend repo GitHub Actions): `daily-pipeline.yml` (09:00 UTC: tmdb → feeds(per_film) →
link → synthesize) and `hourly-feeds.yml` (top of hour: light feeds). Both POST to
`/admin/ingest/<pipeline>` and poll `/admin/ingest/<run_id>` until terminal, failing the job on
`failed`/`cancelled`/timeout. The ingestion work runs **in-process in the FastAPI app**, so its
exceptions are already captured by the backend SDK once the DSN is live. The unique gap is
**missed or failed scheduled runs** (GitHub silently drops schedules) — the job of Sentry Cron Monitors.

## Decisions (locked in brainstorming)

- Project names: **`backlotter-backend`**, **`backlotter-frontend`** (product/brand convention,
  matching `tvbf-*` / `boone-gifts-*`).
- DSNs are **public client keys** → commit them into each repo's `.env.example` comments; live use
  is via prod env vars. (The Sentry **auth token** for source-map upload is a real secret — never committed.)
- Session Replay: flip `maskAllText: false` → **`true`** (privacy: login/signup forms exist).
- SSR runtime: **`@sentry/cloudflare`** `withSentry(...)` wrapping `workers/app.ts` (the Workers
  runtime needs the CF-specific SDK, not the Node `@sentry/node`/`@sentry/react-router` server).
  Client stays on `@sentry/react`.
- Work shape: **two PRs** (1 backend, 1 frontend) per the 1-ticket-1-PR rule. Project creation +
  dashboard secrets are manual setup, not PRs. Create the usual per-stack Linear tickets.

## Design

### 0. Sentry projects (manual, via MCP at execution time)
Create `backlotter-backend` (python) + `backlotter-frontend` (javascript) under `neuroticsasquatch`;
fetch their DSNs. Record DSNs in `.env.example` comments; provide live values for the dashboards.

### 1. Backend PR (`upcoming-movies-backend`)

**1a. Release tag.** Coolify exposes the deployed commit as `SOURCE_COMMIT`. Add to
`docker-compose.prod.yml` `environment:`:
```yaml
GIT_SHA: "${SOURCE_COMMIT:-unknown}"
```
No code change — `main.py` already reads `GIT_SHA`. `.env.example` gains a documented
`SENTRY_DSN=` line (commented, disabled in localdev — matches the existing dormant-in-dev pattern).

**1b. Cron monitors (check-ins).** Add Sentry Cron Monitor check-ins to both workflows:
- At job start: POST an `in_progress` check-in, capturing the returned check-in id.
- At job end: POST `ok` (rc 0) or `error` (rc≠0) for that check-in id.
- Monitors: `daily-pipeline` (schedule `0 9 * * *`) and `hourly-feeds` (schedule `0 * * * *`),
  so Sentry alerts on **missed** runs as well as failures.
- Check-in URL uses the backend project's ingest DSN + a monitor slug; secret stored as a new
  GitHub Actions secret (e.g. `SENTRY_INGEST_CHECKIN_URL` or DSN + monitor slug). Implemented as a
  small curl helper around the existing `rc` accumulation — no change to the ingestion logic itself.

### 2. Frontend PR (`upcoming-movies-frontend`)

**2a. Activate the client SDK.** Wire build-time vars so the existing `entry.client.tsx` init runs
in prod:
- `VITE_SENTRY_DSN` — set as a Cloudflare Workers Builds build env var.
- `VITE_GIT_SHA` — Workers Builds exposes the commit as `WORKERS_CI_COMMIT_SHA`; map it via the
  build command (`VITE_GIT_SHA="$WORKERS_CI_COMMIT_SHA" pnpm build`) so `release` is the real SHA.
- Flip replay `maskAllText` / `blockAllMedia` to `true`.

**2b. SSR server-side capture.** Add `@sentry/cloudflare`; wrap the `workers/app.ts` default export's
`fetch` handler with `Sentry.withSentry((env) => ({ dsn: env.SENTRY_DSN, environment, release, tracesSampleRate: 0.1 }), handler)`.
DSN read from the worker `env` — add `SENTRY_DSN` (the frontend project DSN) as a committed
`var` in `wrangler.jsonc` (public key, safe to commit) alongside the existing `API_BASE_URL`.
This captures public-page loader + SSR-render errors.

> Note: there is **one** `backlotter-frontend` DSN. It reaches the **browser** bundle via the
> `VITE_SENTRY_DSN` build var (2a) and the **worker** runtime via the `wrangler.jsonc` `SENTRY_DSN`
> var (2b) — two delivery mechanisms for the same value, because the client bundle and the Workers
> runtime read env differently.

**2c. Report all route errors.** In `src/root.tsx` `ErrorBoundary`, call `Sentry.captureException(error)`
(guarded for non-404 / unexpected errors) so both public and SPA route errors report. The existing
`spa-layout.tsx` `Sentry.ErrorBoundary` is kept for its nicer fallback UI but is no longer the only reporter.

**2d. Source maps + release.** Add `@sentry/vite-plugin` to `vite.config`, gated on
`process.env.SENTRY_AUTH_TOKEN` being present (so local/dev builds skip upload). It uploads source
maps for client + worker bundles and creates the Sentry release. Needs `SENTRY_AUTH_TOKEN` +
org/project as Cloudflare Workers Builds **secrets**. `.env.example` documents `VITE_SENTRY_DSN`.

### 3. Manual setup (dashboards — exact values provided at execution time)
- **Coolify (backend):** set `SENTRY_DSN`; confirm `SOURCE_COMMIT` is available so `GIT_SHA` resolves.
- **Cloudflare Workers Builds (frontend):** build env vars `VITE_SENTRY_DSN`; build secrets
  `SENTRY_AUTH_TOKEN` (+ `SENTRY_ORG`/`SENTRY_PROJECT` if not in plugin config); add `SENTRY_DSN`
  `var` to `wrangler.jsonc`; set build command to inject `VITE_GIT_SHA`.
- **GitHub Actions (backend repo):** add the cron check-in secret(s).

## Out of scope (YAGNI)
- Tunable per-route / per-transaction sampling beyond the existing 0.1.
- Sentry alerts/dashboards configuration beyond default issue + missed-cron alerting.
- Profiling, tracing across the FE↔BE boundary (distributed tracing) — can follow later.
- Backfilling Sentry into non-prod environments.

## Verification
- **Backend:** trigger a deliberate test error on prod (or a `sentry_sdk.capture_message`) → appears
  in `backlotter-backend` with `environment=production` and a real `release` SHA. Run a cron manually
  (`workflow_dispatch`) → check-in shows in the monitor.
- **Frontend:** load a public SSR page that throws (temporary) → server issue in `backlotter-frontend`;
  trigger a client error → browser issue with un-minified frames + correct release. Confirm replay
  text is masked.

## Notes
- The umbrella (`~/projects/upcoming-movies/`) is **not** a git repo, so this spec has no git history.
- Per the model/effort workflow: implement in Sonnet/high sessions, one PR each; do **not** auto-start
  implementation from this planning session.
