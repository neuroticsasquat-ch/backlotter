# Frontend Production Deployment (Cloudflare Workers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the React Router v8 SSR frontend to production on Cloudflare Workers (Git-connected via Workers Builds), served at `https://backlotter.com`, talking to `https://api.backlotter.com`.

**Architecture:** The Pages→Workers migration is already done in code. This adds the prod config (API URLs, custom domain, deploy script) in one PR, then stands up Cloudflare Workers Builds (push-to-`main` → `pnpm build` + `wrangler deploy`).

**Tech Stack:** React Router v8 (framework-mode SSR), `@cloudflare/vite-plugin`, Vite 8, wrangler 4, Cloudflare Workers + Workers Builds, pnpm, runs in a Docker container via `task`.

## Global Constraints

- **No local Node/pnpm** — everything runs in the container via `task` (`docker compose exec` into `upmovies-frontend`). Container must be up (`task up`; requires infra up via `task infra:up`).
- Before pushing, the full CI trio must be green (memory: run CI locally): `task typecheck` (`react-router typegen` + `tsc -b`), `task lint` (`eslint --max-warnings 0`), `task test` (vitest). Plus the prod build `task build:app` (`pnpm build`).
- FE has **no pre-commit hooks** (commits don't auto-run checks) — so running the CI trio manually before push is mandatory.
- Both backend URLs become `https://api.backlotter.com`: `API_BASE_URL` (SSR runtime, committed in `wrangler.jsonc`) and `VITE_API_BASE_URL` (build-time, set in Cloudflare). `VITE_PUBLIC_SITE_URL=https://backlotter.com`.
- Commit style (FE convention): Conventional Commits subject; Linear ID parenthetical **only if** a ticket maps (none here → drop it); **no** `🤖` footer in commit messages (footer goes in the PR **body** only); **no** `Co-Authored-By`.
- Backend already configured for this FE: CORS allows `https://backlotter.com`, session cookie domain `.backlotter.com`. No backend change here.
- Spec of record: `docs/specs/2026-06-27-frontend-prod-deployment-cloudflare-workers-design.md`.

---

### Task 1: Prod config PR (`upcoming-movies-frontend`)

Set the SSR runtime API URL + custom domain in `wrangler.jsonc`, add a `deploy` script, and refresh `.env.example`. Verify the prod build + CI trio stay green.

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: existing `workers/app.ts` (sets `cloudflareContext` from `env`), `src/lib/load-context.ts` (`AppEnv.API_BASE_URL`), `src/env.ts` (`VITE_API_BASE_URL`).
- Produces: a `wrangler.jsonc` whose deployed Worker serves `backlotter.com` and whose SSR loaders hit `https://api.backlotter.com`; a `pnpm deploy` script Cloudflare Workers Builds (or a human) can run.

- [ ] **Step 1: Branch off main**

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-frontend
git checkout main && git pull --ff-only
git checkout -b tom/frontend-prod-deployment
```

- [ ] **Step 2: Update `wrangler.jsonc`**

Set the SSR runtime `API_BASE_URL` to prod and add the apex custom-domain route. Full file after edit:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "upmovies-frontend",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./workers/app.ts",
  "observability": { "enabled": true },
  "vars": {
    "API_BASE_URL": "https://api.backlotter.com"
  },
  "routes": [{ "pattern": "backlotter.com", "custom_domain": true }]
}
```

(Local dev is unaffected: `.dev.vars` overrides `API_BASE_URL` to `http://upmovies_backend:8000`.)

- [ ] **Step 3: Add the `deploy` script to `package.json`**

In the `"scripts"` block, add a `deploy` entry (canonical non-container deploy command; also what Workers Builds effectively runs):

```json
    "typecheck": "react-router typegen && tsc -b",
    "deploy": "pnpm build && wrangler deploy"
```

(Leave the existing scripts unchanged; just add the `deploy` line.)

- [ ] **Step 4: Refresh `.env.example`**

Drop the stale Cloudflare-Pages build comment and document the Workers-Builds prod vars. Full file after edit:

```
# Copy to .env.local (gitignored).
VITE_API_BASE_URL=https://api.upmovies.localhost
VITE_PUBLIC_SITE_URL=https://app.upmovies.localhost
VITE_TMDB_IMAGE_BASE=https://image.tmdb.org/t/p
# VITE_SENTRY_DSN=<your-upmovies-frontend-Sentry-DSN>
#
# Production (set in Cloudflare Workers Builds -> Settings -> build environment variables):
#   VITE_API_BASE_URL=https://api.backlotter.com
#   VITE_PUBLIC_SITE_URL=https://backlotter.com   # must match backend PUBLIC_BASE_URL (sitemap proxy)
# The SSR-runtime API_BASE_URL is committed in wrangler.jsonc (vars); local dev overrides it via .dev.vars.
```

- [ ] **Step 5: Bring the container up**

```bash
task infra:up   # no-op if already running
task up
```

- [ ] **Step 6: Run the prod build (validates wrangler.jsonc via the cloudflare vite plugin)**

Run: `task build:app`
Expected: `pnpm build` (`react-router build`) completes with no error and emits the SSR build under `dist/`. A malformed `wrangler.jsonc` fails here because `@cloudflare/vite-plugin` reads it during build.

- [ ] **Step 7: Run the CI trio**

```bash
task typecheck
task lint
task test
```
Expected: all green (config-only change touched no source, so nothing should regress).

- [ ] **Step 8: Commit**

```bash
git add wrangler.jsonc package.json .env.example
git commit -m "chore(deploy): configure prod deploy for Cloudflare Workers"
```

- [ ] **Step 9: Push + open PR**

```bash
git push -u origin tom/frontend-prod-deployment
```
Open a PR to `main` (Conventional Commits title; `🤖 Generated with Claude Code` footer in the PR **body** only; no Linear parenthetical — no ticket maps).

---

### Task 2: Deploy runbook (Cloudflare Workers Builds)

Platform-side, **at deploy time**, after Task 1 merges. No repo changes.

**Files:** none (Cloudflare dashboard + GitHub App grant).

**Interfaces:**
- Consumes: merged `wrangler.jsonc` (custom domain + prod `API_BASE_URL`), the `backlotter.com` Cloudflare zone, prod `VITE_*` values.
- Produces: `https://backlotter.com` serving the SSR app, auto-deploying on push to `main`.

- [ ] **Step 1: Grant the Cloudflare GitHub App access to the repo**

On GitHub: org `neuroticsasquat-ch` → Settings → GitHub Apps → the **Cloudflare** app → Configure → add `upcoming-movies-frontend` to repository access. (Separate from Coolify's GitHub App.)

- [ ] **Step 2: Create the Worker via Workers Builds**

Cloudflare dashboard → **Workers & Pages → Create → Workers → Connect to Git** → select `neuroticsasquat-ch/upcoming-movies-frontend`, production branch **`main`**.

- [ ] **Step 3: Build configuration**

- Package manager: **pnpm** (auto-detected via `packageManager` in `package.json`).
- **Build command:** `pnpm build`
- **Deploy command:** `npx wrangler deploy`
- Root directory: repo root (`/`).

- [ ] **Step 4: Build environment variables**

In the Worker's build settings, add:
```
VITE_API_BASE_URL=https://api.backlotter.com
VITE_PUBLIC_SITE_URL=https://backlotter.com
VITE_SENTRY_DSN=<optional prod dsn>
```
(These are **build-time** — they bake into the browser bundle. The SSR-runtime `API_BASE_URL` comes from `wrangler.jsonc`, no dashboard var needed.)

- [ ] **Step 5: First deploy + custom domain**

Trigger the first build/deploy. Confirm in the deploy log that `wrangler deploy` provisions the `backlotter.com` custom domain (Cloudflare auto-creates the DNS record + cert on the zone). If the apex doesn't bind, add it manually under the Worker → Settings → Domains & Routes → Custom Domain → `backlotter.com`.

- [ ] **Step 6: Smoke test (request from me once it's live)**

```bash
curl -fsS https://backlotter.com/ | grep -i "<title" ; echo
curl -fsS -o /dev/null -w 'feed=%{http_code}\n' https://backlotter.com/
curl -fsS -o /dev/null -w 'sitemap=%{http_code}\n' https://backlotter.com/sitemap.xml
```
Expected: `/` returns 200 with server-rendered HTML (a real `<title>` / feed markup, not an empty shell); `/sitemap.xml` returns 200 and lists `backlotter.com` URLs (proxied from the backend). Then manually verify the authed flow in a browser: `https://backlotter.com/login` → `/app` succeeds against `api.backlotter.com` (session cookie set on `.backlotter.com`).

Note: the public feed/film/sitemap content is only non-empty once the backend's first ingestion pipeline has populated data (separate, in progress) — an empty-but-200 feed pre-populate is expected and fine.

---

## Self-Review

**Spec coverage:**
- Workers Builds (Git-connected) deploy → Task 2. ✓
- `API_BASE_URL` → prod in `wrangler.jsonc` → Task 1 Step 2. ✓
- Custom domain `backlotter.com` route → Task 1 Step 2 + Task 2 Step 5. ✓
- `VITE_API_BASE_URL` / `VITE_PUBLIC_SITE_URL` build vars → Task 2 Step 4. ✓
- `deploy` script → Task 1 Step 3. ✓
- `.env.example` refresh (drop Pages comment, add Workers-Builds vars) → Task 1 Step 4. ✓
- Verification (prod build + CI trio; post-deploy SSR/sitemap/authed smoke) → Task 1 Steps 6-7, Task 2 Step 6. ✓
- GitHub App grant for CF → Task 2 Step 1. ✓

**Placeholder scan:** No TBD/TODO; full file contents given for `wrangler.jsonc` and `.env.example`, exact script line for `package.json`. The `<optional prod dsn>` is an operator-supplied secret, not a plan gap. ✓

**Type/name consistency:** `API_BASE_URL` (SSR runtime, matches `AppEnv.API_BASE_URL` / `load-context.ts`), `VITE_API_BASE_URL` + `VITE_PUBLIC_SITE_URL` (match `src/env.ts`), Worker name `upmovies-frontend` (matches `wrangler.jsonc`), task targets match `Taskfile.yml` (`build:app`, `typecheck`, `lint`, `test`, `up`). ✓
