import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import type { FeedDayItem } from "@/api/types";

const item: FeedDayItem = {
  film_slug: "the-odyssey-2026",
  film_title: "The Odyssey",
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
  it("links the whole row to the film page and shows the title and beat", () => {
    renderCard();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("Release date")).toBeInTheDocument();
  });

  it("renders no poster image", () => {
    renderCard();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows no +N suffix for a single-event day", () => {
    renderCard({ event_count: 1 });
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("shows +N (events beyond the headline beat) when a film has multiple events that day", () => {
    renderCard({ event_count: 3 });
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
