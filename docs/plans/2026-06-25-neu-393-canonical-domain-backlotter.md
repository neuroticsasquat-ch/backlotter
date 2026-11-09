**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m01-branding-domain.md

# Point Canonical Domain at backlotter.com — Backend (NEU-393) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This project uses **TDD** — write the failing test first, watch it fail, then make it pass. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `https://backlotter.com` the canonical public origin that the backend's `GET /sitemap.xml` emits in production, driven by the **already-shipped** `PUBLIC_BASE_URL` setting (NEU-309). The substantive work is **config wiring** — `docker-compose.prod.yml` never threaded `PUBLIC_BASE_URL` through to the container, so prod silently falls back to the `http://localhost:5173` dev default. No new schema, no new endpoint, no new application code path.

**Architecture:** The sitemap is already fully mechanized and derives entirely from one setting:

- `Settings.public_base_url` (`src/upmovies/config.py:63`, alias `PUBLIC_BASE_URL`, default `http://localhost:5173`) is the **only** backend consumer of that origin.
- `GET /sitemap.xml` (`src/upmovies/routers/public.py:56-63`) calls `render_sitemap(settings.public_base_url, films)`.
- `render_sitemap(base_url, films)` (`src/upmovies/public/sitemap.py`) `rstrip("/")`s the base and builds absolute `<loc>`s — `{base}/` (root) and `{base}/film/{slug}` per summarized film. Any origin, including `https://backlotter.com`, flows through unchanged.

So there is **no application logic to change** — only (1) thread the env var into the prod compose file and (2) prove, via tests, that an overridden base produces backlotter.com `<loc>`s. The production value itself (setting `PUBLIC_BASE_URL=https://backlotter.com` in the deploy environment) is **ops/deploy, out of scope** — this ticket delivers code + committed-config readiness.

**Tech Stack:** FastAPI, Python 3.13, async SQLAlchemy 2 + asyncpg, Pydantic v2 / pydantic-settings, pytest (pytest-asyncio `auto` mode). Tooling: ruff, pyright. **Everything runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python` on the host.

## What this realizes in M1

This is the **backend half** of Story **NEU-385** ("The site presents as BackLotter on backlotter.com") and directly delivers **milestone acceptance criterion #4** ("Backend sitemap on backlotter.com") plus the backend end of **#6** (the BE↔FE origin-coupling note). The frontend half (NEU-392) owns the canonical/`og:url`/wordmark/footer side. There is **no robots or canonical/`og:url` construction in the backend** — robots `Sitemap:` and canonical links live in the frontend (request-origin / build-time `VITE_PUBLIC_SITE_URL`), confirmed by grep: the only backend consumer of any public origin is the sitemap. So "canonical / OG / sitemap / robots all derive from `PUBLIC_BASE_URL`" reduces, on the backend, to **the sitemap**.

## Global Constraints

- **Repo:** `upcoming-movies-backend` (under the `~/projects/upcoming-movies/` umbrella). All paths below are relative to that repo root.
- **Branch:** one branch per ticket — use the exact branch name Linear provides for NEU-393 (e.g. `tom/neu-393-backend-point-canonical-domain-at-backlotter-com`).
- **Config + tests only:** do **not** touch models, migrations, services, DTOs, or `render_sitemap`'s logic. No new config surface — reuse the existing `PUBLIC_BASE_URL`.
- **Keep the dev default and existing assertions intact.** Leave `config.py:63`'s `http://localhost:5173` default unchanged; backlotter.com is a prod **env** value, not a code default. The existing integration test `tests/integration/routers/test_public_sitemap.py:18-19` pins the `localhost:5173` default and must **stay green** — do not edit it.
- **TDD:** every behavioral assertion below is written and seen failing before the change that satisfies it. Where the change is pure config (compose), the "test" is the derivation proof (an overridden base → backlotter.com `<loc>`s) plus a manual compose verification.
- **CI gates (run all locally before commit, via `task`):** `task test` (full suite green), `task lint` (`ruff check` clean), `task typecheck` (`pyright` clean). Run `task format` (ruff format) before committing. Keep the container up so the `task` targets can `docker compose exec` into it.
- **Commit style:** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-393.` in the body), **no** `Co-Authored-By`, **no** `🤖` footer in the commit (PR body only). Use `/commit-msg` + `/pr-desc`.

## File Structure

- **Modify** `docker-compose.prod.yml` — add `PUBLIC_BASE_URL` to the `environment:` block so ops can set the deployed origin; add a short comment documenting the BE↔FE origin-coupling invariant.
- **Add** `tests/unit/public/test_sitemap.py` — unit test proving `render_sitemap` emits backlotter.com `<loc>`s for an arbitrary base (the pure derivation proof; the dir already exists with `__init__.py`).
- **Modify** `tests/unit/test_config.py` — add a small assertion that `PUBLIC_BASE_URL` (env) overrides `Settings.public_base_url` and that the default is `http://localhost:5173` (matches the existing `_set_required` / `monkeypatch.setenv` idiom in that file).
- **(Recommended) Modify** `tests/integration/routers/test_public_sitemap.py` — add **one new** test that overrides the configured base to `https://backlotter.com` and asserts the served sitemap's `<loc>`s, end-to-end. Leave the existing default-asserting tests untouched.

No new fixtures or test infrastructure.

---

## Task 1: Prove backlotter.com derivation (TDD), then thread `PUBLIC_BASE_URL` into prod compose

**Files:**
- Add: `tests/unit/public/test_sitemap.py`
- Modify: `tests/unit/test_config.py`
- (Recommended) Modify: `tests/integration/routers/test_public_sitemap.py`
- Modify: `docker-compose.prod.yml`

**Intent (not exact signatures):**
- `render_sitemap(base_url, films)` is pure and already imported from `upmovies.public.sitemap`; `SitemapFilm(slug, lastmod)` comes from `upmovies.public.service`. The unit test constructs a base of `https://backlotter.com` and one or two `SitemapFilm`s and asserts the rendered XML contains `<loc>https://backlotter.com/</loc>` and `<loc>https://backlotter.com/film/{slug}</loc>` (parse with `xml.etree.ElementTree` + the sitemaps `0.9` namespace, mirroring the existing integration test, or assert on substrings). Include a trailing-slash base (`https://backlotter.com/`) case to lock in the `rstrip("/")` behavior so no `//` appears.
- The config assertion follows `test_config.py`'s pattern: with required env set, `monkeypatch.setenv("PUBLIC_BASE_URL", "https://backlotter.com")` → `Settings().public_base_url == "https://backlotter.com"`; with it deleted, the default is `http://localhost:5173`.
- The integration test reuses the existing `client` / `make_film` / `add_event` fixtures. Because the route calls the `@lru_cache`d `get_settings()` **directly** (not via `Depends`), the resilient override is to monkeypatch the name in the router module — `monkeypatch.setattr("upmovies.routers.public.get_settings", lambda: base_settings.model_copy(update={"public_base_url": "https://backlotter.com"}))` (build `base_settings` from the real `get_settings()` so all other required fields stay valid). Then `GET /sitemap.xml` and assert the `<loc>`s are on `https://backlotter.com`. (Avoid `get_settings.cache_clear()` + env juggling — the module-name monkeypatch is cleaner and self-contained. Restore is automatic via `monkeypatch`.)

- [ ] **Step 1: Write the failing/grounding tests first**
  - Add `tests/unit/public/test_sitemap.py` with the `render_sitemap` → backlotter.com assertions (root `<loc>`, film `<loc>`, and the trailing-slash-base no-`//` case).
  - Add the `PUBLIC_BASE_URL` override + default assertions to `tests/unit/test_config.py`.
  - (Recommended) Add the single overridden-base integration test to `tests/integration/routers/test_public_sitemap.py` (do not touch the existing tests).

- [ ] **Step 2: Run the new tests and confirm their state**
  - Run `task test -- tests/unit/public/test_sitemap.py tests/unit/test_config.py` (scope to a dir if the single-file async quirk bites — see CLAUDE.md gotcha; the whole suite always works).
  - Expected: the **config-override** and **render_sitemap** assertions already pass (the mechanism exists today — this is the derivation proof, not a red-then-green for app logic). The value of these tests is regression-locking the backlotter.com derivation and documenting intent. If any assertion fails, the test is wrong — fix the test, not `render_sitemap`/`config`.

- [ ] **Step 3: Thread `PUBLIC_BASE_URL` into `docker-compose.prod.yml`**
  - In the `environment:` block (which currently threads `DATABASE_URL`, `ADMIN_TOKEN`, `TMDB_API_KEY`, `CORS_ALLOWED_ORIGINS`, `COOKIE_DOMAIN`, … but **not** this one), add a `PUBLIC_BASE_URL` line so the deployed sitemap can be pointed at backlotter.com.
  - Match the prod-compose idiom (plain `"${VAR}"` interpolation, like the siblings): `PUBLIC_BASE_URL: "${PUBLIC_BASE_URL}"`.
  - **Footgun to flag in the PR / deploy checklist:** an *unset* `${PUBLIC_BASE_URL}` interpolates to an **empty string**, which would override the code default and make the sitemap emit relative/rootless `<loc>`s — worse than the localhost default. Two acceptable resiliency options; pick one and note it:
    - (a) Keep `"${PUBLIC_BASE_URL}"` (spec-literal, matches sibling vars) **and** add a deploy-checklist line that ops MUST set `PUBLIC_BASE_URL=https://backlotter.com`.
    - (b) Harden with a committed prod-appropriate fallback: `"${PUBLIC_BASE_URL:-https://backlotter.com}"` — still ops-overridable, but never silently empty. (This is the more resilient choice and consistent with "committed config ready for cutover"; it does **not** set a runtime prod value in any deploy `.env`, which remains ops.)
  - Add a one-line comment above it documenting the **invariant**: BE `PUBLIC_BASE_URL` must equal the FE public origin (`VITE_PUBLIC_SITE_URL` / the bound Cloudflare custom domain) — `https://backlotter.com` in prod — or the FE-proxied sitemap lists URLs on a different host than serves it. (This realizes the backend end of AC #6.)

- [ ] **Step 4: Verify the compose wiring without deploying**
  - Confirm the env var reaches the container config: e.g. `PUBLIC_BASE_URL=https://backlotter.com docker compose -f docker-compose.prod.yml config` and check the rendered `environment` shows `PUBLIC_BASE_URL: https://backlotter.com` (and, if option (b), that an unset var renders the fallback). This is a static `config` render — no build/deploy, no DNS. Do not actually stand up the prod stack.

- [ ] **Step 5: Run the full gate locally (all green before commit)**
  - `task format` (ruff format), then `task lint`, `task typecheck`, and `task test` (full suite — confirms the existing `localhost:5173` sitemap/config tests still pass and the new tests are green; no new flakes).

- [ ] **Step 6: Commit**
  - Stage `docker-compose.prod.yml`, `tests/unit/public/test_sitemap.py`, `tests/unit/test_config.py`, and (if added) `tests/integration/routers/test_public_sitemap.py`.
  - Conventional Commits subject, e.g. `chore(public): thread PUBLIC_BASE_URL into prod compose for backlotter.com sitemap` with `Refs NEU-393.` in the body. No footer, no `Co-Authored-By`.

---

## Acceptance Criteria

1. **Sitemap derives backlotter.com from `PUBLIC_BASE_URL`.** With `PUBLIC_BASE_URL=https://backlotter.com`, `GET /sitemap.xml` emits `<loc>https://backlotter.com/</loc>` and `<loc>https://backlotter.com/film/{slug}</loc>` for each summarized film, with no `//` artifacts. Proven by the new `render_sitemap` unit test (and the recommended overridden-base integration test). (Milestone AC #4)
2. **Prod compose threads the var.** `docker-compose.prod.yml`'s `environment:` block passes `PUBLIC_BASE_URL` through so ops can set it to `https://backlotter.com`; `docker compose config` confirms it. (Milestone AC #4)
3. **Coupling documented at the backend end.** A comment in `docker-compose.prod.yml` records that BE `PUBLIC_BASE_URL` must match the FE public origin (`VITE_PUBLIC_SITE_URL` / custom domain). (Milestone AC #6)
4. **No regression of shipped behavior.** The dev default (`http://localhost:5173`) and the existing `tests/integration/routers/test_public_sitemap.py` default assertions are unchanged and green; sitemap inclusion rule (summarized films only), `lastmod`, and `<loc>` shape are untouched. No schema, migration, endpoint, or service change. (Milestone AC #4, #7)
5. **Robots / same-origin sitemap unaffected.** Confirmed there is no robots or canonical/`og:url` construction in the backend (grep: sitemap is the sole public-origin consumer); those surfaces are the frontend's (NEU-392). No backend code change for them. (Milestone AC #5)
6. **Gates green.** `task test`, `task lint`, `task typecheck` all pass; `task format` applied. (Milestone AC #7)

## TDD Testing Intent

- **Unit (pure derivation):** `render_sitemap("https://backlotter.com", [SitemapFilm(...)])` → root + per-film `<loc>`s on backlotter.com; trailing-slash base normalizes (no `//`). This is the load-bearing proof that "given `PUBLIC_BASE_URL`, the sitemap emits backlotter.com" with zero settings/DB plumbing.
- **Unit (config):** `PUBLIC_BASE_URL` env overrides `Settings.public_base_url`; default stays `http://localhost:5173` (so prod value comes from env, not code).
- **Integration (end-to-end, recommended):** with the router's `get_settings` monkeypatched to a backlotter.com base, `GET /sitemap.xml` serves backlotter.com `<loc>`s — proving the wiring from setting → route → renderer. The existing default-asserting integration tests remain as the "dev/test stays green" guard.

## Explicit Out of Scope

| Out of scope | Why / where it lives |
|---|---|
| DNS records, registrar, TLS, Cloudflare custom-domain binding | Deploy/ops, outside this project |
| Setting the production `PUBLIC_BASE_URL` env value to `https://backlotter.com` in the deploy environment | Ops/deploy; this ticket only threads the var + makes committed config ready (a committed compose **fallback** is config-readiness, not a deploy env value) |
| Changing the dev/local default off `http://localhost:5173` | Keep local dev + existing test suite green |
| Frontend canonical / `og:url` / robots `Sitemap:` / wordmark / footer | NEU-392 (frontend half of NEU-385) |
| Backend schema, migrations, pipeline, services, or rendered-page content | Strictly config + tests |
| Asserting the BE↔FE origin match in deploy automation | Documented as an ops invariant; enforcement is an ops concern |

## Self-Review

**Spec coverage** (`../specs/2026-06-25-mvp-launch-polish-m01-branding-domain.md` §NEU-393):
- Thread `PUBLIC_BASE_URL` into prod compose (the real work) → Task 1 Step 3. ✅
- Keep `config.py:63` default + existing test expectations → constraints + Step 5; existing integration test left untouched. ✅
- No schema / endpoint / new code path; `render_sitemap` already handles arbitrary bases → derivation proven, not modified. ✅
- Backend end of the BE↔FE coupling note → Step 3 comment, AC #3. ✅
- Backend "robots/canonical all derive" clarified: backend's only public-origin consumer is the sitemap (grep-confirmed); robots/canonical are FE → AC #5. ✅

**Resilience check:** plan pins intent + file targets, not exact signatures; flags the empty-`${PUBLIC_BASE_URL}` footgun with two acceptable resolutions; uses the codebase's real fixtures (`client`/`make_film`/`add_event`), the real settings-override idiom (module-name monkeypatch, since `get_settings` is called directly, not via `Depends`), and the container `task` workflow. No host-run commands. ✅

🤖 Generated with [Claude Code](https://claude.com/claude-code)
