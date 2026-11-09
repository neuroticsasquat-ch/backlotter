import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JustWatchAttribution } from "@/components/film/JustWatchAttribution";

// TMDB's terms for the providers endpoint: credit JustWatch wherever the data renders, and link
// back to TMDB's own watch page. Both are obligations, so both are asserted here — this is the
// one place the wording lives, for the box and for the now_available cards alike.
describe("JustWatchAttribution", () => {
  it("credits JustWatch", () => {
    render(<JustWatchAttribution link="https://www.themoviedb.org/movie/603/watch?locale=US" />);
    expect(screen.getByText(/JustWatch/)).toBeInTheDocument();
  });

  it("links back to TMDB's watch page in a new tab", () => {
    const link = "https://www.themoviedb.org/movie/603/watch?locale=US";
    render(<JustWatchAttribution link={link} />);
    const anchor = screen.getByRole("link", { name: /TMDB/i });
    expect(anchor).toHaveAttribute("href", link);
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(anchor.getAttribute("rel")).toContain("noopener");
  });

  it("still credits JustWatch when there is no link — TMDB omits it for some regions", () => {
    render(<JustWatchAttribution link={null} />);
    expect(screen.getByText(/JustWatch/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders the credit alone for a surface that has no link to offer", () => {
    render(<JustWatchAttribution />);
    expect(screen.getByText(/JustWatch/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
