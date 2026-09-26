import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { env } from "@/env";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { entitySearchHandlers, followGraphHandlers, makeFollow } from "@/test/msw/follows";
import { heldResponse } from "@/test/msw/search";
import { FollowEntitySearch } from "./FollowEntitySearch";

const PEOPLE = [{ id: 525, name: "Christopher Nolan" }];
const COMPANIES = [{ id: 41, name: "A24" }];
const COLLECTIONS = [{ id: 10, name: "Star Wars Collection" }];

function renderSearch() {
  const graph = followGraphHandlers();
  server.use(
    meHandler({ entitled: true }),
    ...graph.handlers,
    ...entitySearchHandlers({ people: PEOPLE, companies: COMPANIES, collections: COLLECTIONS }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([{ path: "/me/follows", Component: FollowEntitySearch }]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/me/follows"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return graph;
}

beforeEach(() => localStorage.clear());

describe("FollowEntitySearch", () => {
  it("asks for a query before searching anything", async () => {
    renderSearch();
    expect(await screen.findByText(/at least 2 characters/i)).toBeInTheDocument();
  });

  it("does not search on a single character", async () => {
    renderSearch();
    await userEvent.type(screen.getByRole("searchbox"), "n");
    // The hint stays put: below the minimum there is no request and nothing to show.
    expect(await screen.findByText(/at least 2 characters/i)).toBeInTheDocument();
  });

  it("searches people by default and lists what comes back", async () => {
    renderSearch();
    await userEvent.type(screen.getByRole("searchbox"), "nolan");

    expect(await screen.findByText("Christopher Nolan")).toBeInTheDocument();
    expect(screen.getByText("Directing")).toBeInTheDocument();
  });

  it("links a person result to their page, and leaves the other two plain", async () => {
    renderSearch();
    await userEvent.type(screen.getByRole("searchbox"), "nolan");

    expect(await screen.findByRole("link", { name: "Christopher Nolan" })).toHaveAttribute(
      "href",
      "/person/525-christopher-nolan",
    );

    // Companies and collections have no page of ours yet, so their names stay text rather than
    // linking somewhere that would 404.
    await userEvent.click(screen.getByRole("tab", { name: "Companies" }));
    expect(await screen.findByText("A24")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "A24" })).not.toBeInTheDocument();
  });

  it("switches endpoint with the tab", async () => {
    renderSearch();
    await userEvent.type(screen.getByRole("searchbox"), "a24");
    await screen.findByText("Christopher Nolan");

    await userEvent.click(screen.getByRole("tab", { name: "Companies" }));

    expect(await screen.findByText("A24")).toBeInTheDocument();
    expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument();
  });

  it("searches collections under their own tab", async () => {
    renderSearch();
    await userEvent.click(screen.getByRole("tab", { name: "Collections" }));
    await userEvent.type(screen.getByRole("searchbox"), "star");

    expect(await screen.findByText("Star Wars Collection")).toBeInTheDocument();
  });

  it("follows a result straight from the list", async () => {
    const graph = renderSearch();
    await userEvent.type(screen.getByRole("searchbox"), "nolan");

    await userEvent.click(await screen.findByRole("button", { name: /follow christopher nolan/i }));

    await waitFor(() =>
      expect(graph.follows).toEqual([
        expect.objectContaining({ entity_type: "person", entity_id: "525" }),
      ]),
    );
  });

  it("a result already followed arrives saying so", async () => {
    const graph = followGraphHandlers({
      follows: [makeFollow({ entity_id: "525", name: "Christopher Nolan" })],
    });
    server.use(
      meHandler({ entitled: true }),
      ...graph.handlers,
      ...entitySearchHandlers({ people: PEOPLE }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Stub = createRoutesStub([{ path: "/me/follows", Component: FollowEntitySearch }]);
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Stub initialEntries={["/me/follows"]} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByRole("searchbox"), "nolan");
    expect(
      await screen.findByRole("button", { name: /unfollow christopher nolan/i }),
    ).toHaveTextContent("Following");
  });

  it("says how many it is not showing rather than truncating in silence", async () => {
    const graph = followGraphHandlers();
    server.use(
      meHandler({ entitled: true }),
      ...graph.handlers,
      http.get(`${env.apiBaseUrl}/people/search`, () =>
        HttpResponse.json({
          items: PEOPLE.map((p) => ({
            ...p,
            known_for_department: "Directing",
            profile_path: null,
          })),
          total: 90,
          limit: 10,
          offset: 0,
        }),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Stub = createRoutesStub([{ path: "/me/follows", Component: FollowEntitySearch }]);
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Stub initialEntries={["/me/follows"]} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByRole("searchbox"), "nolan");
    expect(await screen.findByText(/showing the first 1 of 90/i)).toBeInTheDocument();
  });

  it("says nothing matched rather than showing an empty list", async () => {
    const graph = followGraphHandlers();
    server.use(meHandler({ entitled: true }), ...graph.handlers, ...entitySearchHandlers());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Stub = createRoutesStub([{ path: "/me/follows", Component: FollowEntitySearch }]);
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Stub initialEntries={["/me/follows"]} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByRole("searchbox"), "zzzz");
    expect(await screen.findByText(/no people match/i)).toBeInTheDocument();
  });
});

describe("FollowEntitySearch while a search runs (NEU-1469)", () => {
  const person = (id: number, name: string) => ({
    id,
    name,
    known_for_department: "Directing",
    profile_path: null,
  });
  const page = <T,>(items: T[]) =>
    HttpResponse.json({ items, total: items.length, limit: 10, offset: 0 });

  /** `/people/search` answers "nolan" and "zz" at once, and any other query only once `held`
   *  is released — with a person named after that query. */
  function peopleHandler(held: Promise<void>) {
    return http.get(`${env.apiBaseUrl}/people/search`, async ({ request }) => {
      const q = new URL(request.url).searchParams.get("q") ?? "";
      if (q === "nolan") return page([person(525, "Christopher Nolan")]);
      if (q === "zz") return page([]);
      await held;
      return page([person(1, `Person ${q}`)]);
    });
  }

  it("spins over the previous list until the new one lands", async () => {
    const later = heldResponse();
    renderSearch();
    server.use(peopleHandler(later.held));
    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "nolan");
    await screen.findByText("Christopher Nolan");
    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();

    await userEvent.type(box, "s");
    expect(await screen.findByTestId("spinner")).toBeInTheDocument();
    expect(screen.getByText("Christopher Nolan")).toBeInTheDocument();

    later.release();
    expect(await screen.findByText("Person nolans")).toBeInTheDocument();
    expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument();
    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
  });

  it("does not say the new query matched nothing while it is still in flight", async () => {
    const later = heldResponse();
    renderSearch();
    server.use(peopleHandler(later.held));
    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "zz");
    expect(await screen.findByText(/no people match "zz"/i)).toBeInTheDocument();

    await userEvent.type(box, "z");
    expect(await screen.findByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByText(/no people match/i)).not.toBeInTheDocument();

    later.release();
    expect(await screen.findByText("Person zzz")).toBeInTheDocument();
  });

  it("spins over the old tab's list while the new tab answers", async () => {
    const later = heldResponse();
    renderSearch();
    server.use(
      http.get(`${env.apiBaseUrl}/companies/search`, async () => {
        await later.held;
        return page([{ id: 41, name: "A24", logo_path: null, origin_country: "US" }]);
      }),
    );
    await userEvent.type(screen.getByRole("searchbox"), "nolan");
    await screen.findByText("Christopher Nolan");

    await userEvent.click(screen.getByRole("tab", { name: "Companies" }));
    expect(await screen.findByTestId("spinner")).toBeInTheDocument();
    expect(screen.getByText("Christopher Nolan")).toBeInTheDocument();

    later.release();
    expect(await screen.findByText("A24")).toBeInTheDocument();
    expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument();
  });

  it("drops the held list once the query is cut below the minimum, and does not revive it", async () => {
    const later = heldResponse();
    renderSearch();
    server.use(peopleHandler(later.held));
    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "nolan");
    await screen.findByText("Christopher Nolan");

    await userEvent.clear(box);
    await userEvent.type(box, "n");
    expect(await screen.findByText(/at least 2 characters/i)).toBeInTheDocument();
    expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument();

    // The next query holds what was on screen — nothing — not the last answer TanStack has.
    await userEvent.type(box, "t");
    expect(await screen.findByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument();

    later.release();
    expect(await screen.findByText("Person nt")).toBeInTheDocument();
  });
});
