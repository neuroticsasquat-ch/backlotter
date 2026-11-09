import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExternalLinks } from "@/components/film/ExternalLinks";

describe("ExternalLinks", () => {
  it("links TMDB by numeric id and IMDb by imdb id, opening in a new tab", () => {
    render(<ExternalLinks tmdbId={12345} imdbId="tt1234567" />);
    const tmdb = screen.getByRole("link", { name: /tmdb/i });
    const imdb = screen.getByRole("link", { name: /imdb/i });
    expect(tmdb).toHaveAttribute("href", "https://www.themoviedb.org/movie/12345");
    expect(imdb).toHaveAttribute("href", "https://www.imdb.com/title/tt1234567/");
    expect(tmdb).toHaveAttribute("target", "_blank");
    expect(tmdb).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("omits the IMDb link when imdbId is null", () => {
    render(<ExternalLinks tmdbId={12345} imdbId={null} />);
    expect(screen.queryByRole("link", { name: /imdb/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /tmdb/i })).toBeInTheDocument();
  });

  it("adds TMDB's watch page as a third chip once the film is out (D-1542.8)", () => {
    render(<ExternalLinks tmdbId={12345} imdbId="tt1234567" watchable />);
    const watch = screen.getByRole("link", { name: "Where to watch (TMDB)" });
    expect(watch).toHaveAttribute("href", "https://www.themoviedb.org/movie/12345/watch?locale=US");
    expect(watch).toHaveAttribute("target", "_blank");
    expect(watch).toHaveAttribute("rel", "noopener noreferrer");
    // It links out to TMDB's page and hosts no provider data, so it credits nobody.
    expect(screen.queryByText(/JustWatch/)).not.toBeInTheDocument();
  });

  it("has no watch chip before the film is out", () => {
    render(<ExternalLinks tmdbId={12345} imdbId="tt1234567" />);
    expect(screen.queryByRole("link", { name: /where to watch/i })).not.toBeInTheDocument();
  });
});
