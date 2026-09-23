import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { Follow } from "@/api/types";

const base = env.apiBaseUrl;

/** A stateful stand-in for `/me/follows`: the writes land in memory and the reads see them, so
 *  a test can click a toggle and assert on what the next refetch gets back rather than on the
 *  request alone. One store per `followGraphHandlers()` call, so tests never share state.
 *
 *  Mirrors the backend's toggle semantics (NEU-1349, NEU-1432): a create answers 201 with the
 *  new row and 200 with the existing one, so clicking twice is not an error; a delete answers
 *  204. A follow is binary, and every kind — a film's included, since EF-14 retired the
 *  watchlist — goes through this one pair of routes. */
export function followGraphHandlers(
  initial: {
    follows?: Follow[];
    /** What the catalog can name, keyed `"<entity_type>:<entity_id>"` — consulted by the
     *  create below, the way the backend consults `follow_repo.get_entity_label`. */
    catalog?: Record<string, { name: string; image_path?: string | null }>;
  } = {},
) {
  const follows: Follow[] = [...(initial.follows ?? [])];

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
      // The backend resolves the label from the catalog and *refuses* a follow it cannot name
      // — `follow_service.follow` raises `NotFound` when the label is None — so a created row
      // never comes back with a null name. Never null here either, therefore: an unlisted
      // entity gets a stand-in rather than the impossible state. (A row in `initial.follows`
      // may still be null-named: the *list* route does return those, for a follow whose entity
      // the catalog lost afterwards, which D-40 keeps.)
      const known = initial.catalog?.[`${body.entity_type}:${body.entity_id}`];
      const created: Follow = {
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        name: known?.name ?? `${body.entity_type} ${body.entity_id}`,
        image_path: known?.image_path ?? null,
        headline_release: null,
        source: "manual",
        created_at: new Date().toISOString(),
        // Nothing has been published through a follow created a moment ago, which is the null
        // the backend answers with too — not a missing value (EF-15).
        last_activity_at: null,
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
  ];

  return { handlers, follows };
}

/** The 403 every `/me/*` route answers with for an account that has not been granted access
 *  (D-39) — the one failure the toggles render as a state rather than reporting. */
export function entitlementRequiredHandlers() {
  const deny = () => HttpResponse.json({ detail: "entitlement_required" }, { status: 403 });
  return [
    http.get(`${base}/me/follows`, deny),
    http.post(`${base}/me/follows`, deny),
    http.delete(`${base}/me/follows/:entityType/:entityId`, deny),
  ];
}

/** One follow row as `GET /me/follows` answers it. `name`/`image_path` default to null — the
 *  unresolvable case D-40 keeps — so a test that cares about a label says so.
 *
 *  `last_activity_at` and `headline_release` default to null as well, which is a real state
 *  rather than a stand-in: a follow that has delivered nothing yet, on an entity with no date
 *  of its own. A test about the activity sort or a film's date passes its own. */
export function makeFollow(overrides: Partial<Follow> = {}): Follow {
  return {
    entity_type: "person",
    entity_id: "525",
    name: null,
    image_path: null,
    headline_release: null,
    source: "manual",
    created_at: "2026-09-12T00:00:00Z",
    last_activity_at: null,
    ...overrides,
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
