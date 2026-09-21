import type {
  CalendarResponse,
  CollectionDetail,
  CollectionSearchItem,
  CompanyDetail,
  CompanySearchItem,
  EntitySearchResponse,
  FeedDayResponse,
  FilmDetail,
  FilmIndexResponse,
  PersonDetail,
  PersonSearchItem,
  PopularPeopleResponse,
} from "./types";

/**
 * Extra request headers. SSR loaders pass the signing headers from `lib/ssr-origin.ts` so the
 * backend rate limiter keys on the visitor rather than on the Worker's egress IP (NEU-1344 §4);
 * browser-side callers omit them.
 */
type ExtraHeaders = { headers?: Record<string, string> };

/**
 * One request URL, from a base that may be absolute or relative.
 *
 * Both spellings are real and neither is a mistake. SSR loaders get the absolute
 * `API_BASE_URL` Worker binding; the browser gets the build-time `VITE_API_BASE_URL`, which in
 * dev is **`/api`** so that requests go same-origin through Vite's proxy — the thing that keeps
 * the session cookie and the CSRF header behaving in dev exactly as they do in prod.
 *
 * `new URL(path, base)` cannot take the relative one: it throws `TypeError` on `("/films/search",
 * "/api")`, before any request is made, which is how this silently killed search and both
 * "View more" buttons in dev for as long as it did (NEU-1421). And resolving the *path*
 * against an origin is not a fix either — `new URL("/films/search", "http://host/api")` drops
 * the `/api`, because an absolute path replaces the base's path.
 *
 * So: concatenate base and path the way `api/client.ts` does, then resolve the whole thing.
 * `globalThis.location` is undefined in the Workers runtime, which is fine there — the
 * concatenated string is already absolute, so the second argument goes unused.
 */
function apiUrl(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl.replace(/\/$/, "")}${path}`, globalThis.location?.origin);
}

/**
 * Fetch a film's public detail from the no-auth backend. The base URL is injected by the
 * caller (the SSR loader reads it from the Worker env), so this stays pure and runs in the
 * Workers runtime and under test. No credentials/CSRF — the public API is unauthenticated.
 * Returns null on 404; throws on any other non-OK response.
 */
/** Fetch a film by URL ref. A legacy slug, a bare id, or a stale decorative half all resolve;
 *  the returned `ref` is the canonical one, which the caller redirects to. */
export async function getFilm(
  baseUrl: string,
  ref: string,
  { headers }: ExtraHeaders = {},
): Promise<FilmDetail | null> {
  const res = await fetch(apiUrl(baseUrl, `/films/${encodeURIComponent(ref)}`), {
    headers: { Accept: "application/json", ...headers },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /films/${encodeURIComponent(ref)} failed: ${res.status}`);
  return (await res.json()) as FilmDetail;
}

/** Fetch a person by URL ref (NEU-1418). Resolves on the ref's leading id like the film
 *  fetcher, so a bare id or a stale decorative half both reach the person and the returned
 *  `ref` is the canonical one the caller redirects to. Null on 404 — an unknown id, or one
 *  TMDB has since deleted. */
export async function getPerson(
  baseUrl: string,
  ref: string,
  { headers }: ExtraHeaders = {},
): Promise<PersonDetail | null> {
  const res = await fetch(apiUrl(baseUrl, `/people/${encodeURIComponent(ref)}`), {
    headers: { Accept: "application/json", ...headers },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /people/${encodeURIComponent(ref)} failed: ${res.status}`);
  return (await res.json()) as PersonDetail;
}

/** Fetch a studio by URL ref (NEU-1428). `company` in the URL and in the code, "Studio" on
 *  screen (EF-19). Resolves on the ref's leading id like the person fetcher, and the returned
 *  `ref` is the canonical one the caller redirects to. Null on 404. */
export async function getCompany(
  baseUrl: string,
  ref: string,
  { headers }: ExtraHeaders = {},
): Promise<CompanyDetail | null> {
  const res = await fetch(apiUrl(baseUrl, `/companies/${encodeURIComponent(ref)}`), {
    headers: { Accept: "application/json", ...headers },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /companies/${encodeURIComponent(ref)} failed: ${res.status}`);
  return (await res.json()) as CompanyDetail;
}

/** Fetch a franchise by URL ref (NEU-1428). The backend spells a franchise `collection` —
 *  TMDB's word for it — so the path is `/collections/{ref}` while the route it feeds is
 *  `/franchise/:ref`. Otherwise {@link getCompany}, down to the 404 and the canonical ref. */
export async function getCollection(
  baseUrl: string,
  ref: string,
  { headers }: ExtraHeaders = {},
): Promise<CollectionDetail | null> {
  const res = await fetch(apiUrl(baseUrl, `/collections/${encodeURIComponent(ref)}`), {
    headers: { Accept: "application/json", ...headers },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /collections/${encodeURIComponent(ref)} failed: ${res.status}`);
  return (await res.json()) as CollectionDetail;
}

/** No `headers` option: search runs only from the browser (the type-ahead in `SearchBox`), which
 *  already reaches the backend with the visitor's own IP. An SSR caller would need to add one. */
export async function getFilmSearch(
  baseUrl: string,
  q: string,
  {
    limit = 20,
    offset = 0,
    signal,
  }: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<FilmIndexResponse> {
  const url = apiUrl(baseUrl, "/films/search");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`GET /films/search failed: ${res.status}`);
  return (await res.json()) as FilmIndexResponse;
}

/** The entity searches behind the "follow something" box (NEU-1350). Public, like film search
 *  and for the same reason — the film page's follow buttons and the onboarding grid render
 *  before anyone knows whether the visitor is entitled — so they go through these pure fetchers
 *  rather than `apiFetch`, and carry no credentials.
 *
 *  One builder for three endpoints that differ only in their path and item type: the backend
 *  answers the same `{items, total, limit, offset}` envelope for all three, and giving each its
 *  own copy of this function would mean three places to change when that envelope moves. */
function entitySearch<T>(path: string) {
  return async (
    baseUrl: string,
    q: string,
    {
      limit = 20,
      offset = 0,
      signal,
    }: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<EntitySearchResponse<T>> => {
    const url = apiUrl(baseUrl, path);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return (await res.json()) as EntitySearchResponse<T>;
  };
}

export const getPeopleSearch = entitySearch<PersonSearchItem>("/people/search");
export const getCompaniesSearch = entitySearch<CompanySearchItem>("/companies/search");
export const getCollectionsSearch = entitySearch<CollectionSearchItem>("/collections/search");

/** The faces the onboarding grid offers (D-17): the most popular people who have a profile
 *  photo, capped rather than paged. Public like the searches above — step 2 of `/welcome`
 *  renders before the follow graph is read, and the endpoint has no auth of its own. */
export async function getPopularPeople(
  baseUrl: string,
  { limit = 30, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<PopularPeopleResponse> {
  const url = apiUrl(baseUrl, "/people/popular");
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`GET /people/popular failed: ${res.status}`);
  return (await res.json()) as PopularPeopleResponse;
}

/**
 * Fetch the per-(film, day) grouped public feed from the no-auth backend (NEU-364). The base URL is
 * injected by the caller (the SSR loader reads it from the Worker env), so this stays pure and runs
 * in the Workers runtime and under test. Always responds 200 (no 404 branch); throws on any non-OK.
 */
export async function getFeedGrouped(
  baseUrl: string,
  { limit = 50, offset = 0, headers }: { limit?: number; offset?: number } & ExtraHeaders = {},
): Promise<FeedDayResponse> {
  const url = apiUrl(baseUrl, "/feed/grouped");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`GET /feed/grouped failed: ${res.status}`);
  return (await res.json()) as FeedDayResponse;
}

/**
 * Fetch the release calendar (upcoming releases grouped by date) from the no-auth backend (NEU-408).
 * The base URL is injected by the caller (the SSR loader reads it from the Worker env), so this stays
 * pure and runs in the Workers runtime and under test. Always responds 200 (no 404 branch); throws
 * on any non-OK.
 */
export async function getCalendar(
  baseUrl: string,
  { limit = 100, offset = 0, headers }: { limit?: number; offset?: number } & ExtraHeaders = {},
): Promise<CalendarResponse> {
  const url = apiUrl(baseUrl, "/calendar");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`GET /calendar failed: ${res.status}`);
  return (await res.json()) as CalendarResponse;
}
