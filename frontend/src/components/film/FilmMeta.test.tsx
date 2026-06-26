import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilmMeta } from "@/components/film/FilmMeta";
import type { FilmDetail } from "@/api/types";

function makeFilm(overrides: Partial<FilmDetail> = {}): FilmDetail {
  return {
    slug: "test-film-2024",
    title: "Test Film",
    release_date: "2024-07-15",
    release_year: 2024,
    poster_path: "/poster.jpg",
    arc_stage: "trailer",
    events: [],
    overview: "A gripping tale of adventure and discovery.",
    tagline: "Some things are worth fighting for.",
    runtime: 135,
    genres: ["Action", "Drama"],
    vote_average: 7.8,
    vote_count: 1200,
    original_language: "en",
    backdrop_path: "/backdrop.jpg",
    production_companies: ["Acme Studios", "Global Films"],
    collection: { name: "The Test Saga" },
    ...overrides,
  };
}

describe("FilmMeta", () => {
  it("renders all fields when fully populated", () => {
    render(<FilmMeta film={makeFilm()} />);

    // Tagline
    expect(screen.getByText("Some things are worth fighting for.")).toBeInTheDocument();

    // Overview
    expect(screen.getByText("A gripping tale of adventure and discovery.")).toBeInTheDocument();

    // Runtime formatted as "2h 15m"
    expect(screen.getByText(/2h 15m/)).toBeInTheDocument();

    // Genre chips
    expect(screen.getByText("Action")).toBeInTheDocument();
    expect(screen.getByText("Drama")).toBeInTheDocument();

    // Rating
    expect(screen.getByText(/7\.8\s*\/10/)).toBeInTheDocument();

    // Production companies
    expect(screen.getByText(/Acme Studios/)).toBeInTheDocument();
    expect(screen.getByText(/Global Films/)).toBeInTheDocument();

    // Collection name
    expect(screen.getByText(/The Test Saga/)).toBeInTheDocument();
  });

  it("renders nothing for a sparse film with all optional fields null or empty", () => {
    const { container } = render(
      <FilmMeta
        film={makeFilm({
          overview: null,
          tagline: null,
          runtime: null,
          genres: [],
          vote_average: null,
          vote_count: null,
          original_language: null,
          backdrop_path: null,
          production_companies: [],
          collection: null,
          release_date: null,
        })}
      />,
    );

    // None of the optional values appear
    expect(screen.queryByText("Some things are worth fighting for.")).toBeNull();
    expect(screen.queryByText("A gripping tale of adventure and discovery.")).toBeNull();
    expect(screen.queryByText("Action")).toBeNull();
    expect(screen.queryByText("The Test Saga")).toBeNull();
    expect(screen.queryByText(/\/10/)).toBeNull();

    // No dangling separators
    expect(screen.queryByText(/·/)).toBeNull();

    // Component emits nothing — container is empty
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when vote_average is null and it is the only would-be signal", () => {
    const { container } = render(
      <FilmMeta
        film={makeFilm({
          overview: null,
          tagline: null,
          runtime: null,
          genres: [],
          vote_average: null,
          vote_count: 500,
          original_language: null,
          backdrop_path: null,
          production_companies: [],
          collection: null,
          release_date: null,
        })}
      />,
    );

    // hasAnyMeta must stay consistent with the rating render gate
    expect(container.firstChild).toBeNull();
  });

  describe("rating gate", () => {
    it("hides rating when vote_count is 0", () => {
      render(<FilmMeta film={makeFilm({ vote_count: 0, vote_average: 0.0 })} />);
      expect(screen.queryByText(/\/10/)).toBeNull();
    });

    it("shows rating when vote_count > 0", () => {
      render(<FilmMeta film={makeFilm({ vote_count: 500, vote_average: 6.5 })} />);
      expect(screen.getByText(/6\.5\s*\/10/)).toBeInTheDocument();
    });

    it("hides rating when vote_count is null", () => {
      render(<FilmMeta film={makeFilm({ vote_count: null, vote_average: 8.0 })} />);
      expect(screen.queryByText(/\/10/)).toBeNull();
    });

    it("hides rating when vote_average is null even with votes", () => {
      render(<FilmMeta film={makeFilm({ vote_count: 500, vote_average: null })} />);
      expect(screen.queryByText(/\/10/)).toBeNull();
    });

    it("exposes the rating via an accessible label", () => {
      render(<FilmMeta film={makeFilm({ vote_count: 500, vote_average: 6.5 })} />);
      expect(screen.getByLabelText(/rating: 6\.5 out of 10/i)).toBeInTheDocument();
    });
  });

  describe("runtime edge cases", () => {
    it("formats 60 minutes as '1h'", () => {
      render(<FilmMeta film={makeFilm({ runtime: 60 })} />);
      expect(screen.getByText(/1h/)).toBeInTheDocument();
    });

    it("formats 45 minutes as '45m'", () => {
      render(<FilmMeta film={makeFilm({ runtime: 45 })} />);
      expect(screen.getByText(/45m/)).toBeInTheDocument();
    });
  });

  it("renders collection as plain text, not a link", () => {
    render(<FilmMeta film={makeFilm({ collection: { name: "The Saga Collection" } })} />);

    // Collection name is present as text
    expect(screen.getByText(/The Saga Collection/)).toBeInTheDocument();

    // But not as a link
    expect(screen.queryByRole("link", { name: /the saga collection/i })).toBeNull();
  });
});
