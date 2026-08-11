import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeedDayPoster } from "@/components/feed/FeedDayPoster";
import type { FeedDayItem } from "@/api/types";

function item(overrides: Partial<FeedDayItem> = {}): FeedDayItem {
  return {
    film_slug: "the-odyssey-2026",
    film_title: "The Odyssey",
    release_year: 2026,
    poster_path: "/odyssey.jpg",
    arc_stage: "shooting",
    day: "2026-06-23",
    top_event_type: "trailer",
    event_count: 1,
    ...overrides,
  };
}

describe("FeedDayPoster", () => {
  it("shows the poster of the first listed film that has one", () => {
    render(
      <FeedDayPoster
        items={[
          item({ film_slug: "dune-3-2026", film_title: "Dune Part Three", poster_path: null }),
          item(),
          item({ film_slug: "avatar-4-2026", film_title: "Avatar 4", poster_path: "/avatar.jpg" }),
        ]}
      />,
    );
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toContain("/w92/odyssey.jpg");
    expect(img).toHaveAccessibleName("The Odyssey poster");
  });

  it("uses the w92 source the calendar rows use", () => {
    render(<FeedDayPoster items={[item()]} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "https://image.tmdb.org/t/p/w92/odyssey.jpg",
    );
  });

  it("renders nothing when no film in the day has a poster", () => {
    const { container } = render(<FeedDayPoster items={[item({ poster_path: null })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty day", () => {
    const { container } = render(<FeedDayPoster items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a three-row height even for a single-update day", () => {
    render(<FeedDayPoster items={[item()]} />);
    expect(screen.getByRole("img").className).toContain("h-24");
  });
});
