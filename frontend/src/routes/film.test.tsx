import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import FilmPage, { ErrorBoundary, loader, meta } from "@/routes/film";
import type { FilmDetail } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const film: FilmDetail = {
  ref: "12345-the-odyssey",
  title: "The Odyssey",
  release_date: "2026-07-17",
  release_year: 2026,
  poster_path: "/poster.jpg",
  arc_stage: "wrapped",
  day_groups: [
    {
      day: "2026-06-01",
      heading: "Monday, June 1, 2026",
      news_events: [
        {
          event_id: "evt-2",
          event_type: "trailer",
          confidence: "rumored",
          created_at: "2026-06-01T00:00:00Z",
          summary: "Trailer dropped.",
          summary_edited: false,
          provenance: "story",
          sources: [],
        },
      ],
      tmdb_events: [],
    },
    {
      day: "2025-01-01",
      heading: "Wednesday, January 1, 2025",
      news_events: [
        {
          event_id: "evt-1",
          event_type: "casting",
          confidence: "confirmed",
          created_at: "2025-01-01T00:00:00Z",
          summary: "Casting announced.",
          summary_edited: false,
          provenance: "story",
          sources: [
            { url: "https://deadline.com/a", source: "Deadline", title: "Cast", published_at: null },
          ],
        },
      ],
      tmdb_events: [],
    },
  ],
  overview: "A contemporary retelling of Homer's epic voyage.",
  tagline: "The journey home begins.",
  runtime: 148,
  genres: ["Adventure", "Drama"],
  production_countries: [],
  vote_average: 7.8,
  vote_count: 1200,
  original_language: "en",
  backdrop_path: "/backdrop.jpg",
  production_companies: ["Universal Pictures"],
  collection: null,
  release_dates: [],
  alternative_titles: ["Odysseia", "Οδύσσεια"],
  cast: [
    { name: "Timothée Chalamet", character: "Telemachus", profile_path: "/tchalamet.jpg" },
    { name: "Cate Blanchett", character: null, profile_path: null },
  ],
  crew: [{ name: "Christopher Nolan", job: "Director", department: "Directing" }],
  tmdb_id: 603,
  imdb_id: "tt0133093",
};

function contextWithEnv() {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } });
  return context;
}

function callLoader(ref: string, search = "") {
  return loader({
    request: new Request(`https://upmovies.example/film/${ref}${search}`),
    context: contextWithEnv(),
    params: { ref },
  } as unknown as Parameters<typeof loader>[0]);
}

describe("film route loader", () => {
  it("fetches the film detail by ref", async () => {
    server.use(http.get(`${BACKEND}/films/12345-the-odyssey`, () => HttpResponse.json(film)));
    const data = await callLoader("12345-the-odyssey");
    expect(data.film.ref).toBe("12345-the-odyssey");
  });

  it("throws a 404 Response for an unknown ref", async () => {
    server.use(http.get(`${BACKEND}/films/missing`, () => new HttpResponse(null, { status: 404 })));
    await expect(callLoader("missing")).rejects.toMatchObject({ status: 404 });
  });

  // NEU-1143: a ref resolves on its leading id, so several URLs reach the same film. Each is
  // sent to the canonical one, permanently — the old URLs are indexed, and only a 301 moves the
  // ranking signal onto the URL we now emit.
  it.each([
    ["a legacy slug URL", "the-odyssey-2026"],
    ["a bare id", "12345"],
    ["a stale decorative half", "12345-untitled-odyssey-project"],
  ])("301s %s to the canonical ref", async (_label, requested) => {
    server.use(http.get(`${BACKEND}/films/${requested}`, () => HttpResponse.json(film)));

    const thrown = await callLoader(requested).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    const res = thrown as Response;
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("Location") ?? "").pathname).toBe("/film/12345-the-odyssey");
  });

  it("does not redirect when the URL is already canonical", async () => {
    server.use(http.get(`${BACKEND}/films/12345-the-odyssey`, () => HttpResponse.json(film)));
    const data = await callLoader("12345-the-odyssey");
    expect(data.film.ref).toBe("12345-the-odyssey");
  });

  it("keeps the query string when it redirects", async () => {
    server.use(http.get(`${BACKEND}/films/12345`, () => HttpResponse.json(film)));
    const thrown = (await callLoader("12345", "?utm_source=x").catch(
      (e: unknown) => e,
    )) as Response;
    const url = new URL(thrown.headers.get("Location") ?? "");
    expect(url.pathname).toBe("/film/12345-the-odyssey");
    expect(url.search).toBe("?utm_source=x");
  });
});

describe("film route meta", () => {
  it("builds the head from film data including the poster OG image", () => {
    const tags = meta({
      loaderData: { film },
      location: { pathname: "/film/the-odyssey-2026" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "The Odyssey (2026) — backlotter" });
    expect(tags.some((t) => "property" in t && t.property === "og:image")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });

  it("returns a noindex head when the film is missing", () => {
    const tags = meta({
      loaderData: undefined,
      location: { pathname: "/film/missing" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("uses the newest event's summary for the description, regardless of array order", () => {
    const outOfOrder: FilmDetail = {
      ...film,
      day_groups: [
        {
          day: "2026-06-01",
          heading: "Monday, June 1, 2026",
          news_events: [
            {
              event_id: "evt-3",
              event_type: "trailer",
              confidence: "confirmed",
              created_at: "2026-06-01T00:00:00Z",
              summary: "Newest: trailer dropped.",
              summary_edited: false,
              provenance: "story",
              sources: [],
            },
          ],
          tmdb_events: [],
        },
        {
          day: "2025-01-01",
          heading: "Wednesday, January 1, 2025",
          news_events: [
            {
              event_id: "evt-4",
              event_type: "casting",
              confidence: "confirmed",
              created_at: "2025-01-01T00:00:00Z",
              summary: "Oldest: casting announced.",
              summary_edited: false,
              provenance: "story",
              sources: [],
            },
          ],
          tmdb_events: [],
        },
      ],
    };
    const tags = meta({
      loaderData: { film: outOfOrder },
      location: { pathname: "/film/the-odyssey-2026" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ name: "description", content: "Newest: trailer dropped." });
  });
});

/** Wraps a Stub (from createRoutesStub) with the providers EventCard needs
 *  (QueryClientProvider + AuthProvider). The Stub already provides data-router context,
 *  so useRevalidator resolves; useAuth resolves via the AuthProvider + QueryClient.
 *  Default MSW /me returns 401 → user=null → isAdmin=false, so admin controls stay hidden. */
function renderStub(Stub: React.ComponentType<{ initialEntries: string[] }>, path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={[path]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("film route render", () => {
  it("renders the arc, the timeline newest-first, and outbound source links", async () => {
    const Stub = createRoutesStub([
      { path: "/film/:slug", Component: FilmPage, loader: () => ({ film }) },
    ]);
    renderStub(Stub, "/film/the-odyssey-2026");

    expect(await screen.findByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.getByText("Released")).toBeInTheDocument(); // ArcStepper renders all 7 labels; "Released" is always present
    const summaries = screen.getAllByText(/announced|dropped/);
    expect(summaries[0].textContent).toContain("Trailer dropped.");
    expect(summaries[1].textContent).toContain("Casting announced.");
    const link = screen.getByRole("link", { name: "Deadline" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the empty state when there are no events", async () => {
    const Stub = createRoutesStub([
      {
        path: "/film/:slug",
        Component: FilmPage,
        loader: () => ({ film: { ...film, day_groups: [] } }),
      },
    ]);
    renderStub(Stub, "/film/the-odyssey-2026");
    expect(await screen.findByText(/no updates yet/i)).toBeInTheDocument();
  });

  it("renders the not-found error boundary on a 404", async () => {
    const Stub = createRoutesStub([
      {
        path: "/film/:slug",
        Component: FilmPage,
        ErrorBoundary,
        loader: () => {
          throw new Response(null, { status: 404 });
        },
      },
    ]);
    renderStub(Stub, "/film/missing");
    expect(await screen.findByText(/film not found/i)).toBeInTheDocument();
  });

  it("renders the release-dates section when the film has release dates", async () => {
    const filmWithDates: FilmDetail = {
      ...film,
      release_dates: [
        {
          country: "US",
          release_type: 3,
          type_label: "Theatrical (limited)",
          date: "2026-06-25T00:00:00Z",
          certification: "PG-13",
        },
      ],
    };
    const Stub = createRoutesStub([
      { path: "/film/:slug", Component: FilmPage, loader: () => ({ film: filmWithDates }) },
    ]);
    renderStub(Stub, "/film/the-odyssey-2026");
    expect(await screen.findByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.getByText("Theatrical (limited)")).toBeInTheDocument();
    expect(screen.getByText("Jun 25, 2026")).toBeInTheDocument();
  });

  it("omits the release-dates heading when release_dates is empty", async () => {
    const Stub = createRoutesStub([
      { path: "/film/:slug", Component: FilmPage, loader: () => ({ film }) },
    ]);
    renderStub(Stub, "/film/the-odyssey-2026");
    expect(await screen.findByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /release dates/i })).toBeNull();
    expect(screen.getByText("Released")).toBeInTheDocument(); // ArcStepper still renders
  });

  it("renders the director in the header and the cast section with member names", async () => {
    const Stub = createRoutesStub([
      { path: "/film/:slug", Component: FilmPage, loader: () => ({ film }) },
    ]);
    renderStub(Stub, "/film/the-odyssey-2026");
    expect(await screen.findByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.getAllByText("Christopher Nolan").length).toBeGreaterThanOrEqual(2); // director now in FilmHeader + FilmCrew
    expect(screen.getByRole("heading", { name: "Cast" })).toBeInTheDocument();
    expect(screen.getByText("Timothée Chalamet")).toBeInTheDocument();
    expect(screen.getByText(/Telemachus/)).toBeInTheDocument();
  });

  it("omits the cast section when cast is empty", async () => {
    const Stub = createRoutesStub([
      {
        path: "/film/:slug",
        Component: FilmPage,
        loader: () => ({ film: { ...film, cast: [], crew: [] } }),
      },
    ]);
    renderStub(Stub, "/film/the-odyssey-2026");
    expect(await screen.findByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cast" })).toBeNull();
    expect(screen.queryByText("Timothée Chalamet")).toBeNull();
  });
});
