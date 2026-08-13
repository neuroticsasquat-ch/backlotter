import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeedDayPosters } from "@/components/feed/FeedDayPosters";
import { MAX_DAY_POSTERS } from "@/lib/feed-groups";
import type { FeedDayItem } from "@/api/types";

function item(film_slug: string, overrides: Partial<FeedDayItem> = {}): FeedDayItem {
  return {
    film_slug,
    film_title: film_slug,
    release_year: 2026,
    poster_path: `/${film_slug}.jpg`,
    arc_stage: "shooting",
    day: "2026-06-23",
    top_event_type: "trailer",
    event_types: ["trailer"],
    event_count: 1,
    news_backed: false,
    ...overrides,
  };
}

function renderStrip(items: FeedDayItem[]) {
  return render(
    <MemoryRouter>
      <FeedDayPosters items={items} />
    </MemoryRouter>,
  );
}

describe("FeedDayPosters", () => {
  it("leads with a news-backed film even when a TMDB-only one is more popular", () => {
    // Backend order is by popularity, so the TMDB-only film arrives first.
    renderStrip([item("primetime"), item("animals", { news_backed: true })]);
    expect(screen.getAllByRole("img")[0]).toHaveAccessibleName("animals poster");
  });

  it("shows several posters, not just the day's lead", () => {
    renderStrip([item("a"), item("b"), item("c")]);
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("links each poster to its own film page", () => {
    renderStrip([item("animals", { news_backed: true }), item("primetime")]);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/film/animals", "/film/primetime"]);
  });

  it("uses the w92 source the calendar rows use", () => {
    renderStrip([item("odyssey")]);
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "https://image.tmdb.org/t/p/w92/odyssey.jpg",
    );
  });

  it("hides the posters past the fourth until sm, where the column has room for them", () => {
    // All of them stay in the DOM — which ones show is CSS, so the server and the client
    // render the same markup at every width.
    renderStrip(["a", "b", "c", "d", "e"].map((slug) => item(slug)));
    const links = screen.getAllByRole("link");
    expect(links.slice(0, 4).every((l) => !l.className.includes("hidden"))).toBe(true);
    expect(links[4].className).toContain("hidden sm:block");
  });

  it("caps the strip rather than loading a backfill day's worth of images", () => {
    renderStrip(Array.from({ length: 40 }, (_, i) => item(`film-${i}`)));
    expect(screen.getAllByRole("img")).toHaveLength(MAX_DAY_POSTERS);
  });

  it("lazy-loads everything past the first poster", () => {
    renderStrip([item("a"), item("b")]);
    const imgs = screen.getAllByRole("img");
    expect(imgs[0]).not.toHaveAttribute("loading");
    expect(imgs[1]).toHaveAttribute("loading", "lazy");
  });

  it("skips films with no poster rather than leaving a gap", () => {
    renderStrip([item("no-art", { poster_path: null }), item("has-art")]);
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAccessibleName("has-art poster");
  });

  it("renders nothing when no film in the day has a poster", () => {
    const { container } = renderStrip([item("a", { poster_path: null })]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty day", () => {
    const { container } = renderStrip([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("clips the desktop column instead of letting it set the row height", () => {
    // Laid out in flow the stack would contribute its full height and a tall strip would
    // drive the row, instead of the event list doing it.
    renderStrip([item("a")]);
    const strip = screen.getByRole("img").closest("div");
    expect(strip?.className).toContain("sm:absolute");
    expect(strip?.className).toContain("sm:overflow-hidden");
  });
});
