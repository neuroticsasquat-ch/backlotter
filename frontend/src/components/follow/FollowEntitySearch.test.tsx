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
