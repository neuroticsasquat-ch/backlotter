# NEU-2272 — Cache public entity pages at the edge for unhinted visitors

**Ticket:** NEU-2272 · **Related:** NEU-2271 (merged; the API half) · **ADR:**
`../adr/0029-entity-pages-are-edge-cached-for-unhinted-visitors.md` · **Background:**
`../adr/0026-timeline-hint-cookie.md`, `../adr/0028-overload-sheds-in-one-process.md`,
`../measurements/2026-11-10-neu-2271-pool-baseline.md`

Frontend only. Paths below are relative to `frontend/`.

## Problem

Every load of `/film/:ref`, `/person/:ref`, `/studio/:ref` or `/franchise/:ref` is rendered on the
Worker and makes one or two API reads. A crawl therefore lands in full on the API's one process.
NEU-2271 made that fail fast; it did not reduce the load.

The 2026-11-09/10 crawl loaded about 240 distinct entity pages roughly once each. A cache only
absorbs repeated loads of the same page, so the TTL is long (one hour): pages have to be warm
already, from ordinary traffic, when a crawl arrives.

## Decisions

**D-2272.1 — Cache API in the Worker.** The Worker is the origin for `backlotter.com`, so
Cloudflare's CDN cache and Cache Rules never see its responses. `caches.default` is the only
option. It is per data center, GET-only, has no stale-while-revalidate, and refuses responses
with `Set-Cookie`.

**D-2272.2 — What is cacheable.** A request is a cache candidate only when all of these hold:

- method is `GET`;
- the pathname matches one entity page: `/(film|person|studio|franchise)/<one segment>`, and does
  not end in `.data` (React Router's client-navigation payloads stay uncached);
- the request's `Cookie` header carries no timeline hint (`readTimelineHint` from
  `lib/timeline-hint.ts`; reuse it, do not re-parse);
- a build SHA is compiled in (`__GIT_SHA__`, read the way `lib/sentry.ts` reads it). No SHA, as in
  local dev and tests of the default path, means the cache is off. So does a release that is not
  a commit SHA (7–40 hex digits): a dashboard *Retry build* reports `main`, which would give two
  deploys one key.

Everything else on an entity path is a **bypass**: rendered as today, never read from or written
to the cache. Non-entity paths are untouched and get no header.

**D-2272.3 — The key.** A synthetic GET `Request` for `<origin><pathname>?v=<build SHA>`. The
incoming query string is dropped, so `?utm_source=…` neither busts nor fragments the cache. The
SHA is there because the document references hashed asset URLs.

**D-2272.4 — What is stored.** Only a `200` rendered from a candidate request **whose URL had no
query string**. (Reads ignore the query; writes require none. Entity pages read no query
parameters today, and this keeps a future one from being baked into the shared copy.) The stored
copy carries `Cache-Control: public, max-age=3600`. If the rendered response has a `Set-Cookie`
header, do not store it. Store with `ctx.waitUntil(cache.put(key, response.clone()))`, so the
visitor's response is not delayed and the streamed body is stored whole.

**D-2272.5 — What is served.** On a hit, the cached body and status with the stored
`Cache-Control` removed: browsers get no caching headers they don't get today. Every response on
an entity path carries `X-Backlotter-Cache`:

| Value | When |
|---|---|
| `HIT` | served from the cache; the route loaders did not run |
| `MISS` | candidate request, rendered (and stored if it was a query-less 200) |
| `BYPASS` | entity path, not a candidate (hinted, non-GET, `.data`, or no build SHA) |

**D-2272.6 — TTL is a constant.** `ENTITY_PAGE_TTL_SECONDS = 3600` in the new module. No env var:
a `wrangler.jsonc` var needs a merge to change anyway.

**D-2272.7 — Accepted staleness.** Anonymous visitors may see a page up to an hour behind the
API, including a story an admin has just delinked. No purge. Hinted visitors (subscribers, the
admin) always get a fresh render.

## Shape of the change

- **New `src/lib/edge-cache.ts`** (with `edge-cache.test.ts` beside it), free of Worker-only
  globals so it type-checks and tests under Vitest like `lib/load-context.ts`:
  - `entityPageCacheKey(request: Request, buildSha: string | undefined): Request | null` — the
    candidate test of D-2272.2 and the key of D-2272.3; `null` means bypass.
  - `isEntityPagePath(pathname: string): boolean`.
  - `serveEntityPage(request, { cache, buildSha, waitUntil, render })` — the match / render /
    store flow and the header. `cache` is a minimal `{ match, put }` interface so tests pass a
    `Map`-backed fake; `render` is `() => Promise<Response>`.
- **`workers/app.ts`**: after the Sentry tunnel branch and `throwIfWorkerTestError`, route the
  request through `serveEntityPage` with `caches.default`, `ctx.waitUntil.bind(ctx)` and the
  existing `requestHandler(request, context)` call as `render`. `_ctx` becomes `ctx`. It stays
  inside `withSentry`.
- **Docs:** a short "Edge cache" subsection in `CLAUDE.md` → *Frontend* (what is cached, the
  bypass rule, the header, and the rule from ADR-0029 that new per-visitor variation must join the
  bypass or the key). ADR-0029 is already written. `CONTEXT.md` needs nothing: no new domain term.

## Acceptance criteria

- [ ] `entityPageCacheKey` returns the same key for `/person/1-a` and `/person/1-a?utm_source=x`,
  different keys for two SHAs, and `null` for: a request with `timeline_hint` in `Cookie`, a
  `POST`, `/person/1-a.data`, `/feed`, `/`, `/person/1-a/extra`, and any request when the SHA is
  undefined.
- [ ] `serveEntityPage` tests with a fake cache and a counting `render`:
  - two unhinted GETs of the same page call `render` once; headers are `MISS` then `HIT`; the
    second body equals the first;
  - a hinted GET after that calls `render` again, answers `BYPASS`, and leaves the cache as it was;
  - a hinted GET on a cold cache stores nothing, and the next unhinted GET is a `MISS`
    (a hinted render is never served to an unhinted visitor);
  - a `404`, a `301` and a `500` from `render` are not stored;
  - a `200` rendered for a URL with a query string is not stored, but that URL is served a `HIT`
    once a query-less load has stored the page;
  - a `200` with `Set-Cookie` is not stored;
  - a `HIT` response has no `Cache-Control` header.
- [ ] `task fe:lint && task fe:typecheck && task fe:test` pass; `task fe:deploy-dry-run` builds.
- [ ] After deploy, recorded on the ticket: `curl -s -o /dev/null -D - https://backlotter.com/person/<ref>`
  twice shows `x-backlotter-cache: MISS` then `HIT`; the same with `-H 'Cookie: timeline_hint=1'`
  shows `BYPASS`. (A GET with the body discarded, not `curl -I`: a `HEAD` is not a candidate and
  always answers `BYPASS`. The cache is per data center; run both from one machine.)
- [ ] `CLAUDE.md` carries the Edge cache subsection.

## Out of scope

- **Feed, calendar, `/`.** `/` varies on the hint in its body; a separate decision.
- **`.data` responses** (client-side navigations).
- **A hinted variant**, **404 caching**, **a purge**, **a configurable TTL.** Each was considered
  and rejected; see ADR-0029.
- **Anything on the API.** No backend change.

## Notes for the implementer

- The ticket's wording ("the cache key has to include whether that cookie is set") was superseded
  in planning: hinted requests bypass instead of getting a second variant. The DoD's "test on the
  cache key" is met by the `null`-key and bypass tests above.
- `cache.put` rejects a response whose `Cache-Control` forbids caching and never stores one with
  `Set-Cookie`; build the stored copy's headers explicitly instead of trusting the render's.
- Hits return before the loaders run, so they cost no API read and are not seen by the backend's
  rate limiter. That is intended.
- `film.tsx` computes `watchable` from "today" in its loader. It rides in the cached loader data,
  so server and client still agree; it can be up to an hour old across a UTC midnight.
