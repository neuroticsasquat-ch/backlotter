import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { EntityEventsPage, FilmEvent } from "@/api/types";

const base = env.apiBaseUrl;

/** The three routes an entity page's Recent activity section reads (EF-18), by the word the
 *  follow graph uses for each. `franchise` reads `/collections` — the backend keeps TMDB's
 *  noun where the page says "Franchise". */
const PATHS = {
  person: "people",
  company: "companies",
  franchise: "collections",
} as const;

export type EntityEventsKindFixture = keyof typeof PATHS;

/** One card in an entity's stream. Defaults to a `casting` attach, which is the shape EF-18 is
 *  about; a test that wants a detach or a cancellation overrides `event_type`. */
export function makeEvent(overrides: Partial<FilmEvent> = {}): FilmEvent {
  return {
    event_id: "e1111111-1111-4111-8111-111111111111",
    event_type: "casting",
    confidence: "confirmed",
    created_at: "2026-09-20T10:00:00Z",
    occurred_at: "2026-09-20T10:00:00Z",
    summary: "Christopher Nolan joins The Odyssey as director.",
    summary_edited: false,
    provenance: "story",
    status: "published",
    superseded_by: null,
    video_key: null,
    sources: [],
    ...overrides,
  };
}

/**
 * A keyset-paging handler for one entity kind's `/events` route.
 *
 * Pages over a fixed list the way the backend does: `limit` cards at a time, `next_cursor`
 * naming where the next page starts and null on the last one. The cursor is the index as a
 * string rather than the backend's opaque `(timestamp, uuid)` token — the client only ever
 * echoes it back, so what matters under test is that it is echoed and honoured.
 */
export function entityEventsHandler(kind: EntityEventsKindFixture, events: FilmEvent[]) {
  return http.get(`${base}/${PATHS[kind]}/:ref/events`, ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const from = Number(url.searchParams.get("cursor") ?? 0);
    const items = events.slice(from, from + limit);
    const end = from + items.length;
    return HttpResponse.json({
      items,
      next_cursor: end < events.length ? String(end) : null,
    } satisfies EntityEventsPage);
  });
}

/** The empty page the default handlers answer with, and what a test installs to prove a page
 *  renders its empty state rather than nothing at all. */
export function emptyEntityEventsHandler(kind: EntityEventsKindFixture) {
  return entityEventsHandler(kind, []);
}

/** Every kind at once, empty — the default for tests that are not about this section. */
export const entityEventsDefaults = [
  emptyEntityEventsHandler("person"),
  emptyEntityEventsHandler("company"),
  emptyEntityEventsHandler("franchise"),
];
