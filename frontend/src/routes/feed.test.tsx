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
      film_slug: "the-odyssey-2026",
      film_title: "The Odyssey",
      release_year: 2026,
      poster_path: "/odyssey.jpg",
      arc_stage: "shooting",
      day: "2026-06-23",
      top_event_type: "trailer",
      event_types: ["trailer"],
      event_count: 1,
      news_backed: true,
    },
    {
      film_slug: "dune-3-2026",
      film_title: "Dune Part Three",
      release_year: 2026,
      poster_path: null,
      arc_stage: "shooting",
      day: "2026-06-22",
      top_event_type: "casting",
      event_types: ["casting"],
      event_count: 3,
      news_backed: false,
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
};

function dayItem(film_slug: string, overrides: Partial<FeedDayItem> = {}): FeedDayItem {
  return {
    film_slug,
    film_title: film_slug.toUpperCase(),
    release_year: 2026,
    poster_path: null,
    arc_stage: "shooting",
    day: "2026-06-23",
    top_event_type: "casting",
    event_types: ["casting"],
    event_count: 1,
    news_backed: false,
    ...overrides,
  };
}

/** One day, ordered as the backend returns it (news-backed and TMDB-only interleaved). */
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
    expect(data.feed.items[0].film_slug).toBe("the-odyssey-2026");
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
    expect(posters[0].getAttribute("src")).toContain("/w92/odyssey.jpg");
    expect(posters[0].closest("a")).toHaveAttribute("href", "/film/the-odyssey-2026");
  });

  it("stacks the poster above the day's updates on a phone and beside them from sm up", async () => {
    // A phone column is ~300px once the poster and the date rule take their share, which is
    // not enough for the titles — so the day's row is a column until `sm`.
    const Stub = createRoutesStub([{ path: "/", Component: FeedPage, loader: () => ({ feed }) }]);
    render(<Stub initialEntries={["/"]} />);

    await screen.findByRole("img");
    const row = screen
      .getByText(/June 23, 2026/)
      .closest("section")
      ?.querySelector("div");
    expect(row?.className).toContain("flex-col");
    expect(row?.className).toContain("sm:flex-row");
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
    expect(subheadings).toEqual(["In the news", "via TMDB"]);

    // The news-backed film renders above both TMDB-only ones despite arriving second.
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/film/reported", "/film/tmdb-first", "/film/tmdb-second"]);
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
    expect(screen.queryByText("via TMDB")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);
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
      "via TMDB",
    ]);
    expect([...monday.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/film/reported-monday",
      "/film/monday-tmdb",
    ]);
    // Tuesday is TMDB-only, so it stays unlabelled.
    expect(tuesday.querySelectorAll("h3")).toHaveLength(0);
  });

  it("breaks the second section off with a rule and space, not just a heading", async () => {
    // The sub-heading sits between two striped rows; without a break of its own it reads as
    // one of them. The first section needs none — the day heading above it already does this.
    renderFeed(oneDay(dayItem("reported", { news_backed: true }), dayItem("tmdb")));
    const tmdb = (await screen.findByText("via TMDB")).parentElement;
    const news = screen.getByText("In the news").parentElement;
    expect(tmdb?.className).toContain("border-t");
    expect(news?.className).toBe(tmdb?.className);
    expect(news?.matches(":first-child")).toBe(true);
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
      "https://image.tmdb.org/t/p/w92/news.jpg",
      "https://image.tmdb.org/t/p/w92/tmdb.jpg",
    ]);
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

  it("renders every update in a tall day with no disclosure", async () => {
    const { container } = renderFeed(tallDay);
    await screen.findByText(/June 23, 2026/);

    expect(screen.getAllByRole("link")).toHaveLength(74);
    expect(screen.queryByText(/Show all/i)).toBeNull();
    expect(screen.queryByText(/Show fewer/i)).toBeNull();
    expect(container.querySelector("details")).toBeNull();
  });

  it("keeps day-level pagination untouched", async () => {
    renderFeed({ ...tallDay, total: 2 });
    expect(await screen.findByRole("button", { name: /view more/i })).toBeInTheDocument();
  });
});
