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
  runtime: null,
  genres: [],
  vote_average: null,
  vote_count: null,
  original_language: null,
  backdrop_path: null,
  production_companies: [],
  collection: null,
  release_dates: [],
};

describe("FilmHeader", () => {
  it("renders the title, year, poster, and arc", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /the odyssey poster/i })).toHaveAttribute(
      "src",
      "https://image.tmdb.org/t/p/w342/poster.jpg",
    );
    expect(screen.getByLabelText("Production status")).toBeInTheDocument();
  });

  it("omits the poster when none is set", () => {
    render(<FilmHeader film={{ ...film, poster_path: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
