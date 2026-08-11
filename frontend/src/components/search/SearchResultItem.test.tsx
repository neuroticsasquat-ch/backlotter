import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { SearchResultItem } from "@/components/search/SearchResultItem";
import type { FilmIndexItem } from "@/api/types";

const item: FilmIndexItem = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  arc_stage: "shooting",
};

function renderItem(overrides: Partial<FilmIndexItem> = {}) {
  render(
    <MemoryRouter>
      <SearchResultItem item={{ ...item, ...overrides }} isActive={false} id="option-0" />
    </MemoryRouter>,
  );
}

describe("SearchResultItem", () => {
  it("links to the film page and shows the title with its year", () => {
    renderItem();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
  });

  it("renders the arc-stage label in place of the year when the film is undated", () => {
    renderItem({ release_year: null, arc_stage: "announced" });
    expect(screen.queryByText("2026")).toBeNull();
    expect(screen.getByText("Announced")).toBeInTheDocument();
  });

  it("omits the arc-stage label for a dated film", () => {
    renderItem();
    expect(screen.queryByText("Shooting")).toBeNull();
  });
});
