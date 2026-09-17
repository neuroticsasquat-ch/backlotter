import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { AlertPref, Follow, WatchlistFilm, WatchlistItem } from "@/api/types";

const base = env.apiBaseUrl;

/** A stateful stand-in for `/me/follows` and `/me/watchlist`: the writes land in memory and
 *  the reads see them, so a test can click a toggle and assert on what the next refetch gets
 *  back rather than on the request alone. One store per `followGraphHandlers()` call, so
 *  tests never share state.
 *
 *  Mirrors the backend's toggle semantics (NEU-1349): a create answers 201 with the new row
 *  and 200 with the existing one, so clicking twice is not an error; a delete answers 204. */
export function followGraphHandlers(
  initial: { follows?: Follow[]; watchlist?: WatchlistItem[] } = {},
) {
  const follows: Follow[] = [...(initial.follows ?? [])];
  const watchlist: WatchlistItem[] = [...(initial.watchlist ?? [])];

  const handlers = [
    http.get(`${base}/me/follows`, () => HttpResponse.json({ items: follows })),

    http.post(`${base}/me/follows`, async ({ request }) => {
      const body = (await request.json()) as {
        entity_type: Follow["entity_type"];
        entity_id: string;
      };
      const existing = follows.find(
        (f) => f.entity_type === body.entity_type && f.entity_id === body.entity_id,
      );
      if (existing) return HttpResponse.json(existing, { status: 200 });
      const created: Follow = {
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        source: "manual",
        created_at: new Date().toISOString(),
      };
      follows.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.delete(`${base}/me/follows/:entityType/:entityId`, ({ params }) => {
      const i = follows.findIndex(
        (f) => f.entity_type === params.entityType && f.entity_id === params.entityId,
      );
      if (i === -1) return HttpResponse.json({ detail: "follow_not_found" }, { status: 404 });
      follows.splice(i, 1);
      return new HttpResponse(null, { status: 204 });
    }),

    http.get(`${base}/me/watchlist`, () => HttpResponse.json({ items: watchlist })),

    http.post(`${base}/me/watchlist`, async ({ request }) => {
      const body = (await request.json()) as { film_id: string };
      const existing = watchlist.find((item) => item.film.id === body.film_id);
      if (existing) return HttpResponse.json(existing, { status: 200 });
      const item: WatchlistItem = {
        film: makeWatchlistFilm({ id: body.film_id }),
        source: "manual",
        alert_prefs: ["stream"],
        created_at: new Date().toISOString(),
      };
      watchlist.push(item);
      return HttpResponse.json(item, { status: 201 });
    }),

    http.patch(`${base}/me/watchlist/:filmId`, async ({ params, request }) => {
      const body = (await request.json()) as { alert_prefs: AlertPref[] };
      const item = watchlist.find((row) => row.film.id === params.filmId);
      if (!item) return HttpResponse.json({ detail: "watchlist_item_not_found" }, { status: 404 });
      item.alert_prefs = body.alert_prefs;
      return HttpResponse.json(item, { status: 200 });
    }),

    http.delete(`${base}/me/watchlist/:filmId`, ({ params }) => {
      const i = watchlist.findIndex((item) => item.film.id === params.filmId);
      if (i === -1)
        return HttpResponse.json({ detail: "watchlist_item_not_found" }, { status: 404 });
      watchlist.splice(i, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return { handlers, follows, watchlist };
}

/** The 403 every `/me/*` route answers with for an account that has not been granted access
 *  (D-39) — the one failure the toggles render as a state rather than reporting. */
export function entitlementRequiredHandlers() {
  const deny = () => HttpResponse.json({ detail: "entitlement_required" }, { status: 403 });
  return [
    http.get(`${base}/me/follows`, deny),
    http.post(`${base}/me/follows`, deny),
    http.delete(`${base}/me/follows/:entityType/:entityId`, deny),
    http.get(`${base}/me/watchlist`, deny),
    http.post(`${base}/me/watchlist`, deny),
    http.patch(`${base}/me/watchlist/:filmId`, deny),
    http.delete(`${base}/me/watchlist/:filmId`, deny),
  ];
}

export function makeWatchlistFilm(overrides: Partial<WatchlistFilm> = {}): WatchlistFilm {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tmdb_id: 603,
    slug: "the-odyssey",
    title: "The Odyssey",
    poster_path: "/poster.jpg",
    // An upcoming wide US opening — the ordinary case, so a test naming no headline release
    // gets the row that renders every part of the line.
    headline_release: { date: "2026-07-17", kind: "upcoming", country: "US", bucket: "wide" },
    ...overrides,
  };
}

/** `makeWatchlistFilm`'s counterpart for a whole row. `source` defaults to `manual` because a
 *  derived item is the case a test opts into — its removal is the one that needs a confirm. */
export function makeWatchlistItem(
  overrides: Partial<Omit<WatchlistItem, "film">> & { film?: Partial<WatchlistFilm> } = {},
): WatchlistItem {
  const { film, ...rest } = overrides;
  return {
    film: makeWatchlistFilm(film),
    source: "manual",
    alert_prefs: ["stream"],
    created_at: "2026-09-01T00:00:00Z",
    ...rest,
  };
}

/** The three public entity searches (NEU-1350). One handler per endpoint, each answering the
 *  same paged envelope, so a test names the items it wants back and nothing else. */
export function entitySearchHandlers(
  items: {
    people?: { id: number; name: string; known_for_department?: string | null }[];
    companies?: { id: number; name: string; origin_country?: string | null }[];
    collections?: { id: number; name: string }[];
  } = {},
) {
  const page = <T>(rows: T[]) =>
    HttpResponse.json({ items: rows, total: rows.length, limit: 10, offset: 0 });
  return [
    http.get(`${base}/people/search`, () =>
      page(
        (items.people ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          known_for_department: p.known_for_department ?? "Directing",
          profile_path: null,
        })),
      ),
    ),
    http.get(`${base}/companies/search`, () =>
      page(
        (items.companies ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          logo_path: null,
          origin_country: c.origin_country ?? "US",
        })),
      ),
    ),
    http.get(`${base}/collections/search`, () =>
      page((items.collections ?? []).map((c) => ({ id: c.id, name: c.name, poster_path: null }))),
    ),
  ];
}
