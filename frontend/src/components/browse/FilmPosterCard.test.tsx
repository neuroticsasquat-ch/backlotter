import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FilmPosterCard } from "@/components/browse/FilmPosterCard";
import type { FilmIndexItem } from "@/api/types";

const item: FilmIndexItem = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  arc_stage: "shooting",
};

function renderCard(overrides: Partial<FilmIndexItem> = {}) {
  render(
    <MemoryRouter>
      <FilmPosterCard item={{ ...item, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("FilmPosterCard", () => {
  it("links the whole cell to the film page", () => {
    renderCard();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/film/the-odyssey-2026");
  });

  it("shows the film title", () => {
    renderCard();
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
  });

  it("shows the release year when present", () => {
    renderCard();
    expect(screen.getByText("2026")).toBeInTheDocument();
  });

  it("renders a poster image with the correct src and alt when poster_path is set", () => {
    renderCard();
    const img = screen.getByRole("img", { name: /the odyssey poster/i });
    expect(img).toHaveAttribute("src", "https://image.tmdb.org/t/p/w342/odyssey.jpg");
  });

  it("lazy-loads the poster image with intrinsic dimensions", () => {
    renderCard();
    const img = screen.getByRole("img", { name: /the odyssey poster/i });
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("width", "342");
    expect(img).toHaveAttribute("height", "513");
  });

  it("renders a placeholder tile (no img) with a 'No poster' hint when poster_path is null", () => {
    renderCard({ poster_path: null });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("poster-placeholder")).toBeInTheDocument();
    expect(screen.getByText(/no poster/i)).toBeInTheDocument();
  });

  it("omits the year line when release_year is null", () => {
    renderCard({ release_year: null });
    expect(screen.queryByText(/^\d{4}$/)).toBeNull();
  });
});
