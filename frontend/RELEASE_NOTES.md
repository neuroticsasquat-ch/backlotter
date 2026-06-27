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
