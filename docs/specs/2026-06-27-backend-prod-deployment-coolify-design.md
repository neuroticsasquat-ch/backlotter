# Backend production deployment (Coolify) — design

**Date:** 2026-06-27
**Component:** `upcoming-movies-backend`
**Status:** Approved (brainstorm) — pending implementation plan

## Goal

Ship the FastAPI backend to production on **Coolify** with a **managed Postgres**, reachable
at `https://api.backlotter.com`, serving the public surface and authed app at
`https://backlotter.com` (Cloudflare Workers SSR). The daily/hourly GitHub Actions cron
drives ingestion against the prod API.

This is a finishing/hardening task, not greenfield: a `prod` Dockerfile target and a partial
`docker-compose.prod.yml` already exist. This design completes them.

## Decisions

- **One Dockerfile, deploy the `prod` target.** No separate Dockerfile. The existing
  multi-stage `prod` target installs runtime-only deps (`uv pip install --system --no-cache .`,
  no `[dev]`), copies `src/` + `alembic.ini` + `migrations/`, and on startup runs
  `alembic upgrade head && exec uvicorn …` so migrations self-apply and signals reach uvicorn.
  No code/Dockerfile change required.
- **Lean Coolify-native compose.** Coolify owns the Traefik proxy, TLS, restart policy, and
  env injection. The compose therefore declares **no** `ports:`, `restart:`, proxy network, or
  `traefik.*` labels — Coolify adds those. Rejected alternative: hardcoded Traefik labels +
  manual proxy-network join (duplicates Coolify, fragile to its proxy-wiring changes).
- **Managed Postgres, bare DB.** Coolify-provisioned Postgres needs only to be an empty
  database. The container's startup `alembic upgrade head` self-bootstraps everything:
  `migrations/env.py` runs fully async (`async_engine_from_config` against the asyncpg URL) and
  `CREATE SCHEMA IF NOT EXISTS` for `app`/`catalog`/`news`/`ingest` plus the `citext` and
  `pgcrypto` extensions inside the migration transaction. No sync driver (psycopg) is needed.
- **Migrations run on container startup** (single instance). Acceptable for this service;
  a `start_period` on the healthcheck covers first-boot migration time.

## Changes to `docker-compose.prod.yml`

The existing file already has: `build: target: prod`, env passthrough for `DATABASE_URL`,
`ADMIN_TOKEN`, `TMDB_API_KEY`, `CORS_ALLOWED_ORIGINS`, `COOKIE_DOMAIN`, `PUBLIC_BASE_URL`
(default `https://backlotter.com`), `COOKIE_SAMESITE`, `ENVIRONMENT=production`, `SENTRY_DSN`,
`LOG_LEVEL`, and a healthcheck. Apply three changes:

1. **Add `ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"`** to `environment:`.
   *Boot-blocker:* `config.py` declares it `Field(...)` (required) — the app will not start
   without it, and the `link`/`synthesize` pipeline stages call the Anthropic API.
2. **Add Coolify FQDN magic:** `SERVICE_FQDN_UPMOVIESBACKEND_8000` to `environment:` so Coolify
   routes the assigned domain → container port 8000. The actual domain (`api.backlotter.com`)
   is assigned in the Coolify UI.
3. **Add `start_period: 30s`** to the healthcheck so it does not flap while the startup
   migration runs on first boot.

Everything else stays as-is. All env *values* are set in the Coolify UI, not committed.

## Deploy checklist (Coolify UI / GitHub — not committed)

**Coolify application env:**

- `DATABASE_URL` — **must use the `postgresql+asyncpg://` scheme** (rewrite Coolify's default
  `postgres://…`), pointing at the managed Postgres. (Alembic + the app both use this single
  async URL.)
- `ANTHROPIC_API_KEY`, `TMDB_API_KEY`, `ADMIN_TOKEN` — real secrets.
- `CORS_ALLOWED_ORIGINS=https://backlotter.com`
- `COOKIE_DOMAIN=.backlotter.com` (cookie_secure stays `true`, `COOKIE_SAMESITE=lax`)
- `PUBLIC_BASE_URL=https://backlotter.com`
- `SENTRY_DSN` — prod DSN (optional; defaults to empty/disabled).
- `ENVIRONMENT=production`, `LOG_LEVEL=INFO` (already defaulted in compose).

**Coolify routing:** assign domain `api.backlotter.com` to the service (port 8000).

**GitHub Actions cron** (`daily-pipeline.yml`, `hourly-feeds.yml`), repo
Settings → Secrets and variables → Actions:

- secret `UPMOVIES_ADMIN_TOKEN` — must equal the API's `ADMIN_TOKEN`.
- variable `UPMOVIES_API_BASE_URL=https://api.backlotter.com` (no trailing slash).

## Domain / auth model

- Backend: `api.backlotter.com`. Frontend (public SSR + authed SPA): `backlotter.com`.
- Cross-subdomain session cookies work because both share the registrable domain
  `backlotter.com`: `api.backlotter.com` sets the session cookie scoped to `.backlotter.com`,
  `SameSite=lax`, `Secure=true`; the browser on `backlotter.com` sends it back. CORS allows the
  single origin `https://backlotter.com` (credentialed).

## Verification

- `docker compose -f docker-compose.prod.yml build` succeeds (prod target).
- Against a throwaway empty Postgres: container boots, `alembic upgrade head` creates schemas +
  extensions + tables, `GET /healthz` → `{"status":"ok"}`.
- Post-deploy smoke: `https://api.backlotter.com/healthz` 200; a manual
  `workflow_dispatch` of the daily pipeline reaches terminal `succeeded`.

## Out of scope

- Frontend (Cloudflare Workers) deployment — separate.
- Postgres backups/upgrades — owned by the managed-DB provider.
- CI build/push of the image — Coolify builds from the repo on deploy.
- Horizontal scaling / migration-as-separate-step — single instance, migrate-on-boot is fine.
