import { describe, expect, it } from "vitest";
import { formatEventDate, truncate } from "@/lib/format";

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
