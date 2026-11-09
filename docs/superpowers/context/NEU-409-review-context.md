# NEU-409 review context

## Linear ticket
- **ID/Title:** NEU-409 — [frontend] Release calendar page (/calendar)
- **State:** In Review
- **Description:** New public SSR `/calendar` route: upcoming releases grouped by date → release type, soonest-first. Nav link from the global header, SEO meta + sitemap entry, graceful empty state. Consumes `GET /calendar`. FE repo.
- **Plan:** docs/plans/2026-06-25-neu-409-calendar-page.md
- **Milestone spec:** docs/specs/2026-06-25-mvp-launch-polish-m06-release-calendar.md

## Linear hierarchy & relations
- **Project:** Movies: MVP Launch Polish
- **Milestone:** M6 — Release calendar
- **Parent:** NEU-373 (Story: Public release calendar)
- **Blocked by:** NEU-408 ([backend] GET /calendar endpoint) — defines the `CalendarResponse` contract this consumes
- **Related to:** NEU-398 ([frontend] Auth-aware global header + footer) — owns the `Calendar` nav seat this flips live

## Acceptance criteria (spec §4 / plan)
1. Public SSR `/calendar` consumes `GET /calendar`; renders upcoming releases grouped by date (soonest-first) → release type (premiere → limited → wide); each film a card linking to `/film/{slug}` (poster + title; placeholder for null poster).
2. Header `Calendar` nav entry is live (`enabled: true`).
3. SEO: `meta()` via `buildMeta` (title "Release Calendar" + description/OG/canonical); `/calendar` present in FE sitemap; crawlable in robots (no robots change).
4. Empty state is a graceful 200 ("No upcoming releases yet"); fetch failure surfaces neutral `ErrorBoundary`.
5. New `getCalendar` fetcher + `CalendarItem`/`CalendarResponse` types mirror backend DTOs; `groupByReleaseDate` is pure & deterministic (no client sort, no `Date.now()`, UTC headings).
6. Tests cover: loader (MSW `GET /calendar`), grouped render + film links + label mapping + soonest-first ordering, empty state, error boundary, nav-entry-live flip, sitemap injection, `groupByReleaseDate`/`releaseBucketLabel` units. `task test`/`lint` (0 warnings)/`typecheck` green; touched files prettier-clean.

## Load-bearing design constraints
- **Determinism:** `groupByReleaseDate` does NO client sort, NO `Date.now()` — relies on server order (`release_date ASC, release_type ASC`) + `timeZone: "UTC"` headings (reuse `formatDayHeading`). SSR HTML and first client paint byte-identical.
- **Provider-free body:** the page body imports no React Query / Auth — preserves the invariant that public loaders/bodies never fire `/me` during SSR.
- **Fetcher:** `getCalendar` cloned from `getFeedGrouped` — always 200, no 404 branch, no credentials, `Accept: application/json`; default `limit=100`, `offset=0`.
- **`release_type` stays a plain `string`** (not narrowed to a literal union) — forward-compatible with a future bucket.
- **Card null-safety:** never emit an `<img>` with null/empty src — render a placeholder tile (mirror `FilmPosterCard`).
- **Sitemap:** inject `/calendar` `<url>` into proxied backend sitemap; derive base from upstream root `<loc>`; resilient fallbacks (unchanged XML if no `<loc>`/`</urlset>`); generalize NEU-399's `injectBrowseUrl` if present.
