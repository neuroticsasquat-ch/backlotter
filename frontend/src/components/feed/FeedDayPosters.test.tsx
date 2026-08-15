import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeedDayPosters } from "@/components/feed/FeedDayPosters";
import { MAX_DAY_POSTERS } from "@/lib/feed-groups";
import type { FeedDayItem } from "@/api/types";

function item(film_ref: string, overrides: Partial<FeedDayItem> = {}): FeedDayItem {
  return {
    film_ref,
    film_title: film_ref,
    release_year: 2026,
    poster_path: `/${film_ref}.jpg`,
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

  it("falls back to a source sized for the strip's own display width", () => {
    // The strip renders at a fixed 5rem at every width, so w92 (the old desktop-column size)
    // came out upscaled. Browsers that honour srcSet pick from it; this is the fallback.
    renderStrip([item("odyssey")]);
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "https://image.tmdb.org/t/p/w185/odyssey.jpg",
    );
  });

  it("renders every lead at a fixed width and lets the row clip the overflow", () => {
    // How many show is CSS, not a count in JS — so the markup is identical on the server and
    // the client, and the strip follows a resize without re-rendering.
    renderStrip(["a", "b", "c", "d", "e"].map((slug) => item(slug)));
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links.every((l) => l.className.includes("w-20 flex-none"))).toBe(true);
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

  it("clips the row horizontally and fades the cut edge", () => {
    renderStrip([item("a")]);
    const strip = screen.getByRole("img").closest("div");
    expect(strip?.className).toContain("overflow-hidden");
    expect(strip?.className).toContain("to_right");
  });
});
