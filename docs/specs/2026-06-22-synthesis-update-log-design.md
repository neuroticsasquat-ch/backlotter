# Synthesis & Update Log — Design

- **Date:** 2026-06-22
- **Status:** Approved (pending implementation)
- **Component:** `upcoming-movies-backend` (summary layer + public read API) and
  `upcoming-movies-frontend` (SSR public surface)
- **Linear:** project *Movies: Synthesis & Update Log*; spike NEU-260
- **Builds on:** [2026-06-19-entity-linking-clustering-design.md](2026-06-19-entity-linking-clustering-design.md)
  (the upstream `news.event` / `news.event_story` contract this project consumes)

## What this is

The **public-facing free product** — the spiritual revival of the old Corona daily-updates
index. It sits directly downstream of Entity Linking & Clustering and does three things:

1. **Summarize** each event into one neutral 2–3 sentence plain-language update, keyed by
   `event_id`, with links back to the source stories it was based on. Paraphrase only —
   facts aren't copyrightable, but we reproduce nothing.
2. **Per-movie chronological update log** — every tracked film's full history as a
   status-arc timeline (announced → cast → shooting → wrapped → dated → trailer → released),
   each entry a summary + source links.
3. **Global "updated today" feed** — what changed across all tracked films today (and
   recent days), the discovery front door.

This is the **first unauthenticated surface** in the product. Every existing router is
auth/admin-gated; every existing FE page is behind `RequireAuth`. Synthesis introduces the
public read API and the SSR-rendered public pages.

## Decisions

| Question | Decision |
|---|---|
| v1 surface boundary | **Free = everything.** v1 ships the complete free product (summaries + per-movie log + global feed). All monetization is Out of v1. |
| Rendering | **SSR in v1.** This is discovery-driven; pages must be crawlable. Use **React Router v7's own SSR** (the FE already uses `react-router` v7) — a continuation of the existing library, not a new framework. |
| Summary model | **Haiku 4.5, batched** — reuse the Batches infra already built for Stage-1 linking (NEU-296). A 2–3 sentence neutral paraphrase is well within Haiku's range. Config-swappable. |
| Summary ownership | Synthesis owns its own summary layer **keyed by `event_id`**. The upstream `news.event` has no summary column by design; the contract stops at the event + its sources. |
| Source links | Derived from `news.event_story` → `news.story` (`url`, `source`, `title`, `published_at`). No source data is duplicated into the summary layer. |
| Freshness / idempotency | Summaries regenerate when an event grows. `event_summary.source_updated_at` records the `event.updated_at` the summary was built against; the pipeline (re)summarizes events whose summary is missing **or** stale (`event.updated_at > summary.source_updated_at`). |
| Slugs | Public film URLs use an SEO-friendly `slug` on `catalog.film` (derived from title + release year, unique). Not UUIDs. |

## Architecture

```
news.event (upstream, exists)  ──┐
news.event_story → news.story    │  member stories (title + dek + source + url)
                                 ▼
   ┌──────────────────────────────────────┐  Haiku 4.5, batched
   │ SYNTHESIZE  (new `synthesize` run)    │  per event missing/stale a summary
   │  → one neutral 2–3 sentence paraphrase │  → upsert news.event_summary
   └──────────────────┬─────────────────────┘
                      │
        ┌─────────────┴───────────────┐
        ▼                             ▼
  GET /films, /films/{slug}      GET /feed            (public, unauthenticated)
        │                             │
        ▼                             ▼
  SSR /film/{slug}              SSR /  (the feed)      (React Router v7 SSR)
  (status-arc timeline)         (updated-today)
```

The `synthesize` stage is a fourth `ingest_run` kind alongside `tmdb`, `feeds`, `link`. It
runs **after `link`** in the daily cron (tmdb → feeds → link → synthesize), follows the
existing ingestion conventions (`(session_factory, run_id, …)`, commit per batch so one
failure never rolls back others, wire `ingest.runs`), and is idempotent / re-runnable
(only events missing or stale a summary are touched; a no-new-events run is a no-op).

## Schema (`news`)

### `news.event_summary` — new (the summary layer)

| Column | Type | Notes |
|---|---|---|
| `event_id` | uuid pk, FK → `news.event.id` (`ON DELETE CASCADE`) | 1:1 with event |
| `summary` | Text, not null | the neutral 2–3 sentence paraphrase |
| `model` | Text, not null | model that produced it (e.g. `claude-haiku-4-5`) |
| `prompt_version` | Text/int, not null | bump to force regeneration on prompt changes |
| `source_updated_at` | timestamptz, not null | the `event.updated_at` this summary was built against — the staleness key |
| `generated_at` | timestamptz, default `now()` | when written |

No source columns — sources come from `event_story` at read time.

### `catalog.film` — extended

| Column | Type | Notes |
|---|---|---|
| `slug` | Text, unique, indexed | SEO URL, derived from title + release year; backfilled |

(Touches the catalog spine, owned by Ingestion, but is required by the public film URL and
the sitemap; scoped here as a one-PR migration + backfill.)

## Summarization service

- **Input per event:** `event_type`, film title, and the member stories' `title` + `dek`
  (`story.raw.summary`) + `source`. No article bodies (ToS-clean, same as upstream).
- **Output:** one neutral 2–3 sentence update. **Strict paraphrase** — the prompt forbids
  reproducing source phrasing; it states facts (who/what/when) in our own words.
- **Model:** Haiku 4.5 via the Batches surface (`llm/client.py`), mirroring Stage-1 link.
  Config: `summary_model` (default `claude-haiku-4-5`), `summary_use_batches` (default
  `True`), `summary_prompt_version`.
- **TDD:** Anthropic mocked, never live. A fresh event produces a stored summary; a grown
  event (new `event_story`, bumped `updated_at`) regenerates; an unchanged event is a no-op.

## Public read API (unauthenticated)

A new public router (the first no-auth surface) registered in `main.py`. CORS already
permits GET.

- `GET /films` — index of tracked films (slug, title, year, poster, current arc stage),
  paginated; powers the sitemap and is the discovery substrate.
- `GET /films/{slug}` — film detail + its events in chronological order, each event carrying
  `event_type`, `confidence`, `occurred_at`, the `summary`, and its source stories
  (`url`, `source`, `title`, `published_at`); plus the **derived current arc stage**
  (computed from `film.status` + the event types present).
- `GET /feed` — recent events across all films grouped/ordered by `event.created_at` (the
  "updated today" axis), paginated; each item carries film slug/title + summary +
  type/confidence + sources.
- `GET /sitemap.xml` — film URLs + the feed, generated from the index.

Events without a summary yet are omitted from the public surface (the summary is the
product).

## Frontend — SSR public surface

- **2.1 SSR foundation:** adopt React Router v7 SSR (framework mode or Vite SSR +
  `createStaticHandler`/`StaticRouter` + hydration). Add an **unauthenticated public
  layout** distinct from the authed `AppLayout`; establish a server-side data-loading
  pattern. Existing authed SPA routes (`/login`, `/signup`, authed `/`, `/admin/*`) keep
  working.
- **2.2 SEO primitives:** per-route `<title>`/meta/OG helper for public routes + `robots.txt`.
- **3.3 Film page:** SSR route `/film/{slug}` — status-arc timeline, per-event summary cards
  with source links, per-film meta/OG, empty + 404 states.
- **4.2 Feed landing page:** SSR public landing route `/` — updates grouped by day, each
  linking to its film page; meta/OG; pagination/empty. (The current authed Home stub moves
  aside; the public root becomes the feed.)

All FE pages: MSW + Vitest gates; `tsc -b` + eslint green before push.

## Delivery plan (milestones)

- **M1 — Summarization engine (backend foundation):** `event_summary` schema + migration;
  Haiku/batched summarization service (paraphrase guardrails); `synthesize` pipeline + ingest
  kind + trigger + cron. *Output:* every event gets a stored neutral summary.
- **M2 — Public rendering foundation (frontend foundation):** React Router v7 SSR shell +
  unauthenticated public layout; SEO meta/OG helper + robots. *Output:* a crawlable public
  shell proving the SSR stack.
- **M3 — Per-movie update log (capability):** film `slug` + backfill; public film index +
  detail API + sitemap; SSR film page (status-arc timeline + source links).
- **M4 — Global "updated today" feed (capability):** feed API; SSR feed landing page (the
  public front door). Sequenced last because it links into the film pages.

## Out of scope / Deferred (Out of v1)

| Deferred item | Rationale / home |
|---|---|
| Paid tier — alerts/notifications, email digests, data export, confirmed-only & per-type filtering, watchlists, paid timelines | No paid project exists yet; spin one up when monetization starts. The `confidence` axis is already stored upstream, ready to filter on. |
| Dedicated browse / search UI | Feed + film pages + sitemap cover v1 discovery. |
| Person / credits pages | Credits aren't ingested (deferred in the capture spec). |
| Personalized / per-user feed | Public surface is anonymous in v1. |
| Stage-2 cluster-purity validation | Entity Linking & Clustering's concern, not Synthesis. |

## Testing

- **Backend:** TDD, Anthropic mocked; `task test` / `task lint` / `task typecheck` green
  (`task format`). Schema migration round-trips; summarization freshness logic; public
  endpoints' shape, ordering, slug resolution, summary-less-event omission.
- **Frontend:** MSW + Vitest; SSR render + hydration of public routes; `tsc -b` + eslint.
