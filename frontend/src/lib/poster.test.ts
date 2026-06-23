import { describe, expect, it } from "vitest";
import { posterUrl } from "@/lib/poster";

describe("posterUrl", () => {
  it("builds a TMDB URL from a path and size", () => {
    expect(posterUrl("/abc.jpg", "w342")).toBe("https://image.tmdb.org/t/p/w342/abc.jpg");
  });

  it("returns null when the path is null", () => {
    expect(posterUrl(null, "w342")).toBeNull();
  });
});
