import type { CalendarResponse, FeedDayResponse, FilmDetail, FilmIndexResponse } from "./types";

/**
 * Fetch a film's public detail from the no-auth backend. The base URL is injected by the
 * caller (the SSR loader reads it from the Worker env), so this stays pure and runs in the
 * Workers runtime and under test. No credentials/CSRF — the public API is unauthenticated.
 * Returns null on 404; throws on any other non-OK response.
 */
export async function getFilm(baseUrl: string, slug: string): Promise<FilmDetail | null> {
  const res = await fetch(new URL(`/films/${encodeURIComponent(slug)}`, baseUrl), {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /films/${encodeURIComponent(slug)} failed: ${res.status}`);
  return (await res.json()) as FilmDetail;
}

/** Grid-friendly page size for the /browse index; within the backend's 1..100 limit bound. */
export const PAGE_SIZE = 36;

export async function getFilms(
  baseUrl: string,
  { limit = PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<FilmIndexResponse> {
  const url = new URL("/films", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET /films failed: ${res.status}`);
  return (await res.json()) as FilmIndexResponse;
}

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

/**
 * Fetch the per-(film, day) grouped public feed from the no-auth backend (NEU-364). The base URL is
 * injected by the caller (the SSR loader reads it from the Worker env), so this stays pure and runs
 * in the Workers runtime and under test. Always responds 200 (no 404 branch); throws on any non-OK.
 */
export async function getFeedGrouped(
  baseUrl: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<FeedDayResponse> {
  const url = new URL("/feed/grouped", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
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
  { limit = 100, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<CalendarResponse> {
  const url = new URL("/calendar", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET /calendar failed: ${res.status}`);
  return (await res.json()) as CalendarResponse;
}
