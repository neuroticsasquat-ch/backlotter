import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import FeedPage, { loader, meta } from "@/routes/feed";
import type { FeedDayResponse } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const feed: FeedDayResponse = {
  items: [
    {
      film_slug: "the-odyssey-2026",
      film_title: "The Odyssey",
      release_year: 2026,
      poster_path: "/odyssey.jpg",
      day: "2026-06-23",
      top_event_type: "trailer",
      event_count: 1,
    },
    {
      film_slug: "dune-3-2026",
      film_title: "Dune Part Three",
      release_year: 2026,
      poster_path: null,
      day: "2026-06-22",
      top_event_type: "casting",
      event_count: 3,
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
};

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
    expect(tags).toContainEqual({ title: "backlotter — production log" });
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

    expect(await screen.findByRole("heading", { name: "Latest Updates" })).toBeInTheDocument();
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/June 22, 2026/)).toBeInTheDocument();

    const odyssey = screen.getByRole("link", { name: /The Odyssey/ });
    expect(odyssey).toHaveAttribute("href", "/film/the-odyssey-2026");
    const dune = screen.getByRole("link", { name: /Dune Part Three/ });
    expect(dune).toHaveAttribute("href", "/film/dune-3-2026");
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
