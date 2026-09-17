import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { Follow, WatchlistFilm, WatchlistItem } from "@/api/types";

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
    release_date: "2026-07-17",
    ...overrides,
  };
}
