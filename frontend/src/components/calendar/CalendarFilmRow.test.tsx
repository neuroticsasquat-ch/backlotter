import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { CalendarFilmRow } from "@/components/calendar/CalendarFilmRow";
import type { CalendarItem } from "@/api/types";

const item: CalendarItem = {
  film_slug: "the-odyssey-2026",
  film_title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  release_date: "2026-07-04",
  release_type: "wide",
  director: "Christopher Nolan",
  stars: ["Matt Damon", "Tom Holland", "Zendaya"],
  genres: ["Adventure", "Drama"],
};

function renderRow(overrides: Partial<CalendarItem> = {}) {
  render(
    <MemoryRouter>
      <CalendarFilmRow item={{ ...item, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("CalendarFilmRow", () => {
  it("links the row and shows title, year, director, stars, and genres", () => {
    renderRow();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("(2026)")).toBeInTheDocument();
    expect(screen.getByText("Dir. Christopher Nolan")).toBeInTheDocument();
    expect(screen.getByText("Matt Damon · Tom Holland · Zendaya")).toBeInTheDocument();
    expect(screen.getByText("Adventure · Drama")).toBeInTheDocument();
  });

  it("renders the poster thumbnail from poster_path", () => {
    renderRow();
    expect(screen.getByRole("img").getAttribute("src")).toContain("/w92/odyssey.jpg");
  });

  it("renders a placeholder (no img) when poster_path is null", () => {
    renderRow({ poster_path: null });
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("omits year, director, stars, and genres when absent", () => {
    renderRow({ release_year: null, director: null, stars: [], genres: [] });
    expect(screen.queryByText(/\(\d{4}\)/)).toBeNull();
    expect(screen.queryByText(/^Dir\./)).toBeNull();
    expect(screen.queryByText(/·/)).toBeNull();
  });
});
