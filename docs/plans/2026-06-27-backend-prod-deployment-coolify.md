# Backend Production Deployment (Coolify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `upcoming-movies-backend` deployable to production on Coolify by completing `docker-compose.prod.yml`, then run the deploy.

**Architecture:** Deploy the existing multi-stage Dockerfile `prod` target (runtime-only deps; startup runs `alembic upgrade head && exec uvicorn`). Coolify owns the Traefik proxy, TLS, restart policy, and env injection, so the compose stays lean — no ports/restart/labels/proxy-network. Managed Postgres is a bare DB; the container's startup migration self-bootstraps schemas (`app`/`catalog`/`news`/`ingest`) and the `citext`/`pgcrypto` extensions.

**Tech Stack:** Docker (multi-stage), Docker Compose, Coolify, FastAPI/uvicorn, Alembic (async, asyncpg), managed Postgres 17, GitHub Actions (cron ingestion).

## Global Constraints

- One Dockerfile; deploy the `prod` target. **No** separate Dockerfile, **no** Dockerfile change.
- Compose declares no `ports:`, `restart:`, proxy network, or `traefik.*` labels — Coolify provides them.
- `DATABASE_URL` must use the **`postgresql+asyncpg://`** scheme (both app and Alembic use this single async URL).
- Required app env (app will not boot without these): `DATABASE_URL`, `ADMIN_TOKEN`, `TMDB_API_KEY`, `ANTHROPIC_API_KEY`.
- Prod domains: backend `api.backlotter.com`; frontend (public + authed) `backlotter.com`. `CORS_ALLOWED_ORIGINS=https://backlotter.com`, `COOKIE_DOMAIN=.backlotter.com`, `COOKIE_SAMESITE=lax`, cookie_secure `true`, `PUBLIC_BASE_URL=https://backlotter.com`.
- Commit style (repo convention): Conventional Commits subject, **no** Linear ID in subject, **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. No Linear ticket maps to this work.
- Repo pre-commit hooks `docker compose exec -T` into the running container (ruff check / ruff format --check / pyright / pytest full suite) — the `upmovies-backend` container must be **up** (`task up`) to commit. This change touches no Python, so the suite should stay green; do **not** use `--no-verify`.
- Spec of record: `docs/specs/2026-06-27-backend-prod-deployment-coolify-design.md`.

---

### Task 1: Harden `docker-compose.prod.yml`

Add the missing required env var, the Coolify routing magic var, and a healthcheck `start_period`. Verify by building the prod image and booting it against a throwaway empty Postgres to prove migrate-on-boot works.

**Files:**
- Modify: `docker-compose.prod.yml`

**Interfaces:**
- Consumes: existing Dockerfile `prod` target (`build: { context: ., target: prod }`), already referenced by this compose file.
- Produces: a deployable `docker-compose.prod.yml` whose `upmovies-backend` service boots against a bare Postgres and serves `GET /healthz` → `{"status":"ok"}`. Coolify assigns the FQDN via the `SERVICE_FQDN_UPMOVIESBACKEND_8000` env var.

- [ ] **Step 1: Branch off main**

Repo is currently on `main`. Branch first (no Linear ticket maps to this work).

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
git checkout main && git pull
git checkout -b tom/backend-prod-deployment
```

- [ ] **Step 2: Edit the `environment:` block**

In `docker-compose.prod.yml`, under `services.upmovies-backend.environment:`, add `ANTHROPIC_API_KEY` (boot-blocker — `config.py` declares it `Field(...)`) and the Coolify FQDN magic var `SERVICE_FQDN_UPMOVIESBACKEND_8000` (Coolify routes the assigned domain → container:8000). Place `ANTHROPIC_API_KEY` next to the other secret passthroughs and `SERVICE_FQDN_UPMOVIESBACKEND_8000` at the end of the block. Resulting `environment:` block:

```yaml
    environment:
      DATABASE_URL: "${DATABASE_URL}"
      ADMIN_TOKEN: "${ADMIN_TOKEN}"
      TMDB_API_KEY: "${TMDB_API_KEY}"
      ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
      LOG_LEVEL: "INFO"
      # BE PUBLIC_BASE_URL must equal the FE public origin (VITE_PUBLIC_SITE_URL / Cloudflare
      # custom domain) — https://backlotter.com in prod — or the sitemap will list URLs on a
      # different host than serves it. DEPLOY CHECKLIST: ensure PUBLIC_BASE_URL is set to
      # https://backlotter.com in the deploy environment (unset = empty string overrides the
      # code default; the fallback below prevents silent misconfiguration).
      PUBLIC_BASE_URL: "${PUBLIC_BASE_URL:-https://backlotter.com}"
      CORS_ALLOWED_ORIGINS: "${CORS_ALLOWED_ORIGINS}"
      COOKIE_DOMAIN: "${COOKIE_DOMAIN}"
      COOKIE_SAMESITE: "lax"
      ENVIRONMENT: "production"
      SENTRY_DSN: "${SENTRY_DSN:-}"
      # Coolify magic var: routes the assigned domain (api.backlotter.com, set in the
      # Coolify UI) to this service on container port 8000.
      SERVICE_FQDN_UPMOVIESBACKEND_8000: "${SERVICE_FQDN_UPMOVIESBACKEND_8000:-}"
```

- [ ] **Step 3: Add `start_period` to the healthcheck**

So the healthcheck does not flap while the startup migration runs on first boot. Update the healthcheck block to:

```yaml
    healthcheck:
      test: ["CMD", "python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/healthz', timeout=2).status == 200 else 1)"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
```

- [ ] **Step 4: Validate the compose file parses**

Run:
```bash
docker compose -f docker-compose.prod.yml config >/dev/null && echo OK
```
Expected: prints `OK` (any unset `${VAR}` warnings are fine — values come from Coolify). A YAML/schema error fails here.

- [ ] **Step 5: Build the prod image**

Run:
```bash
docker build --target prod -t upmovies-backend:prodsmoke .
```
Expected: build succeeds (installs runtime-only deps, copies `src/`/`alembic.ini`/`migrations/`).

- [ ] **Step 6: Boot smoke test against a throwaway empty Postgres**

Proves migrate-on-boot bootstraps a bare DB and the app serves `/healthz`.

```bash
docker network create upm_smoke
docker run -d --name upm_smoke_pg --network upm_smoke \
  -e POSTGRES_USER=root -e POSTGRES_PASSWORD=root -e POSTGRES_DB=upmovies \
  postgres:17
# wait for postgres to accept connections
until docker exec upm_smoke_pg pg_isready -U root >/dev/null 2>&1; do sleep 1; done

docker run -d --name upm_smoke_api --network upm_smoke -p 18000:8000 \
  -e DATABASE_URL="postgresql+asyncpg://root:root@upm_smoke_pg:5432/upmovies" \
  -e ADMIN_TOKEN=smoke -e TMDB_API_KEY=smoke -e ANTHROPIC_API_KEY=smoke \
  upmovies-backend:prodsmoke

# give migrations + uvicorn time to start
sleep 15
docker logs upm_smoke_api | tail -20
curl -fsS http://localhost:18000/healthz; echo
```
Expected: logs show `alembic upgrade head` running migrations to head with no error, then uvicorn startup; `curl` prints `{"status":"ok"}`.

- [ ] **Step 7: Tear down the smoke stack**

```bash
docker rm -f upm_smoke_api upm_smoke_pg
docker network rm upm_smoke
docker rmi upmovies-backend:prodsmoke
```

- [ ] **Step 8: Commit**

Ensure the dev container is up so pre-commit hooks can run (`task up`). Then:
```bash
git add docker-compose.prod.yml
git commit -m "chore(deploy): complete prod compose for Coolify deployment"
```
Expected: pre-commit hooks (ruff/pyright/pytest in-container) pass — no Python changed — and the commit lands.

- [ ] **Step 9: Push and open the PR**

```bash
git push -u origin tom/backend-prod-deployment
```
Then open a PR to `main` using `/pr-desc` (Conventional Commits title; `🤖 Generated with Claude Code` footer in the PR **body** only). No Linear ID parenthetical (no ticket maps to this work).

---

### Task 2: Deploy runbook (Coolify + GitHub cron)

Operational steps performed **at deploy time**. No repo code changes — this task documents and executes the platform-side configuration the lean compose depends on. Run after Task 1's PR is merged.

**Files:** none (Coolify UI + GitHub repo settings).

**Interfaces:**
- Consumes: merged `docker-compose.prod.yml`, the managed Postgres connection string, real secrets (`ANTHROPIC_API_KEY`, `TMDB_API_KEY`, a freshly generated `ADMIN_TOKEN`), prod `SENTRY_DSN`.
- Produces: a running backend at `https://api.backlotter.com/healthz`; GitHub Actions cron able to drive `/admin/ingest/*`.

- [ ] **Step 1: Provision managed Postgres in Coolify**

Create a Postgres 17 resource in the Coolify project. Note its connection string. The DB can be empty — startup migration bootstraps schemas + `citext`/`pgcrypto`.

- [ ] **Step 2: Create the Coolify application from compose**

Point Coolify at the `upcoming-movies-backend` repo, `main` branch, build type **Docker Compose**, compose file `docker-compose.prod.yml`.

- [ ] **Step 3: Set application environment variables (Coolify UI)**

```
DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<managed-pg-host>:5432/<db>
ADMIN_TOKEN=<generated strong token>
TMDB_API_KEY=<real key>
ANTHROPIC_API_KEY=<real key>
CORS_ALLOWED_ORIGINS=https://backlotter.com
COOKIE_DOMAIN=.backlotter.com
PUBLIC_BASE_URL=https://backlotter.com
SENTRY_DSN=<prod dsn>
```
Critical: `DATABASE_URL` MUST be the `postgresql+asyncpg://` form (rewrite Coolify's default `postgres://`). `LOG_LEVEL`, `COOKIE_SAMESITE`, `ENVIRONMENT` are already set in the compose.

- [ ] **Step 4: Assign the domain**

In the Coolify UI, assign domain `api.backlotter.com` to the `upmovies-backend` service (container port 8000). Coolify provisions TLS and wires its Traefik proxy. Ensure DNS for `api.backlotter.com` points at the Coolify host.

- [ ] **Step 5: Deploy and smoke-test**

Trigger the deploy. Then:
```bash
curl -fsS https://api.backlotter.com/healthz; echo
```
Expected: `{"status":"ok"}`. Check Coolify deploy logs show `alembic upgrade head` reaching head with no error.

- [ ] **Step 6: Configure the GitHub Actions cron**

Set the repo secret + variable the ingestion workflows require (`daily-pipeline.yml`, `hourly-feeds.yml`):
```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
gh secret set UPMOVIES_ADMIN_TOKEN --body '<same value as ADMIN_TOKEN>'
gh variable set UPMOVIES_API_BASE_URL --body 'https://api.backlotter.com'
```

- [ ] **Step 7: Verify the pipeline end-to-end**

Manually dispatch the daily pipeline and confirm it reaches a terminal `succeeded`:
```bash
gh workflow run daily-pipeline.yml
gh run watch
```
Expected: the job triggers `tmdb → feeds → link → synthesize` against `api.backlotter.com` and each run reaches `succeeded`.

---

## Self-Review

**Spec coverage:**
- Dockerfile "no change, deploy prod target" → Global Constraints + Task 1 (build `--target prod`). ✓
- Lean Coolify-native compose (no ports/restart/labels) → Global Constraints; Task 1 leaves them out. ✓
- `ANTHROPIC_API_KEY` boot-blocker fix → Task 1 Step 2. ✓
- `SERVICE_FQDN_UPMOVIESBACKEND_8000` routing → Task 1 Step 2; domain assign Task 2 Step 4. ✓
- Healthcheck `start_period` → Task 1 Step 3. ✓
- Managed Postgres bare-DB / migrate-on-boot → Task 1 Step 6 smoke test; Task 2 Steps 1, 5. ✓
- `postgresql+asyncpg://` scheme gotcha → Global Constraints + Task 2 Step 3. ✓
- Domain/auth env values → Task 2 Step 3. ✓
- GitHub cron secret/variable → Task 2 Step 6; e2e verify Step 7. ✓
- Verification (build, boot-against-empty-PG, post-deploy smoke) → Task 1 Steps 4-6, Task 2 Steps 5, 7. ✓

**Placeholder scan:** No TBD/TODO; all commands and the full env block are concrete. The `<…>` tokens in Task 2 are deploy-time secrets the operator supplies, not plan placeholders. ✓

**Type consistency:** Env var names match the spec and `config.py` aliases (`ANTHROPIC_API_KEY`, `CORS_ALLOWED_ORIGINS`, `COOKIE_DOMAIN`, `PUBLIC_BASE_URL`); service name `upmovies-backend` and the FQDN var `SERVICE_FQDN_UPMOVIESBACKEND_8000` are consistent across tasks. ✓
