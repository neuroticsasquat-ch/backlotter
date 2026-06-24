import { describe, expect, it } from "vitest";
import { groupByDay } from "@/lib/feed-groups";
import type { FeedDayItem } from "@/api/types";

function item(day: string, film_slug: string, event_count = 1): FeedDayItem {
  return {
    film_slug,
    film_title: film_slug.toUpperCase(),
    poster_path: null,
    day,
    top_event_type: "casting",
    event_count,
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
