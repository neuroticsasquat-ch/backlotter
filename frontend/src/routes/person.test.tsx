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
import PersonPage, { ErrorBoundary, loader, meta } from "@/routes/person";
import type { Follow, PersonDetail, PersonFilm } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

/** Overrides for one `callLoader` call: Worker env extras and inbound request headers. */
type LoaderCall = { env?: Partial<AppEnv>; headers?: Record<string, string> };

const filmRow = (overrides: Partial<PersonFilm["film"]> = {}): PersonFilm["film"] => ({
  id: "11111111-1111-4111-8111-111111111111",
  tmdb_id: 603,
  ref: "603-the-odyssey",
  slug: "the-odyssey",
  title: "The Odyssey",
  poster_path: "/poster.jpg",
  headline_release: { date: "2026-07-17", kind: "upcoming", country: "US", bucket: "wide" },
  ...overrides,
});

/** A writer-director: two credits on one film, listed rather than folded. */
const directed: PersonFilm = {
  film: filmRow(),
  credits: [
    { credit_type: "crew", job: "Director", character: null, credit_order: null },
    { credit_type: "crew", job: "Writer", character: null, credit_order: null },
  ],
};

/** A 12th-billed part. Once it took a follow at `any` to reach this film; a follow is binary
 *  now (EF-1), so this row is delivered exactly like the one above. */
const bitPart: PersonFilm = {
  film: filmRow({
    id: "22222222-2222-4222-8222-222222222222",
    tmdb_id: 604,
    ref: "604-a-quiet-year",
    slug: "a-quiet-year",
    title: "A Quiet Year",
    headline_release: { date: "2026-02-02", kind: "released", country: "US", bucket: "limited" },
  }),
  credits: [{ credit_type: "cast", job: null, character: "Barman", credit_order: 11 }],
};

const person: PersonDetail = {
  ref: "525-christopher-nolan",
  id: 525,
  name: "Christopher Nolan",
  profile_path: "/nolan.jpg",
  known_for_department: "Directing",
  birthday: "1970-07-30",
  deathday: null,
  upcoming: [directed],
  recent: [bitPart],
};

function contextWithEnv(env: Partial<AppEnv> = {}) {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND, ...env } });
  return context;
}

function callLoader(ref: string, search = "", { env, headers }: LoaderCall = {}) {
  return loader({
    request: new Request(`https://upmovies.example/person/${ref}${search}`, { headers }),
    context: contextWithEnv(env),
    params: { ref },
  } as unknown as Parameters<typeof loader>[0]);
}

describe("person route loader", () => {
  it("fetches the person detail by ref", async () => {
    server.use(
      http.get(`${BACKEND}/people/525-christopher-nolan`, () => HttpResponse.json(person)),
    );
    const data = await callLoader("525-christopher-nolan");
    expect(data.person.name).toBe("Christopher Nolan");
  });

  it("signs the fetch and forwards the visitor IP when the secret is set", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BACKEND}/people/525-christopher-nolan`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json(person);
      }),
    );
    await callLoader("525-christopher-nolan", "", {
      env: { SSR_ORIGIN_SECRET: "s3cret" },
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });
    expect(captured?.get("X-Backlotter-Origin")).toBe("s3cret");
    expect(captured?.get("X-Backlotter-Client-IP")).toBe("203.0.113.7");
  });

  it("throws a 404 Response for an unknown or tombstoned person", async () => {
    server.use(
      http.get(`${BACKEND}/people/missing`, () => new HttpResponse(null, { status: 404 })),
    );
    await expect(callLoader("missing")).rejects.toMatchObject({ status: 404 });
  });

  // The film page's rule, for the same reason: the ref resolves on its leading id, so a bare
  // id and a ref built from a name TMDB has since corrected both land here.
  it.each([
    ["a bare id", "525"],
    ["a stale decorative half", "525-chris-nolan"],
  ])("301s %s to the canonical ref", async (_label, requested) => {
    server.use(http.get(`${BACKEND}/people/${requested}`, () => HttpResponse.json(person)));

    const thrown = await callLoader(requested).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    const res = thrown as Response;
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("Location") ?? "").pathname).toBe(
      "/person/525-christopher-nolan",
    );
  });

  it("does not redirect when the URL is already canonical", async () => {
    server.use(
      http.get(`${BACKEND}/people/525-christopher-nolan`, () => HttpResponse.json(person)),
    );
    await expect(callLoader("525-christopher-nolan")).resolves.toBeTruthy();
  });
});

describe("person route meta", () => {
  it("titles the page with the name and counts the upcoming films", () => {
    const tags = meta({
      loaderData: { person },
      location: { pathname: "/person/525-christopher-nolan" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "Christopher Nolan — backlotter" });
    expect(tags).toContainEqual({
      name: "description",
      content:
        "1 upcoming film for Christopher Nolan, with release dates and every credit we track.",
    });
  });

  it("noindexes a person that did not resolve", () => {
    const tags = meta({
      loaderData: undefined,
      location: { pathname: "/person/missing" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
  });
});

function renderPage(
  detail: PersonDetail = person,
  { entitled = true, follows = [] as Follow[], activity = EMPTY_ACTIVITY } = {},
) {
  const graph = followGraphHandlers({ follows });
  server.use(meHandler({ entitled }), ...graph.handlers);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    {
      path: "/person/:ref",
      Component: PersonPage,
      loader: () => ({ person: detail, activity }),
    },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={[`/person/${detail.ref}`]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return graph;
}

beforeEach(() => localStorage.clear());

describe("person page", () => {
  it("heads the page with the name, department and date of birth", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Christopher Nolan" })).toBeInTheDocument();
    expect(screen.getByText("Directing")).toBeInTheDocument();
    expect(screen.getByText("Born Jul 30, 1970")).toBeInTheDocument();
  });

  it("renders both sections, each row linking to the film and naming the credits", async () => {
    renderPage();

    const upcomingHeading = await screen.findByRole("heading", { name: /upcoming \(1\)/i });
    const upcoming = upcomingHeading.parentElement as HTMLElement;
    expect(within(upcoming).getByRole("link", { name: "The Odyssey" })).toHaveAttribute(
      "href",
      "/film/603-the-odyssey",
    );
    // A writer-director's two credits read in the order the backend sent them.
    expect(within(upcoming).getByText("Director · Writer")).toBeInTheDocument();

    const recent = screen.getByRole("heading", { name: /recently released \(1\)/i })
      .parentElement as HTMLElement;
    expect(within(recent).getByText("Barman")).toBeInTheDocument();
  });

  it("badges no row with a tier — every credit is one a follow reaches now", async () => {
    // The badge named the narrowest coverage setting that would reach a film. A follow is
    // binary (EF-1) and reaches every credit (EF-2), so there is no cut left for it to name:
    // the 12th-billed part above is delivered exactly like the directing credit.
    renderPage();
    await screen.findByRole("heading", { name: /upcoming \(1\)/i });
    for (const label of ["Lead", "Major", "Any"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
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
    server.use(entityEventsHandler("person", cards));
    renderPage(person, { activity: { items: [cards[0]], next_cursor: "1" } });

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
    renderPage({ ...person, upcoming: [], recent: [] });
    expect(await screen.findByText("No upcoming films in the catalog")).toBeInTheDocument();
    expect(screen.getByText("No recent releases")).toBeInTheDocument();
  });

  it("draws no tier control beside the follow button — a follow is binary now", async () => {
    // The three-tier `CoverageControl` went with the `coverage` field it wrote (EF-1): there is
    // nothing left to narrow, and a control over a field the backend ignores would be a lie.
    renderPage();
    await screen.findByRole("button", { name: "Follow Christopher Nolan" });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("creates the follow from its type and id alone", async () => {
    const graph = renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Follow Christopher Nolan" }));

    await waitFor(() => expect(graph.follows).toHaveLength(1));
    expect(graph.follows[0]).toMatchObject({ entity_type: "person", entity_id: "525" });
    expect(graph.follows[0]).not.toHaveProperty("coverage");
  });

  it("reads an existing follow back as Following rather than offering to follow again", async () => {
    const existing = makeFollow({ entity_id: "525", name: "Christopher Nolan" });
    const graph = renderPage(person, { follows: [existing] });

    expect(
      await screen.findByRole("button", { name: "Unfollow Christopher Nolan" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(graph.follows).toHaveLength(1);
  });

  it("disables the follow button for a visitor who cannot follow anything yet", async () => {
    // The locked button renders in place of the live one (D-41): someone deciding whether they
    // want a subscription should see the control they would get, disabled, rather than nothing.
    renderPage(person, { entitled: false });
    expect(await screen.findByRole("button", { name: "Follow Christopher Nolan" })).toBeDisabled();
  });
});

describe("person route ErrorBoundary", () => {
  it("says the person was not found for a 404", async () => {
    const Stub = createRoutesStub([
      {
        path: "/person/:ref",
        Component: PersonPage,
        ErrorBoundary,
        loader: () => {
          throw new Response(null, { status: 404 });
        },
      },
    ]);
    render(<Stub initialEntries={["/person/missing"]} />);
    expect(await screen.findByRole("heading", { name: /person not found/i })).toBeInTheDocument();
  });
});
