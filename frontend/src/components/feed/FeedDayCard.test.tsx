import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import type { FeedDayItem } from "@/api/types";

const item: FeedDayItem = {
  film_ref: "the-odyssey-2026",
  film_title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  arc_stage: "shooting",
  day: "2026-06-23",
  top_event_type: "release_date",
  event_types: ["release_date"],
  event_count: 1,
  news_backed: false,
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

  it("renders the arc-stage label in place of the year when the film is undated", () => {
    renderCard({ release_year: null, arc_stage: "announced" });
    expect(screen.queryByText(/\(\d{4}\)/)).toBeNull();
    expect(screen.getByText("(Announced)")).toBeInTheDocument();
  });

  it("keeps the year and omits the arc-stage label for a dated film", () => {
    renderCard();
    expect(screen.getByText("(2026)")).toBeInTheDocument();
    expect(screen.queryByText("(Shooting)")).toBeNull();
  });

  it("renders no poster image", () => {
    renderCard();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("stripes via a parent-scoped odd: selector, so each feed section restarts the pattern", () => {
    // NEU-1138 splits a day into two sibling lists. The stripe resets per section precisely
    // because it is CSS nth-child on the card's own parent, not an index passed in — so the
    // card takes no position prop, and adding one would silently change the day's appearance.
    renderCard();
    expect(screen.getByRole("link").className).toContain("odd:bg-muted/40");
  });

  it("labels every beat the film saw that day, in the order the backend ranked them", () => {
    renderCard({ event_types: ["trailer", "casting", "announced"], event_count: 5 });
    expect(screen.getByText("Trailer")).toBeInTheDocument();
    expect(screen.getByText("Casting")).toBeInTheDocument();
    expect(screen.getByText("Announced")).toBeInTheDocument();
  });

  it("renders the beat labels beneath the title, not inside it", () => {
    renderCard({ event_types: ["casting"] });
    const title = screen.getByText("The Odyssey");
    expect(title).not.toContainElement(screen.getByText("Casting"));
  });

  it("shows a single label for a one-beat day", () => {
    renderCard({ event_types: ["release_date"] });
    expect(screen.getByText("Release date")).toBeInTheDocument();
    expect(screen.queryByText("Trailer")).toBeNull();
  });

  it("still shows no event count — the labels say what happened, not how often", () => {
    renderCard({ event_count: 3, event_types: ["casting"] });
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.queryByText("3")).toBeNull();
  });

  it("wraps a long title instead of truncating it", () => {
    // The mobile column is ~300px wide, so truncation hides most of a long title. The
    // hanging indent on the wrapped lines is what keeps line two from reading as its own row.
    renderCard({ film_title: "Untitled Shang-Chi and the Legend of the Ten Rings Sequel" });
    const link = screen.getByRole("link");
    expect(link.className).not.toContain("truncate");
    expect(screen.getByText(/^Untitled Shang-Chi/).className).toContain("-indent-3");
  });
});
