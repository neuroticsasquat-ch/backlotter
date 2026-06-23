import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import FeedPage, { loader, meta } from "@/routes/feed";
import type { FeedResponse } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const feed: FeedResponse = {
  items: [
    {
      film_slug: "the-odyssey-2026",
      film_title: "The Odyssey",
      event_type: "trailer",
      confidence: "confirmed",
      occurred_at: "2026-06-01T00:00:00Z",
      created_at: "2026-06-23T10:00:00Z",
      summary: "Trailer dropped.",
      sources: [
        { url: "https://deadline.com/a", source: "Deadline", title: "Trailer", published_at: null },
      ],
    },
    {
      film_slug: "dune-3-2026",
      film_title: "Dune Part Three",
      event_type: "casting",
      confidence: "rumored",
      occurred_at: "2025-03-01T00:00:00Z",
      created_at: "2026-06-22T09:00:00Z",
      summary: "New cast rumored.",
      sources: [],
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
  it("fetches the feed from the backend", async () => {
    server.use(http.get(`${BACKEND}/feed`, () => HttpResponse.json(feed)));
    const data = await callLoader();
    expect(data.feed.total).toBe(2);
    expect(data.feed.items[0].film_slug).toBe("the-odyssey-2026");
  });
});

describe("feed route meta", () => {
  it("builds the landing head with the templated title and canonical link", () => {
    const tags = meta({
      location: { pathname: "/" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "Latest Updates · Upcoming Movies Tracker" });
    expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});

describe("feed route render", () => {
  it("groups items by day (newest first) and links each to its film page", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: FeedPage, loader: () => ({ feed }) }]);
    render(<Stub initialEntries={["/"]} />);

    expect(await screen.findByRole("heading", { name: "Latest Updates" })).toBeInTheDocument();
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/June 22, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Trailer dropped.")).toBeInTheDocument();
    expect(screen.getByText("New cast rumored.")).toBeInTheDocument();
    const filmLink = screen.getByRole("link", { name: "The Odyssey" });
    expect(filmLink).toHaveAttribute("href", "/film/the-odyssey-2026");
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
});
