# Branding & domain (BackLotter) — Milestone Design (MVP Launch Polish · M1)

- **Date:** 2026-06-25
- **Status:** Approved (ready for per-ticket implementation plans)
- **Project / milestone:** *Movies: MVP Launch Polish* · **M1 — Branding & domain (BackLotter)** (ships first)
- **Product:** **BackLotter** — upcoming-movies tracker (backlotter.com)
- **Components:**
  - `upcoming-movies-frontend` — public + authenticated shells + SEO helper (NEU-392)
  - `upcoming-movies-backend` — public sitemap base URL (NEU-393)
- **Stories & tickets:**
  - Story **NEU-385** "The site presents as BackLotter on backlotter.com"
    - **NEU-392** `[frontend]` BackLotter text wordmark across the public shell (header + footer) **and** the authenticated app shell + auth pages (login / signup / home), plus `<title>` template / OpenGraph `site_name` = "BackLotter" — all sourced from a single exported `SITE_NAME`.
    - **NEU-393** `[backend]` Point the canonical domain (`PUBLIC_BASE_URL`) at `https://backlotter.com`; sitemap / canonical-feeding URLs derive from it. No new schema.
- **Builds on (shipped):** NEU-307 SEO primitives (`src/lib/seo.ts` `buildMeta`, robots/sitemap resource routes), NEU-309 backend public film API + `GET /sitemap.xml`, NEU-310/312 SSR film + feed pages, NEU-306 SSR foundation.

## Purpose / scope

Establish the **BackLotter** brand and the **backlotter.com** canonical origin across the
public surface, with **no behavioral or schema change** to the pipeline or the rendered pages
beyond brand strings and the canonical origin. Concretely, after this milestone:

- The public shell shows a **BackLotter text wordmark** in the header brand slot and a
  **© BackLotter** footer (text only — no designed logo art).
- Every public page's `<title>`, `og:site_name`, and Twitter title carry **"BackLotter"** (via
  the already-shipped `buildMeta` helper — no new meta mechanism).
- Canonical links / `og:url`, the sitemap's `<loc>` URLs, and the robots `Sitemap:` directive all
  resolve to **`https://backlotter.com`** in production, sourced from the existing per-environment
  base-URL config (no new config surface).

This is a **design spec**: it fixes the files, helpers, and the single-source discipline for each
ticket. Exact signatures and test lists land in the per-ticket implementation plans.

DNS, TLS, the Cloudflare custom-domain binding, and setting the production environment variables
themselves are **deploy/ops, OUTSIDE this project** (see Out of scope). This milestone makes the
**code and committed config** ready for that cutover.

## Architecture & approach

### What already exists (the seams we plug into)

Branding and the canonical origin are already *fully mechanized* by NEU-307/309 — there is no new
plumbing to build, only values and presentation to set:

- **Brand name → head.** `src/lib/seo.ts` holds `SITE_NAME = "Upcoming Movies Tracker"`
  (`seo.ts:4`) and `buildMeta()` templates every page title as `"<title> · <SITE_NAME>"`
  (`seo.ts:23`) and emits `og:site_name` = `SITE_NAME` (`seo.ts:31`), plus `og:title`/
  `twitter:title` off the same templated string. Both public routes already call it:
  `src/routes/feed.tsx:16` and `src/routes/film.tsx:36`.
- **Brand name → visible shell.** `src/routes/public-layout.tsx` is the SSR public shell; the
  header brand slot is a hardcoded `<Link to="/">Upcoming Movies Tracker</Link>`
  (`public-layout.tsx:9-11`). There is **no footer** today. Its test
  (`public-layout.test.tsx:17`) asserts the brand link by the text `/upcoming movies tracker/i`.
- **Canonical / og:url → domain.** `buildMeta` builds canonical + `og:url` as
  `new URL(pathname, env.publicSiteUrl)` (`seo.ts:25`), where
  `env.publicSiteUrl = VITE_PUBLIC_SITE_URL ?? "https://app.upmovies.localhost"`
  (`src/env.ts:3`). This is **build-time** (a framework-mode `meta()` cannot read Worker runtime
  env) — so the production canonical origin is a Cloudflare build var, documented in
  `.env.example` (`VITE_PUBLIC_SITE_URL=…`).
- **robots `Sitemap:` → host.** `src/routes/robots.ts:4` derives the `Sitemap:` line from the
  request origin (`new URL(request.url).origin`), so it follows whatever host serves it — no env.
- **sitemap `<loc>` → domain.** The FE `/sitemap.xml` (`src/routes/sitemap.ts`) is a pure
  pass-through proxy of the backend's sitemap; it adds no URLs. The backend is the single sitemap
  generator: `routers/public.py:55-62` calls `render_sitemap(settings.public_base_url, films)`
  (`src/upmovies/public/sitemap.py:6`), which emits `{base}/` and `{base}/film/{slug}` `<loc>`s.
  `settings.public_base_url` is `PUBLIC_BASE_URL` (`src/upmovies/config.py:63`, default
  `http://localhost:5173`) — the **only** backend consumer of that setting.

### NEU-392 `[frontend]` — wordmark + footer + brand in head (public + authenticated)

> **Scope note (2026-06-26):** extended during PR #15 review to cover the authenticated app shell + auth pages, with the brand centralized in an exported `SITE_NAME`. Items 1–4 are the original public scope; item 5 covers the authenticated surfaces.

Presentation/brand-string edits, no new mechanism:

1. **Header wordmark** — swap the brand text in `public-layout.tsx:10` to **BackLotter** (text
   wordmark; styling is the existing `font-semibold` link, logo art deferred). Keep `to="/"`.
2. **Footer** — add a `<footer>` to the public shell (`public-layout.tsx`) after `<Outlet/>`
   rendering **© BackLotter** (with the current year). This is the first footer on the surface;
   keep it minimal and inside the same `max-w-*` container idiom the header uses.
3. **Brand in head** — set `SITE_NAME = "BackLotter"` in `seo.ts:4` and **export** it. This single
   constant flows to the `<title>` template, `og:site_name`, `og:title`, and `twitter:title` for
   **both** public routes automatically (no per-route change). Review `DEFAULT_DESCRIPTION`
   (`seo.ts:5`) for any old-brand wording and update copy if needed — but keep it a brand/copy
   change only.
4. **Tests** — update `public-layout.test.tsx` (the brand-name matcher) and any `seo` unit
   assertion that pins the literal site name; add a footer assertion. No new test infrastructure.
5. **Authenticated shell + auth pages** — point `AppLayout.tsx` (header wordmark), `Home.tsx`
   (landing heading), and `Login.tsx` / `Signup.tsx` (headings + Signup invite copy) at the exported
   `SITE_NAME`. Pin each with a brand assertion (`AppLayout.test.tsx`, `Login.test.tsx`,
   `Signup.test.tsx`, new `Home.test.tsx`). Also style the public footer as chrome (`border-t` +
   muted text) and comment the UTC year. Brand strings only — no layout/logic change.

The production canonical **origin** (`VITE_PUBLIC_SITE_URL = https://backlotter.com`) is set at
Cloudflare build time (ops); this ticket's job for the URL is only to confirm the derivation is
already env-driven (it is — `seo.ts:25`) and that `.env.example` documents the var. No code change
to the URL-building path.

### NEU-393 `[backend]` — canonical domain via `PUBLIC_BASE_URL`

The backend already derives the sitemap from `PUBLIC_BASE_URL`; the gap is purely **config
wiring**, not application code:

1. **Thread the var into prod.** `docker-compose.prod.yml`'s `environment:` block does **not**
   currently pass `PUBLIC_BASE_URL` (it threads `DATABASE_URL`, `ADMIN_TOKEN`, `TMDB_API_KEY`,
   `CORS_ALLOWED_ORIGINS`, `COOKIE_DOMAIN`, …, but not this one). Add
   `PUBLIC_BASE_URL: "${PUBLIC_BASE_URL}"` so ops can set it to `https://backlotter.com` for the
   deployed sitemap. Without this, prod silently falls back to the `http://localhost:5173` default.
2. **Keep the dev default.** Leave `config.py:63`'s default (`http://localhost:5173`) and the test
   expectations as-is — the production value comes from env, not the code default. (The sitemap
   integration test `tests/integration/routers/test_public_sitemap.py:18-19` asserts the
   `localhost:5173` default; changing the default would needlessly break it.)
3. **No schema, no new endpoint, no new code path.** `render_sitemap` already `rstrip("/")`s the
   base and builds absolute `<loc>`s, so `https://backlotter.com` flows through unchanged.

### How the two tickets fit together — the domain single-source discipline

The brand **name** has one source of truth in code: the **exported** `SITE_NAME` in `src/lib/seo.ts`,
referenced by `buildMeta()` (head), both shell headers, the public footer, and the auth-page copy.
(Originally the shared constant was called optional polish; PR #15 review showed an un-centralized
literal is what let the authenticated shell drift, so exporting + reusing it is now the standard.)

The canonical **domain string** is, by the shipped architecture, **two per-environment config
values that must be set to the same origin** — there is intentionally no single runtime constant
spanning both repos (the FE `meta()` runs at build time on Workers; the BE renders the sitemap at
request time on the API origin):

| Surface | Source of the origin | Owner |
|---|---|---|
| FE canonical + `og:url` | `VITE_PUBLIC_SITE_URL` (build-time, `env.ts:3` → `seo.ts:25`) | ops sets prod value; FE confirms derivation |
| FE robots `Sitemap:` line | FE request origin (no env) | follows the Cloudflare custom domain |
| FE `/sitemap.xml` host | FE request origin (proxy) | follows the Cloudflare custom domain |
| BE sitemap `<loc>` URLs | `PUBLIC_BASE_URL` (runtime, `config.py:63` → `sitemap.py`) | NEU-393 threads var; ops sets prod value |

**Invariant (already flagged in NEU-307 §Risks):** in every environment, BE `PUBLIC_BASE_URL`
must equal the FE public origin (`VITE_PUBLIC_SITE_URL` / the Cloudflare custom domain). If they
diverge, the proxied sitemap lists URLs on a different host than serves it. This milestone makes
**`https://backlotter.com`** that shared production value and documents the coupling at both ends
(prod compose env on the backend; `.env.example` note on the frontend). Enforcing/asserting the
match in deploy config is an ops concern.

## Cross-cutting decisions & constraints

- **Text wordmark only.** "BackLotter" rendered as styled text in the header and footer. No SVG/
  raster logo, no favicon redesign — designed logo art is explicitly deferred to a later milestone.
- **Reuse the shipped SEO helper.** All head/brand/OG changes go through `buildMeta` and its
  `SITE_NAME` constant. Do **not** add a parallel meta path, a root-level `<title>`, or duplicate
  OG tags in `root.tsx` (whose `Layout` already owns only `charset`/`viewport`/`favicon`).
- **No new config surface.** Use the existing `VITE_PUBLIC_SITE_URL` (FE) and `PUBLIC_BASE_URL`
  (BE). The only config change is threading `PUBLIC_BASE_URL` into `docker-compose.prod.yml`.
- **DNS / deploy cutover is out of scope.** Registrar, DNS records, TLS, the Cloudflare Workers
  custom-domain binding, and setting the production env vars to `https://backlotter.com` are ops,
  handled outside this project. This milestone delivers code + committed config readiness only.
- **Don't regress shipped SEO / SSR.** Preserve everything NEU-307/310/312 ship: the title-template
  shape (`"<page> · <brand>"`), the full OG/Twitter/canonical descriptor set, `og:type` per route
  (`website` feed / `article` film), per-film poster `og:image`, the film-page `noindex` on 404,
  the robots disallow list, and the sitemap inclusion rule (summarized films only). Brand/domain
  strings change; structure does not. Keep dev defaults (`app.upmovies.localhost`,
  `localhost:5173`) intact so local dev and the existing test suite stay green.
- **No backend schema or pipeline change.** NEU-393 is config + (optionally) a sitemap test that
  asserts derivation from an overridden base; nothing touches models, migrations, or services.

## Milestone acceptance criteria

1. **Header & footer brand.** The public shell renders **BackLotter** as the header brand link
   (still `→ /`) and a **© BackLotter** footer (current year); the authenticated app shell + auth
   pages (header wordmark, signed-in home, login / signup) render **BackLotter** too — all sourced
   from the exported `SITE_NAME`. `public-layout.test.tsx`, `AppLayout.test.tsx`, `Login.test.tsx`,
   `Signup.test.tsx`, and `Home.test.tsx` assert these. (NEU-392)
2. **Brand in head.** For both public routes, `buildMeta` output yields `<title>` ending in
   `· BackLotter` (and the site name alone where no page title), `og:site_name` = `BackLotter`, and
   brand-carrying `og:title`/`twitter:title`. SEO unit tests updated and green. (NEU-392)
3. **Canonical origin derivation intact.** Canonical + `og:url` continue to derive from
   `VITE_PUBLIC_SITE_URL`; with that var set to `https://backlotter.com`, the emitted canonical/
   `og:url` for `/` and `/film/{slug}` are `https://backlotter.com/…`. `.env.example` documents the
   prod value. (NEU-392)
4. **Backend sitemap on backlotter.com.** `docker-compose.prod.yml` threads `PUBLIC_BASE_URL`; with
   it set to `https://backlotter.com`, `GET /sitemap.xml` emits `<loc>https://backlotter.com/</loc>`
   and `https://backlotter.com/film/{slug}` entries. No schema change. (NEU-393)
5. **robots + same-origin sitemap unaffected.** `/robots.txt`'s `Sitemap:` line and the FE
   `/sitemap.xml` proxy still resolve same-origin (will be backlotter.com once the custom domain is
   bound — an ops step). No code change required; confirmed not regressed. (NEU-392/393)
6. **Coupling documented.** The BE-`PUBLIC_BASE_URL` ↔ FE-`VITE_PUBLIC_SITE_URL` "must match"
   invariant is noted at both ends (prod compose / `.env.example`).
7. **Gates green.** FE `task test` / `task lint` (zero warnings) / `task typecheck`; BE `task test`
   / `task lint` / `task typecheck`. No new flakes; existing sitemap/SEO tests still pass.

## Explicit out-of-scope

| Out of scope | Why / where it lives |
|---|---|
| DNS records, registrar, TLS certs, Cloudflare custom-domain binding | Deploy/ops, outside this project |
| Setting production env values (`VITE_PUBLIC_SITE_URL`, `PUBLIC_BASE_URL`, `API_BASE_URL`, `CORS_ALLOWED_ORIGINS`) to backlotter.com | Ops/deploy; this milestone only makes code + committed config ready |
| Changing dev/local defaults off `app.upmovies.localhost` / `localhost:5173` | Keep dev + test suite green; backlotter.com is a prod env value |
| Designed logo art, favicon/app-icon redesign, brand color system, OG default image asset | Text wordmark only; deferred to a later polish milestone |
| Email/transactional or admin-app branding | This milestone is the public SSR surface only |
| Redirects from any old origin to backlotter.com | Ops/edge config, not app code |
| Backend schema, migrations, pipeline, or rendered-page content changes | Strictly brand strings + canonical origin config |
| Asserting the BE↔FE origin match in deploy automation | Documented as an ops invariant; enforcement is an ops concern |

## Notes / risks

- **Prod compose gap is the real work on the backend.** The sitemap already derives from
  `PUBLIC_BASE_URL`; the substantive change is that `docker-compose.prod.yml` never passed it
  through. Easy to miss because dev/tests use the default and "look" correct.
- **Two values, one origin.** The most likely failure mode is setting only one of
  `PUBLIC_BASE_URL` / `VITE_PUBLIC_SITE_URL` to backlotter.com. The documented invariant (and a
  deploy checklist line) guards against the proxied sitemap listing cross-host URLs.
- **Build-time vs runtime asymmetry is intentional.** FE canonical is build-time (Workers `meta()`
  can't read runtime env); BE sitemap is runtime. Do not "fix" this into a single shared runtime
  constant — it would require root-loader plumbing NEU-307 explicitly considered and rejected.

## Sources (grounding)

- FE shell — `upcoming-movies-frontend/src/routes/public-layout.tsx` (+ `public-layout.test.tsx`)
- FE SEO helper — `upcoming-movies-frontend/src/lib/seo.ts`, `src/env.ts`
- FE public routes — `src/routes/feed.tsx`, `src/routes/film.tsx`, `src/routes/robots.ts`,
  `src/routes/sitemap.ts`; doc shell `src/root.tsx`; `.env.example`, `wrangler.jsonc`
- BE sitemap — `upcoming-movies-backend/src/upmovies/routers/public.py`,
  `src/upmovies/public/sitemap.py`, `src/upmovies/config.py` (`PUBLIC_BASE_URL`),
  `docker-compose.prod.yml`, `tests/integration/routers/test_public_sitemap.py`
- Prior design — [2026-06-23-neu-307-seo-primitives-design.md](2026-06-23-neu-307-seo-primitives-design.md)
  (brand/site-name decision, canonical-URL source, BE↔FE origin coupling risk)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
