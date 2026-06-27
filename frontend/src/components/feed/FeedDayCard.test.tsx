import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import type { FeedDayItem } from "@/api/types";

const item: FeedDayItem = {
  film_slug: "the-odyssey-2026",
  film_title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  day: "2026-06-23",
  top_event_type: "release_date",
  event_count: 1,
};

function renderCard(overrides: Partial<FeedDayItem> = {}) {
  render(
    <MemoryRouter>
      <FeedDayCard item={{ ...item, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("FeedDayCard", () => {
  it("links the whole row to the film page and shows the title with its year", () => {
    renderCard();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("(2026)")).toBeInTheDocument();
  });

  it("omits the year when it is null", () => {
    renderCard({ release_year: null });
    expect(screen.queryByText(/\(\d{4}\)/)).toBeNull();
  });

  it("renders no poster image", () => {
    renderCard();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("does not show the beat or an event count (the home feed only signals an update exists)", () => {
    renderCard({ event_count: 3, top_event_type: "release_date" });
    expect(screen.queryByText("Release date")).toBeNull();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });
});
