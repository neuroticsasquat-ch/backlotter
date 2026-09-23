import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { followGraphHandlers, makeFollow } from "@/test/msw/follows";
import { entityEventsHandler, makeEvent } from "@/test/msw/entity-events";
import { EMPTY_ACTIVITY } from "@/api/public";
import { cloudflareContext, type AppEnv } from "@/lib/load-context";
import FranchisePage, { ErrorBoundary, loader, meta } from "@/routes/franchise";
import type { CollectionDetail, FilmRow, Follow } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

/** Overrides for one `callLoader` call: Worker env extras and inbound request headers. */
type LoaderCall = { env?: Partial<AppEnv>; headers?: Record<string, string> };

const filmRow = (overrides: Partial<FilmRow> = {}): FilmRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  tmdb_id: 603,
  ref: "603-dune-part-three",
  slug: "dune-part-three",
  title: "Dune: Part Three",
  poster_path: "/poster.jpg",
  headline_release: { date: "2026-12-18", kind: "upcoming", country: "US", bucket: "wide" },
  ...overrides,
});

const collection: CollectionDetail = {
  ref: "726871-dune-collection",
  id: 726871,
  name: "Dune Collection",
  poster_path: "/dune.jpg",
  upcoming: [filmRow()],
  recent: [
    filmRow({
      id: "22222222-2222-4222-8222-222222222222",
      tmdb_id: 604,
      ref: "604-dune-part-two",
      slug: "dune-part-two",
      title: "Dune: Part Two",
      headline_release: { date: "2026-03-01", kind: "released", country: "US", bucket: "wide" },
    }),
  ],
};

function contextWithEnv(env: Partial<AppEnv> = {}) {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND, ...env } });
  return context;
}

function callLoader(ref: string, search = "", { env, headers }: LoaderCall = {}) {
  return loader({
    request: new Request(`https://upmovies.example/franchise/${ref}${search}`, { headers }),
    context: contextWithEnv(env),
    params: { ref },
  } as unknown as Parameters<typeof loader>[0]);
}

describe("franchise route loader", () => {
  // The route is `/franchise/:ref` and the endpoint is `/collections/{ref}` — the reader's word
  // and TMDB's, deliberately different (EF-19).
  it("fetches the collection detail by ref", async () => {
    server.use(
      http.get(`${BACKEND}/collections/726871-dune-collection`, () =>
        HttpResponse.json(collection),
      ),
    );
    const data = await callLoader("726871-dune-collection");
    expect(data.collection.name).toBe("Dune Collection");
  });

  it("signs the fetch and forwards the visitor IP when the secret is set", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BACKEND}/collections/726871-dune-collection`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json(collection);
      }),
    );
    await callLoader("726871-dune-collection", "", {
      env: { SSR_ORIGIN_SECRET: "s3cret" },
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });
    expect(captured?.get("X-Backlotter-Origin")).toBe("s3cret");
    expect(captured?.get("X-Backlotter-Client-IP")).toBe("203.0.113.7");
  });

  it("throws a 404 Response for a collection the catalog does not hold", async () => {
    server.use(
      http.get(`${BACKEND}/collections/missing`, () => new HttpResponse(null, { status: 404 })),
    );
    await expect(callLoader("missing")).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ["a bare id", "726871"],
    ["a stale decorative half", "726871-dune"],
  ])("301s %s to the canonical ref", async (_label, requested) => {
    server.use(
      http.get(`${BACKEND}/collections/${requested}`, () => HttpResponse.json(collection)),
    );

    const thrown = await callLoader(requested).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    const res = thrown as Response;
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("Location") ?? "").pathname).toBe(
      "/franchise/726871-dune-collection",
    );
  });

  it("does not redirect when the URL is already canonical", async () => {
    server.use(
      http.get(`${BACKEND}/collections/726871-dune-collection`, () =>
        HttpResponse.json(collection),
      ),
    );
    await expect(callLoader("726871-dune-collection")).resolves.toBeTruthy();
  });
});

describe("franchise route meta", () => {
  it("titles the page with the name and counts the upcoming films", () => {
    const tags = meta({
      loaderData: { collection },
      location: { pathname: "/franchise/726871-dune-collection" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "Dune Collection — backlotter" });
    expect(tags).toContainEqual({
      name: "description",
      content: "1 upcoming film from Dune Collection, with release dates and what we know so far.",
    });
  });

  it("falls back to the franchise's own noun when nothing is upcoming", () => {
    const tags = meta({
      loaderData: { collection: { ...collection, upcoming: [] } },
      location: { pathname: "/franchise/726871-dune-collection" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({
      name: "description",
      content: "Release dates and recent releases from the franchise Dune Collection.",
    });
  });

  it("noindexes a franchise that did not resolve", () => {
    const tags = meta({
      loaderData: undefined,
      location: { pathname: "/franchise/missing" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
  });
});

function renderPage(
  detail: CollectionDetail = collection,
  { entitled = true, follows = [] as Follow[], activity = EMPTY_ACTIVITY } = {},
) {
  const graph = followGraphHandlers({ follows });
  server.use(meHandler({ entitled }), ...graph.handlers);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    {
      path: "/franchise/:ref",
      Component: FranchisePage,
      loader: () => ({ collection: detail, activity }),
    },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={[`/franchise/${detail.ref}`]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return graph;
}

beforeEach(() => localStorage.clear());

describe("franchise page", () => {
  it("heads the page with the name and calls it a Franchise", async () => {
    expect.hasAssertions();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Dune Collection" })).toBeInTheDocument();
    expect(screen.getByText("Franchise")).toBeInTheDocument();
  });

  it("renders both sections, each row linking to the film, with no tier badge", async () => {
    renderPage();

    const upcomingHeading = await screen.findByRole("heading", { name: /upcoming \(1\)/i });
    const upcoming = upcomingHeading.parentElement as HTMLElement;
    expect(within(upcoming).getByRole("link", { name: "Dune: Part Three" })).toHaveAttribute(
      "href",
      "/film/603-dune-part-three",
    );

    const recent = screen.getByRole("heading", { name: /recently released \(1\)/i })
      .parentElement as HTMLElement;
    expect(within(recent).getByRole("link", { name: "Dune: Part Two" })).toHaveAttribute(
      "href",
      "/film/604-dune-part-two",
    );

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("previews the cards a follow would deliver, and pages them", async () => {
    // EF-18: the section is the argument for the button above it. The first page is the
    // loader's; "Load more" reads the entity's own `/events` route from the browser.
    const cards = [
      makeEvent({ summary: "FIRST_CARD" }),
      makeEvent({
        event_id: "e2222222-2222-4222-8222-222222222222",
        summary: "SECOND_CARD",
        created_at: "2026-09-19T10:00:00Z",
        occurred_at: "2026-09-19T10:00:00Z",
      }),
    ];
    server.use(entityEventsHandler("franchise", cards));
    renderPage(collection, { activity: { items: [cards[0]], next_cursor: "1" } });

    expect(await screen.findByText(/FIRST_CARD/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText(/SECOND_CARD/)).toBeInTheDocument();
  });

  it("says nothing has happened yet rather than hiding the activity section", async () => {
    renderPage();
    expect(
      await screen.findByText("Nothing yet — you'll hear when they join or leave a film"),
    ).toBeInTheDocument();
  });

  it("says so rather than hiding a section with nothing in it", async () => {
    renderPage({ ...collection, upcoming: [], recent: [] });
    expect(await screen.findByText("No upcoming films in the catalog")).toBeInTheDocument();
    expect(screen.getByText("No recent releases")).toBeInTheDocument();
  });

  it("follows the franchise as a franchise, keyed on the TMDB collection id", async () => {
    const graph = renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Follow Dune Collection" }));

    await waitFor(() => expect(graph.follows).toHaveLength(1));
    expect(graph.follows[0]).toMatchObject({ entity_type: "franchise", entity_id: "726871" });
  });

  it("unfollows a franchise already followed", async () => {
    const existing = makeFollow({
      entity_type: "franchise",
      entity_id: "726871",
      name: "Dune Collection",
    });
    const graph = renderPage(collection, { follows: [existing] });

    await userEvent.click(await screen.findByRole("button", { name: "Unfollow Dune Collection" }));

    await waitFor(() => expect(graph.follows).toHaveLength(0));
  });

  it("disables the button for a visitor who cannot follow anything yet", async () => {
    renderPage(collection, { entitled: false });
    expect(await screen.findByRole("button", { name: "Follow Dune Collection" })).toBeDisabled();
  });
});

describe("franchise route ErrorBoundary", () => {
  it("says the franchise was not found for a 404", async () => {
    const Stub = createRoutesStub([
      {
        path: "/franchise/:ref",
        Component: FranchisePage,
        ErrorBoundary,
        loader: () => {
          throw new Response(null, { status: 404 });
        },
      },
    ]);
    render(<Stub initialEntries={["/franchise/missing"]} />);
    expect(
      await screen.findByRole("heading", { name: /franchise not found/i }),
    ).toBeInTheDocument();
  });
});
