# M6 — Release calendar — Milestone Design

- **Date:** 2026-06-25
- **Status:** Approved (ready for per-ticket implementation plans)
- **Product:** **BackLotter** — public SSR tracker of upcoming films (backlotter.com).
- **Components:** `upcoming-movies-backend` (new public endpoint) + `upcoming-movies-frontend`
  (new public SSR route).
- **Project / milestone:** *Movies: MVP Launch Polish* · milestone **M6 — Release calendar**.
  Story **NEU-373** "Public release calendar":
  - **NEU-408** `[backend]` New public `GET /calendar` — upcoming releases (today forward), grouped
    and orderable by release **date** and release **type**, read from the ingested per-country
    release-dates. **Blocked by NEU-404.**
  - **NEU-409** `[frontend]` New public SSR `/calendar` route — upcoming releases grouped by date →
    release type, soonest-first; nav link from the global header; SEO meta + sitemap entry; graceful
    empty state. **Blocked by NEU-408**; related to the header (**NEU-398**).
- **Builds on (shipped / sibling):**
  - **NEU-306** — React Router framework-mode SSR on Cloudflare Workers; `src/routes.ts`;
    `routes/public-layout.tsx`; the server-`loader` pattern; `cloudflareContext` (Worker env → loaders).
  - **NEU-307** — SEO primitives: `src/lib/seo.ts` `buildMeta(...)`; FE `routes/sitemap.ts` proxy of
    the backend `GET /sitemap.xml`; `routes/robots.ts` (`Allow: /`).
  - **NEU-309 / NEU-310 / NEU-312 / NEU-364** — the public film API, the SSR film/feed pages, and the
    grouped feed (`GET /feed/grouped` + `FeedDayResponse`, FE `groupByDay`) whose **flat-list +
    client-grouping** shape this milestone mirrors.
  - **NEU-398 (M3)** — the auth-aware global header with the single `NAV_ITEMS` config, which already
    seats an **inert `Calendar` placeholder** (`{ label: "Calendar", href: "/calendar", enabled: false }`).
    This milestone flips it live.
- **Depends on (NOT shipped):** **NEU-404** `[backend]` — TMDB per-country `release_dates` ingestion
  (types 1–6 = premiere / limited theatrical / wide theatrical / digital / physical / TV) into a new
  per-film / per-country release-dates schema. **This milestone consumes that table; it does not
  define or redesign it** (see §3.1).
- **Refs:** sibling designs
  [2026-06-23-neu-364-per-film-per-day-feed-grouping-design.md](2026-06-23-neu-364-per-film-per-day-feed-grouping-design.md)
  (flat grouped-list endpoint + pure ranker + UTC day handling),
  [2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md](2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md)
  (public SSR route template, sitemap injection, `NAV_ITEMS`),
  [2026-06-23-neu-307-seo-primitives-design.md](2026-06-23-neu-307-seo-primitives-design.md)
  (`buildMeta`, sitemap/robots).

---

## 1. Purpose & scope

Give the public surface a **forward-looking release calendar**: "what's coming out, and when." Today
the public surface is backward/now-looking — the grouped feed (`/`) shows *what got news today*, the
film page (`/film/:slug`) shows a film's update log, and `/browse` lists tracked films. None of them
answers "which films release in the next weeks/months, and in what form (premiere vs. limited vs.
wide)." NEU-404 ingests the raw TMDB per-country release dates; this milestone turns that data into a
single public page.

This milestone adds:

1. **A public `GET /calendar` endpoint** (NEU-408): upcoming releases (today forward) read from the
   NEU-404 release-dates table, scoped to a single governing region (**US**, §2.3), each TMDB release
   `type` folded into a small set of **display buckets** (premiere / limited / wide, §2.2), returned as
   a **flat, ordered list** (`release_date ASC, type, …`) the client groups **by date → type** (§2.4).
2. **A public SSR `/calendar` route** (NEU-409): consumes `GET /calendar`, renders the upcoming
   releases grouped by date (soonest-first) then by release type, flips the header's **Calendar** nav
   entry live, adds SEO meta + a sitemap entry, and shows a graceful empty state.

**In scope:** the `/calendar` endpoint + its DTOs + the TMDB-type→bucket mapping (a pure helper); the
`/calendar` SSR route + its API fetcher/types + the date→type grouping render + the nav flip + the
sitemap-entry injection + SEO meta; tests on both sides.

**Explicitly out of scope (see §5):** the NEU-404 schema itself; any **per-user** calendar, reminders,
"add to watchlist", or ICS/notifications (a **FUTURE watchlist project**); digital/physical/TV release
types (TMDB 4/5/6) and multi-region/per-country views; historical/past releases beyond the small
"today" boundary; pagination UI.

---

## 2. Architecture & approach

### 2.1 The `GET /calendar` query (NEU-408)

A new public route in `routers/public.py`, alongside the existing public reads, served by a new
`service.get_calendar(...)` — same layering and signature shape as `get_feed_grouped`:

```
GET /calendar?limit=100&offset=0
  └─ service.get_calendar(session, *, limit, offset) -> CalendarResponse
```

- `limit`: `Query(default=100, ge=1, le=200)` — a calendar window is naturally larger than a feed
  page; default 100 rows, hard-capped (the FE renders the whole window without paging in v1, §2.5).
- `offset`: `Query(default=0, ge=0)` — kept for envelope consistency / future "load more"; v1 FE
  doesn't send it.

**Source.** The NEU-404 per-film / per-country release-dates table — referred to here as
`catalog.film_release_date(film_id, iso_3166_1, release_date, release_type, …)`, one row per
(film, country, release_date, TMDB type). **Exact table/column names are owned by NEU-404**; this spec
only assumes a queryable `(film_id, iso_3166_1, release_date, release_type ∈ 1..6)` shape (§3.1).

**Future-first, single-region, distinct (film, date, bucket) rows.** Conceptually:

```sql
SELECT f.slug, f.title, f.poster_path,
       r.release_date,
       r.release_type                       -- TMDB int 1|2|3 (→ bucket in Python, §2.2)
FROM   catalog.film_release_date r
JOIN   catalog.film f ON f.id = r.film_id
WHERE  r.iso_3166_1 = :region              -- 'US' (§2.3)
  AND  r.release_type IN (1, 2, 3)         -- premiere / limited / wide only (§2.2)
  AND  r.release_date >= :today            -- UTC "today", inclusive (§3.3)
  AND  f.slug IS NOT NULL                  -- has a public detail page (§3.2)
  AND  COALESCE(f.adult, FALSE) = FALSE    -- safety filter (§3.2)
GROUP BY f.slug, f.title, f.poster_path, r.release_date, r.release_type, f.popularity
ORDER BY r.release_date ASC, r.release_type ASC,
         f.popularity DESC NULLS LAST, f.slug ASC
LIMIT :limit OFFSET :offset
```

- **`GROUP BY` (or `SELECT DISTINCT`) over (film, date, type)** collapses TMDB's frequent duplicate
  rows (multiple entries per country/type with different `note`/`certification`) into one calendar row
  per (film, US date, bucket). A film with both a limited and a wide US date → two rows (different
  dates and/or types); a genuinely re-released film with two limited dates → two rows. Intended.
- **`release_type ASC` doubles as the bucket order.** TMDB's integer order `1 < 2 < 3` is exactly the
  desired display significance `premiere < limited < wide`, so ordering by the raw type yields
  date-then-type adjacency the FE can group on with no extra rank column (mirrors NEU-364, where the
  pure ranker kept the SQL order-independent).
- **`total`** = `SELECT count(*)` over the same grouped query without `ORDER BY`/`LIMIT`/`OFFSET` —
  the number of (film, date, bucket) rows in the window (mirrors `get_feed_grouped`'s group count).
- Postgres-specific SQL is fine (tests run against real Postgres; prod is Postgres).

The TMDB→bucket mapping is applied **in Python** on each row (pure helper, §2.2), keeping the SQL a
straight projection and the mapping unit-testable in isolation.

### 2.2 TMDB release `type` → display bucket (the festival/premiere decision)

NEU-404 stores TMDB's per-country `type` integer (`/movie/{id}/release_dates`):

| TMDB `type` | TMDB meaning | M6 display bucket |
|---|---|---|
| **1** | **Premiere** | **`premiere`** |
| **2** | Theatrical (limited) | **`limited`** |
| **3** | Theatrical (wide) | **`wide`** |
| 4 | Digital | *(excluded, v1)* |
| 5 | Physical | *(excluded, v1)* |
| 6 | TV | *(excluded, v1)* |

A pure module mirrors `public/arc.py`'s style:

```python
# src/upmovies/public/release.py
# TMDB release_dates `type` ints (per /movie/{id}/release_dates):
#   1 Premiere · 2 Theatrical (limited) · 3 Theatrical (wide) · 4 Digital · 5 Physical · 6 TV
RELEASE_BUCKETS: tuple[str, ...] = ("premiere", "limited", "wide")  # display + significance order
_TMDB_TYPE_TO_BUCKET: dict[int, str] = {1: "premiere", 2: "limited", 3: "wide"}

def bucket_for_tmdb_type(tmdb_type: int) -> str | None:
    """Return the calendar display bucket for a TMDB release `type`, or None if not surfaced."""
    return _TMDB_TYPE_TO_BUCKET.get(tmdb_type)
```

**The festival/premiere decision (explicit).** The product asked for buckets *limited / wide /
festival / premiere*, noting "festival ≈ Premiere." **TMDB has no distinct festival type** — festival
screenings (Cannes, TIFF, Venice, …) are encoded as **type 1 Premiere**, distinguishable only by the
free-text `note` ("Cannes Film Festival"). **Decision: collapse "festival" into a single `premiere`
bucket; do not split it out in v1.** Splitting on `note` substrings is fragile, locale-dependent, and
out of scope. (The NEU-404 `note` can later feed an optional sub-label like *"Premiere · Cannes"*
without changing buckets — deferred.) So the festival/premiere pair becomes **one** `premiere` bucket,
giving v1 the three theatrical-arc buckets **premiere → limited → wide**.

**Why 4/5/6 are excluded (v1).** The calendar is a *theatrical/premiere* release calendar — the beats
an upcoming-movies tracker cares about. Digital/physical/TV are deferred (§5); adding any is a
one-line `_TMDB_TYPE_TO_BUCKET` entry + widening the SQL `IN (...)`, so exclusion is a scoping choice,
not an architectural limit.

### 2.3 Which region defines the listed date (single governing region = US)

A film carries a *different* release date per country. To give the calendar one canonical date per
(film, bucket) — and to avoid the same film smeared across dozens of country-dates — **v1 scopes the
listed date to a single governing region: `iso_3166_1 = 'US'`.** Rationale:

- The US theatrical date is the dominant signal for this product's audience and the most consistently
  populated in TMDB.
- One region ⇒ one date per (film, bucket) ⇒ a clean, deterministic, de-duplicated calendar.

The region is a **named constant** (`CALENDAR_REGION = "US"`) so it is trivially configurable later.
**A film with no US row for types 1–3 simply doesn't appear** in v1 — no cross-country fallback (kept
deterministic and simple; a "earliest worldwide date" fallback or a region selector is a documented
future option, §5). This is an intentional, documented narrowing for the MVP.

### 2.4 Response envelope (flat list, grouped by date → type client-side)

Mirror the grouped-feed contract (`FeedDayResponse`) exactly — a **flat, server-ordered list** the FE
buckets, not a pre-nested tree. New DTOs in `public/dto.py`:

```python
class CalendarItem(BaseModel):
    film_slug: str
    film_title: str
    poster_path: str | None
    release_date: date          # the US release date → serializes "YYYY-MM-DD"
    release_type: str           # display bucket: "premiere" | "limited" | "wide"

class CalendarResponse(BaseModel):
    items: list[CalendarItem]   # ordered release_date ASC, then bucket significance, then popularity, slug
    total: int                  # number of (film, date, bucket) rows in the window
    limit: int
    offset: int
```

- `release_date` is a `date` (not datetime) → `"YYYY-MM-DD"`, groupable directly by the FE (like
  `FeedDayItem.day`).
- `release_type` is the **bucket string**, not the raw TMDB int — the FE renders it via a label map
  and never sees TMDB's numbering. The server's `release_date ASC, type ASC` order means items arrive
  **date-then-type adjacent**, so the client groups by walking the list (no client sort → SSR/CSR
  determinism, mirroring `groupByDay`).

The router (`routers/public.py`):

```python
@router.get("/calendar", response_model=CalendarResponse)
async def get_calendar(
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> CalendarResponse:
    return await service.get_calendar(session, limit=limit, offset=offset)
```

### 2.5 The `/calendar` SSR route (NEU-409)

A new public SSR route under the existing `public-layout`, following the established
`loader → meta → component → ErrorBoundary` template (`feed.tsx` is the closest sibling — a flat list
grouped at render time, no pagination UI):

```
route("calendar", "routes/calendar.tsx")   // added to the public-layout block in routes.ts
```

```
GET /calendar
  └─ loader({ context })
       ├─ env = context.get(cloudflareContext).env             // API_BASE_URL
       └─ getCalendar(env.API_BASE_URL)                          // src/api/public.ts → CalendarResponse
            ├─ 200 → { items, total, limit, offset }
            └─ non-OK/network → throw ──────────► route ErrorBoundary (neutral)
  meta() → buildMeta({ title: "Release Calendar", description, type: "website", pathname })
  default CalendarPage({ loaderData })
       ├─ items.length === 0 → empty state ("No upcoming releases yet — check back soon.")  // 200, indexable
       └─ groupByReleaseDate(items) → date sections → per-type sub-groups of CalendarFilmCard
```

Proposed files:

| File | Action | Responsibility |
|---|---|---|
| `src/routes.ts` | modify | Add `route("calendar", "routes/calendar.tsx")` inside the `public-layout` block. |
| `src/routes/calendar.tsx` | create | `loader` (`getCalendar`), `meta` (`buildMeta`), `CalendarPage`, `ErrorBoundary` — `feed.tsx` shape. |
| `src/api/public.ts` | modify | Add `getCalendar(baseUrl, { limit?, offset? }): Promise<CalendarResponse>` (pure, base-URL-injected, no creds; throws on non-OK; **no 404 branch** — the calendar is always 200). |
| `src/api/types.ts` | modify | Add `CalendarItem` + `CalendarResponse` (mirror the backend DTOs). |
| `src/lib/calendar-groups.ts` | create | `groupByReleaseDate(items)` → date sections, each with per-bucket sub-groups (adjacency walk, mirrors `groupByDay`). |
| `src/components/calendar/CalendarFilmCard.tsx` | create | One film cell: `posterUrl(poster_path, "w185")` + title, the whole cell `Link to="/film/{slug}"`. |
| `src/components/calendar/release-labels.ts` | create | `RELEASE_BUCKET_LABELS` (`premiere`→"Premiere", `limited`→"Limited release", `wide`→"Wide release") + `releaseBucketLabel(bucket)`. |
| `src/components/layout/nav-items.ts` | modify | Flip the existing `Calendar` entry `enabled: false → true` (no header surgery — NEU-398's seat goes live). |
| `src/routes/sitemap.ts` | modify | Inject a `/calendar` `<url>` into the proxied sitemap (§3.4). |

**FE types** mirror the backend DTOs:

```ts
// src/api/types.ts
export interface CalendarItem {
  film_slug: string;
  film_title: string;
  poster_path: string | null;     // raw TMDB path; FE builds the URL via posterUrl()
  release_date: string;           // "YYYY-MM-DD" (US date)
  release_type: string;           // bucket: "premiere" | "limited" | "wide" — rendered via releaseBucketLabel
}
export interface CalendarResponse { items: CalendarItem[]; total: number; limit: number; offset: number; }
```

**Fetcher** — beside `getFeedGrouped`/`getFilm`, same shape (always 200):

```ts
// src/api/public.ts
export async function getCalendar(
  baseUrl: string,
  { limit = 100, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<CalendarResponse> {
  const url = new URL("/calendar", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET /calendar failed: ${res.status}`);
  return (await res.json()) as CalendarResponse;
}
```

**Grouping render.** `groupByReleaseDate` walks the backend-ordered list into date sections, and
within each date into per-bucket sub-groups — pure adjacency, no client sort (the server already
ordered `date ASC, type ASC`), so SSR and client output match (the NEU-312/364 determinism rule):

```ts
// shape produced by groupByReleaseDate(items)
{ dateKey: "2026-07-04",
  heading: "Saturday, July 4, 2026",            // formatDayHeading(dateKey) — reuses src/lib/format.ts
  buckets: [ { bucket: "premiere", label: "Premiere",         films: CalendarItem[] },
             { bucket: "limited",  label: "Limited release",  films: CalendarItem[] },
             { bucket: "wide",     label: "Wide release",     films: CalendarItem[] } ] }
```

`release_date` is already `"YYYY-MM-DD"`; passing it to the existing `formatDayHeading`/`dayKey`
(both `timeZone: "UTC"`) renders the heading correctly (UTC-midnight parse). `CalendarPage` renders
`<time dateTime={dateKey}>{heading}</time>` per date, a small label per bucket, and a grid/list of
`CalendarFilmCard`s under each bucket. **Empty state** (`items.length === 0`) is a friendly 200,
indexable message — not an error. **Errors** (fetcher throws) surface the neutral route
`ErrorBoundary` + a link home — same shape as `feed.tsx`/`film.tsx`. **No pagination UI in v1** — the
default window (limit 100) renders whole; "load more" / month paging is a documented future (§5).

**Nav link.** NEU-398 already renders a `Calendar` nav seat as an inert placeholder. This milestone
flips its `enabled` flag — a one-line change; `PrimaryNav` then renders it as a live `NavLink` to
`/calendar` with no other header change.

---

## 3. Cross-cutting decisions

### 3.1 Dependency on NEU-404 (hard blocker)

`GET /calendar` reads **only** the per-country release-dates table defined by **NEU-404**; it cannot
ship or be meaningfully tested before that table exists and is populated. **NEU-408 is blocked by
NEU-404; NEU-409 is blocked by NEU-408.** This spec **assumes** a queryable
`(film_id, iso_3166_1, release_date, release_type ∈ 1..6)` shape and **does not** define, migrate, or
alter it — column/table names are NEU-404's to finalize; the calendar service adapts to whatever
NEU-404 lands (the query in §2.1 is illustrative). If NEU-404 also normalizes `note`/`certification`,
the calendar ignores them in v1 (reserved for future sub-labels).

### 3.2 Visibility rule (slug-gated, not summary-gated)

The film index/feed gate on `slug IS NOT NULL` **and** ≥1 *summarized* event (`_visible_events()` /
`has_summary`). **The calendar deliberately gates only on `slug IS NOT NULL`** (+ a `NOT adult`
safety filter) — **not** on having summarized news. Rationale: the **release date itself is the
content** the calendar exists to show; requiring news would hide *dated-but-quiet* films (precisely
the upcoming titles a calendar should surface) and defeat the page's purpose. `slug IS NOT NULL`
remains required so every listed film has a public `/film/{slug}` page to link to. This is the
"publicly-visible films **where sensible**" call: visible = has a public page, not = has news.

### 3.3 Timezone / "today" handling

"Today forward" uses a **UTC** boundary for determinism and SSR-cache friendliness, consistent with
the feed's UTC day handling (NEU-364). The service computes `today = datetime.now(tz=UTC).date()` in
Python and binds it as the `release_date >= :today` parameter — **not** SQL `CURRENT_DATE` (which
depends on the session timezone). `release_date` is a date (no time), so "today" is inclusive: a film
releasing today still appears. Viewer-local-timezone nuance at the day boundary is a negligible MVP
edge and is not modeled.

### 3.4 SEO

- `meta()` routes through `buildMeta(...)` (title "Release Calendar", a descriptive
  `description`, `type: "website"`, canonical/OG/Twitter via the existing helper) — uniform with
  `/`, `/film/:slug`, `/browse`.
- **Sitemap:** like `/browse` (M3), the FE `routes/sitemap.ts` **injects** a `/calendar` `<url>` into
  the proxied backend sitemap (derive the base from the upstream root `<loc>`, insert before
  `</urlset>`, keep the existing pass-through/cache/failure-fallback behavior). **No backend sitemap
  change** — keeps the backend ticket purely the data endpoint and the FE owning its route inventory.
- `routes/robots.ts` already `Allow: /` everything except `/login|/signup|/admin/`, so `/calendar` is
  crawlable with no change.
- The empty state and the default window are **HTTP 200, indexable**; the calendar is a single
  canonical page (no `?page=` thin-page concern in v1).

### 3.5 Determinism & runtime (FE)

`groupByReleaseDate` does **no** client sort and **no** `Date.now()`; it relies on the server order
and `timeZone: "UTC"` formatting, so SSR HTML and first client paint are byte-identical (NEU-312/364
rule). `getCalendar` uses only web `fetch`/`URL` (runs in workerd and under MSW); the page body stays
**provider-free** (no React Query/Auth) — only NEU-398's `HeaderAccount` island touches auth.

---

## 4. Milestone acceptance

**NEU-408 — `GET /calendar` (backend)**
- New public `GET /calendar?limit&offset` returns `CalendarResponse` `{ items, total, limit, offset }`,
  reading the NEU-404 release-dates table.
- Items are **future-first**: `release_date >= today (UTC)`, ordered `release_date ASC, release_type
  ASC, popularity DESC NULLS LAST, slug ASC`; one row per **(film, US date, bucket)**.
- TMDB types map to buckets **1→premiere, 2→limited, 3→wide** via the pure `public/release.py` helper;
  **festival collapses into `premiere`** (documented); types **4/5/6 excluded**.
- Date is scoped to **`iso_3166_1 = 'US'`** (named constant); films with no US type-1/2/3 row don't
  appear.
- Visibility = **`slug IS NOT NULL`** + `NOT adult` (no summary gate, §3.2); `total` = window row count.
- Tests (pytest, real Postgres): bucket mapping unit tests (1/2/3 → premiere/limited/wide; 4/5/6 → not
  surfaced); integration — future-first cutoff (past dates excluded, today included), US-only scoping
  (non-US rows ignored), date-then-type ordering, distinct (film, date, bucket) de-dup, slug-null
  exclusion, adult exclusion, `limit`/`offset` + `total`, empty result. `task test`/`lint`/`typecheck`
  green; `task format` clean.

**NEU-409 — `/calendar` SSR route (frontend)**
- A public SSR route `/calendar` consumes `GET /calendar` and renders upcoming releases **grouped by
  date (soonest-first) then by release type** (premiere → limited → wide), each film a card linking to
  `/film/{slug}` (poster + title; placeholder for null poster).
- The header's **Calendar** nav entry is **live** (`enabled: true`).
- **SEO:** `meta()` via `buildMeta` (title/description/OG/canonical); `/calendar` present in the FE
  sitemap; crawlable in robots.
- **Empty state** is a graceful 200 ("No upcoming releases yet"); fetch failure surfaces the neutral
  `ErrorBoundary`.
- New `getCalendar` fetcher + `CalendarItem`/`CalendarResponse` types mirror the backend DTOs;
  `groupByReleaseDate` is a pure, deterministic grouping helper.
- Tests (Vitest + RTL + MSW): loader (MSW-mocked `GET /calendar`), date→type grouped render + film
  links, label mapping, empty state, error boundary, nav-entry-live, sitemap `/calendar` injection,
  `groupByReleaseDate` unit tests. `task test`/`lint` (zero warnings)/`typecheck` green; touched files
  prettier-clean.

---

## 5. Out of scope / deferred

| Item | Where it lives |
|---|---|
| **The release-dates schema/ingestion** (the `(film, country, release_date, type)` table) | **NEU-404** (Comprehensive film page milestone). M6 only *reads* it. |
| **Per-user calendar, reminders, "add to watchlist", ICS export, notifications** | A **FUTURE watchlist project.** M6 is a single public, identity-free page — no personalization. |
| **Digital / physical / TV release types (TMDB 4/5/6)** | Deferred. Adding any is a one-line mapping + SQL `IN(...)` widening; not in v1's theatrical/premiere scope. |
| **Splitting "festival" from "premiere"** (e.g. via the TMDB `note`) | Collapsed into `premiere` in v1 (§2.2). A `note`-derived sub-label is a future polish, not a new bucket. |
| **Multi-region / per-country calendar; region selector; cross-country date fallback** | v1 is **US-only** (§2.3). Region is a constant ready to parametrize later. |
| **Historical / past releases** beyond the inclusive "today" boundary | Out — the calendar is forward-looking (`release_date >= today`). No "recently released" view here. |
| **Pagination / "load more" / month navigation UI** | v1 renders the default window (limit 100) whole; `limit`/`offset` exist on the API for a future "load more". |
| **Backend sitemap change for `/calendar`** | None — injected FE-side in the sitemap proxy (mirrors `/browse`, §3.4). |
| **Any visual redesign / design-system work** | Reuse existing Tailwind/utility styling and the shared header/footer; no restyle. |

---

## 6. Risks / notes

- **Hard dependency on NEU-404.** Nothing here is testable until that table lands and is populated;
  the §2.1 SQL is illustrative and must be reconciled to NEU-404's final column names. Sequence:
  NEU-404 → NEU-408 → NEU-409.
- **US-coverage sparsity.** If TMDB US release dates are thin for upcoming titles, the calendar may
  look sparse. Accepted for v1 (deterministic, simple); the documented fallback/region levers (§2.3,
  §5) are the escape hatch. Surface via the empty/short state, not an error.
- **TMDB duplicate rows.** Per-country/type entries frequently duplicate (different `note`/
  `certification`); the `GROUP BY`/`DISTINCT` over (film, date, type) is load-bearing to avoid
  repeated calendar rows.
- **Determinism.** Keep all ordering server-side and all FE grouping adjacency-based with UTC
  formatting — no client sort, no `Date.now()` — or SSR/CSR diverge (NEU-312/364).
- **Nav coupling to NEU-398.** The Calendar seat must already exist in `NAV_ITEMS`; M6 only flips
  `enabled`. If M6 somehow precedes NEU-398's seat, add the entry rather than restructuring the header.

## Sources

- Backend public endpoints/services — `src/upmovies/routers/public.py`,
  `src/upmovies/public/{service.py,dto.py,arc.py,sitemap.py}` (the `get_feed_grouped` flat-list +
  pure-ranker + UTC-day pattern this mirrors); `src/upmovies/catalog/models.py` (`Film.slug`,
  `Film.adult`, `Film.popularity`).
- Sibling design — [2026-06-23-neu-364-per-film-per-day-feed-grouping-design.md](2026-06-23-neu-364-per-film-per-day-feed-grouping-design.md)
  (flat grouped endpoint, `total` = group count, UTC day handling).
- FE route template — `src/routes/feed.tsx` (`loader → meta → component → ErrorBoundary`),
  `src/lib/feed-groups.ts` (`groupByDay` adjacency walk), `src/lib/format.ts`
  (`formatDayHeading`/`dayKey`, UTC), `src/lib/seo.ts` (`buildMeta`), `src/lib/poster.ts`
  (`posterUrl`), `src/api/public.ts` (`getFeedGrouped` fetcher), `src/routes/sitemap.ts` (proxy +
  injection precedent), `src/components/layout/nav-items.ts` (the `Calendar` seat).
- Sibling milestone — [2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md](2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md)
  (public SSR route + sitemap injection + `NAV_ITEMS` flip).
- TMDB `release_dates` `type` enum (1 Premiere · 2 Theatrical limited · 3 Theatrical · 4 Digital ·
  5 Physical · 6 TV) — https://developer.themoviedb.org/reference/movie-release-dates.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
