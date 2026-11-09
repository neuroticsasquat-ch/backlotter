**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m01-branding-domain.md

# BackLotter wordmark + site title / OG `site_name` (NEU-392) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **TDD** ticket — write/adjust the failing assertion first, watch it go red, then change the implementation to green.

> **Scope update (2026-06-26):** Originally scoped to the *public* surface only. During PR #15 review the authenticated app shell was found still reading "Upcoming Movies", so the rename was extended to cover **both** the public and authenticated surfaces, with the brand name centralized in a single **exported** `SITE_NAME` constant. This plan reflects the delivered (public + authed) scope.

**Goal:** Present **every** user-facing surface as **BackLotter** — public and authenticated. Put the **BackLotter** text wordmark in the public header brand slot and the authenticated app-shell header, add a minimal **© BackLotter** footer to the public shell, rename the signed-in landing / login / signup brand strings, and flip the shipped SEO helper's `SITE_NAME` to "BackLotter" so every public page's `<title>` template, `og:site_name`, `og:title`, and `twitter:title` carry the new brand. The brand name is centralized in the exported `SITE_NAME` and referenced by both shells and the auth pages. Text wordmark only — no logo art. SSR-safe.

**Architecture:** Presentation/brand-string edits across both shells, no new mechanism (the SEO/branding plumbing was fully shipped by NEU-307/310/312). The brand string is centralized once in an **exported** `SITE_NAME` (`src/lib/seo.ts`) and referenced everywhere:

1. **Header wordmark** — `src/routes/public-layout.tsx` already renders the brand as a hardcoded `<Link to="/">Upcoming Movies Tracker</Link>`. Swap the text to **BackLotter**; keep `to="/"` and the existing `font-semibold` styling.
2. **Footer** — add a `<footer>` to the same shell, after `<Outlet />`, rendering **© {year} BackLotter** (text wordmark) inside the same `mx-auto max-w-4xl p-4` container idiom the header uses. This is the first footer on the surface; keep links truly minimal (see Decisions).
3. **Brand in head** — set `SITE_NAME = "BackLotter"` in `src/lib/seo.ts` and **export** it. That single constant flows through `buildMeta()` to the `<title>` template (`"<page> · BackLotter"`, or the bare site name where a page has no title), `og:site_name`, `og:title`, and `twitter:title` for **both** public routes (`feed.tsx`, `film.tsx`) automatically — no per-route change.
4. **Authenticated shell + auth pages** — point the signed-in surfaces at the same exported `SITE_NAME`: the app-shell header wordmark (`src/components/AppLayout.tsx`), the signed-in landing heading (`src/pages/Home.tsx`), and the login/signup headings + the Signup invite-only copy (`src/pages/Login.tsx`, `src/pages/Signup.tsx`). Brand string only — no layout/logic change.

Plus the test + doc surface that pins the old literal: the SEO unit tests, the two route `meta` tests, the public-layout test, and `.env.example` (which documents the prod canonical origin and the BE↔FE coupling).

**Tech Stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — all driven through `task` in the container.

**Design of record:** `docs/specs/2026-06-25-mvp-launch-polish-m01-branding-domain.md` (M1 — Branding & domain), §"NEU-392 — wordmark + footer + brand in head". Pattern precedent: the merged NEU-312 feed landing (`src/routes/public-layout.tsx` + `public-layout.test.tsx`, the brand header) and NEU-307 SEO primitives (`src/lib/seo.ts` + `seo.test.ts`, `buildMeta`/`SITE_NAME`).

This ticket has **no blockers** — it stands alone (NEU-393 is the sibling backend config change; the two share a milestone, not a dependency).

---

## Working agreements (read first)

- **All commands run in the container via `task`.** Never run `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the container up (`task up`). Scope tests with `task test -- <path>`.
- **Commits:** Do **NOT** commit per task. NEU-392 ships as **one frontend PR**; the user commits once at the end. If executing via subagents, strip any commit step from implementer prompts.
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`). For a brand rename, the red signal is the existing literal-`SITE_NAME` assertions: update each pinned assertion to the **BackLotter** value first, confirm it fails against the un-flipped source, then change the source to green.
- **ESLint runs at zero warnings — unused imports/vars fail the build.** Import only what you use.
- **Format only what you touch** (`task format`). `AuthContext.*` has pre-existing Prettier drift on `main` — don't reformat unrelated files.
- **SSR / hydration safety.** The footer renders on the server (Workers) and hydrates on the client. Derive the copyright year **deterministically** so server and client agree regardless of the viewer's timezone (e.g. `new Date().getUTCFullYear()`); the repo's house rule is UTC for all date output. No `Date.now()`, no relative dates, no locale-dependent strings.
- **Don't regress shipped SEO/SSR.** Only the brand *string* changes — preserve the title-template shape (`"<page> · <brand>"`), the full OG/Twitter/canonical descriptor set, `og:type` per route, the film-page `noindex`-on-404, and the canonical/`og:url` derivation from `VITE_PUBLIC_SITE_URL`. Keep dev defaults (`app.upmovies.localhost`, `localhost:5173`) intact.

## Decisions / resilience notes

- **One brand string, one source of truth.** `SITE_NAME` is **exported** from `src/lib/seo.ts` and referenced by every brand render site — `buildMeta()` (head), both shell headers, the public footer, and the auth-page headings/copy. (This was originally left as "optional polish"; PR #15 review showed the un-centralized literal is exactly what let the authenticated shell drift, so the shared constant is now required.)
- **Footer links stay minimal.** M1 ships no new pages (feed `/` and `film/:slug` are the only public routes); richer nav (About/Privacy/etc.) is **M3 — Navigation & site structure**. So the footer is the **© {year} BackLotter** wordmark plus *at most* a home link to an existing destination — do **not** invent routes that don't exist yet (no dead links). Render the footer wordmark as plain text (not a second `BackLotter` link) so the header brand stays the only `BackLotter` link in the tree — this keeps the test queries unambiguous.
- **`DEFAULT_DESCRIPTION` review.** Per the spec, scan `src/lib/seo.ts`'s `DEFAULT_DESCRIPTION` for any old-brand wording. It currently names no brand ("Track upcoming movies: …"), so leave it unchanged — but if implementit finds brand wording, update the *copy* only (no mechanism change). Also update the `SITE_NAME` docstring comment in `seo.ts` that still reads "… · Upcoming Movies Tracker" for consistency (no test pins the comment).
- **Disambiguate header vs footer in tests.** `<header>` has implicit role `banner`; `<footer>` has implicit role `contentinfo`. Assert the brand link inside the banner and the copyright inside the contentinfo region so the duplicated "BackLotter" text doesn't make queries ambiguous.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/seo.ts` | modify | **Export** `SITE_NAME` (= `"BackLotter"`); update the docstring comment to match. |
| `src/lib/seo.test.ts` | modify | Repoint the four literal site-name assertions to `BackLotter`. |
| `src/routes/feed.tsx` | review | No change expected — title comes from `SITE_NAME`. Confirm only. |
| `src/routes/feed.test.tsx` | modify | `meta` test's templated-title pin → `"Latest Updates · BackLotter"`. |
| `src/routes/film.test.tsx` | modify | `meta` test's templated-title pin → `"The Odyssey (2026) · BackLotter"`. |
| `src/routes/public-layout.tsx` | modify | Header + footer use `{SITE_NAME}`; add a `<footer>` with **© {year} {SITE_NAME}** styled as chrome (`border-t text-sm text-muted-foreground`); comment the UTC year. |
| `src/routes/public-layout.test.tsx` | modify | Brand-link matcher → `/backlotter/i`; add a footer assertion (copyright + wordmark in `contentinfo`). |
| `src/components/AppLayout.tsx` | modify | Authed header wordmark → `{SITE_NAME}`. |
| `src/pages/Home.tsx` | modify | Signed-in landing heading → `{SITE_NAME}`. |
| `src/pages/Login.tsx` | modify | Heading → `Log in to {SITE_NAME}`. |
| `src/pages/Signup.tsx` | modify | Heading → `Create your {SITE_NAME} account`; invite copy → `{SITE_NAME} is invite-only during beta.`. |
| `src/components/AppLayout.test.tsx` | modify | Add a banner brand-link assertion (`/backlotter/i`). |
| `src/pages/Login.test.tsx` | modify | Add a heading assertion (`/log in to backlotter/i`). |
| `src/pages/Signup.test.tsx` | modify | Add heading + invite-copy assertions. |
| `src/pages/Home.test.tsx` | **add** | New test: signed-in heading renders `/backlotter/i`. |
| `.env.example` | modify | Document the prod canonical origin (`VITE_PUBLIC_SITE_URL=https://backlotter.com`) and the BE↔FE "must match" coupling, as a comment; leave the dev default value. |

One new test file (`src/pages/Home.test.tsx`); no new env vars, no new runtime dependencies, no backend changes.

---

## Task 1: Brand in head — `SITE_NAME` → "BackLotter"

**Files:** `src/lib/seo.ts`, `src/lib/seo.test.ts`, `src/routes/feed.test.tsx`, `src/routes/film.test.tsx`

- [ ] **Step 1 — Red:** In `src/lib/seo.test.ts`, change every assertion that pins the literal `Upcoming Movies Tracker` (the templated title, `og:title`, `og:site_name`, and the bare-site-name fallback) to `BackLotter`. In `src/routes/feed.test.tsx`, change the `meta` test's title pin to `"Latest Updates · BackLotter"`. In `src/routes/film.test.tsx`, change the `meta` test's title pin to `"The Odyssey (2026) · BackLotter"`. Run `task test -- src/lib/seo.test.ts src/routes/feed.test.tsx src/routes/film.test.tsx` and confirm they **fail** (source still emits the old name).
- [ ] **Step 2 — Green:** In `src/lib/seo.ts`, set `SITE_NAME = "BackLotter"` and update the `title` docstring comment to read `"<title> · BackLotter"`. Re-run the scoped tests — green.
- [ ] **Step 3 — Guard `buildMeta` invariants:** Confirm the SEO test still asserts the full descriptor shape (description present, canonical `link`, `og:type`, twitter card) — only the brand string changed; nothing structural should move.

## Task 2: Public shell — header wordmark + footer

**Files:** `src/routes/public-layout.tsx`, `src/routes/public-layout.test.tsx`

- [ ] **Step 1 — Red:** In `src/routes/public-layout.test.tsx`, change the brand-link matcher to `/backlotter/i` (still `href="/"`, scoped to the `banner` region) and add a new assertion that a `contentinfo` footer renders the copyright + **BackLotter** (e.g. a `/©\s*\d{4}\s*BackLotter/` text match within `getByRole("contentinfo")`). Run `task test -- src/routes/public-layout.test.tsx` — fails (no footer, old brand).
- [ ] **Step 2 — Green:** In `src/routes/public-layout.tsx`, import the exported `SITE_NAME` and use it for the header link (keep `to="/"`, keep `font-semibold`) and add a `<footer>` after `<Outlet />` rendering **© {year} {SITE_NAME}** inside the same `mx-auto max-w-4xl p-4` container. Style the footer as chrome so it separates from page content: `border-t text-sm text-muted-foreground` (mirrors the header's `border-b`). Derive `year` deterministically (`new Date().getUTCFullYear()`) and add a one-line comment explaining the UTC choice (hydration safety) so it isn't "fixed" to `getFullYear()` later. Keep links minimal per Decisions (no invented routes). Re-run — green.
- [ ] **Step 3 — SSR sanity:** Verify the footer uses no client-only API and no locale/timezone-dependent output (year is UTC-derived), so server render and hydration match.

## Task 3: Document the prod canonical origin + coupling

**Files:** `.env.example`

- [ ] **Step 1:** Add a comment near `VITE_PUBLIC_SITE_URL` noting the production value is `https://backlotter.com` and that it **must match** the backend `PUBLIC_BASE_URL` (the sitemap proxy lists URLs sourced from the backend origin). Leave the dev default value (`https://app.upmovies.localhost`) unchanged — backlotter.com is set at Cloudflare build time (ops). Doc-only; no test.

## Task 4: Authenticated shell + auth pages — reference `SITE_NAME`

**Files:** `src/components/AppLayout.tsx`, `src/pages/Home.tsx`, `src/pages/Login.tsx`, `src/pages/Signup.tsx` (+ tests `AppLayout.test.tsx`, `Login.test.tsx`, `Signup.test.tsx`, new `Home.test.tsx`)

- [ ] **Step 1 — Red:** Add a brand assertion to each authed surface's test pinning **BackLotter**: the `AppLayout` header link (scoped to the `banner`), the `Login` heading (`/log in to backlotter/i`), the `Signup` heading + invite copy (`/create your backlotter account/i`, `/backlotter is invite-only/i`), and a new `Home.test.tsx` asserting the signed-in heading (`/backlotter/i`). Run the scoped tests — fail (sources still read "Upcoming Movies").
- [ ] **Step 2 — Green:** Import the exported `SITE_NAME` into each file and reference it — `AppLayout` header wordmark `{SITE_NAME}`, `Home` `<h1>{SITE_NAME}</h1>`, `Login` `Log in to {SITE_NAME}`, `Signup` `Create your {SITE_NAME} account` + `{SITE_NAME} is invite-only during beta.`. Re-run — green.

---

## Acceptance criteria (this ticket's slice of M1)

1. **Header & footer brand.** The public shell renders **BackLotter** as the header brand link (still `→ /`) and a **© {year} BackLotter** footer. `public-layout.test.tsx` asserts both (banner brand link + contentinfo copyright). *(Realizes M1 AC #1.)*
2. **Brand in head.** For both public routes, `buildMeta` output yields `<title>` ending in `· BackLotter` (and the bare site name where a page has no title), `og:site_name` = `BackLotter`, and brand-carrying `og:title`/`twitter:title`. `seo.test.ts` + the two route `meta` tests are green on the new literals. *(Realizes M1 AC #2.)*
3. **Canonical derivation intact.** Canonical + `og:url` still derive from `VITE_PUBLIC_SITE_URL` — unchanged code path. `.env.example` documents the prod value and the BE↔FE coupling. *(Realizes M1 AC #3 & #6, FE side.)*
4. **No regressions.** Title-template shape, OG/Twitter/canonical descriptor set, `og:type` per route, and the film-page 404 `noindex` are unchanged. Dev defaults intact. *(M1 AC #5/#7.)*
5. **Text wordmark only.** No SVG/raster logo, no favicon change. *(Spec cross-cutting constraint.)*
6. **Authenticated surfaces branded.** The signed-in app-shell header, the Home landing heading, and the Login/Signup headings + Signup invite copy all render **BackLotter**, sourced from the exported `SITE_NAME`. `AppLayout.test.tsx`, `Login.test.tsx`, `Signup.test.tsx`, and the new `Home.test.tsx` assert this. *(Extends M1 AC #1 to the authenticated surface.)*

## TDD testing intent (what to write first, what it asserts)

- **`seo.test.ts`** (head, source of truth): the four literal pins assert the templated title, `og:title`, `og:site_name`, and bare-site-name fallback all read **BackLotter** — failing first, then green when `SITE_NAME` flips. These prove the single constant propagates to every brand-carrying head tag.
- **`feed.test.tsx` / `film.test.tsx`** (`meta` exports): assert the per-route templated `<title>` (`"Latest Updates · BackLotter"`, `"The Odyssey (2026) · BackLotter"`) — proves both shipped public routes inherit the brand with zero per-route edits.
- **`public-layout.test.tsx`** (shell): assert (a) the header `banner` contains a `BackLotter` link to `/`, and (b) a `contentinfo` footer renders the **© {year} BackLotter** copyright. Scoping by ARIA landmark keeps the duplicated brand text unambiguous.
- **`AppLayout.test.tsx` / `Login.test.tsx` / `Signup.test.tsx` / `Home.test.tsx`** (authed surfaces): assert each signed-in brand string reads **BackLotter** — the app-shell header link, the login/signup headings + invite copy, and the home heading — so the authenticated shell can't silently drift from the public brand again.

## Final verification (before handing off to commit)

- [ ] `task format` (only the touched files)
- [ ] `task lint` — clean (ESLint at zero warnings)
- [ ] `task typecheck` — clean (`react-router typegen` + `tsc -b`)
- [ ] `task test` — full suite green (no new flakes; existing SEO/route/layout tests pass)
- [ ] Hand off: the user commits once (e.g. `feat: rebrand site wordmark and meta to BackLotter (NEU-392)`; keep the `🤖 Generated with Claude Code` footer in the PR body, no `Co-Authored-By`) and opens the single frontend PR.

## Self-Review

- **Spec coverage:** Realizes the M1 spec's "NEU-392 — wordmark + footer + brand in head" and extends it to the authenticated shell: public header wordmark, first footer, exported `SITE_NAME` flip referenced across both shells + auth pages, and the test/doc updates. Backend domain wiring (NEU-393) and the URL-building path are explicitly untouched.
- **Resilience:** No exact line numbers pinned — edits reference files + symbols (`SITE_NAME`, the `meta` exports, the brand `<Link>`) so they survive drift; implementit fills precise locations.
- **Single source of truth:** Brand name centralized in the **exported** `SITE_NAME` and referenced by every render site (head, both shell headers, public footer, auth-page copy) — no literals, so future rebrands are a one-line change.
- **Scope guard:** No logo art, no favicon, no new config surface, no new routes/links beyond existing destinations (footer nav deferred to M3); dev defaults and the canonical derivation path are preserved.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
