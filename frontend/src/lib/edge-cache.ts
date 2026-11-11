import { readTimelineHint } from "@/lib/timeline-hint";

/**
 * The entity-page edge cache (NEU-2272, ADR-0029): the Worker keeps the server-rendered HTML of
 * `/film`, `/person`, `/studio` and `/franchise` pages in `caches.default` for an hour, so a burst
 * of loads of one page reaches the API once.
 *
 * Only the render for a request without the timeline hint is cached. A request carrying
 * `timeline_hint` bypasses the cache in both directions, so a visitor with the hint and one
 * without cannot receive each other's document (ADR-0026). Anything that later makes an entity page vary per visitor must join that bypass or
 * the key.
 *
 * Free of Worker-only globals, like `lib/load-context.ts`, so it type-checks and tests under the
 * client config; `workers/app.ts` hands it `caches.default` and the execution context.
 */

/** How long a stored page is served. A constant: a `wrangler.jsonc` var needs a merge anyway. */
export const ENTITY_PAGE_TTL_SECONDS = 3600;

/** Says what the cache did on every entity-path response: `HIT`, `MISS` or `BYPASS`. */
export const CACHE_STATUS_HEADER = "X-Backlotter-Cache";

type CacheStatus = "HIT" | "MISS" | "BYPASS";

/** The slice of the Cache API used here, so tests can pass a `Map`-backed fake. */
export interface PageCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

const ENTITY_PAGE_PATH = /^\/(film|person|studio|franchise)\/[^/]+$/;

/** A commit SHA, abbreviated or full. A dashboard-started build reports the branch name instead
 *  (`main`), which would give two deploys one key; such a build caches nothing. */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/;

/** Whether `pathname` is one entity page, its `.data` client-navigation payload included. */
export function isEntityPagePath(pathname: string): boolean {
  return ENTITY_PAGE_PATH.test(pathname);
}

/**
 * The cache key for `request`, or `null` when it must bypass the cache: not a `GET`, not an
 * entity page, a `.data` payload, a request carrying the timeline hint, or a build without a
 * commit SHA (local dev, a dashboard *Retry build*).
 *
 * The key is the page's path plus the build SHA. The query string is dropped, so tracking
 * parameters neither bust nor fragment the cache; the SHA is there because the document links
 * hashed assets, and a deploy must not serve the previous build's HTML.
 */
export function entityPageCacheKey(request: Request, buildSha: string | undefined): Request | null {
  if (!buildSha || !COMMIT_SHA.test(buildSha) || request.method !== "GET") return null;
  const url = new URL(request.url);
  if (!isEntityPagePath(url.pathname) || url.pathname.endsWith(".data")) return null;
  if (readTimelineHint(request.headers.get("Cookie"))) return null;
  return new Request(`${url.origin}${url.pathname}?v=${encodeURIComponent(buildSha)}`);
}

/** A copy of `response` with mutable headers: a cache hit's are immutable on the Worker. */
function withHeaders(response: Response, edit: (headers: Headers) => void): Response {
  const headers = new Headers(response.headers);
  edit(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withCacheStatus(response: Response, status: CacheStatus): Response {
  return withHeaders(response, (headers) => headers.set(CACHE_STATUS_HEADER, status));
}

/** Whether a rendered response may become the shared copy. Only a 200 for the bare path: entity
 *  pages read no query parameters today, and this keeps a future one out of the shared copy. The
 *  Cache API refuses `Set-Cookie`; skipping it here makes that explicit. */
function isStorable(response: Response, url: URL): boolean {
  return response.status === 200 && url.search === "" && !response.headers.has("Set-Cookie");
}

export interface ServeEntityPageOptions {
  cache: PageCache;
  buildSha: string | undefined;
  /** The execution context's `waitUntil`, so storing does not delay the visitor's response. */
  waitUntil: (promise: Promise<unknown>) => void;
  /** The SSR render the cache stands in front of. */
  render: () => Promise<Response>;
}

/** Serves `request` through the entity-page cache: a hit skips `render`, and so the loaders and
 *  their API reads; a candidate miss renders and stores; anything else renders as before. */
export async function serveEntityPage(
  request: Request,
  { cache, buildSha, waitUntil, render }: ServeEntityPageOptions,
): Promise<Response> {
  const url = new URL(request.url);
  if (!isEntityPagePath(url.pathname)) return render();

  const key = entityPageCacheKey(request, buildSha);
  if (!key) return withCacheStatus(await render(), "BYPASS");

  const cached = await cache.match(key);
  if (cached) {
    // The stored `Cache-Control` is for the cache alone; browsers get what they get today.
    return withHeaders(cached, (headers) => {
      headers.delete("Cache-Control");
      headers.set(CACHE_STATUS_HEADER, "HIT");
    });
  }

  const response = await render();
  if (isStorable(response, url)) {
    // Explicit headers: `cache.put` rejects a response whose own `Cache-Control` forbids storing.
    const stored = withHeaders(response.clone(), (headers) =>
      headers.set("Cache-Control", `public, max-age=${ENTITY_PAGE_TTL_SECONDS}`),
    );
    // A failed store only means a later miss; it must not surface as an unhandled rejection.
    waitUntil(cache.put(key, stored).catch(() => undefined));
  }
  return withCacheStatus(response, "MISS");
}
