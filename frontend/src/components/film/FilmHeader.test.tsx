import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilmHeader } from "@/components/film/FilmHeader";
import type { FilmDetail } from "@/api/types";

const film: FilmDetail = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_date: "2026-07-17",
  release_year: 2026,
  poster_path: "/poster.jpg",
  arc_stage: "shooting",
  events: [],
  overview: null,
  tagline: null,
  runtime: 148,
  genres: ["Adventure", "Drama"],
  vote_average: null,
  vote_count: null,
  original_language: "en",
  backdrop_path: null,
  production_companies: ["Universal Pictures"],
  collection: null,
  release_dates: [
    {
      country: "US",
      release_type: 3,
      type_label: "Theatrical (limited)",
      date: "2026-07-17T00:00:00Z",
      certification: "PG-13",
    },
  ],
  alternative_titles: [],
  cast: [],
  directors: ["Christopher Nolan"],
};

describe("FilmHeader", () => {
  it("renders the title, parenthetical year, poster, and arc", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.getByText("(2026)")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /the odyssey poster/i })).toHaveAttribute(
      "src",
      "https://image.tmdb.org/t/p/w342/poster.jpg",
    );
    expect(screen.getByLabelText("Production status")).toBeInTheDocument();
  });

  it("renders labeled runtime and rating rows, without language", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    expect(screen.getByText("2h 28m")).toBeInTheDocument();
    expect(screen.getByText("Rating")).toBeInTheDocument();
    expect(screen.getByText("PG-13")).toBeInTheDocument();
    expect(screen.queryByText(/English/)).not.toBeInTheDocument();
  });

  it("omits the rating-body country for a US rating", () => {
    render(<FilmHeader film={film} />);
    expect(screen.queryByText("US")).not.toBeInTheDocument();
  });

  it("shows the rating-body country when the rating is not US", () => {
    const gbFilm: FilmDetail = {
      ...film,
      release_dates: [{ ...film.release_dates[0], country: "GB", certification: "15" }],
    };
    render(<FilmHeader film={gbFilm} />);
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("GB")).toBeInTheDocument();
  });

  it("renders the director with a 'Director' label and the director name", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByText("Director")).toBeInTheDocument();
    expect(screen.getByText(/Christopher Nolan/)).toBeInTheDocument();
  });

  it("renders each genre as its own capsule", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByText("Adventure")).toBeInTheDocument();
    expect(screen.getByText("Drama")).toBeInTheDocument();
    expect(screen.queryByText("Adventure, Drama")).not.toBeInTheDocument();
  });

  it("does not render production companies (they live below the cast)", () => {
    render(<FilmHeader film={film} />);
    expect(screen.queryByText("Universal Pictures")).not.toBeInTheDocument();
  });

  it("omits the poster when none is set", () => {
    render(<FilmHeader film={{ ...film, poster_path: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("omits the year when release_year is null", () => {
    render(<FilmHeader film={{ ...film, release_year: null }} />);
    expect(screen.queryByText("(2026)")).toBeNull();
  });
});
