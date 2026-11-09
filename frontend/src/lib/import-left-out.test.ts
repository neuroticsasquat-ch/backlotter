import { describe, expect, it } from "vitest";
import type { ImportJob } from "@/api/types";
import { leftOutSummary } from "./import-left-out";

describe("leftOutSummary", () => {
  const summary = (unmatched: ImportJob["unmatched"], source = "letterboxd") =>
    leftOutSummary({ source, unmatched });
  const old = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      name: `Old ${i}`,
      year: 2001,
      kind: "outside_window" as const,
    }));
  const missing = (n: number, kind: "watchlist" | "tmdb_missing" = "watchlist") =>
    Array.from({ length: n }, (_, i) => ({ name: `Gone ${i}`, year: 2027, kind }));

  it("joins both clauses, the noun carried by the first", () => {
    expect(summary([...old(14), ...missing(2)])).toBe(
      "We left out 14 titles released more than a year ago and 2 we could not match.",
    );
  });

  it("says either clause alone, with its own noun", () => {
    expect(summary(old(1))).toBe("We left out 1 title released more than a year ago.");
    expect(summary(missing(2))).toBe("We left out 2 titles we could not match.");
    expect(summary(missing(1))).toBe("We left out 1 title we could not match.");
  });

  it("words the second clause as TMDB's for a TMDB job", () => {
    expect(summary([...old(3), ...missing(2, "tmdb_missing")], "tmdb")).toBe(
      "We left out 3 titles released more than a year ago and 2 that TMDB no longer has.",
    );
  });

  it("is null when nothing was left out", () => {
    expect(summary([])).toBeNull();
  });
});
