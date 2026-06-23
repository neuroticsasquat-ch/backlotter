import type { FilmDetail } from "./types";

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
