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
Until the docs PR (NEU-2260) folds them in, the frontend keeps its own guides —
**read `frontend/AGENTS.md` and `frontend/CLAUDE.md` before touching `frontend/`**, and read each
`task <x>` there as `task fe:<x>` here.

## Companion docs — read before working

- **`AGENTS.md`** — operating rules, production/deploy flow, gotchas. Authoritative on process.
- **`CONTEXT.md`** — the domain glossary. Terms there are *enforced in code* (e.g. `provenance` vs
  `news_backed`, "total stage failure" vs partial failure). When naming a concept in code, tests, or
  a PR, use the glossary's term and avoid the listed synonyms.
- **`docs/adr/`** — 25 ADRs covering retrieval, clustering, LLM routing, sweep, and feed grouping.
  Read the ones touching your area; flag explicitly if your change contradicts one.
- **`docs/specs/NEU-*.md`** — per-ticket specs (`specs_dir: docs`). Implementation work is spec-driven.

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
- The frontend is under `frontend/` (see *Monorepo layout*); read `frontend/AGENTS.md` before
  touching it.
