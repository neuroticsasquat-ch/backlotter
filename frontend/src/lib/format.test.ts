import { describe, expect, it } from "vitest";
import {
  dayKey,
  formatDayHeading,
  formatEventDate,
  formatLanguage,
  formatRuntime,
  formatUsd,
  pickRating,
  truncate,
} from "@/lib/format";
import type { ReleaseDate } from "@/api/types";

function rd(over: Partial<ReleaseDate> = {}): ReleaseDate {
  return {
    country: "US",
    release_type: 3,
    type_label: "Theatrical (limited)",
    date: "2026-01-01T00:00:00Z",
    certification: "PG-13",
    ...over,
  };
}

describe("formatEventDate", () => {
  it("formats an ISO timestamp as 'Mon D, YYYY'", () => {
    expect(formatEventDate("2025-03-14T00:00:00Z")).toBe("Mar 14, 2025");
  });

  it("uses UTC so a late-UTC time does not roll the day", () => {
    expect(formatEventDate("2025-03-14T23:30:00Z")).toBe("Mar 14, 2025");
  });
});

describe("truncate", () => {
  it("leaves short text unchanged", () => {
    expect(truncate("short enough", 155)).toBe("short enough");
  });

  it("cuts long text on a word boundary and appends an ellipsis", () => {
    const long = `${"a".repeat(10)} ${"b".repeat(200)}`;
    const out = truncate(long, 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
  });

  it("does not truncate text at exactly max characters", () => {
    const exact = "a".repeat(155);
    expect(truncate(exact, 155)).toBe(exact);
  });

  it("hard-cuts at max when there is no word boundary in the window", () => {
    const noSpace = "a".repeat(200);
    const out = truncate(noSpace, 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
  });
});

describe("dayKey", () => {
  it("returns the UTC calendar date as YYYY-MM-DD", () => {
    expect(dayKey("2026-06-23T10:00:00Z")).toBe("2026-06-23");
  });

  it("uses UTC so a late-UTC time does not roll into the next day", () => {
    expect(dayKey("2026-06-23T23:59:00Z")).toBe("2026-06-23");
  });
});

describe("formatDayHeading", () => {
  it("formats a UTC day as a long weekday + date", () => {
    expect(formatDayHeading("2025-03-14T00:00:00Z")).toContain("March 14, 2025");
  });

  it("uses UTC so a late-UTC time keeps the same day", () => {
    expect(formatDayHeading("2025-03-14T23:30:00Z")).toContain("March 14, 2025");
  });
});

describe("formatUsd", () => {
  it("formats whole and 2-decimal amounts with a dollar sign", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1.5)).toBe("$1.50");
  });

  it("keeps sub-cent precision up to 4 fractional digits", () => {
    expect(formatUsd(0.0123)).toBe("$0.0123");
  });

  it("rounds to at most 4 fractional digits", () => {
    expect(formatUsd(0.012345)).toBe("$0.0123");
  });
});

describe("formatRuntime", () => {
  it("formats hours and minutes", () => {
    expect(formatRuntime(135)).toBe("2h 15m");
  });

  it("omits minutes when zero", () => {
    expect(formatRuntime(60)).toBe("1h");
  });

  it("omits hours when zero", () => {
    expect(formatRuntime(45)).toBe("45m");
  });

  it("returns empty string for zero", () => {
    expect(formatRuntime(0)).toBe("");
  });

  it("returns empty string for negative values", () => {
    expect(formatRuntime(-10)).toBe("");
  });
});

describe("formatLanguage", () => {
  it("resolves a known language code to its English display name", () => {
    expect(formatLanguage("en")).toBe("English");
  });

  it("falls back to uppercased code for unknown codes", () => {
    expect(formatLanguage("xx")).toBe("XX");
  });
});

describe("pickRating", () => {
  it("returns null when there are no release dates", () => {
    expect(pickRating([])).toBeNull();
  });

  it("returns null when no entry carries a certification", () => {
    expect(
      pickRating([rd({ certification: null }), rd({ country: "GB", certification: "" })]),
    ).toBeNull();
  });

  it("prefers the US rating", () => {
    expect(
      pickRating([
        rd({ country: "GB", certification: "15" }),
        rd({ country: "US", certification: "R" }),
      ]),
    ).toEqual({ certification: "R", country: "US" });
  });

  it("falls back to the first non-empty rating when no US entry", () => {
    expect(
      pickRating([
        rd({ country: "FR", certification: null }),
        rd({ country: "GB", certification: "15" }),
      ]),
    ).toEqual({ certification: "15", country: "GB" });
  });

  it("treats an empty-string certification as absent", () => {
    expect(
      pickRating([
        rd({ country: "US", certification: "" }),
        rd({ country: "GB", certification: "12A" }),
      ]),
    ).toEqual({ certification: "12A", country: "GB" });
  });
});
