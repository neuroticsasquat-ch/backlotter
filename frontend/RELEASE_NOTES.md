# Release notes

## 1.1.1 — 2026-09-26

### Feed

- Uncollapse Not yet reported, show its events, hide empty sections ([NEU-1467](https://linear.app/neuroticsasquatch/issue/NEU-1467)) ([#181](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/181))
- Server-render the timeline skeleton for a hinted subscriber ([NEU-1468](https://linear.app/neuroticsasquatch/issue/NEU-1468)) ([#182](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/182))

### Onboarding

- Pin people tiles to their grid track ([NEU-1471](https://linear.app/neuroticsasquatch/issue/NEU-1471)) ([#185](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/185))

### Search

- Show a spinner while a search runs ([NEU-1469](https://linear.app/neuroticsasquatch/issue/NEU-1469)) ([#183](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/183))

### Settings

- Drop alerts and push, the digest is the only delivery ([NEU-1470](https://linear.app/neuroticsasquatch/issue/NEU-1470)) ([#184](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/184))

## 1.1.0 — 2026-09-25

### Admin

- /admin/digest page to preview any user's digest and send it to me ([NEU-1465](https://linear.app/neuroticsasquatch/issue/NEU-1465)) ([#177](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/177))

### Settings

- Say what each digest cadence sends, and confirm an unsubscribe ([NEU-1466](https://linear.app/neuroticsasquatch/issue/NEU-1466)) ([#178](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/178))

## 1.0.0 — 2026-09-23

### Admin

- /admin/users grant page and AuthContext.entitled ([NEU-1392](https://linear.app/neuroticsasquatch/issue/NEU-1392)) ([#130](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/130))
- Read-only /admin/resolution decision queue ([NEU-1367](https://linear.app/neuroticsasquatch/issue/NEU-1367)) ([#139](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/139))
- Invites page to mint and copy signup links ([NEU-1408](https://linear.app/neuroticsasquatch/issue/NEU-1408)) ([#153](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/153))
- Resolution lists people, studios and franchises ([NEU-1447](https://linear.app/neuroticsasquatch/issue/NEU-1447)) ([#170](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/170))

### Api

- Build public API URLs from a base that may be relative ([NEU-1421](https://linear.app/neuroticsasquatch/issue/NEU-1421)) ([#159](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/159))

### Auth

- Forgot, reset and verify routes with email_verified in AuthContext ([NEU-1342](https://linear.app/neuroticsasquatch/issue/NEU-1342)) ([#127](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/127))
- Turnstile widget on signup, invite code optional ([NEU-1345](https://linear.app/neuroticsasquatch/issue/NEU-1345)) ([#128](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/128))

### Calendar

- Tab the reader's own watchlist alongside all releases ([NEU-1412](https://linear.app/neuroticsasquatch/issue/NEU-1412)) ([#154](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/154))

### Feed

- Cast section elements to HTMLElement for within() typecheck ([NEU-1208](https://linear.app/neuroticsasquatch/issue/NEU-1208))
- Sign SSR API fetches and forward the visitor IP ([NEU-1389](https://linear.app/neuroticsasquatch/issue/NEU-1389)) ([#129](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/129))
- Home becomes the timeline when signed in, global feed at /feed ([NEU-1354](https://linear.app/neuroticsasquatch/issue/NEU-1354)) ([#134](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/134))
- JustWatch attribution on now_available cards ([NEU-1402](https://linear.app/neuroticsasquatch/issue/NEU-1402)) ([#141](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/141))
- One global feed page under two URLs, named as the nav names it ([NEU-1410](https://linear.app/neuroticsasquatch/issue/NEU-1410)) ([#152](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/152))
- Catalog section heading reads "Not yet reported", not "unconfirmed updates" ([NEU-1406](https://linear.app/neuroticsasquatch/issue/NEU-1406)) ([#173](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/173))

### Feed,film

- Rename via TMDB to unconfirmed updates, title-only catalog section ([NEU-1208](https://linear.app/neuroticsasquatch/issue/NEU-1208))

### Film

- Render day_groups with news/tmdb subsections on film page ([NEU-1201](https://linear.app/neuroticsasquatch/issue/NEU-1201))
- In the news not collapsible, no event counts, always show label ([NEU-1201](https://linear.app/neuroticsasquatch/issue/NEU-1201))
- Uncollapse via TMDB events on movie page ([NEU-1207](https://linear.app/neuroticsasquatch/issue/NEU-1207))
- Confidence badge, retraction marker, first-seen line on event cards ([NEU-1348](https://linear.app/neuroticsasquatch/issue/NEU-1348)) ([#132](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/132))
- Follow buttons and watchlist toggle on the film page ([NEU-1353](https://linear.app/neuroticsasquatch/issue/NEU-1353)) ([#133](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/133))
- Home-release dates, the where-to-watch box, and calendar buckets ([NEU-1377](https://linear.app/neuroticsasquatch/issue/NEU-1377)) ([#140](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/140))
- Inline trailer embed on event cards and the film header ([NEU-1386](https://linear.app/neuroticsasquatch/issue/NEU-1386)) ([#146](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/146))
- One follow button on the film page, every name links ([NEU-1441](https://linear.app/neuroticsasquatch/issue/NEU-1441)) ([#166](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/166))

### Follow

- Person page, three-tier coverage control, credit links ([NEU-1419](https://linear.app/neuroticsasquatch/issue/NEU-1419)) ([#157](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/157))
- One control on the film page, and a cue that says what it does ([NEU-1405](https://linear.app/neuroticsasquatch/issue/NEU-1405)) ([#158](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/158))

### Follows

- Follows and watchlist management pages ([NEU-1355](https://linear.app/neuroticsasquatch/issue/NEU-1355)) ([#135](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/135))
- Watchlist, follows and settings over the merged follow model ([NEU-1415](https://linear.app/neuroticsasquatch/issue/NEU-1415)) ([#156](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/156))
- Label rows from the API instead of localStorage ([NEU-1422](https://linear.app/neuroticsasquatch/issue/NEU-1422)) ([#160](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/160))
- Studio and franchise pages ([NEU-1429](https://linear.app/neuroticsasquatch/issue/NEU-1429)) ([#163](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/163))
- Studio and franchise rows link inward, TMDB link gone ([NEU-1431](https://linear.app/neuroticsasquatch/issue/NEU-1431)) ([#165](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/165))
- One flat list with type chips, three sorts and a text filter ([NEU-1442](https://linear.app/neuroticsasquatch/issue/NEU-1442)) ([#167](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/167))
- Delete the watchlist page, calendar tab reads "My films" ([NEU-1443](https://linear.app/neuroticsasquatch/issue/NEU-1443)) ([#168](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/168))
- Entity pages preview their own cards; person rows lose the tier badge ([NEU-1444](https://linear.app/neuroticsasquatch/issue/NEU-1444)) ([#169](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/169))

### General

- Natural title sort + always show country codes on release dates
- Deduplicate same-film posters in daily feed strip ([NEU-1203](https://linear.app/neuroticsasquatch/issue/NEU-1203))
- Label the day's beats on unconfirmed feed rows ([NEU-1212](https://linear.app/neuroticsasquatch/issue/NEU-1212))
- Separate consecutive feed beat pills ([NEU-1213](https://linear.app/neuroticsasquatch/issue/NEU-1213))
- Stop feed beat pills inheriting the title's negative indent ([NEU-1214](https://linear.app/neuroticsasquatch/issue/NEU-1214))
- Give the feed row a country/director/year parenthetical ([NEU-1215](https://linear.app/neuroticsasquatch/issue/NEU-1215))

### Layout

- Fold the account links into an avatar menu ([#149](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/149))
- Make the nav depend on whether the reader has a timeline ([NEU-1407](https://linear.app/neuroticsasquatch/issue/NEU-1407)) ([#150](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/150))

### Onboarding

- /welcome import CTA, people grid and timeline landing ([NEU-1358](https://linear.app/neuroticsasquatch/issue/NEU-1358)) ([#137](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/137))
- TMDB connect flow in onboarding ([NEU-1359](https://linear.app/neuroticsasquatch/issue/NEU-1359)) ([#138](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/138))
- Review list before an import follows anything ([NEU-1450](https://linear.app/neuroticsasquatch/issue/NEU-1450)) ([#171](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/171))
- Restore an open import on /welcome and announce a waiting list on the timeline ([NEU-1452](https://linear.app/neuroticsasquatch/issue/NEU-1452)) ([#172](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/172))

### Push

- Service worker and browser notification toggle ([NEU-1388](https://linear.app/neuroticsasquatch/issue/NEU-1388)) ([#148](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/148))

### Pwa

- Add web app manifest, install icons, and Apple standalone metas ([NEU-1404](https://linear.app/neuroticsasquatch/issue/NEU-1404)) ([#147](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/147))

### Search

- The header finds films, people, studios and franchises ([NEU-1430](https://linear.app/neuroticsasquatch/issue/NEU-1430)) ([#164](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/164))

### Settings

- /me/settings with digest cadence, email and password changes ([NEU-1382](https://linear.app/neuroticsasquatch/issue/NEU-1382)) ([#142](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/142))
- Calendar subscribe section with copy and rotate ([NEU-1384](https://linear.app/neuroticsasquatch/issue/NEU-1384)) ([#144](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/144))

### Watchlist

- Render the headline release on /me/watchlist ([NEU-1398](https://linear.app/neuroticsasquatch/issue/NEU-1398)) ([#136](https://github.com/neuroticsasquat-ch/upcoming-movies-frontend/pull/136))

## 0.3.2 — 2026-08-13

### General

- Split each feed day into news-backed and TMDB-only sections ([NEU-1138](https://linear.app/neuroticsasquatch/issue/NEU-1138))
- Stack the feed poster on mobile, wrap long titles, label the day's beats ([NEU-1140](https://linear.app/neuroticsasquatch/issue/NEU-1140))
- Give each feed day a news-first poster strip with linked posters ([NEU-1141](https://linear.app/neuroticsasquatch/issue/NEU-1141))
- Run the feed day poster strip horizontally at every width ([NEU-1142](https://linear.app/neuroticsasquatch/issue/NEU-1142))
- Route film pages on the ref and redirect non-canonical URLs ([NEU-1144](https://linear.app/neuroticsasquatch/issue/NEU-1144))

## 0.3.1 — 2026-08-13

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
