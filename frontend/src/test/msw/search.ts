import { http, HttpResponse } from "msw";
import { env } from "@/env";
import type {
  CollectionSearchItem,
  CompanySearchItem,
  FilmIndexItem,
  FilmIndexResponse,
  PersonSearchItem,
} from "@/api/types";

const base = env.apiBaseUrl;

export function filmsSearchHandler(
  override: Partial<FilmIndexResponse> & { items?: FilmIndexItem[]; status?: number } = {},
) {
  const { status, ...rest } = override;
  if (status) {
    return http.get(`${base}/films/search`, () => new HttpResponse(null, { status }));
  }
  const response: FilmIndexResponse = {
    items: rest.items ?? [],
    total: rest.total ?? rest.items?.length ?? 0,
    limit: rest.limit ?? 20,
    offset: rest.offset ?? 0,
  };
  return http.get(`${base}/films/search`, () => HttpResponse.json(response));
}

/** Every endpoint the header's `SearchBox` calls, in one `server.use(...)`.
 *
 *  MSW is configured `onUnhandledRequest: "error"`, and one query now fans out to four
 *  endpoints — so a test that stubs only the films search fails on the other three rather
 *  than on what it meant to assert. Everything defaults to an empty page, which is also the
 *  shape that makes a group render nothing at all. */
export function headerSearchHandlers(
  items: {
    films?: FilmIndexItem[];
    people?: PersonSearchItem[];
    companies?: CompanySearchItem[];
    collections?: CollectionSearchItem[];
    /** When set, all four endpoints answer with this status and no body. */
    status?: number;
  } = {},
) {
  const paths = ["/films/search", "/people/search", "/companies/search", "/collections/search"];
  if (items.status) {
    const { status } = items;
    return paths.map((path) =>
      http.get(`${base}${path}`, () => new HttpResponse(null, { status })),
    );
  }
  const page = <T>(rows: T[] | undefined) =>
    HttpResponse.json({ items: rows ?? [], total: rows?.length ?? 0, limit: 5, offset: 0 });
  return [
    http.get(`${base}/films/search`, () => page(items.films)),
    http.get(`${base}/people/search`, () => page(items.people)),
    http.get(`${base}/companies/search`, () => page(items.companies)),
    http.get(`${base}/collections/search`, () => page(items.collections)),
  ];
}
