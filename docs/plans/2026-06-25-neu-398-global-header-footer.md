**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md

# NEU-398 `[frontend]` — Auth-aware global header + footer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. **This project uses TDD: write the failing test first, watch it fail, then implement.** Steps use checkbox (`- [ ]`) syntax for tracking. One ticket = one PR = one `/implementit` run; **do not commit per task** — the user commits the whole NEU-398 change once at the end.

**Goal:** Promote the bare `PublicLayout` brand header into a persistent, **auth-aware global header** (BackLotter wordmark + primary nav `Home / Browse / Search / Calendar` + an account area) and add a global **footer**, so every public route (`/`, `/film/:slug`, and the future `/browse`) inherits shared chrome with zero per-route wiring. Logged-in and anonymous visitors both keep landing on the public feed at `/` (no auth-split homepage — that is a deferred FUTURE project).

**Which part of M3 this realizes:** NEU-398 is the first of M3's two standalone `[frontend]` tickets (the second, NEU-399 `/browse`, is independent and lands separately). This ticket delivers §2.1 (chrome slotting into `PublicLayout`), §2.2 (the SSR-neutral + client-hydrated account island — *the central design question*), and §2.3 (the single `NAV_ITEMS` config with inert Search/Calendar seats). It does **not** touch `/browse`, the API, or the sitemap.

**Tech stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — **all driven through `task` inside the container** (never run `pnpm`/`vitest`/`eslint`/`tsc` on the host).

**Pattern precedent (read before coding):**
- `src/routes/spa-layout.tsx` — the module-level `QueryClient` + `AuthProvider` wrapping pattern the account island mirrors.
- `src/components/AppLayout.tsx` — the existing authed account/admin/logout UI (`useAuth().user`, `user.is_admin` → Admin link, `logout()` button) the account menu mirrors.
- `src/components/AuthContext.tsx` — `AuthProvider` + `useAuth()`; `user` is `null` until the `["me"]` query resolves (the queryFn does **not** run during SSR).
- `src/components/AppLayout.test.tsx` + `src/test/msw/me.ts` (`meHandler({ is_admin })`, `unauthMeHandler()`) — the auth-async test pattern (key assertions off the post-auth "Log out" control via `findBy*`).
- `src/routes/public-layout.test.tsx` — the current bare-wordmark test this ticket rewrites.

---

## Working agreements (read first)

- **Everything runs in the container via `task`.** Keep it up (`task up`). Scope tests with `task test -- <path>`. Gates: `task test`, `task lint` (eslint `--max-warnings 0` — **unused imports fail the build**), `task typecheck` (`react-router typegen` + `tsc -b`). Format only what you touch (`task format`); **don't** restage the pre-existing `AuthContext.*` Prettier drift on `main`.
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`). MSW runs `onUnhandledRequest: "error"` — add per-test handlers with `server.use(...)` from `@/test/msw/server`; the backend base in tests is `https://api.upmovies.localhost`. Auth resolves **asynchronously** via the `["me"]` query: assert post-auth content with `findBy*`, keyed off a control that only exists once a user is present (e.g. "Log out").
- **Determinism / hydration safety.** No `Date.now()`, no relative dates, no locale-dependent output in the render tree. The footer's `© {year}` must be a render-stable value (a fixed/server-stable year string — see Risks).
- **One PR.** If executing via subagents, strip any commit step from implementer prompts; the user commits once at the end off the ticket branch.
- **No backend changes, no new env vars, no new dependencies.** Everything reuses already-shipped modules (`AuthContext`, `@tanstack/react-query`).

---

## Architecture & approach

### Where the chrome slots in

`PublicLayout` becomes the single home of the global chrome — a `min-h-screen` flex column with the header above `<Outlet/>` and the footer below it, so the footer sits at the bottom and **every** public route inherits the chrome for free:

```
PublicLayout (min-h-screen flex column)
  <GlobalHeader/>   // wordmark (Link to "/") + <PrimaryNav/> + <HeaderAccount/>
  <Outlet/>         // the routed public page — provider-free body, UNCHANGED
  <GlobalFooter/>   // wordmark + static links + © {year} — fully server-rendered, no auth
```

The page body stays exactly as NEU-312 left it: **provider-free**, so feed/film/browse loaders never touch React Query or Auth and never fire `/me` during SSR.

### The SSR-vs-client-auth resolution (NEU-398's central question — honor the milestone constraint)

The public layout is deliberately provider-free precisely so SSR never fires `/me`. The server has no session context and crawlers don't run JS, so the header **cannot** know identity at SSR time. Resolution — **neutral SSR, hydrate only the account area on the client:**

- **Server renders a neutral, logged-out-default header.** Wordmark, primary nav, and the account area's **Login / Sign up** default are all emitted server-side. This is the identity-free HTML crawlers index.
- **The account area is a self-contained client island, `HeaderAccount`.** It mounts `QueryClientProvider` + `AuthProvider` **scoped to itself** — a stable **module-level** `QueryClient` (exactly the `spa-layout.tsx` pattern). Scoping the providers to the island (not the whole layout) keeps the page body provider-free and confines the one client `/me` call to the header.
- **No hydration mismatch, by construction.** React Query does not run its `queryFn` during SSR → on the server `useAuth().user` is `null`. The account UI renders the **Login / Sign up** default whenever `!user` — which is exactly the server output *and* the first client render (cache cold → `user` still `null`). Server HTML and first client paint are byte-identical → clean hydration. After mount the `["me"]` query fires; on a logged-in user the area swaps to the account menu. **Render no distinct "loading" state** — the logged-out default *is* the pre-resolution state (avoids a skeleton flash and keeps SSR/CSR agreement trivial).
- **Accepted tradeoff (v1):** a signed-in visitor briefly sees Login / Sign up until `/me` resolves (one short post-hydration flash); each public view fires one client `/me` (a 401 for anon). SSR/crawlers are unaffected (the call is client-only).

### Account-area behavior (mirror `AppLayout.tsx`)

- `!user` → **Login** (`Link to="/login"`) + **Sign up** (`Link to="/signup"`).
- `user` → an account menu: the **display name** (`user.display_name`), a **Log out** control (`useAuth().logout()`), and an **Admin** link (`Link to="/admin/ingest"`) gated on `user.is_admin` — identical gating to `AppLayout`.
- `logout()` clears the session (`["me"]` → `null`); the area falls back to the logged-out default.

### Nav config + inert Search/Calendar seats

Primary nav is driven by one source-of-truth config so the header's final shape is fixed now and later milestones flip a flag:

```ts
// src/components/layout/nav-items.ts (shape, not prescriptive styling)
export const NAV_ITEMS = [
  { label: "Home",     href: "/",         enabled: true  },
  { label: "Browse",   href: "/browse",   enabled: true  }, // NEU-399 (independent; route may land after this)
  { label: "Search",   href: "/search",   enabled: false }, // route lands in M4
  { label: "Calendar", href: "/calendar", enabled: false }, // route lands in a later milestone
] as const;
```

`PrimaryNav` renders **enabled** items as active `NavLink`s (with `aria-current` styling) and **disabled** items as **inert, muted placeholders** — `aria-disabled`, **no `href`**, not focusable, no navigation — so they never produce a dead/404 link for users or crawlers. Activating Search/Calendar later is a one-line `enabled: true` (+ the route landing), no header surgery. Browse is `enabled: true` now: if `/browse` hasn't landed yet it's simply a not-yet-live route, not a 404-risk inert seat (it 200s once NEU-399 merges). **Leave a documented insertion slot** in `GlobalHeader` next to the nav where M4's search box will mount (per spec §5).

### Wordmark (BackLotter, sourced from M1 / NEU-392 — soft relation, not a blocker)

Isolate the wordmark to one place so the M1 swap stays a localized one-token change. Define a single `WORDMARK` constant (e.g. in `nav-items.ts` or a tiny `brand.ts`) set to **`"BackLotter"`** per the ticket intent, consumed by both `GlobalHeader` and `GlobalFooter`. If NEU-392's wordmark component/string already exists at implementation time, consume *that* instead; otherwise ship the `"BackLotter"` string and retarget on the M1 merge. **Tests import `WORDMARK`** (rather than hardcoding the literal) so a later brand-asset swap doesn't churn the suite. Do **not** change `seo.ts`'s `SITE_NAME` here — that rename is M1's concern.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/components/layout/nav-items.ts` | create | `NAV_ITEMS` config + the `WORDMARK` constant (single source of truth). |
| `src/components/layout/PrimaryNav.tsx` | create | Renders `NAV_ITEMS`: enabled → `NavLink` (`aria-current`), disabled → inert `aria-disabled` placeholder (no href, not focusable). |
| `src/components/layout/HeaderAccount.tsx` | create | The auth-aware **client island**: default export wraps the module-level `QueryClient` + `AuthProvider` around an inner account-area component; the inner (consuming `useAuth()`) is also exported for isolated testing. |
| `src/components/layout/GlobalHeader.tsx` | create | Wordmark (`Link to="/"`) + `<PrimaryNav/>` + `<HeaderAccount/>`; documented search-box insertion slot. Server-rendered, SSR-safe. |
| `src/components/layout/GlobalFooter.tsx` | create | Wordmark + a small static link list + `© {year} {WORDMARK}`. Fully server-rendered, no auth. |
| `src/routes/public-layout.tsx` | modify | Render `<GlobalHeader/>` + `<Outlet/>` + `<GlobalFooter/>` in a `min-h-screen` flex column. |
| `src/components/layout/PrimaryNav.test.tsx` | create | Enabled-vs-disabled rendering. |
| `src/components/layout/HeaderAccount.test.tsx` | create | Neutral/anon default, signed-in account menu, admin gating, logout fallback, synchronous logged-out first paint. |
| `src/components/layout/GlobalFooter.test.tsx` | create | Footer presence (wordmark + copyright + links). |
| `src/routes/public-layout.test.tsx` | modify | Rewrite: header (wordmark + nav) + footer present; `<Outlet/>` child renders. |

No changes to `routes.ts` (the layout slot already wraps the public routes), the API, env, or dependencies.

---

## Task 1: Nav config + `PrimaryNav` (enabled vs. inert seats)

**Files:** create `src/components/layout/nav-items.ts`, `src/components/layout/PrimaryNav.tsx`, `src/components/layout/PrimaryNav.test.tsx`.

- [ ] **Test first.** Write `PrimaryNav.test.tsx` rendering `<PrimaryNav/>` inside a `MemoryRouter`. Assert: each **enabled** label (`Home`, `Browse`) is a real link (`getByRole("link", { name })` with the expected `href`); each **disabled** label (`Search`, `Calendar`) is present as text/an element but is **not** a link (`queryByRole("link", { name })` is null) and carries `aria-disabled="true"` (and has no `href`). Run `task test -- src/components/layout/PrimaryNav.test.tsx` → FAIL (module missing).
- [ ] **Implement.** Create `nav-items.ts` exporting `NAV_ITEMS` (the §"Nav config" shape) and `WORDMARK = "BackLotter"`. Create `PrimaryNav.tsx` mapping `NAV_ITEMS`: `enabled` → `NavLink to={href}` (active styling via `aria-current`); `!enabled` → a `<span aria-disabled="true">` muted placeholder (no `href`, `tabIndex={-1}` / not focusable). Re-run → PASS.

**Resilience notes:** drive everything off `NAV_ITEMS` (no per-item hardcoding in the component); the test iterates the config so adding/enabling an item later doesn't require new test scaffolding. Keep styling Tailwind-utility only (no new design-system work).

## Task 2: `HeaderAccount` — the SSR-neutral, client-hydrated account island

**Files:** create `src/components/layout/HeaderAccount.tsx`, `src/components/layout/HeaderAccount.test.tsx`.

- [ ] **Test first.** Write `HeaderAccount.test.tsx` mirroring `AppLayout.test.tsx`'s auth-async pattern. Render the **inner** account-area component wrapped in a **per-test** `QueryClient` (`{ retry: false }`) + `AuthProvider` + `MemoryRouter` (per-test client gives isolation; the shared module-level client is for production hydration stability, not tests). Cover:
  1. **Neutral / anonymous default** — with `unauthMeHandler()`, the Login (`/login`) and Sign up (`/signup`) links render and no account menu appears.
  2. **No-mismatch first paint** — assert **synchronously** (before any `findBy`/await, cache cold) that the Login link is already present — proving the first client render equals the neutral SSR default. (Optionally note a `renderToString`-equality check as a stretch; the synchronous-default assertion is the resilient gate.)
  3. **Signed-in account menu** — with `meHandler({ is_admin: false })`, `await findByRole("button", { name: /log out/i })`; the display name shows; assert the **Admin** link is **absent** (`queryByRole("link", { name: /admin/i })` is null).
  4. **Admin gating** — with `meHandler({ is_admin: true })`, `await findByRole("link", { name: /admin/i })` with `href="/admin/ingest"`.
  5. **Logout fallback** — after a signed-in render, invoking Log out returns the area to the Login/Sign up default (`findByRole("link", { name: /log in/i })`).
  Also add a light smoke test that the **default island export** renders the Login default when mounted with only a `MemoryRouter` (it supplies its own providers). Run `task test -- src/components/layout/HeaderAccount.test.tsx` → FAIL.
- [ ] **Implement.** In `HeaderAccount.tsx`: a stable **module-level** `QueryClient` (mirror `spa-layout.tsx`'s options — `staleTime`, `refetchOnWindowFocus: false`). Export an **inner** component (e.g. `AccountArea`) that consumes `useAuth()` and renders: `!user` → Login + Sign up links; `user` → display name + Admin link (iff `user.is_admin`) + Log out button calling `logout()` — mirroring `AppLayout.tsx`. The **default export** `HeaderAccount` wraps `QueryClientProvider client={moduleClient}` + `AuthProvider` around `<AccountArea/>`. Render **no** loading state (the logged-out default is the pre-resolution state). Re-run → PASS.

**Resilience notes:** exporting the inner separately (consuming externally-supplied providers, like `AppLayout`) is what makes the island testable in isolation and avoids module-level cache bleed between tests. Don't introduce a loading skeleton (it would break the no-mismatch guarantee). The `/me` call, CSRF, and 401→null handling are all already inside `AuthContext` — reuse, don't reimplement.

## Task 3: `GlobalHeader` + `GlobalFooter`

**Files:** create `src/components/layout/GlobalHeader.tsx`, `src/components/layout/GlobalFooter.tsx`, `src/components/layout/GlobalFooter.test.tsx`.

- [ ] **Test first (footer).** Write `GlobalFooter.test.tsx` rendering `<GlobalFooter/>` in a `MemoryRouter`. Assert the wordmark text (`screen.getByText(WORDMARK)`, imported from `nav-items.ts`), the copyright line, and at least one static link are present. Run → FAIL.
- [ ] **Implement footer.** `GlobalFooter.tsx`: wordmark + a small static link list + `© {year} {WORDMARK}` where `{year}` is a render-stable constant (see Risks — a fixed/server-stable year string, **not** `new Date().getFullYear()` if that risks SSR/CSR drift). No auth, fully server-rendered. Re-run → PASS.
- [ ] **Implement header (covered by Task 4's layout test).** `GlobalHeader.tsx`: wordmark `Link to="/"` (text = `WORDMARK`) + `<PrimaryNav/>` + `<HeaderAccount/>`, with a **documented insertion slot** (a comment-marked region) next to the nav for M4's search box. Keep it responsive-friendly (flex, wrap) but no mobile drawer (out of scope).

**Resilience notes:** `GlobalHeader` is a thin composition (no logic of its own) so it's exercised end-to-end by the `PublicLayout` test in Task 4 rather than duplicating assertions. Footer gets its own focused test since it carries the copyright/links.

## Task 4: Wire the chrome into `PublicLayout` + rewrite its test

**Files:** modify `src/routes/public-layout.tsx`, `src/routes/public-layout.test.tsx`.

- [ ] **Test first.** Rewrite `public-layout.test.tsx` (currently asserts the bare "Upcoming Movies Tracker" wordmark). Using the existing layout-with-index `MemoryRouter` + `Routes` pattern (so `<Outlet/>` resolves to a child `<Route index element={<p>page body</p>}/>`), assert: the wordmark link to `/` is present (match by `WORDMARK`, imported — not a hardcoded literal); the enabled nav links (`Home`, `Browse`) render; the disabled seats (`Search`, `Calendar`) are present but non-link; the footer (wordmark/copyright) renders; and the routed child (`page body`) renders. Because the layout now mounts `HeaderAccount` (which mounts `AuthProvider` → fires `/me`), register `unauthMeHandler()` via `server.use(...)` so MSW doesn't error on the call. Run `task test -- src/routes/public-layout.test.tsx` → FAIL (old single-wordmark structure).
- [ ] **Implement.** Replace `PublicLayout`'s body with a `min-h-screen` flex column: `<GlobalHeader/>` + `<Outlet/>` (in a `flex-1` main region) + `<GlobalFooter/>`. Re-run → PASS.

**Resilience notes:** the layout test asserting `unauthMeHandler` is registered is the regression guard that the public body stays provider-free *except* for the scoped island — if someone wraps the whole layout in providers, this test still passes but the spec invariant note in Task 5's self-review flags it. Prefer role/text queries over DOM structure so footer/header restyles don't break the test.

## Task 5: Full verification + handoff

**Files:** none (verification only).

- [ ] `task format` — Prettier-clean only the touched files (don't stage unrelated `AuthContext.*` drift).
- [ ] `task lint` — `eslint src --max-warnings 0`, zero warnings (no unused imports — the new `layout/` files import only what they use).
- [ ] `task typecheck` — `react-router typegen` + `tsc -b`, 0 errors. (No new route module, so no `+types` churn.)
- [ ] `task test` — full suite green: the new `PrimaryNav` / `HeaderAccount` / `GlobalFooter` tests, the rewritten `public-layout` test, and every untouched suite.
- [ ] **Hand off for commit (user).** Do **not** commit from task execution. Report the green gates. The user commits the whole NEU-398 change as **one PR** off the ticket branch, Conventional Commits subject (no Linear ID in the commit subject; PR **title** carries `(NEU-398)`), the `🤖 Generated with Claude Code` footer in the **PR body only**, no `Co-Authored-By`. Pre-commit hooks delegate into the container — commit normally with the container up.

---

## Acceptance criteria (from milestone §4)

- A persistent global **header** renders on **every** public page (`/`, `/film/:slug`, `/browse`): BackLotter wordmark (links to `/`) + primary nav (`Home / Browse / Search / Calendar`) + an account area.
- The header is **SSR-safe**: the server emits a neutral, logged-out-default header; **no hydration mismatch**; crawlers receive identity-free HTML.
- The account area is **auth-aware on the client**: signed-in → account menu (display name, Log out, Admin link iff `is_admin`); anonymous → Login / Sign up. Driven by `AuthContext` / `/me`.
- **Home** and **Browse** nav entries are live; **Search** and **Calendar** render as inert, non-navigating placeholders (no 404).
- A global **footer** renders on every public page (wordmark, static links, copyright).
- Tests (Vitest + RTL + MSW) cover: neutral SSR/anonymous default, the signed-in account menu (`meHandler`), the admin-gated link, nav enabled-vs-disabled rendering, and footer presence. `task test` / `task lint` (zero warnings) / `task typecheck` green; touched files Prettier-clean.

## TDD testing intent (summary)

| Behavior | Where asserted |
|---|---|
| Nav renders enabled links + inert disabled seats | `PrimaryNav.test.tsx` |
| Account island shows Login/Sign up per anon (and synchronously on first paint = no mismatch) | `HeaderAccount.test.tsx` |
| Account island shows account menu + Log out + admin-gated link per auth state | `HeaderAccount.test.tsx` (`meHandler`/`unauthMeHandler`) |
| Logout returns the area to the logged-out default | `HeaderAccount.test.tsx` |
| Footer present (wordmark + copyright + links) | `GlobalFooter.test.tsx` |
| Header + footer + child render through the layout; `/me` mocked | `public-layout.test.tsx` |

## Risks / notes

- **Hydration determinism.** The account area must render the logged-out default whenever `!user` (server, first client paint, anon) and swap only on a truthy `user` — **no** loading skeleton, no `Date.now()`, no locale-dependent output. The footer's `© {year}` must be a render-stable value; if `new Date().getFullYear()` is used it runs identically on server and client *only when the years agree* — to be safe, use a fixed/build-stable year string per the spec's note.
- **Provider scoping.** Keep `QueryClientProvider` + `AuthProvider` **inside** `HeaderAccount` (stable module-level `QueryClient`, per `spa-layout.tsx`). The feed/film/(future) browse loaders and bodies must stay provider-free and never fire `/me` during SSR. The Task 4 layout test registering `unauthMeHandler` is the guard that the island is the *only* place auth is wired.
- **Test cache isolation.** The island's module-level `QueryClient` is shared across renders; tests must render the **inner** account component with a **per-test** `QueryClient` (or otherwise reset cache) to avoid `["me"]` bleed between tests — hence exporting the inner separately.
- **Wordmark coupling to M1/NEU-392.** Soft relation, not a blocker. Isolate to the `WORDMARK` constant consumed by header + footer; if NEU-392's wordmark lands first, consume it; otherwise ship `"BackLotter"` and retarget on merge. Don't touch `seo.ts` `SITE_NAME` (M1's concern). Tests import `WORDMARK` so the swap is churn-free.
- **`/` blast radius is nil.** This ticket does not move `/` or change any loader; it only adds chrome around the existing `<Outlet/>`.
- **NEU-399 independence.** `Browse` is `enabled: true` now even though `/browse` may land later — it's a not-yet-live route, never an inert seat. No hard ordering between NEU-398 and NEU-399.

## Self-review — spec coverage

- **§2.1 chrome in `PublicLayout`** → Task 4 (header above `<Outlet/>`, footer below, `min-h-screen` flex column); asserted by the rewritten `public-layout.test.tsx`.
- **§2.2 neutral SSR + client-hydrated account island; providers scoped to `HeaderAccount`** → Task 2 (module-level `QueryClient` + `AuthProvider` inside the island; logged-out default = SSR output = first paint; no loading state); asserted by the anon-default, synchronous-first-paint, signed-in, admin-gating, and logout tests.
- **§2.3 single `NAV_ITEMS` config; inert Search/Calendar; Home/Browse live; search-box insertion slot** → Task 1 (`nav-items.ts` + `PrimaryNav`) + Task 3 (`GlobalHeader` slot); asserted by `PrimaryNav.test.tsx` enabled-vs-disabled and the layout test.
- **Footer (wordmark, static links, copyright)** → Task 3; asserted by `GlobalFooter.test.tsx`.
- **Account menu mirrors `AppLayout` (display name, Log out, admin-gated Admin link)** → Task 2; asserted by the signed-in + admin-gating tests.
- **BackLotter wordmark, isolated for the M1 swap** → Task 1 `WORDMARK` constant, consumed by header + footer, imported by tests.
- **No backend / API / sitemap / `/browse` work, no auth-split homepage** → none touched; out-of-scope items (Search page/box, Calendar page, watchlist home, mobile drawer, design-system) explicitly deferred per spec §5.
- **Gates** → Task 5 (`task format`/`lint`/`typecheck`/`test`), one PR, user commits.

**Placeholder scan:** no "TBD"/"similar to above"/"add error handling" — each task names its files, its test-first assertions, and its `task` command. Code is described (resilient, light on exact signatures) rather than pasted, but every behavior maps to a concrete test and an existing pattern (`spa-layout.tsx`, `AppLayout.tsx`, `AppLayout.test.tsx`, `me.ts`).
