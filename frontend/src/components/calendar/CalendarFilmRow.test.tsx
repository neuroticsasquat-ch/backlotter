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
};

describe("CalendarFilmRow", () => {
  it("links the row to the film page and shows the title with its year", () => {
    render(
      <MemoryRouter>
        <CalendarFilmRow item={item} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("(2026)")).toBeInTheDocument();
  });

  it("renders no poster image and omits the year when null", () => {
    render(
      <MemoryRouter>
        <CalendarFilmRow item={{ ...item, release_year: null }} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/\(\d{4}\)/)).toBeNull();
  });
});
