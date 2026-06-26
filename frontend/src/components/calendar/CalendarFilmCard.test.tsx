import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { CalendarItem } from "@/api/types";
import { CalendarFilmCard } from "./CalendarFilmCard";
import * as posterLib from "@/lib/poster";

describe("CalendarFilmCard", () => {
  const mockItem: CalendarItem = {
    film_slug: "test-film",
    film_title: "Test Film",
    poster_path: "/test_poster.jpg",
    release_date: "2026-07-15",
    release_type: "wide",
  };

  it("links to the film detail page", () => {
    render(
      <MemoryRouter>
        <CalendarFilmCard item={mockItem} />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/film/test-film");
  });

  it("displays the film title", () => {
    render(
      <MemoryRouter>
        <CalendarFilmCard item={mockItem} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Test Film")).toBeInTheDocument();
  });

  it("renders an image with correct posterUrl when poster_path is non-null", () => {
    const mockPosterUrl = "https://image.tmdb.org/t/p/w185/test_poster.jpg";
    const spy = vi.spyOn(posterLib, "posterUrl").mockReturnValue(mockPosterUrl);

    render(
      <MemoryRouter>
        <CalendarFilmCard item={mockItem} />
      </MemoryRouter>,
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", mockPosterUrl);
    expect(img).toHaveAttribute("alt", "Test Film poster");
    expect(posterLib.posterUrl).toHaveBeenCalledWith("/test_poster.jpg", "w185");

    spy.mockRestore();
  });

  it("renders placeholder and no img when poster_path is null", () => {
    const itemWithoutPoster: CalendarItem = {
      ...mockItem,
      poster_path: null,
    };

    render(
      <MemoryRouter>
        <CalendarFilmCard item={itemWithoutPoster} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByTestId("poster-placeholder")).toBeInTheDocument();
  });
});
