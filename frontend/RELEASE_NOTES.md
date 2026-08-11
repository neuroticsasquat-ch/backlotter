# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [0.3.0] - 2026-08-11

## [0.2.0] - 2026-08-08

### Features

- **calendar:** Show poster and metadata in calendar film rows (NEU-437)
- Add Terms of Service and Privacy Policy pages
- Add neuroticsasquat.ch release credit to footer
- Add admin delink controls to the film page (NEU-441)
- **labels:** Add First look label for first_look event type (NEU-447)
- **film:** Trim ArcStepper to 4 reachable stages (NEU-458)
- Add source-domain types and admin API client (NEU-456)
- Add admin Sources page with layout tabs (NEU-456)
- Wire optimistic source override mutation (NEU-456)
- Add search and tier/override filters to Sources page (NEU-456)
- Add default and column sorting to Sources page (NEU-456)
- Add 'Hide blocked' filter to admin Sources page
- Inline admin edit + reset-to-AI for event summaries (NEU-540)
- **feed:** Lead each day with its top film's poster ([#79](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/79))

### Bug Fixes

- Swap default title order to production log — backlotter for iMessage previews
- Correct wordmark split — backlot foreground, ter muted

### Documentation

- Name sole proprietor on first reference in legal docs

### Styling

- Lowercase SITE_NAME to backlotter and shift wordmark highlight to backlot

### Testing

- Add combined-filter test and document mutation rollback caveat (NEU-456)

### Build System

- **deps:** Bump the minor-and-patch group with 26 updates
- **deps-dev:** Bump @cloudflare/workers-types
- **deps:** Bump the minor-and-patch group with 21 updates ([#59](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/59))
- **deps:** Bump the minor-and-patch group with 11 updates
- **deps:** Bump the minor-and-patch group with 23 updates ([#66](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/66))
- **deps-dev:** Bump @testing-library/jest-dom from 6.9.1 to 7.0.0 ([#68](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/68))
- **deps-dev:** Bump @cloudflare/workers-types ([#67](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/67))
- **deps:** Bump the minor-and-patch group with 7 updates ([#71](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/71))
- **deps-dev:** Bump jsdom from 29.1.1 to 30.0.1 ([#72](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/72))
- **deps:** Bump the minor-and-patch group with 12 updates

### CI

- **deps:** Bump actions/checkout from 6 to 7
- **deps:** Bump actions/setup-node from 6 to 7

### Miscellaneous

- Scaffold agent-skills config (Linear tracker, triage labels, domain docs)
- Replace eslint with oxlint ([#74](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/74))

## [0.1.1] - 2026-06-27

### Features

- Activate Sentry monitoring across client and SSR (NEU-416)
- Tunnel Sentry events through same-origin to bypass ad blockers (NEU-418)
- Add crew block and director/writer billing (NEU-431)
- Add IMDb and TMDB links to film header (NEU-432) ([#36](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/36))
- Add collapsed plot summary to film page (NEU-412) ([#37](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/37))
- Group release calendar by year, month, and day (NEU-410) ([#38](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/38))

### Bug Fixes

- Delete Sentry source maps after upload so they aren't served publicly (NEU-417)
- Use hidden source maps so wrangler deploy doesn't read deleted maps (NEU-419)
- Forward raw bytes through Sentry tunnel so replay envelopes aren't corrupted (NEU-420)

### CI

- Add weekly merge-main-into-dependencies workflow
- Fix merge-main-into-dependencies workflow (open+merge PR instead of no-op)

### Miscellaneous

- Set backlotter-frontend SSR Sentry DSN (NEU-416)

## [0.1.0] - 2026-06-27

### 🚀 Features

- Add frontend env, fetch client, auth API module (NEU-257)
- Add auth context with session bootstrap (NEU-257)
- Add RequireAuth gate and login/signup/home pages (NEU-257)
- Add frontend docker/compose/taskfile + cloudflare pages config (NEU-257)
- Add admin gating (is_admin type + RequireAdmin + nav) (NEU-270) (#1)
- Add admin ingestion-status page + API client (NEU-271) (#2)
- Migrate to React Router v8 framework-mode SSR on Cloudflare Workers (NEU-306) (#4)
- Add SEO meta/OG helper, robots.txt, and sitemap proxy (NEU-307) (#5)
- Add SSR /film/:slug page with arc indicator and event timeline (#6)
- *(frontend)* Add SSR feed landing page at / and move home to /app (#7)
- *(feed)* Replace per-event feed with per-film-per-day grouped cards (NEU-362) (#9)
- *(admin)* Show per-run LLM token cost in admin runs view (NEU-376) (#10)
- *(feed)* Remove poster images and tighten row density for faster scanning (NEU-369) (#11)
- *(film)* Group event timeline by day, newest-first (NEU-371) (#12)
- Label all ingest run kinds in the admin runs page (NEU-280) (#13)
- Rebrand site name to BackLotter and add copyright footer (NEU-392)
- Add auth-aware global header and footer (NEU-398) (#16)
- *(film)* Add FilmMeta section with supplemental film info (NEU-397) (#18)
- *(browse)* Add paginated film index at /browse (NEU-399) (#19)
- *(search)* Add film search box and /search results page (NEU-401) (#20)
- *(film)* Add ReleaseDates section to film detail page (NEU-405)
- *(film)* Add AlsoKnownAs line to film detail page (NEU-407) (#22)
- *(film)* Add cast & crew section to film detail page (NEU-403) (#23)
- *(calendar)* Add calendar page with grouped release view (NEU-409) (#24)
- UX improvements

### 🐛 Bug Fixes

- Rebrand authed app to BackLotter via shared SITE_NAME (NEU-392)
- *(film)* Rename FilmEvent.occurred_at to created_at to match backend API (NEU-395) (#17)

### 📚 Documentation

- Record Linear initiative/team in CLAUDE.md (#14)

### ⚙️ Miscellaneous Tasks

- Scaffold frontend config (NEU-257)
- Add pnpm lockfile (NEU-257)
- Add repo CLAUDE.md guide (#3)
- *(deploy)* Configure prod deploy for Cloudflare Workers (#25)
