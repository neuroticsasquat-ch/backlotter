import { createRoutesStub } from "react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { dayItem, feed, oneDay } from "@/test/feed-fixtures";
import { env } from "@/env";
import type { FeedDayResponse } from "@/api/types";
import { GLOBAL_FEED_STANDFIRST, GlobalFeed } from "@/components/feed/GlobalFeed";
import { SECTION_SPLIT_EXPLAINER } from "@/components/film/labels";

const HEADING = "All updates";

/** Renders the feed body on its own. No auth providers: `GlobalFeed` is the half of the home
 *  page that does not know who is looking — the deciding is `TimelineOrFeed`'s job, and is
 *  covered in `routes/feed.test.tsx`. */
function renderFeed(data: FeedDayResponse) {
  const Stub = createRoutesStub([{ path: "/", Component: () => <GlobalFeed feed={data} /> }]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("global feed render", () => {
  it("groups films by day (newest first) and links each card to its film page", async () => {
    renderFeed(feed);

    expect(await screen.findByRole("heading", { name: HEADING })).toBeInTheDocument();
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/June 22, 2026/)).toBeInTheDocument();

    // Reached through the title rather than by accessible name: the day's poster strip links
    // the same film too, under "<title> poster".
    expect(screen.getByText("The Odyssey").closest("a")).toHaveAttribute(
      "href",
      "/film/the-odyssey-2026",
    );

    // The TMDB-only film is inside the collapsed "Not yet reported" section.
    await userEvent.click(screen.getByText("Not yet reported (1 movie)"));
    expect(screen.getByText("Dune Part Three").closest("a")).toHaveAttribute(
      "href",
      "/film/dune-3-2026",
    );
  });

  /** The heading used to be a prop so `/` and `/feed` could label themselves differently.
   *  It is a constant now, which is what makes them one page rather than two (NEU-1410). */
  it("names itself the same on every route, so / and /feed cannot drift apart", async () => {
    renderFeed(feed);
    expect(await screen.findByRole("heading", { name: "All updates" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /latest updates for upcoming movies/i }),
    ).toBeNull();
  });

  it("carries the standfirst that replaced the old SEO heading", async () => {
    renderFeed(feed);
    expect(
      await screen.findByText(/every casting change, trailer and release date/i),
    ).toBeInTheDocument();
  });

  it("gives each day a poster strip and links every poster to its film", async () => {
    renderFeed(feed);

    // June 23 has The Odyssey's poster; June 22's only film has none, so that day has no strip.
    const posters = await screen.findAllByRole("img");
    expect(posters).toHaveLength(1);
    expect(posters[0].getAttribute("src")).toContain("/w185/odyssey.jpg");
    expect(posters[0].closest("a")).toHaveAttribute("href", "/film/the-odyssey-2026");
  });

  it("puts the poster strip above the day's updates at every width", async () => {
    // Beside the list, a poster lined up with whatever row happened to sit next to it and read
    // as a label for a film it had nothing to do with.
    renderFeed(feed);

    await screen.findByRole("img");
    const row = screen
      .getByText(/June 23, 2026/)
      .closest("section")
      ?.querySelector("div");
    expect(row?.className).toContain("flex-col");
    expect(row?.className).not.toContain("flex-row");
  });

  it("shows the empty state when there are no updates", async () => {
    renderFeed({ ...feed, items: [], total: 0 });
    expect(await screen.findByText(/no updates yet/i)).toBeInTheDocument();
  });

  it("loads the next page of days when 'View more' is clicked (no autoload)", async () => {
    // Page 1 has one day but total=2, so 'View more' shows; clicking fetches page 2.
    const page1: FeedDayResponse = { items: [feed.items[0]], total: 2, limit: 10, offset: 0 };
    let captured: Headers | undefined;
    server.use(
      http.get(`${env.apiBaseUrl}/feed/grouped`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json({ items: [feed.items[1]], total: 2, limit: 10, offset: 1 });
      }),
    );
    renderFeed(page1);
    expect(await screen.findByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/June 22, 2026/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /view more/i }));
    expect(await screen.findByText(/June 22, 2026/)).toBeInTheDocument();
    // Browser-side paging is already per-visitor: it must never send the SSR signing headers.
    expect(captured?.get("X-Backlotter-Origin")).toBeNull();
    expect(captured?.get("X-Backlotter-Client-IP")).toBeNull();
  });
});

describe("feed day sections", () => {
  it("leads with the news-backed section, then the Not yet reported one", async () => {
    renderFeed(
      oneDay(
        dayItem("tmdb-first"),
        dayItem("reported", { news_backed: true }),
        dayItem("tmdb-second"),
      ),
    );
    await screen.findByText(/June 23, 2026/);

    expect(screen.getByText("In the news (1 movie)")).toBeInTheDocument();
    expect(screen.getByText("Not yet reported (2 movies)")).toBeInTheDocument();

    // The news-backed film renders above both not-yet-reported ones despite the original order.
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/film/reported");
  });

  it("renders both labels on a news-only day with a static None today line", async () => {
    renderFeed(oneDay(dayItem("a", { news_backed: true }), dayItem("b", { news_backed: true })));
    await screen.findByText(/June 23, 2026/);

    expect(screen.getByText("In the news (2 movies)")).toBeInTheDocument();
    expect(screen.getByText("Not yet reported")).toBeInTheDocument();
    expect(screen.getByText("None today")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("renders both labels on a tmdb-only day with a static None today line", async () => {
    renderFeed(oneDay(dayItem("a"), dayItem("b")));
    await screen.findByText(/June 23, 2026/);

    expect(screen.getByText("In the news")).toBeInTheDocument();
    expect(screen.getByText("None today")).toBeInTheDocument();
    expect(screen.getByText("Not yet reported (2 movies)")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Not yet reported (2 movies)"));
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("sort items alphabetically within each section", async () => {
    renderFeed(
      oneDay(
        dayItem("z-movie", { news_backed: true, film_title: "Z Movie" }),
        dayItem("a-movie", { news_backed: true, film_title: "A Movie" }),
        dayItem("m-movie", { film_title: "M Movie" }),
        dayItem("b-movie", { film_title: "B Movie" }),
      ),
    );
    await screen.findByText(/June 23, 2026/);

    const newsSection = screen.getByText("In the news (2 movies)").closest("div")!;
    const newsLinks = [...newsSection.querySelectorAll("a[href^='/film/']")].map((a) =>
      a.getAttribute("href"),
    );
    expect(newsLinks).toEqual(["/film/a-movie", "/film/z-movie"]);

    // Expand the "Not yet reported" section to inspect its order too.
    await userEvent.click(screen.getByText("Not yet reported (2 movies)"));
    const tmdbSection = screen.getByText("Not yet reported (2 movies)").closest("div")!;
    const tmdbLinks = [...tmdbSection.querySelectorAll("a[href^='/film/']")].map((a) =>
      a.getAttribute("href"),
    );
    expect(tmdbLinks).toEqual(["/film/b-movie", "/film/m-movie"]);
  });

  it("renders events within a card with a summary line and source chips", async () => {
    renderFeed(
      oneDay(
        dayItem("reported", {
          news_backed: true,
          film_title: "Reported Film",
          events: [
            {
              event_id: "evt-1",
              event_type: "trailer",
              confidence: "confirmed",
              created_at: "2026-06-23T10:00:00Z",
              occurred_at: "2026-06-23T10:00:00Z",
              summary: "First trailer released.",
              summary_edited: false,
              status: "published",
              superseded_by: null,
              video_key: null,
              provenance: "story",
              sources: [
                {
                  url: "https://variety.com/story1",
                  source: "Variety",
                  title: "Story One",
                  published_at: null,
                },
              ],
            },
          ],
        }),
      ),
    );
    await screen.findByText("Reported Film");
    expect(screen.getByText("First trailer released.")).toBeInTheDocument();
    expect(screen.getByText("Variety")).toBeInTheDocument();
  });

  it("sections a promoted event on its original day, not the day the story arrived", async () => {
    // NEU-1136's promotion rule: TMDB carded "reported-monday" on the 22nd; a trade covered it
    // on the 23rd and the story attached to that same event. `created_at` does not move (backend
    // ADR-0016), so the item stays on the 22nd — and now leads that day's news-backed section.
    renderFeed({
      items: [
        dayItem("tuesday-tmdb", { day: "2026-06-23" }),
        dayItem("reported-monday", { day: "2026-06-22", news_backed: true }),
        dayItem("monday-tmdb", { day: "2026-06-22" }),
      ],
      total: 2,
      limit: 10,
      offset: 0,
    });
    await screen.findByText(/June 22, 2026/);

    const days = [...document.querySelectorAll("main section")] as HTMLElement[];
    const tuesday = days.find(
      (d) => d.querySelector("time")?.getAttribute("datetime") === "2026-06-23",
    )!;
    const monday = days.find(
      (d) => d.querySelector("time")?.getAttribute("datetime") === "2026-06-22",
    )!;

    // The promoted item is on Monday, in Monday's news section — not on Tuesday.
    expect(monday.querySelector('a[href="/film/reported-monday"]')).not.toBeNull();
    expect(tuesday.querySelector('a[href="/film/reported-monday"]')).toBeNull();
    expect([...monday.querySelectorAll("h3")].map((h) => h.textContent)).toEqual([
      "In the news (1 movie)",
    ]);
    // Expand Monday's "Not yet reported" section to see all items.
    await userEvent.click(within(monday).getByText("Not yet reported (1 movie)"));
    // Within each section, items are alphabetically sorted. News section renders first (reported-monday),
    // then "Not yet reported" section (monday-tmdb).
    const mondayLinks = [...monday.querySelectorAll("a[href^='/film/']")].map((a) =>
      a.getAttribute("href"),
    );
    expect(mondayLinks).toEqual(["/film/reported-monday", "/film/monday-tmdb"]);
    expect(mondayLinks.length).toBe(2);
    // Tuesday is TMDB-only: empty "In the news" heading plus collapsed "Not yet reported".
    expect([...tuesday.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["In the news"]);
    expect(within(tuesday).getByText("Not yet reported (1 movie)")).toBeInTheDocument();
  });

  it("opens every section with a rule and space, not just a heading", async () => {
    renderFeed(oneDay(dayItem("reported", { news_backed: true }), dayItem("tmdb")));
    const newsContainer = (await screen.findByText("In the news (1 movie)")).closest(".border-t")!;
    const tmdbContainer = screen.getByText("Not yet reported (1 movie)").closest(".border-t")!;
    expect(newsContainer).not.toBeNull();
    expect(tmdbContainer).not.toBeNull();
  });

  it("gives the day one strip covering both sections, news-backed posters first", async () => {
    renderFeed(
      oneDay(
        dayItem("tmdb", { poster_path: "/tmdb.jpg" }),
        dayItem("reported", { news_backed: true, poster_path: "/news.jpg" }),
      ),
    );
    await screen.findByText(/June 23, 2026/);
    const posters = screen.getAllByRole("img");
    // One strip for the whole day — but ordered news-first, so the reported film leads even
    // though backend order (popularity) puts the TMDB-only one ahead of it.
    expect(posters.map((p) => p.getAttribute("src"))).toEqual([
      "https://image.tmdb.org/t/p/w185/news.jpg",
      "https://image.tmdb.org/t/p/w185/tmdb.jpg",
    ]);
  });
});

describe("Not yet reported section", () => {
  it("is explained once, in the standfirst, not under every day", async () => {
    renderFeed(feed);
    await screen.findByRole("heading", { name: HEADING });

    const standfirst = screen.getByText(GLOBAL_FEED_STANDFIRST, { exact: false });
    expect(standfirst).toHaveTextContent(`${GLOBAL_FEED_STANDFIRST} ${SECTION_SPLIT_EXPLAINER}`);
    expect(screen.getAllByText(SECTION_SPLIT_EXPLAINER, { exact: false })).toHaveLength(1);
  });

  it("renders the Not yet reported section collapsed by default with movie count", async () => {
    renderFeed(
      oneDay(dayItem("news-film", { news_backed: true }), dayItem("tmdb-a"), dayItem("tmdb-b")),
    );
    await screen.findByText(/June 23, 2026/);

    expect(screen.getByText("Not yet reported (2 movies)")).toBeInTheDocument();
  });

  it("renders In the news section always expanded with count", async () => {
    renderFeed(oneDay(dayItem("news-film", { news_backed: true }), dayItem("tmdb-film")));
    await screen.findByText(/June 23, 2026/);

    expect(screen.getByText("In the news (1 movie)")).toBeInTheDocument();
    expect(screen.getByText("In the news (1 movie)").tagName).toBe("H3");
  });

  it("toggles the Not yet reported section open on click", async () => {
    renderFeed(oneDay(dayItem("news-film", { news_backed: true }), dayItem("tmdb-a")));
    await screen.findByText(/June 23, 2026/);

    // Initially the Not yet reported section's items are not visible.
    expect(screen.queryByText("TMDB-A")).toBeNull();

    await userEvent.click(screen.getByText("Not yet reported (1 movie)"));
    expect(screen.getByText("TMDB-A")).toBeInTheDocument();
  });

  it("empty section shows None today without count suffix", async () => {
    renderFeed(oneDay(dayItem("news-film", { news_backed: true })));
    await screen.findByText(/June 23, 2026/);

    const emptyHeading = screen.getByText("Not yet reported");
    expect(emptyHeading).toBeInTheDocument();
    expect(emptyHeading.textContent).not.toContain("movie");
    expect(screen.getByText("None today")).toBeInTheDocument();
  });

  it("renders movie titles with beat labels but no event cards", async () => {
    // Backend still ships events: [] for catalog-sourced feed rows (NEU-1208); NEU-1212
    // labels the row with the day's beats so it can be triaged without a page load.
    renderFeed(
      oneDay(
        dayItem("tmdb-film", {
          film_title: "TMDB Film",
          event_count: 1,
          event_types: ["casting"],
          events: [],
        }),
      ),
    );
    await screen.findByText(/June 23, 2026/);

    await userEvent.click(screen.getByText("Not yet reported (1 movie)"));
    expect(screen.getByText("TMDB Film")).toBeInTheDocument();
    expect(screen.getByText("Casting")).toBeInTheDocument();
    expect(screen.queryByText("The official trailer was released.")).toBeNull();
    expect(screen.queryByText("Trailer")).toBeNull();
  });
});

describe("within-day cap removal", () => {
  // Backend ADR-0016: the first directors sweep published 74 updates under one date heading,
  // and future tranches will do the same by design. That day must now render in full.
  const tallDay: FeedDayResponse = {
    items: Array.from({ length: 74 }, (_, n) => dayItem(`film-${n}`, { news_backed: n % 3 === 0 })),
    total: 1,
    limit: 10,
    offset: 0,
  };

  it("renders every update in a tall day with no additional disclosure controls", async () => {
    renderFeed(tallDay);
    await screen.findByText(/June 23, 2026/);

    // Expand the "Not yet reported" section to count all items
    const tmdbBtn = screen.getByText(/^Not yet reported \(/);
    await userEvent.click(tmdbBtn);
    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(74);
    expect(screen.queryByText(/Show all/i)).toBeNull();
    expect(screen.queryByText(/Show fewer/i)).toBeNull();
  });

  it("keeps day-level pagination untouched", async () => {
    renderFeed({ ...tallDay, total: 2 });
    expect(await screen.findByRole("button", { name: /view more/i })).toBeInTheDocument();
  });
});
