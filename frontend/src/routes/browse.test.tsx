import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import BrowsePage, { loader, meta } from "@/routes/browse";
import type { FilmIndexResponse } from "@/api/types";
import { PAGE_SIZE } from "@/api/public";

const BACKEND = "https://api.upmovies.localhost";

const films: FilmIndexResponse = {
  items: [
    {
      slug: "the-odyssey-2026",
      title: "The Odyssey",
      release_year: 2026,
      poster_path: "/odyssey.jpg",
      arc_stage: "trailer",
    },
    {
      slug: "dune-3-2026",
      title: "Dune Part Three",
      release_year: 2026,
      poster_path: null,
      arc_stage: "shooting",
    },
  ],
  total: 2,
  limit: PAGE_SIZE,
  offset: 0,
};

function contextWithEnv() {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } });
  return context;
}

function callLoader(url = "https://upmovies.example/browse") {
  return loader({
    request: new Request(url),
    context: contextWithEnv(),
    params: {},
  } as unknown as Parameters<typeof loader>[0]);
}

describe("browse route loader", () => {
  it("fetches films with offset=0 when no page param is given", async () => {
    let capturedUrl: URL | null = null;
    server.use(
      http.get(`${BACKEND}/films`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json(films);
      }),
    );
    const data = await callLoader();
    expect(capturedUrl!.searchParams.get("offset")).toBe("0");
    expect(data.films.total).toBe(2);
    expect(data.films.items[0].slug).toBe("the-odyssey-2026");
    expect(data.page).toBe(1);
  });

  it("maps page=2 to offset=PAGE_SIZE", async () => {
    let capturedUrl: URL | null = null;
    server.use(
      http.get(`${BACKEND}/films`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({ ...films, offset: PAGE_SIZE });
      }),
    );
    const data = await callLoader("https://upmovies.example/browse?page=2");
    expect(capturedUrl!.searchParams.get("offset")).toBe(String(PAGE_SIZE));
    expect(data.page).toBe(2);
  });

  it("clamps page=0 to page 1", async () => {
    server.use(http.get(`${BACKEND}/films`, () => HttpResponse.json(films)));
    const data = await callLoader("https://upmovies.example/browse?page=0");
    expect(data.page).toBe(1);
  });

  it("clamps page=-3 to page 1", async () => {
    server.use(http.get(`${BACKEND}/films`, () => HttpResponse.json(films)));
    const data = await callLoader("https://upmovies.example/browse?page=-3");
    expect(data.page).toBe(1);
  });

  it("clamps page=abc to page 1", async () => {
    server.use(http.get(`${BACKEND}/films`, () => HttpResponse.json(films)));
    const data = await callLoader("https://upmovies.example/browse?page=abc");
    expect(data.page).toBe(1);
  });
});

describe("browse route meta", () => {
  it("builds the head with the templated title, description, and canonical link", () => {
    const tags = meta({
      loaderData: { films, page: 1, totalPages: 1 },
      location: { pathname: "/browse" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "Browse · BackLotter" });
    expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });

  it("self-canonicalizes page 1 to the bare /browse URL", () => {
    const tags = meta({
      loaderData: { films, page: 1, totalPages: 1 },
      location: { pathname: "/browse" },
    } as unknown as Parameters<typeof meta>[0]);
    const canonical = tags.find(
      (t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical",
    ) as { href: string } | undefined;
    expect(canonical?.href).toMatch(/\/browse$/);
    const ogUrl = tags.find((t) => "property" in t && t.property === "og:url") as
      | { content: string }
      | undefined;
    expect(ogUrl?.content).toMatch(/\/browse$/);
  });

  it("self-canonicalizes page 2 to /browse?page=2 and points rel=prev at the bare URL", () => {
    const tags = meta({
      loaderData: { films: { ...films, total: 72 }, page: 2, totalPages: 2 },
      location: { pathname: "/browse" },
    } as unknown as Parameters<typeof meta>[0]);
    const canonical = tags.find(
      (t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical",
    ) as { href: string } | undefined;
    expect(canonical?.href).toMatch(/\/browse\?page=2$/);
    const ogUrl = tags.find((t) => "property" in t && t.property === "og:url") as
      | { content: string }
      | undefined;
    expect(ogUrl?.content).toMatch(/\/browse\?page=2$/);
    const prev = tags.find((t) => "tagName" in t && t.tagName === "link" && t.rel === "prev") as
      | { href: string }
      | undefined;
    expect(prev?.href).toMatch(/\/browse$/);
    expect(prev?.href).not.toMatch(/\?page=/);
  });

  it("includes rel=next when page < totalPages", () => {
    const tags = meta({
      loaderData: { films: { ...films, total: 72 }, page: 1, totalPages: 2 },
      location: { pathname: "/browse" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "next")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "prev")).toBe(
      false,
    );
  });

  it("includes rel=prev when page > 1", () => {
    const tags = meta({
      loaderData: { films: { ...films, total: 72 }, page: 2, totalPages: 2 },
      location: { pathname: "/browse" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "prev")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "next")).toBe(
      false,
    );
  });

  it("includes noindex when page > totalPages and total > 0", () => {
    const tags = meta({
      loaderData: { films: { ...films, total: 2, items: [] }, page: 5, totalPages: 1 },
      location: { pathname: "/browse" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags.some((t) => "name" in t && t.name === "robots" && t.content === "noindex")).toBe(
      true,
    );
  });

  it("does not include noindex when total = 0", () => {
    const tags = meta({
      loaderData: { films: { ...films, total: 0, items: [] }, page: 1, totalPages: 1 },
      location: { pathname: "/browse" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags.some((t) => "name" in t && t.name === "robots")).toBe(false);
  });
});

describe("browse route render", () => {
  it("renders a grid with film links and titles plus a Next pagination link", async () => {
    const twoPageFilms: FilmIndexResponse = { ...films, total: 72 };
    const Stub = createRoutesStub([
      {
        path: "/browse",
        Component: BrowsePage,
        loader: () => ({ films: twoPageFilms, page: 1, totalPages: 2 }),
      },
    ]);
    render(<Stub initialEntries={["/browse"]} />);

    // Both film links render
    const odyssey = await screen.findByRole("link", { name: /The Odyssey/i });
    expect(odyssey).toHaveAttribute("href", "/film/the-odyssey-2026");
    const dune = screen.getByRole("link", { name: /Dune Part Three/i });
    expect(dune).toHaveAttribute("href", "/film/dune-3-2026");

    // Next pagination link
    expect(screen.getByRole("link", { name: /next/i })).toBeInTheDocument();
  });

  it("renders the empty state when items=[] and total=0", async () => {
    const emptyFilms: FilmIndexResponse = { items: [], total: 0, limit: PAGE_SIZE, offset: 0 };
    const Stub = createRoutesStub([
      {
        path: "/browse",
        Component: BrowsePage,
        loader: () => ({ films: emptyFilms, page: 1, totalPages: 1 }),
      },
    ]);
    render(<Stub initialEntries={["/browse"]} />);
    expect(await screen.findByText(/no films tracked yet/i)).toBeInTheDocument();
  });

  it("shows a past-the-end message (not the empty-catalog copy) when items=[] but total>0", async () => {
    const pastEnd: FilmIndexResponse = {
      items: [],
      total: 2,
      limit: PAGE_SIZE,
      offset: PAGE_SIZE * 4,
    };
    const Stub = createRoutesStub([
      {
        path: "/browse",
        Component: BrowsePage,
        loader: () => ({ films: pastEnd, page: 5, totalPages: 1 }),
      },
    ]);
    render(<Stub initialEntries={["/browse?page=5"]} />);
    expect(await screen.findByText(/past the end of the list/i)).toBeInTheDocument();
    expect(screen.queryByText(/no films tracked yet/i)).toBeNull();
    expect(screen.getByRole("link", { name: /back to the first page/i })).toHaveAttribute(
      "href",
      "/browse",
    );
  });
});
