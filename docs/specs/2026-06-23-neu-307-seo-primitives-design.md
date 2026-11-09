# SEO primitives (meta/OG + robots) — Design (NEU-307)

- **Date:** 2026-06-23
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-frontend` — new `src/lib/seo.ts` helper + two resource routes (`robots.txt`, `sitemap.xml`) + minimal Worker load-context wiring. No backend changes.
- **Linear:** NEU-307 `[frontend] SEO primitives (meta/OG + robots)` · project *Movies: Synthesis & Update Log* · milestone **M2 — Public rendering foundation**
- **Blocked by (merged):** NEU-306 (`[frontend] React Router v7/v8 SSR foundation`) — provides framework-mode `meta`/`links` route exports, the `root.tsx` document shell with `<Meta/>`/`<Links/>`, the `/preview` public route, and Workers Static Assets.
- **Blocks:** NEU-310 (`[frontend] SSR film update-log page`), NEU-312 (`[frontend] SSR feed landing page`) — both will consume the meta/OG helper this ticket ships.
- **Refs:** NEU-309 (`[backend] Public film index/detail API + sitemap`, merged) owns `GET /sitemap.xml`; spike NEU-260; design-of-record [2026-06-22-synthesis-update-log-design.md](2026-06-22-synthesis-update-log-design.md) §2.2.

## What this is

The per-route head + crawler basics the public pages need, built on the merged NEU-306
framework-mode SSR foundation. Three deliverables:

1. A reusable **meta/OG helper** (`buildMeta`) that public routes call from their framework-mode
   `meta()` export, so every public page renders a consistent `<title>` / meta-description /
   Open Graph / Twitter / canonical head — server-rendered into the HTML head.
2. A **`/robots.txt`** that allows crawling and references the sitemap.
3. A same-origin **`/sitemap.xml`** that forwards the backend's already-generated sitemap, so the
   sitemap and the frontend URLs it lists share a host.

It ships the helper and proves it on the existing `/preview` route. The real film/feed pages
(NEU-310/312) and per-film OG poster images are downstream consumers, not part of this ticket.

## Background (what already exists)

- **Frontend (NEU-306, merged):** React Router framework mode, `ssr: true`, on Cloudflare Workers.
  `src/root.tsx` is the document shell (`<Meta/>`/`<Links/>` in `<head>`). `src/routes/preview.tsx`
  is the one public SSR route and currently exports a stub `meta()` returning `[{ title: "Upcoming
  Movies" }]`. `public/` is served via Workers Static Assets (`favicon.svg`). `workers/app.ts`
  currently calls `createRequestHandler(...)` **without** a load context — the comment notes the
  `cloudflare.env` wiring "lands with the first SSR loader that needs cloudflare env (NEU-310)".
- **Backend (NEU-309, merged):** `GET /sitemap.xml` renders a standard `<urlset>` from the film
  index, listing **frontend** URLs — `{public_base_url}/` and one `{public_base_url}/film/{slug}`
  per indexed film. `public_base_url` is config (env `PUBLIC_BASE_URL`, default
  `http://localhost:5173`). The sitemap is served at the **API origin**, distinct from the host of
  the pages it lists. No production public domain is committed anywhere yet.

## Decisions (locked with Tom)

| Question | Decision |
|---|---|
| How `robots.txt` references the sitemap given the host mismatch | **Proxy `/sitemap.xml` through the FE Worker** — a same-origin resource route forwards the backend's sitemap so the sitemap and the frontend URLs it lists share a host (SEO-clean). Not a second generator. |
| Brand / site name | **"Upcoming Movies Tracker"** — title template `"<page> · Upcoming Movies Tracker"`; `og:site_name` the same. |
| Default Open Graph image | **Deferred.** The helper accepts an optional `image`; no site-wide default asset this ticket. Downstream film pages pass per-film posters (NEU-310); a site default can land then. |
| `robots.txt` contents | **Allow all, plus `Disallow: /login`, `/signup`, `/admin`** (non-content client-only routes), plus a same-origin `Sitemap:` line. |
| Absolute-URL source for canonical/`og:url` | **Build-time `VITE_PUBLIC_SITE_URL`** + the route's `location.pathname` — works identically in SSR and on client navigation (a framework-mode `meta()` function cannot read Worker runtime env). |
| Backend base URL for the sitemap proxy | **Runtime Worker env `API_BASE_URL`** via a minimal `getLoadContext`, consistent with NEU-306's "SSR reads `cloudflare.env`" split. 307's proxy becomes the first consumer of that wiring (NEU-310 reuses it). |
| `robots.txt` / `sitemap.xml` delivery | **Resource routes**, not files in `public/` — both need dynamic content (request origin / backend fetch). |

## Architecture

```
  crawler ── GET /robots.txt ──► FE Worker ──► text/plain
                                              (Sitemap: <request-origin>/sitemap.xml)

  crawler ── GET /sitemap.xml ─► FE Worker ──► fetch {API_BASE_URL}/sitemap.xml (backend NEU-309)
                                              └► application/xml passthrough

  crawler ── GET /preview ─────► FE Worker SSR ──► <head> built by buildMeta() via <Meta/> (root.tsx)
```

## Components

### 1. `src/lib/seo.ts` — the meta/OG helper

A pure function returning React Router's `MetaDescriptor[]` (the array a route `meta()` returns),
centralizing site defaults so every public route is consistent.

```ts
interface SeoInput {
  title?: string;        // page title; templated. Omit → site name only.
  description?: string;  // meta description; omit → site default.
  pathname: string;      // location.pathname → canonical + og:url (query dropped).
  image?: string;        // optional absolute/relative og + twitter image.
  type?: "website" | "article";  // og:type, default "website".
}

function buildMeta(input: SeoInput): MetaDescriptor[];
```

Emitted descriptors:

- `{ title }` — `"<title> · Upcoming Movies Tracker"`, or just `"Upcoming Movies Tracker"` when no
  `title`.
- `{ name: "description", content }` — `input.description` or the site default.
- Open Graph: `og:title`, `og:description`, `og:type`, `og:url`, `og:site_name`.
- Twitter: `twitter:card` (`summary`, upgraded to `summary_large_image` when `image` is set),
  `twitter:title`, `twitter:description`.
- `og:image` + `twitter:image` **only when `image` is provided** (deferred default).
- `{ tagName: "link", rel: "canonical", href }` — canonical link via meta's link-descriptor form.

**Absolute URLs:** `og:url` and canonical are `new URL(pathname, SITE_URL)` where
`SITE_URL = import.meta.env.VITE_PUBLIC_SITE_URL ?? "https://app.upmovies.localhost"`. Build-time so
it is identical on the server and after client navigation.

`charset` and `viewport` already live as static `<meta>` in `root.tsx`'s `Layout`, so the helper
does not emit them (no duplication).

*Alternative considered & rejected:* sourcing the origin from a root `loader` and reading it via
`matches`. More plumbing for a value that changes only on a domain move; the build-time var is
simpler and isomorphic.

### 2. `src/routes/robots.ts` — resource route → `/robots.txt`

A loader-only module (no default export ⇒ resource route), registered top-level in `routes.ts` as
`route("robots.txt", "routes/robots.ts")`. Returns `text/plain; charset=utf-8`:

```
User-agent: *
Allow: /
Disallow: /login
Disallow: /signup
Disallow: /admin
Sitemap: <origin>/sitemap.xml
```

`<origin>` is `new URL(request.url).origin`, so robots references the sitemap **same-host as
whatever serves it** (production or a preview deployment) — no env needed here.

### 3. `src/routes/sitemap.ts` — resource route → `/sitemap.xml`

Loader-only module, `route("sitemap.xml", "routes/sitemap.ts")`. Server-side `fetch`es
`{API_BASE_URL}/sitemap.xml` from the backend and passes the XML through with
`Content-Type: application/xml; charset=utf-8` and a modest `Cache-Control` (e.g.
`public, max-age=3600`). It mirrors the upstream status. **It does not generate a sitemap** — the
backend (NEU-309) stays the single source; this only makes it reachable same-origin so the listed
frontend URLs and the sitemap share a host.

`API_BASE_URL` is read from `context.cloudflare.env` (already present in `wrangler.jsonc`). This
requires the small `getLoadContext` addition below.

### 4. Worker load-context wiring (`workers/app.ts`)

Add the minimal `getLoadContext` that exposes `cloudflare.env` (and `ctx`) to loaders, and the
`AppLoadContext` type augmentation, per the current React Router + Cloudflare framework-mode API.
This is exactly the wiring NEU-306 deferred to "the first SSR loader that needs cloudflare env";
307's sitemap proxy is that first consumer and establishes the pattern NEU-310 reuses.

*Lighter alternative considered & rejected:* having the proxy read build-time
`import.meta.env.VITE_API_BASE_URL`. Rejected to honor NEU-306's "SSR backend calls go through
Worker runtime env" separation, and because NEU-310 needs the load-context wiring regardless.

### 5. Apply to `/preview`

Replace `preview.tsx`'s stub `meta()` with a `buildMeta({ title, description, pathname:
location.pathname })` call. This is the "sample public route" the AC's head-tags test targets; it
also serves as the worked example downstream routes copy.

## Configuration

- **New FE env `VITE_PUBLIC_SITE_URL`** — the public site origin for canonical/`og:url`. Added to
  `.env` and `.env.example` with a dev default of `https://app.upmovies.localhost`; production sets
  the real domain at build time (Cloudflare build env). The helper falls back to the dev default if
  unset.
- **Existing Worker env `API_BASE_URL`** (`wrangler.jsonc`, currently
  `https://api.upmovies.localhost`) — consumed by the sitemap proxy. No new var needed.
- **Backend `PUBLIC_BASE_URL`** must equal the public FE origin in each environment so the proxied
  sitemap lists URLs on the FE host. This is an existing backend setting (NEU-309); flagged here as
  a deploy-time coupling, not a code change in this ticket.

## Testing (Vitest; TDD)

- **`buildMeta` unit** — title templating (with and without a title), description default, the
  og/twitter/canonical descriptor set, and image present vs. absent (card type + image descriptors).
- **`/preview` route** — call the exported `meta(...)` with a mock `location` and assert the head
  descriptors include the templated title, description, `og:title`, and the canonical link. Satisfies
  the AC "Vitest asserts the head tags render for a sample public route."
- **robots loader** — invoke with a mock `Request`; assert the body lines, the same-origin
  `Sitemap:` directive, and `text/plain`.
- **sitemap loader** — mock `fetch`; assert it requests `{API_BASE_URL}/sitemap.xml`, returns the
  upstream body, and sets `application/xml`.
- **Gates:** `task test` / `task lint` (zero warnings) / `task typecheck` (`react-router typegen` +
  `tsc -b`) all green; `task format` on touched files only.

## Acceptance-criteria mapping (NEU-307)

| Ticket AC | Where covered |
|---|---|
| Per-route `<title>` / meta-description / Open Graph helper usable by SSR public routes, rendered into the head | `src/lib/seo.ts` `buildMeta`, used from route `meta()`, rendered via `<Meta/>` in `root.tsx` |
| Static `robots.txt` (allow crawl; reference the sitemap) | `/robots.txt` resource route — allow all, disallow authed paths, same-origin `Sitemap:` |
| Dynamic `sitemap.xml` generated from the film index endpoint; not duplicated here | `/sitemap.xml` proxy forwards backend NEU-309's sitemap; no second generator |
| Tests: Vitest asserts head tags render for a sample public route; `tsc -b` + eslint green | Tests above + gates |

## Out of scope / deferred

| Deferred item | Home |
|---|---|
| Sitemap generation (URLs, `lastmod`, inclusion rule) | Backend NEU-309 (merged) |
| Real public pages (film update-log, feed) + their per-route `meta()` calls | NEU-310 (M3), NEU-312 (M4) |
| Per-film OG poster images; a site-wide default OG image asset | NEU-310 (poster passthrough) / later |
| `/` → public-feed swap | NEU-312 (M4) |
| Edge/server-side error reporting | Later (NEU-306 kept Sentry client-only) |

## Risks / notes

- **Dev TLS for the sitemap proxy.** In local dev the proxy fetches `https://api.upmovies.localhost`
  (self-signed via Traefik) from the workerd runtime, which may reject the cert. Tests mock `fetch`
  so CI is unaffected; live local verification of the proxy may need the cert trusted (or an
  internal plain-HTTP base). Not a production concern.
- **`getLoadContext` is the one structural addition.** Keep it minimal — just enough to expose
  `env.API_BASE_URL` to the resource-route loader — matching the current framework-mode Cloudflare
  template so NEU-310 extends rather than reworks it.
- **`PUBLIC_BASE_URL` ↔ FE origin coupling.** If the backend's `PUBLIC_BASE_URL` does not match the
  FE public origin, the proxied sitemap lists URLs on a different host than serves it — defeating the
  point of the proxy. A deploy-time check, noted above.

## Sources

- React Router — route module `meta` export (descriptors, `tagName` link form) —
  https://reactrouter.com/start/framework/route-module
- React Router — resource routes (loader-only modules returning a `Response`) —
  https://reactrouter.com/how-to/resource-routes
- React Router on Cloudflare — `getLoadContext` / `cloudflare.env` —
  https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/
- NEU-306 design — [2026-06-22-neu-306-ssr-foundation-design.md](2026-06-22-neu-306-ssr-foundation-design.md)
- NEU-309 design — [2026-06-22-neu-309-public-film-api-design.md](2026-06-22-neu-309-public-film-api-design.md)
