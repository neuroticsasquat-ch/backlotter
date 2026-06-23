import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeedItemCard } from "@/components/feed/FeedItemCard";
import type { FeedItem } from "@/api/types";

const item: FeedItem = {
  film_slug: "the-odyssey-2026",
  film_title: "The Odyssey",
  event_type: "release_date",
  confidence: "confirmed",
  occurred_at: "2025-03-01T00:00:00Z",
  created_at: "2026-06-23T00:00:00Z",
  summary: "Studio sets a July 17 theatrical release.",
  sources: [{ url: "https://thr.com/a", source: "THR", title: "Dated", published_at: null }],
};

function renderCard(overrides: Partial<FeedItem> = {}) {
  render(
    <MemoryRouter>
      <FeedItemCard item={{ ...item, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("FeedItemCard", () => {
  it("links the film title to its film page and shows beat, confidence, date, summary, sources", () => {
    renderCard();
    const filmLink = screen.getByRole("link", { name: "The Odyssey" });
    expect(filmLink).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("Release date")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Jun 23, 2026")).toBeInTheDocument();
    expect(screen.getByText(/July 17 theatrical release/)).toBeInTheDocument();
    const source = screen.getByRole("link", { name: "THR" });
    expect(source).toHaveAttribute("href", "https://thr.com/a");
    expect(source).toHaveAttribute("target", "_blank");
    expect(source.getAttribute("rel")).toContain("noopener");
  });

  it("renders rumored confidence", () => {
    renderCard({ confidence: "rumored" });
    expect(screen.getByText("Rumored")).toBeInTheDocument();
  });
});
