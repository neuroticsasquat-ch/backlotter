import { describe, expect, it } from "vitest";
import { groupByDay } from "@/lib/feed-groups";
import type { FeedItem } from "@/api/types";

function item(created_at: string, summary: string): FeedItem {
  return {
    film_slug: "f",
    film_title: "F",
    event_type: "casting",
    confidence: "confirmed",
    occurred_at: created_at,
    created_at,
    summary,
    sources: [],
  };
}

describe("groupByDay", () => {
  it("returns an empty array for no items", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("buckets same-UTC-day items into one group, preserving input order", () => {
    const groups = groupByDay([
      item("2026-06-23T10:00:00Z", "newest"),
      item("2026-06-23T01:00:00Z", "same day, older"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].dayKey).toBe("2026-06-23");
    expect(groups[0].items.map((i) => i.summary)).toEqual(["newest", "same day, older"]);
  });

  it("opens a new group on a day boundary, keeping groups newest-first", () => {
    const groups = groupByDay([
      item("2026-06-23T10:00:00Z", "today a"),
      item("2026-06-23T01:00:00Z", "today b"),
      item("2026-06-22T23:00:00Z", "yesterday"),
    ]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-06-23", "2026-06-22"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items.map((i) => i.summary)).toEqual(["yesterday"]);
    expect(groups[1].heading).toContain("June 22, 2026");
  });
});
