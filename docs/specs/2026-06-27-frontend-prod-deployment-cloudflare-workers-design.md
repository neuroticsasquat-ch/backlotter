# Frontend production deployment (Cloudflare Workers) — design

**Date:** 2026-06-27
**Component:** `upcoming-movies-frontend`
**Status:** Approved (brainstorm) — pending implementation plan

## Goal

Deploy the React Router v8 SSR frontend to production on **Cloudflare Workers**, served at
`https://backlotter.com`, talking to the backend at `https://api.backlotter.com`. Deploys are
**Git-connected via Cloudflare Workers Builds** (push to `main` → CF builds + `wrangler deploy`),
mirroring the backend's Coolify push-to-deploy.

This is a finishing task, not greenfield: the NEU-306 Pages→Workers migration is already done in
code (framework-mode SSR, `@cloudflare/vite-plugin`, `workers/app.ts`, `wrangler.jsonc`, wrangler 4,
`public/_redirects` removed). What remains is prod configuration + standing up the deploy.

## Architecture

Cloudflare Workers Builds watches the repo. On push to `main` it runs `pnpm install --frozen-lockfile`,
`pnpm build` (React Router SSR build through the cloudflare vite plugin), then `wrangler deploy`. The
deployed Worker serves SSR at the edge for `backlotter.com`. It reaches the backend over **two**
channels, both pointing at `https://api.backlotter.com`:

- **SSR loaders** (workerd) read `env.API_BASE_URL` via `cloudflareContext` (`src/lib/load-context.ts`,
  set in `workers/app.ts`; consumed by `routes/feed.tsx`, `film.tsx`, `calendar.tsx`, `sitemap.ts`).
- **Browser** reads `VITE_API_BASE_URL`, baked into the bundle at build time (`src/env.ts`).

## Decisions

- **Deploy mechanism: Cloudflare Workers Builds (Git-connected).** Chosen for parity with the
  backend's auto-deploy and the prior Pages flow. Rejected: GitHub Actions (more moving parts, a CF
  API token to manage) and manual `wrangler deploy` (no automation).
- **`API_BASE_URL` (SSR runtime var):** change the committed value in `wrangler.jsonc` from the dev
  `https://api.upmovies.localhost` → **`https://api.backlotter.com`**. It's a plain URL (not a
  secret), and the committed `vars` value is what a deploy ships, so committing the prod value is
  correct. Local dev is unaffected — it overrides via the gitignored `.dev.vars`
  (`http://upmovies_backend:8000`, container-to-container). Caveat: running local dev *without*
  `.dev.vars` would now hit prod; the team convention (and `.dev.vars.example`) is to have it.
- **Build-time vars set in Cloudflare's build env** (not committed): `VITE_API_BASE_URL=https://api.backlotter.com`,
  `VITE_PUBLIC_SITE_URL=https://backlotter.com`, optional `VITE_SENTRY_DSN`.
- **Custom domain via wrangler config:** add a `routes` entry with `custom_domain: true` for
  `backlotter.com` so `wrangler deploy` provisions the apex custom domain + cert + DNS (the zone is
  already on Cloudflare). Rejected: dashboard-only binding (keeps domain config out of the repo).
- **`deploy` script** added to `package.json`: `pnpm build && wrangler deploy`.

## Changes (one PR, `upcoming-movies-frontend`)

1. **`wrangler.jsonc`** — set `vars.API_BASE_URL` → `https://api.backlotter.com`; add
   `"routes": [{ "pattern": "backlotter.com", "custom_domain": true }]`.
2. **`package.json`** — add `"deploy": "pnpm build && wrangler deploy"`.
3. **`.env.example`** — set the prod `VITE_PUBLIC_SITE_URL=https://backlotter.com`, drop the stale
   Cloudflare-Pages build comment, document the Workers-Builds build vars.

No source/component changes; CORS (`https://backlotter.com`) and cookie domain (`.backlotter.com`)
are already configured on the backend.

## Deploy checklist (Cloudflare UI — not committed)

After the PR merges:

1. **Create the Worker** via Workers & Pages → Create → Workers → **Connect to Git** → select
   `neuroticsasquat-ch/upcoming-movies-frontend`, branch `main`.
2. **Build config:** package manager pnpm (auto-detected via `packageManager` field), build command
   `pnpm build`, deploy command `npx wrangler deploy`, root dir = repo root.
3. **Build environment variables:**
   ```
   VITE_API_BASE_URL=https://api.backlotter.com
   VITE_PUBLIC_SITE_URL=https://backlotter.com
   VITE_SENTRY_DSN=<optional prod dsn>
   ```
4. **First deploy:** trigger a build; confirm `wrangler deploy` provisions the `backlotter.com`
   custom domain (cert + DNS auto-created on the Cloudflare zone).
5. **Smoke test:**
   - `https://backlotter.com/` renders the SSR feed (server-rendered HTML, not an empty shell).
   - `https://backlotter.com/film/<slug>` renders a film page.
   - `https://backlotter.com/sitemap.xml` proxies the backend sitemap with `backlotter.com` URLs.
   - Authed flow: `/login` → `/app` works against `api.backlotter.com` (cookie set on
     `.backlotter.com`, CSRF + credentialed fetch succeed).

## Domain / auth model

- FE apex `backlotter.com` (Worker); backend `api.backlotter.com`. Same registrable domain →
  the `.backlotter.com` session cookie set by the API is sent on credentialed browser fetches from
  the apex (same-site, `SameSite=lax`, `Secure`). SSR loader calls are server-to-server (no CORS).

## Verification

- `pnpm build` succeeds locally/in CI (the test workflow already runs typecheck + lint + vitest).
- Post-deploy: the smoke tests above pass; the public surface is populated once the backend's first
  ingestion pipeline completes (separate, in progress).

## Out of scope

- `www.backlotter.com` → apex redirect (add a Cloudflare redirect rule later).
- `VITE_GIT_SHA` / Sentry release provenance (was `CF_PAGES_COMMIT_SHA`; Workers Builds exposes a
  commit-sha build var — wire later if wanted).
- Backend deployment (done separately, PR #69) and its first data populate (in progress).
- Any visual / component changes.
