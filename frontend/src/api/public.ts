import type {
  CalendarResponse,
  CollectionSearchItem,
  CompanySearchItem,
  EntitySearchResponse,
  FeedDayResponse,
  FilmDetail,
  FilmIndexResponse,
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
  const res = await fetch(new URL(`/films/${encodeURIComponent(ref)}`, baseUrl), {
    headers: { Accept: "application/json", ...headers },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /films/${encodeURIComponent(ref)} failed: ${res.status}`);
  return (await res.json()) as FilmDetail;
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
  const url = new URL("/films/search", baseUrl);
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
    const url = new URL(path, baseUrl);
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
  const url = new URL("/people/popular", baseUrl);
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
  const url = new URL("/feed/grouped", baseUrl);
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
  const url = new URL("/calendar", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`GET /calendar failed: ${res.status}`);
  return (await res.json()) as CalendarResponse;
}
