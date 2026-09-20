import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { followGraphHandlers } from "@/test/msw/follows";
import { lookupFollowLabel, resetFollowLabelCache } from "@/lib/follow-labels";
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

/** A writer-director: two credits on one film, and the row's own tier is the narrowest of
 *  them — which is the number the badge reads. */
const directed: PersonFilm = {
  film: filmRow(),
  credits: [
    { credit_type: "crew", job: "Director", character: null, credit_order: null, tier: "lead" },
    { credit_type: "crew", job: "Writer", character: null, credit_order: null, tier: "major" },
  ],
  tier: "lead",
};

/** A 12th-billed part: only a follow at `any` reaches this film at all. */
const bitPart: PersonFilm = {
  film: filmRow({
    id: "22222222-2222-4222-8222-222222222222",
    tmdb_id: 604,
    ref: "604-a-quiet-year",
    slug: "a-quiet-year",
    title: "A Quiet Year",
    headline_release: { date: "2026-02-02", kind: "released", country: "US", bucket: "limited" },
  }),
  credits: [{ credit_type: "cast", job: null, character: "Barman", credit_order: 11, tier: "any" }],
  tier: "any",
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
  { entitled = true, follows = [] as Follow[] } = {},
) {
  const graph = followGraphHandlers({ follows });
  server.use(meHandler({ entitled }), ...graph.handlers);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/person/:ref", Component: PersonPage, loader: () => ({ person: detail }) },
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

beforeEach(() => {
  localStorage.clear();
  resetFollowLabelCache();
});

describe("person page", () => {
  it("heads the page with the name, department and date of birth", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Christopher Nolan" })).toBeInTheDocument();
    expect(screen.getByText("Directing")).toBeInTheDocument();
    expect(screen.getByText("Born Jul 30, 1970")).toBeInTheDocument();
  });

  it("renders both sections, each row linking to the film and badged with its tier", async () => {
    renderPage();

    const upcomingHeading = await screen.findByRole("heading", { name: /upcoming \(1\)/i });
    const upcoming = upcomingHeading.parentElement as HTMLElement;
    expect(within(upcoming).getByRole("link", { name: "The Odyssey" })).toHaveAttribute(
      "href",
      "/film/603-the-odyssey",
    );
    // A writer-director's two credits read in the order the backend sent them, and the row's
    // badge is the narrowest of the two.
    expect(within(upcoming).getByText("Director · Writer")).toBeInTheDocument();
    expect(within(upcoming).getByText("Lead")).toBeInTheDocument();

    const recent = screen.getByRole("heading", { name: /recently released \(1\)/i })
      .parentElement as HTMLElement;
    expect(within(recent).getByText("Barman")).toBeInTheDocument();
    // Only a follow at "Every credit" reaches this one.
    expect(within(recent).getByText("Any")).toBeInTheDocument();
  });

  it("says so rather than hiding a section with nothing in it", async () => {
    renderPage({ ...person, upcoming: [], recent: [] });
    expect(await screen.findByText("No upcoming films in the catalog")).toBeInTheDocument();
    expect(screen.getByText("No recent releases")).toBeInTheDocument();
  });

  it("remembers the name and face behind the id, for the follows page", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Christopher Nolan" });
    expect(lookupFollowLabel("person", "525")).toEqual({
      label: "Christopher Nolan",
      imagePath: "/nolan.jpg",
    });
  });

  it("offers all three tiers, defaulting to lead, before there is a follow", async () => {
    renderPage();
    expect(await screen.findByRole("radio", { name: "Lead roles" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Major credits" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Every credit" })).toBeInTheDocument();
  });

  it("creates the follow at the tier chosen before it existed", async () => {
    const graph = renderPage();

    await userEvent.click(await screen.findByRole("radio", { name: "Every credit" }));
    await userEvent.click(screen.getByRole("button", { name: "Follow Christopher Nolan" }));

    await waitFor(() => expect(graph.follows).toHaveLength(1));
    expect(graph.follows[0]).toMatchObject({
      entity_type: "person",
      entity_id: "525",
      coverage: "any",
    });
  });

  it("PATCHes the tier once the follow exists, rather than creating a second one", async () => {
    const existing: Follow = {
      entity_type: "person",
      entity_id: "525",
      source: "manual",
      coverage: "lead",
      created_at: "2026-09-01T00:00:00Z",
    };
    const graph = renderPage(person, { follows: [existing] });

    // The control reads the follow back rather than its own local default.
    expect(await screen.findByRole("radio", { name: "Lead roles" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Major credits" }));

    await waitFor(() => expect(graph.follows[0].coverage).toBe("major"));
    expect(graph.follows).toHaveLength(1);
  });

  it("disables the tiers for a visitor who cannot follow anything yet", async () => {
    renderPage(person, { entitled: false });
    // The locked button renders in place of the live one (D-41), and the radios beside it are
    // shown-but-disabled for the same reason: someone deciding whether they want a
    // subscription should see what it would let them pick.
    expect(await screen.findByRole("button", { name: "Follow Christopher Nolan" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Every credit" })).toBeDisabled();
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
