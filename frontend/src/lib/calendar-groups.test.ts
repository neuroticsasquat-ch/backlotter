import { describe, expect, it } from "vitest";
import { groupByReleaseDate, nestByYearMonth } from "@/lib/calendar-groups";
import type { CalendarItem } from "@/api/types";

function item(film_slug: string, release_date: string, release_type: string): CalendarItem {
  return {
    film_slug,
    film_title: film_slug.toUpperCase(),
    release_year: 2026,
    poster_path: null,
    release_date,
    release_type,
    director: null,
    stars: [],
    genres: [],
  };
}

describe("groupByReleaseDate", () => {
  it("returns an empty array for no items", () => {
    expect(groupByReleaseDate([])).toEqual([]);
  });

  it("opens one date section per distinct release_date, in input order (soonest-first)", () => {
    const groups = groupByReleaseDate([
      item("film_a", "2026-06-22", "wide"),
      item("film_b", "2026-06-23", "wide"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].dateKey).toBe("2026-06-22");
    expect(groups[1].dateKey).toBe("2026-06-23");
  });

  it("generates a UTC heading from the release_date", () => {
    const groups = groupByReleaseDate([item("film_a", "2026-07-04", "wide")]);
    expect(groups[0].heading).toContain("July 4, 2026");
  });

  it("within a date, buckets adjacent same-release_type items into one sub-group", () => {
    const groups = groupByReleaseDate([
      item("premiere_1", "2026-06-23", "premiere"),
      item("premiere_2", "2026-06-23", "premiere"),
      item("wide_1", "2026-06-23", "wide"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].buckets).toHaveLength(2);
    expect(groups[0].buckets[0].bucket).toBe("premiere");
    expect(groups[0].buckets[0].films.map((f) => f.film_slug)).toEqual([
      "premiere_1",
      "premiere_2",
    ]);
    expect(groups[0].buckets[1].bucket).toBe("wide");
    expect(groups[0].buckets[1].films.map((f) => f.film_slug)).toEqual(["wide_1"]);
  });

  it("preserves the premiere→limited→wide order the server emitted", () => {
    const groups = groupByReleaseDate([
      item("premiere_1", "2026-06-23", "premiere"),
      item("wide_1", "2026-06-23", "wide"),
      item("limited_1", "2026-06-23", "limited"),
    ]);
    expect(groups[0].buckets.map((b) => b.bucket)).toEqual(["premiere", "wide", "limited"]);
  });

  it("each bucket sub-group carries the bucket key, its label, and its films", () => {
    const groups = groupByReleaseDate([item("film_a", "2026-06-23", "limited")]);
    const bucket = groups[0].buckets[0];
    expect(bucket).toHaveProperty("bucket", "limited");
    expect(bucket).toHaveProperty("label");
    expect(bucket).toHaveProperty("films");
    expect(bucket.label).toBe("Limited");
    expect(bucket.films).toHaveLength(1);
    expect(bucket.films[0].film_slug).toBe("film_a");
  });

  it("a second date with only limited items opens a fresh date section", () => {
    const groups = groupByReleaseDate([
      item("wide_1", "2026-06-23", "wide"),
      item("limited_1", "2026-06-22", "limited"),
      item("limited_2", "2026-06-22", "limited"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].dateKey).toBe("2026-06-23");
    expect(groups[1].dateKey).toBe("2026-06-22");
    expect(groups[1].buckets).toHaveLength(1);
    expect(groups[1].buckets[0].bucket).toBe("limited");
    expect(groups[1].buckets[0].films).toHaveLength(2);
  });
});

describe("nestByYearMonth", () => {
  it("returns an empty array for no date groups", () => {
    expect(nestByYearMonth([])).toEqual([]);
  });

  it("nests day groups under month (named) and year, preserving order", () => {
    const dayGroups = groupByReleaseDate([
      item("a", "2026-06-12", "wide"),
      item("b", "2026-06-17", "wide"),
      item("c", "2026-07-01", "wide"),
      item("d", "2027-01-05", "wide"),
    ]);
    const years = nestByYearMonth(dayGroups);
    expect(years.map((y) => y.year)).toEqual(["2026", "2027"]);
    expect(years[0].months.map((m) => m.heading)).toEqual(["June", "July"]);
    expect(years[0].months[0].days.map((d) => d.dateKey)).toEqual(["2026-06-12", "2026-06-17"]);
    expect(years[1].months[0].heading).toBe("January");
    expect(years[1].months[0].monthKey).toBe("2027-01");
  });
});
