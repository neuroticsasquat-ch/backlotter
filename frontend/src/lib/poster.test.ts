import { describe, expect, it } from "vitest";
import { posterSrcSet, posterUrl, profileUrl } from "@/lib/poster";

describe("posterUrl", () => {
  it("builds a TMDB URL from a path and size", () => {
    expect(posterUrl("/abc.jpg", "w342")).toBe("https://image.tmdb.org/t/p/w342/abc.jpg");
  });

  it("builds a backdrop URL with a wider size", () => {
    expect(posterUrl("/b.jpg", "w780")).toBe("https://image.tmdb.org/t/p/w780/b.jpg");
  });

  it("returns null when the path is null", () => {
    expect(posterUrl(null, "w342")).toBeNull();
  });
});

describe("profileUrl", () => {
  it("builds a TMDB profile URL from a path and size", () => {
    expect(profileUrl("/abc.jpg", "w185")).toBe("https://image.tmdb.org/t/p/w185/abc.jpg");
  });

  it("returns null when the path is null", () => {
    expect(profileUrl(null)).toBeNull();
  });
});

describe("posterSrcSet", () => {
  it("offers each width with its descriptor", () => {
    expect(posterSrcSet("/odyssey.jpg")).toBe(
      "https://image.tmdb.org/t/p/w92/odyssey.jpg 92w, " +
        "https://image.tmdb.org/t/p/w185/odyssey.jpg 185w, " +
        "https://image.tmdb.org/t/p/w342/odyssey.jpg 342w",
    );
  });

  it("returns null for a film with no poster, same as posterUrl", () => {
    expect(posterSrcSet(null)).toBeNull();
  });
});
