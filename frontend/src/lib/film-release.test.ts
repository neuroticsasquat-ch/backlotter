import { describe, expect, it } from "vitest";
import type { ReleaseDate } from "@/api/types";
import { isWatchable } from "@/lib/film-release";

const TODAY = "2026-10-08";

function row(overrides: Partial<ReleaseDate>): ReleaseDate {
  return {
    country: "US",
    release_type: 3,
    type_label: "Wide",
    date: "2026-10-07T00:00:00Z",
    certification: null,
    ...overrides,
  };
}

describe("isWatchable", () => {
  it("is true for a US wide date yesterday", () => {
    expect(isWatchable([row({})], TODAY)).toBe(true);
  });

  it("is true for a US digital date today", () => {
    expect(
      isWatchable(
        [row({ release_type: 4, type_label: "Digital", date: "2026-10-08T00:00:00Z" })],
        TODAY,
      ),
    ).toBe(true);
  });

  it("is false for a US wide date tomorrow", () => {
    expect(isWatchable([row({ date: "2026-10-09T00:00:00Z" })], TODAY)).toBe(false);
  });

  it("is false for a wide date abroad, however long ago", () => {
    expect(isWatchable([row({ country: "FR" })], TODAY)).toBe(false);
  });

  it("is false for the primary-date fallback row, which has no label", () => {
    expect(isWatchable([row({ type_label: "" })], TODAY)).toBe(false);
  });

  it("is false with no dates at all", () => {
    expect(isWatchable([], TODAY)).toBe(false);
  });
});
