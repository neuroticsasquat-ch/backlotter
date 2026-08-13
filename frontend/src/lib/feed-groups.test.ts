import { describe, expect, it } from "vitest";
import {
  MAX_DAY_POSTERS,
  dayPosterLeads,
  groupByDay,
  groupEventsByDay,
  splitByNewsBacked,
} from "@/lib/feed-groups";
import type { FeedDayItem, FilmEvent } from "@/api/types";

function item(day: string, film_slug: string, overrides: Partial<FeedDayItem> = {}): FeedDayItem {
  return {
    film_slug,
    film_title: film_slug.toUpperCase(),
    release_year: 2026,
    poster_path: null,
    arc_stage: "shooting",
    day,
    top_event_type: "casting",
    event_types: ["casting"],
    event_count: 1,
    news_backed: false,
    ...overrides,
  };
}

describe("groupByDay", () => {
  it("returns an empty array for no items", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("buckets same-day items into one group, preserving input order", () => {
    const groups = groupByDay([item("2026-06-23", "a"), item("2026-06-23", "b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].dayKey).toBe("2026-06-23");
    expect(groups[0].items.map((i) => i.film_slug)).toEqual(["a", "b"]);
  });

  it("opens a new group on a day boundary, keeping groups newest-first", () => {
    const groups = groupByDay([
      item("2026-06-23", "a"),
      item("2026-06-23", "b"),
      item("2026-06-22", "c"),
    ]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-06-23", "2026-06-22"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items.map((i) => i.film_slug)).toEqual(["c"]);
    expect(groups[1].heading).toContain("June 22, 2026");
  });
});

describe("splitByNewsBacked", () => {
  it("returns two empty lists for no items", () => {
    expect(splitByNewsBacked([])).toEqual({ newsBacked: [], tmdbOnly: [] });
  });

  it("partitions on news_backed, preserving the backend's within-day order in each list", () => {
    // Interleaved on input: the split must not reorder within either bucket.
    const { newsBacked, tmdbOnly } = splitByNewsBacked([
      item("2026-06-23", "a", { news_backed: true }),
      item("2026-06-23", "b"),
      item("2026-06-23", "c", { news_backed: true }),
      item("2026-06-23", "d"),
    ]);
    expect(newsBacked.map((i) => i.film_slug)).toEqual(["a", "c"]);
    expect(tmdbOnly.map((i) => i.film_slug)).toEqual(["b", "d"]);
  });

  it("puts every item in one bucket when the day is all news-backed", () => {
    const { newsBacked, tmdbOnly } = splitByNewsBacked([
      item("2026-06-23", "a", { news_backed: true }),
      item("2026-06-23", "b", { news_backed: true }),
    ]);
    expect(newsBacked).toHaveLength(2);
    expect(tmdbOnly).toEqual([]);
  });

  it("puts every item in one bucket when the day is all TMDB-only", () => {
    const { newsBacked, tmdbOnly } = splitByNewsBacked([
      item("2026-06-23", "a"),
      item("2026-06-23", "b"),
    ]);
    expect(newsBacked).toEqual([]);
    expect(tmdbOnly).toHaveLength(2);
  });

  it("keeps every input item — the split partitions, it never drops or caps", () => {
    const items = Array.from({ length: 74 }, (_, n) =>
      item("2026-08-11", `film-${n}`, { news_backed: n % 3 === 0 }),
    );
    const { newsBacked, tmdbOnly } = splitByNewsBacked(items);
    expect(newsBacked.length + tmdbOnly.length).toBe(74);
  });
});

function event(created_at: string, summary: string): FilmEvent {
  return {
    event_id: "evt-default",
    event_type: "casting",
    confidence: "confirmed",
    created_at,
    summary,
    summary_edited: false,
    provenance: "story",
    sources: [],
  };
}

describe("groupEventsByDay", () => {
  it("returns an empty array for no events", () => {
    expect(groupEventsByDay([])).toEqual([]);
  });

  it("orders days newest-first and events newest-first within a day", () => {
    // Input is ascending by created_at, as the backend returns it.
    const groups = groupEventsByDay([
      event("2026-06-22T08:00:00Z", "older day"),
      event("2026-06-23T08:00:00Z", "same day, earlier"),
      event("2026-06-23T20:00:00Z", "same day, later"),
    ]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-06-23", "2026-06-22"]);
    expect(groups[0].events.map((e) => e.summary)).toEqual([
      "same day, later",
      "same day, earlier",
    ]);
    expect(groups[1].events.map((e) => e.summary)).toEqual(["older day"]);
  });

  it("derives the UTC day key and human heading from created_at", () => {
    const groups = groupEventsByDay([event("2026-06-23T23:30:00Z", "late evening UTC")]);
    expect(groups[0].dayKey).toBe("2026-06-23");
    expect(groups[0].heading).toContain("June 23, 2026");
  });
});

describe("dayPosterLeads", () => {
  /** Local helper: unlike the shared `item`, these default to *having* a poster. */
  function poster(film_slug: string, overrides: Partial<FeedDayItem> = {}): FeedDayItem {
    return item("2026-06-23", film_slug, { poster_path: `/${film_slug}.jpg`, ...overrides });
  }

  it("puts news-backed films ahead of TMDB-only ones regardless of backend order", () => {
    // Backend order within a day is by popularity, so the two kinds arrive interleaved.
    const leads = dayPosterLeads([
      poster("primetime"),
      poster("animals", { news_backed: true }),
      poster("dorothy"),
      poster("charlie", { news_backed: true }),
    ]);
    expect(leads.map((i) => i.film_slug)).toEqual(["animals", "charlie", "primetime", "dorothy"]);
  });

  it("keeps backend order (popularity) within each kind", () => {
    const leads = dayPosterLeads([
      poster("popular", { news_backed: true }),
      poster("less-popular", { news_backed: true }),
    ]);
    expect(leads.map((i) => i.film_slug)).toEqual(["popular", "less-popular"]);
  });

  it("drops films with no poster rather than holding a blank slot", () => {
    const leads = dayPosterLeads([
      poster("no-poster", { news_backed: true, poster_path: null }),
      poster("has-poster"),
    ]);
    expect(leads.map((i) => i.film_slug)).toEqual(["has-poster"]);
  });

  it("caps the strip so a backfill day does not load dozens of images", () => {
    const many = Array.from({ length: 40 }, (_, i) => poster(`film-${i}`));
    expect(dayPosterLeads(many)).toHaveLength(MAX_DAY_POSTERS);
  });

  it("returns nothing for a day whose films all lack posters", () => {
    expect(dayPosterLeads([poster("x", { poster_path: null })])).toEqual([]);
  });
});
