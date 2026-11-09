import { expect, it } from "vitest";
import type { FilmDayGroup, FilmEvent } from "@/api/types";
import { latestTrailerKey } from "./trailers";

const event: FilmEvent = {
  event_id: "evt-1",
  event_type: "trailer",
  confidence: "confirmed",
  created_at: "2026-06-30T00:00:00Z",
  occurred_at: "2026-06-30T00:00:00Z",
  summary: "A trailer is out.",
  summary_edited: false,
  status: "published",
  superseded_by: null,
  provenance: "catalog",
  video_key: "abc123",
  sources: [],
};

function group(overrides: Partial<FilmDayGroup> = {}): FilmDayGroup {
  return {
    day: "2026-06-30",
    heading: "Tuesday, June 30, 2026",
    news_events: [],
    tmdb_events: [],
    ...overrides,
  };
}

it("picks the newest trailer by occurred_at across every day group", () => {
  const older = { ...event, event_id: "old", occurred_at: "2026-05-01T00:00:00Z", video_key: "a" };
  const newer = { ...event, event_id: "new", occurred_at: "2026-06-01T00:00:00Z", video_key: "b" };
  expect(latestTrailerKey([group({ tmdb_events: [older] }), group({ news_events: [newer] })])).toBe(
    "b",
  );
});

it("ignores events that carry no video key, including story-born trailer cards", () => {
  const storyBorn = { ...event, provenance: "story" as const, video_key: null };
  expect(latestTrailerKey([group({ news_events: [storyBorn] })])).toBeNull();
});

it("ignores a retracted trailer rather than promoting it to the header", () => {
  const retracted = {
    ...event,
    status: "superseded" as const,
    superseded_by: "evt-9",
    occurred_at: "2026-07-01T00:00:00Z",
    video_key: "gone",
  };
  const standing = { ...event, occurred_at: "2026-06-01T00:00:00Z", video_key: "kept" };
  expect(latestTrailerKey([group({ tmdb_events: [retracted, standing] })])).toBe("kept");
});

it("has no trailer to offer when nothing on the page is one", () => {
  const casting = { ...event, event_type: "casting", video_key: null };
  expect(latestTrailerKey([group({ news_events: [casting] })])).toBeNull();
  expect(latestTrailerKey([])).toBeNull();
});

// The backend pushes two trailers published in the same TMDB second 1µs apart so both can
// card, and Pydantic drops a zero fraction — so the pair arrives as "…00Z" and "…00.000001Z".
// Compared as strings that is backwards ("Z" > "."), and Date.parse alone calls them equal.
it("orders a microsecond tie-break the way the backend meant it", () => {
  const first = { ...event, occurred_at: "2026-06-30T00:00:00Z", video_key: "older" };
  const nudged = { ...event, occurred_at: "2026-06-30T00:00:00.000001Z", video_key: "newer" };
  expect(latestTrailerKey([group({ tmdb_events: [first, nudged] })])).toBe("newer");
  expect(latestTrailerKey([group({ tmdb_events: [nudged, first] })])).toBe("newer");
});

it("still orders correctly across whole seconds and milliseconds", () => {
  const a = { ...event, occurred_at: "2026-06-30T00:00:00.500Z", video_key: "a" };
  const b = { ...event, occurred_at: "2026-06-30T00:00:01Z", video_key: "b" };
  expect(latestTrailerKey([group({ tmdb_events: [b, a] })])).toBe("b");
});

it("ignores an event whose video_key the API omitted rather than nulled", () => {
  // Spread-and-delete, not destructuring: oxlint rejects the unused rest sibling.
  const withoutKey = { ...event } as Partial<FilmEvent>;
  delete withoutKey.video_key;
  expect(latestTrailerKey([group({ tmdb_events: [withoutKey as FilmEvent] })])).toBeNull();
});
