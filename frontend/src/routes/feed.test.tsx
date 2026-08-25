import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import FeedPage, { loader, meta } from "@/routes/feed";
import type { FeedDayItem, FeedDayResponse } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const feed: FeedDayResponse = {
  items: [
    {
      film_ref: "the-odyssey-2026",
      film_title: "The Odyssey",
      release_year: 2026,
      poster_path: "/odyssey.jpg",
      arc_stage: "shooting",
      day: "2026-06-23",
      top_event_type: "trailer",
      event_types: ["trailer"],
      event_count: 1,
      news_backed: true,
      event_story_sources: [],
    },
    {
      film_ref: "dune-3-2026",
      film_title: "Dune Part Three",
      release_year: 2026,
      poster_path: null,
      arc_stage: "shooting",
      day: "2026-06-22",
      top_event_type: "casting",
      event_types: ["casting"],
      event_count: 3,
      news_backed: false,
      event_story_sources: [],
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
};

function dayItem(film_ref: string, overrides: Partial<FeedDayItem> = {}): FeedDayItem {
  return {
    film_ref,
    film_title: film_ref.toUpperCase(),
    release_year: 2026,
    poster_path: null,
    arc_stage: "shooting",
    day: "2026-06-23",
    top_event_type: "casting",
    event_types: ["casting"],
    event_count: 1,
    news_backed: false,
    event_story_sources: [],
    ...overrides,
  };
}

/** One day, ordered as the backend returns it. */
function oneDay(...items: FeedDayResponse["items"]): FeedDayResponse {
  return { items, total: 1, limit: 10, offset: 0 };
}

function contextWithEnv() {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } });
  return context;
}

function callLoader() {
  return loader({
    request: new Request("https://upmovies.example/"),
    context: contextWithEnv(),
    params: {},
  } as unknown as Parameters<typeof loader>[0]);
}

describe("feed route loader", () => {
  it("fetches the grouped feed from the backend", async () => {
    server.use(http.get(`${BACKEND}/feed/grouped`, () => HttpResponse.json(feed)));
    const data = await callLoader();
    expect(data.feed.total).toBe(2);
    expect(data.feed.items[0].film_ref).toBe("the-odyssey-2026");
  });
});

describe("feed route meta", () => {
  it("builds the landing head with the brand-lockup title and canonical link", () => {
    const tags = meta({
      location: { pathname: "/" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "production log — backlotter" });
    expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});

describe("feed route render", () => {
  it("groups films by day (newest first) and links each card to its film page", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: FeedPage, loader: () => ({ feed }) }]);
    render(<Stub initialEntries={["/"]} />);

    expect(
      await screen.findByRole("heading", { name: "Latest Updates for Upcoming Movies" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/June 22, 2026/)).toBeInTheDocument();

    // Reached through the title rather than by accessible name: the day's poster strip links
    // the same film too, under "<title> poster".
    expect(screen.getByText("The Odyssey").closest("a")).toHaveAttribute(
      "href",
      "/film/the-odyssey-2026",
    );
    expect(screen.getByText("Dune Part Three").closest("a")).toHaveAttribute(
      "href",
      "/film/dune-3-2026",
    );
  });

  it("gives each day a poster strip and links every poster to its film", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: FeedPage, loader: () => ({ feed }) }]);
    render(<Stub initialEntries={["/"]} />);

    // June 23 has The Odyssey's poster; June 22's only film has none, so that day has no strip.
    const posters = await screen.findAllByRole("img");
    expect(posters).toHaveLength(1);
    expect(posters[0].getAttribute("src")).toContain("/w185/odyssey.jpg");
    expect(posters[0].closest("a")).toHaveAttribute("href", "/film/the-odyssey-2026");
  });

  it("puts the poster strip above the day's updates at every width", async () => {
    // Beside the list, a poster lined up with whatever row happened to sit next to it and read
    // as a label for a film it had nothing to do with.
    const Stub = createRoutesStub([{ path: "/", Component: FeedPage, loader: () => ({ feed }) }]);
    render(<Stub initialEntries={["/"]} />);

    await screen.findByRole("img");
    const row = screen
      .getByText(/June 23, 2026/)
      .closest("section")
      ?.querySelector("div");
    expect(row?.className).toContain("flex-col");
    expect(row?.className).not.toContain("flex-row");
  });

  it("shows the empty state when there are no updates", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: FeedPage,
        loader: () => ({ feed: { ...feed, items: [], total: 0 } }),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(await screen.findByText(/no updates yet/i)).toBeInTheDocument();
  });

  it("loads the next page of days when 'View more' is clicked (no autoload)", async () => {
    // Page 1 has one day but total=2, so 'View more' shows; clicking fetches page 2.
    const page1: FeedDayResponse = { items: [feed.items[0]], total: 2, limit: 10, offset: 0 };
    server.use(
      http.get(`${BACKEND}/feed/grouped`, () =>
        HttpResponse.json({ items: [feed.items[1]], total: 2, limit: 10, offset: 1 }),
      ),
    );
    const Stub = createRoutesStub([
      { path: "/", Component: FeedPage, loader: () => ({ feed: page1 }) },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(await screen.findByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/June 22, 2026/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /view more/i }));
    expect(await screen.findByText(/June 22, 2026/)).toBeInTheDocument();
  });
});

function renderFeed(data: FeedDayResponse) {
  const Stub = createRoutesStub([
    { path: "/", Component: FeedPage, loader: () => ({ feed: data }) },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("feed day sections", () => {
  it("leads with the news-backed section, then the TMDB-only one", async () => {
    renderFeed(
      oneDay(
        dayItem("tmdb-first"),
        dayItem("reported", { news_backed: true }),
        dayItem("tmdb-second"),
      ),
    );
    await screen.findByText(/June 23, 2026/);

    const subheadings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(subheadings).toEqual(["In the news"]);

    // The news-backed film renders above both TMDB-only ones despite the original order.
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/film/reported");
  });

  it("renders no sub-heading when the day is only news-backed", async () => {
    renderFeed(oneDay(dayItem("a", { news_backed: true }), dayItem("b", { news_backed: true })));
    await screen.findByText(/June 23, 2026/);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("renders no sub-heading when the day is only TMDB-only", async () => {
    renderFeed(oneDay(dayItem("a"), dayItem("b")));
    await screen.findByText(/June 23, 2026/);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
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

    const newsSection = screen.getByText("In the news").closest("div")!;
    const newsLinks = [...newsSection.querySelectorAll("a[href^='/film/']")].map(
      (a) => a.getAttribute("href"),
    );
    expect(newsLinks).toEqual(["/film/a-movie", "/film/z-movie"]);
  });

  it("renders story sources within a news-backed card", async () => {
    renderFeed(
      oneDay(
        dayItem("reported", {
          news_backed: true,
          film_title: "Reported Film",
          event_story_sources: [
            { url: "https://variety.com/story1", source: "Variety", title: "Story One", published_at: null },
          ],
        }),
      ),
    );
    await screen.findByText("Reported Film");
    expect(screen.getByText("Variety")).toBeInTheDocument();
    expect(screen.getByText("Story One")).toBeInTheDocument();
    // The story source renders as a span[role="link"] inside the card's anchor
    const storyLink = screen.getByText("Story One").closest('[role="link"]')!;
    expect(storyLink).toBeInTheDocument();
    expect(storyLink.getAttribute("tabIndex")).toBe("0");
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

    const days = [...document.querySelectorAll("main section")];
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
      "In the news",
    ]);
    // Expand the TMDB section to see all items
    await userEvent.click(screen.getByText("via TMDB"));
    // Within each section, items are alphabetically sorted. News section renders first (reported-monday),
    // then TMDB section (monday-tmdb).
    const mondayLinks = [...monday.querySelectorAll("a[href^='/film/']")].map((a) => a.getAttribute("href"));
    expect(mondayLinks).toEqual(["/film/reported-monday", "/film/monday-tmdb"]);
    expect(mondayLinks.length).toBe(2);
    // Tuesday is TMDB-only, so it stays unlabelled.
    expect(tuesday.querySelectorAll("h3")).toHaveLength(0);
  });

  it("opens every section with a rule and space, not just a heading", async () => {
    renderFeed(oneDay(dayItem("reported", { news_backed: true }), dayItem("tmdb")));
    const newsContainer = (await screen.findByText("In the news")).closest(".border-t")!;
    const tmdbContainer = screen.getByText("via TMDB").closest(".border-t")!;
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

describe("tmdb section collapse", () => {
  it("renders via TMDB section collapsed by default with movie count", async () => {
    renderFeed(
      oneDay(
        dayItem("news-film", { news_backed: true }),
        dayItem("tmdb-a"),
        dayItem("tmdb-b"),
      ),
    );
    await screen.findByText(/June 23, 2026/);

    // The TMDB section shows its heading and count but the items are hidden
    const tmdbHeading = screen.getByText("via TMDB");
    expect(tmdbHeading).toBeInTheDocument();

    // The count badge should show 2
    const countEl = tmdbHeading.parentElement!.querySelector(".ml-auto");
    expect(countEl?.textContent).toBe("2");

    // The expand/collapse chevron should be present (not rotated = collapsed)
    const chevron = tmdbHeading.parentElement!.querySelector("svg");
    expect(chevron).not.toBeNull();
    expect(chevron?.className).not.toContain("rotate-90");
  });

  it("renders In the news section always expanded", async () => {
    renderFeed(
      oneDay(
        dayItem("news-film", { news_backed: true }),
        dayItem("tmdb-film"),
      ),
    );
    await screen.findByText(/June 23, 2026/);

    // News section heading is an h3, not a button
    const newsHeading = screen.getByText("In the news");
    expect(newsHeading.tagName).toBe("H3");
  });

  it("toggles via TMDB section open on click", async () => {
    renderFeed(
      oneDay(
        dayItem("news-film", { news_backed: true }),
        dayItem("tmdb-a"),
      ),
    );
    await screen.findByText(/June 23, 2026/);

    // Initially TMDB section items are not visible (via queryByText — element shouldn't exist)
    expect(screen.queryByText("TMDB-A")).toBeNull();

    // Click the TMDB heading to expand
    await userEvent.click(screen.getByText("via TMDB"));
    expect(screen.getByText("TMDB-A")).toBeInTheDocument();
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

    // Expand the TMDB section to count all items
    const tmdbBtn = screen.getByText("via TMDB");
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
