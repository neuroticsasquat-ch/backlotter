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
import StudioPage, { ErrorBoundary, loader, meta } from "@/routes/studio";
import type { CompanyDetail, FilmRow, Follow } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

/** Overrides for one `callLoader` call: Worker env extras and inbound request headers. */
type LoaderCall = { env?: Partial<AppEnv>; headers?: Record<string, string> };

const filmRow = (overrides: Partial<FilmRow> = {}): FilmRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  tmdb_id: 603,
  ref: "603-the-odyssey",
  slug: "the-odyssey",
  title: "The Odyssey",
  poster_path: "/poster.jpg",
  headline_release: { date: "2026-07-17", kind: "upcoming", country: "US", bucket: "wide" },
  ...overrides,
});

const company: CompanyDetail = {
  ref: "33-universal-pictures",
  id: 33,
  name: "Universal Pictures",
  logo_path: "/universal.png",
  upcoming: [filmRow()],
  recent: [
    filmRow({
      id: "22222222-2222-4222-8222-222222222222",
      tmdb_id: 604,
      ref: "604-a-quiet-year",
      slug: "a-quiet-year",
      title: "A Quiet Year",
      headline_release: { date: "2026-02-02", kind: "released", country: "US", bucket: "limited" },
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
    request: new Request(`https://upmovies.example/studio/${ref}${search}`, { headers }),
    context: contextWithEnv(env),
    params: { ref },
  } as unknown as Parameters<typeof loader>[0]);
}

describe("studio route loader", () => {
  it("fetches the company detail by ref", async () => {
    server.use(
      http.get(`${BACKEND}/companies/33-universal-pictures`, () => HttpResponse.json(company)),
    );
    const data = await callLoader("33-universal-pictures");
    expect(data.company.name).toBe("Universal Pictures");
  });

  it("signs the fetch and forwards the visitor IP when the secret is set", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BACKEND}/companies/33-universal-pictures`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json(company);
      }),
    );
    await callLoader("33-universal-pictures", "", {
      env: { SSR_ORIGIN_SECRET: "s3cret" },
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });
    expect(captured?.get("X-Backlotter-Origin")).toBe("s3cret");
    expect(captured?.get("X-Backlotter-Client-IP")).toBe("203.0.113.7");
  });

  it("throws a 404 Response for a company the catalog does not hold", async () => {
    server.use(
      http.get(`${BACKEND}/companies/missing`, () => new HttpResponse(null, { status: 404 })),
    );
    await expect(callLoader("missing")).rejects.toMatchObject({ status: 404 });
  });

  // The person page's rule, for the same reason: the ref resolves on its leading id, so a bare
  // id and a ref built from a name TMDB has since corrected both land here.
  it.each([
    ["a bare id", "33"],
    ["a stale decorative half", "33-universal"],
  ])("301s %s to the canonical ref", async (_label, requested) => {
    server.use(http.get(`${BACKEND}/companies/${requested}`, () => HttpResponse.json(company)));

    const thrown = await callLoader(requested).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    const res = thrown as Response;
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("Location") ?? "").pathname).toBe(
      "/studio/33-universal-pictures",
    );
  });

  it("does not redirect when the URL is already canonical", async () => {
    server.use(
      http.get(`${BACKEND}/companies/33-universal-pictures`, () => HttpResponse.json(company)),
    );
    await expect(callLoader("33-universal-pictures")).resolves.toBeTruthy();
  });
});

describe("studio route meta", () => {
  it("titles the page with the name and counts the upcoming films", () => {
    const tags = meta({
      loaderData: { company },
      location: { pathname: "/studio/33-universal-pictures" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "Universal Pictures — backlotter" });
    expect(tags).toContainEqual({
      name: "description",
      content:
        "1 upcoming film from Universal Pictures, with release dates and what we know so far.",
    });
  });

  it("noindexes a studio that did not resolve", () => {
    const tags = meta({
      loaderData: undefined,
      location: { pathname: "/studio/missing" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
  });
});

function renderPage(
  detail: CompanyDetail = company,
  { entitled = true, follows = [] as Follow[], activity = EMPTY_ACTIVITY } = {},
) {
  const graph = followGraphHandlers({ follows });
  server.use(meHandler({ entitled }), ...graph.handlers);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    {
      path: "/studio/:ref",
      Component: StudioPage,
      loader: () => ({ company: detail, activity }),
    },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={[`/studio/${detail.ref}`]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return graph;
}

beforeEach(() => localStorage.clear());

describe("studio page", () => {
  it("heads the page with the name and calls it a Studio", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Universal Pictures" })).toBeInTheDocument();
    expect(screen.getByText("Studio")).toBeInTheDocument();
  });

  it("renders both sections, each row linking to the film, with no tier badge", async () => {
    renderPage();

    const upcomingHeading = await screen.findByRole("heading", { name: /upcoming \(1\)/i });
    const upcoming = upcomingHeading.parentElement as HTMLElement;
    expect(within(upcoming).getByRole("link", { name: "The Odyssey" })).toHaveAttribute(
      "href",
      "/film/603-the-odyssey",
    );

    const recent = screen.getByRole("heading", { name: /recently released \(1\)/i })
      .parentElement as HTMLElement;
    expect(within(recent).getByRole("link", { name: "A Quiet Year" })).toHaveAttribute(
      "href",
      "/film/604-a-quiet-year",
    );

    // The tier badges are being retired (EF-18): a studio credit has no tier to narrow, so no
    // row carries one — and there are no tier radios anywhere any more, on this page or the
    // person page, since a follow became binary (EF-1).
    for (const label of ["Lead", "Major", "Any"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
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
    server.use(entityEventsHandler("company", cards));
    renderPage(company, { activity: { items: [cards[0]], next_cursor: "1" } });

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
    renderPage({ ...company, upcoming: [], recent: [] });
    expect(await screen.findByText("No upcoming films in the catalog")).toBeInTheDocument();
    expect(screen.getByText("No recent releases")).toBeInTheDocument();
  });

  it("follows the studio as a company, keyed on the TMDB id", async () => {
    const graph = renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Follow Universal Pictures" }));

    await waitFor(() => expect(graph.follows).toHaveLength(1));
    expect(graph.follows[0]).toMatchObject({ entity_type: "company", entity_id: "33" });
  });

  it("unfollows a studio already followed", async () => {
    const existing = makeFollow({
      entity_type: "company",
      entity_id: "33",
      name: "Universal Pictures",
    });
    const graph = renderPage(company, { follows: [existing] });

    await userEvent.click(
      await screen.findByRole("button", { name: "Unfollow Universal Pictures" }),
    );

    await waitFor(() => expect(graph.follows).toHaveLength(0));
  });

  it("disables the button for a visitor who cannot follow anything yet", async () => {
    renderPage(company, { entitled: false });
    // The locked button renders in place of the live one (D-41) rather than disappearing:
    // someone deciding whether they want a subscription should see what it would give them.
    expect(await screen.findByRole("button", { name: "Follow Universal Pictures" })).toBeDisabled();
  });
});

describe("studio route ErrorBoundary", () => {
  it("says the studio was not found for a 404", async () => {
    const Stub = createRoutesStub([
      {
        path: "/studio/:ref",
        Component: StudioPage,
        ErrorBoundary,
        loader: () => {
          throw new Response(null, { status: 404 });
        },
      },
    ]);
    render(<Stub initialEntries={["/studio/missing"]} />);
    expect(await screen.findByRole("heading", { name: /studio not found/i })).toBeInTheDocument();
  });
});
