# ADR-0029 — Entity pages are edge-cached for an hour, for unhinted visitors only

**Status:** Accepted 2026-11-11 (NEU-2272) · **Spec:** `../specs/NEU-2272-edge-cache-entity-pages.md`
· **Builds on:** ADR-0026 (timeline hint), ADR-0028 (overload sheds in one process)

## Context

Every load of a public entity page (`/film/…`, `/person/…`, `/studio/…`, `/franchise/…`) is
server-rendered on the Worker and costs one or two API reads. ADR-0028 made the API fail fast
under a burst, and named edge caching as the lever that reduces the load itself.

Three facts shaped the decision:

- **The Worker is the origin.** `backlotter.com` is a Worker custom domain, so Cloudflare's CDN
  cache and Cache Rules never see its responses. The only cache available is the Worker's own
  Cache API (`caches.default`). It is per data center, has no tiered cache and no
  stale-while-revalidate, stores GETs only, and refuses a response with `Set-Cookie`.
- **The crawl went wide, not deep.** The 2026-11-09/10 incident was 484 timeouts over about 240
  entity pages at two reads per person page: roughly one load per page
  (`../measurements/2026-11-10-neu-2271-pool-baseline.md`). A cache absorbs only repeated loads of
  one page in one data center, so a short TTL would have absorbed almost none of it.
- **The document varies on one cookie.** ADR-0026: the public layout renders the header nav from
  `timeline_hint`. Nothing else in an entity page's document depends on the visitor, and the
  entity routes read no query parameters.

## Decision

The Worker caches the server-rendered **HTML document** of an entity page in `caches.default`.

- **TTL: one hour.** Entity data changes at most hourly (the `hourly` feeds pass), and only a long
  TTL keeps pages warm from ordinary traffic so that a wide crawl finds anything cached.
- **Hinted requests bypass the cache.** A request carrying `timeline_hint` is neither served from
  the cache nor stored in it. Only the unhinted render is ever cached, so a hinted and an unhinted
  visitor cannot receive each other's document, by construction. This is how ADR-0026's "the cache
  key must vary on `timeline_hint`" is met: with one variant and a bypass, not two variants.
- **Key: the page's path plus the build SHA.** The query string is ignored. The SHA is in the key
  because the document references hashed asset URLs: a deploy must not serve the previous build's
  HTML. A build whose release is not a commit SHA caches nothing: a dashboard *Retry build*
  reports the branch name (`main`), which would give two deploys one key.
- **Only 200s are stored.** 404s, the 301 canonical-ref redirects and errors always render.
- **Every entity response says what happened:** `X-Backlotter-Cache: HIT | MISS | BYPASS`.

## Why not the alternatives

- **A short TTL (~60 s).** Near-zero staleness, but it only helps when one page is loaded many
  times in a minute. That is not what the incident was.
- **A second cached variant for hinted visitors.** It would serve subscribers, and the admin,
  pages up to an hour old, and on a site with few subscribers that copy would rarely be warm.
- **Caching the API's JSON instead.** Still a Worker render per load, and the SSR fetches are
  signed per visitor, which complicates a shared key.
- **A purge on moderation.** `cache.delete` reaches only the data center the Worker ran in. A real
  purge needs the Cloudflare zone API and a token on the backend. Not worth it for the hour it
  saves.

## Consequences

- An anonymous visitor can see an entity page up to one hour behind the API: a new event, a
  changed release date, or a story an admin has just delinked. The admin sees their own change at
  once, because they carry the hint.
- A forged `timeline_hint` cookie skips the cache. That costs one full render, which is what every
  load costs today. It is not an escalation, but it does mean the cache is not a defence against a
  crawler that sends the cookie.
- The hit rate is bounded by per-data-center storage and a long-tail catalogue. The first load of
  each page in each data center still reaches the API; NEU-2271's fast 503s remain the backstop.
- A cached page costs the API nothing, so it is also not counted by the per-visitor rate limiter.
- Each deploy starts with an empty cache. Old entries expire on their own within the hour.
- Feed, calendar and `.data` (client-navigation) responses are not cached. `/` in particular
  renders differently per hint in its body, not only its nav; caching it is a separate decision.
- Anything that later makes an entity page's document depend on the visitor (a second cookie, a
  query parameter, a `Set-Cookie`) must either join the bypass condition or the key.
