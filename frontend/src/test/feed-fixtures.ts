import type { FeedDayItem, FeedDayResponse } from "@/api/types";

/** Builders for the grouped-feed DTO. Shared by the global feed, the two routes that render it
 *  and the timeline, because `/me/timeline` answers with the same shape (NEU-1351) — one set of
 *  fixtures, so a change to the contract breaks every surface at once rather than one at a time. */
export function dayItem(film_ref: string, overrides: Partial<FeedDayItem> = {}): FeedDayItem {
  return {
    film_ref,
    film_title: film_ref.toUpperCase(),
    release_year: 2026,
    poster_path: null,
    arc_stage: "shooting",
    production_countries: [],
    directors: [],
    day: "2026-06-23",
    top_event_type: "casting",
    event_types: ["casting"],
    event_count: 1,
    news_backed: false,
    events: [],
    ...overrides,
  };
}

/** One day, ordered as the backend returns it. */
export function oneDay(...items: FeedDayItem[]): FeedDayResponse {
  return { items, total: 1, limit: 10, offset: 0 };
}

/** Two days, the newer one news-backed with a poster — the fixture the route tests assert
 *  grouping, ordering and poster-strip behaviour against. */
export const feed: FeedDayResponse = {
  items: [
    {
      ...dayItem("the-odyssey-2026", {
        film_title: "The Odyssey",
        poster_path: "/odyssey.jpg",
        day: "2026-06-23",
        top_event_type: "trailer",
        event_types: ["trailer"],
        news_backed: true,
      }),
      events: [
        {
          event_id: "evt-odyssey-trailer",
          event_type: "trailer",
          confidence: "confirmed",
          created_at: "2026-06-23T12:00:00Z",
          occurred_at: "2026-06-23T12:00:00Z",
          summary: "The first trailer for The Odyssey was released.",
          summary_edited: false,
          status: "published",
          superseded_by: null,
          provenance: "story",
          sources: [],
        },
      ],
    },
    dayItem("dune-3-2026", {
      film_title: "Dune Part Three",
      day: "2026-06-22",
      event_count: 3,
    }),
  ],
  total: 2,
  limit: 50,
  offset: 0,
};
