import { http, HttpResponse } from "msw";
import type { FilmIndexResponse, FilmIndexItem } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

export function filmsSearchHandler(
  override: Partial<FilmIndexResponse> & { items?: FilmIndexItem[]; status?: number } = {},
) {
  const { status, ...rest } = override;
  if (status) {
    return http.get(`${BACKEND}/films/search`, () => new HttpResponse(null, { status }));
  }
  const response: FilmIndexResponse = {
    items: rest.items ?? [],
    total: rest.total ?? rest.items?.length ?? 0,
    limit: rest.limit ?? 20,
    offset: rest.offset ?? 0,
  };
  return http.get(`${BACKEND}/films/search`, () => HttpResponse.json(response));
}
