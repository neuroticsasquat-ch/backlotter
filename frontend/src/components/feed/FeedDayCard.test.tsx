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
  it("links the whole card to the film page and shows the poster, title, and beat", () => {
    renderCard();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("Release date")).toBeInTheDocument();
    const poster = screen.getByRole("img", { name: "The Odyssey poster" });
    expect(poster.getAttribute("src")).toContain("/w154/odyssey.jpg");
  });

  it("shows no +N suffix for a single-event day", () => {
    renderCard({ event_count: 1 });
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("shows +N (events beyond the headline beat) when a film has multiple events that day", () => {
    renderCard({ event_count: 3 });
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("renders a placeholder and no image when the film has no poster", () => {
    renderCard({ poster_path: null });
    expect(screen.queryByRole("img")).toBeNull();
  });
});
