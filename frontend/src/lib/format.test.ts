import { describe, expect, it } from "vitest";
import { dayKey, formatDayHeading, formatEventDate, truncate } from "@/lib/format";

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
