import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import type { Follow } from "@/api/types";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { entitySearchHandlers, followGraphHandlers, makeFollow } from "@/test/msw/follows";
import { delay, http, HttpResponse } from "msw";
import { env } from "@/env";
import { MyFollows } from "./MyFollows";

/** The row the page is given. Named by default now that `GET /me/follows` resolves the
 *  catalog's own label (NEU-1396); a test wanting the unresolvable case passes `name: null`. */
const follow = (overrides: Partial<Follow> = {}): Follow =>
  makeFollow({ name: "Christopher Nolan", ...overrides });

function renderPage(follows: Follow[] = []) {
  const graph = followGraphHandlers({ follows });
  server.use(meHandler({ entitled: true }), ...graph.handlers, ...entitySearchHandlers());
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([{ path: "/me/follows", Component: MyFollows }]);
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

describe("MyFollows", () => {
  it("groups follows by entity type under their own headings", async () => {
    renderPage([
      follow(),
      follow({ entity_type: "company", entity_id: "41", name: "A24" }),
      follow({ entity_type: "franchise", entity_id: "10", name: "Star Wars Collection" }),
    ]);

    expect(await screen.findByText("Christopher Nolan")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /people \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /companies \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /collections \(1\)/i })).toBeInTheDocument();
    // No films followed, so no Films heading — the groups are fixed in order but only the
    // occupied ones render.
    expect(screen.queryByRole("heading", { name: /films/i })).not.toBeInTheDocument();
  });

  it("labels a row from the name the API resolved, with no localStorage involved", async () => {
    // The whole point of NEU-1422: a follow made on another device, or by an import, is named
    // on first paint. It used to read "Person 525" until the user happened to visit them.
    renderPage([follow({ image_path: "/nolan.jpg" })]);

    expect(await screen.findByText("Christopher Nolan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unfollow Christopher Nolan" })).toBeInTheDocument();
  });

  it("falls back to the type and the id for a person the catalog cannot resolve", async () => {
    // A follow outlives the entity it names and D-40 keeps the row, so the API answers with a
    // null name rather than dropping it. This is the placeholder's only remaining job.
    renderPage([follow({ entity_id: "287", name: null })]);

    // The placeholder links to the person's own page rather than out to TMDB (NEU-1419): a row
    // reading "Person 287" is exactly the one whose reader needs somewhere to go and find out
    // who that is, and our page tells them what the person has coming as well.
    const link = await screen.findByRole("link", { name: "Person 287" });
    expect(link).toHaveAttribute("href", "/person/287");
    expect(screen.queryByRole("link", { name: /look up on tmdb/i })).not.toBeInTheDocument();
  });

  it("links a company row it has no name for to the studio page anyway", async () => {
    // Well formed from the id alone, the same deal person rows have taken since NEU-1419. The
    // page it reaches 404s while the catalog cannot name the id — the entity endpoint reads the
    // table the label lookup just missed — which is the honest answer for a row D-40 keeps after
    // its entity left the catalog. The outbound TMDB link this replaced is gone (NEU-1431).
    renderPage([follow({ entity_type: "company", entity_id: "41", name: null })]);

    expect(await screen.findByRole("link", { name: "Company 41" })).toHaveAttribute(
      "href",
      "/studio/41",
    );
    expect(screen.queryByRole("link", { name: /look up on tmdb/i })).not.toBeInTheDocument();
  });

  it("links a named company row to its studio page, slugged from the name", async () => {
    renderPage([follow({ entity_type: "company", entity_id: "41", name: "A24" })]);

    expect(await screen.findByRole("link", { name: "A24" })).toHaveAttribute(
      "href",
      "/studio/41-a24",
    );
  });

  it("links a franchise row to its franchise page", async () => {
    // On-screen vocabulary is EF-19's: the payload says `franchise`, the URL says franchise,
    // and TMDB's word "collection" survives only in the heading this page has not rebuilt yet.
    renderPage([
      follow({ entity_type: "franchise", entity_id: "10", name: "Star Wars Collection" }),
    ]);

    expect(await screen.findByRole("link", { name: "Star Wars Collection" })).toHaveAttribute(
      "href",
      "/franchise/10-star-wars-collection",
    );
  });

  it("links a named person row to their page, slugged from the name the API gave", async () => {
    renderPage([follow()]);

    expect(await screen.findByRole("link", { name: "Christopher Nolan" })).toHaveAttribute(
      "href",
      "/person/525-christopher-nolan",
    );
  });

  it("leaves a title row unlinked — the payload carries no film ref to link to", async () => {
    // A title follow's `entity_id` is our film UUID, and `/film/:ref` is addressed by
    // `<tmdb_id>-<slug>`; `GET /me/follows` ships neither, so the row cannot mint a link. It
    // never had a TMDB one either — TMDB cannot address our UUIDs.
    renderPage([
      follow({
        entity_type: "title",
        entity_id: "11111111-1111-4111-8111-111111111111",
        name: "Dune: Part Three",
      }),
    ]);

    expect(await screen.findByRole("heading", { name: /films \(1\)/i })).toBeInTheDocument();
    expect(screen.getByText("Dune: Part Three")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dune: Part Three" })).not.toBeInTheDocument();
  });

  it("links nothing on the page out to TMDB", async () => {
    // EF-15: every row links inward. The page had one outbound link, on unnamed company and
    // collection rows, and NEU-1431 deleted it with `tmdbUrl`.
    renderPage([
      follow({ name: null }),
      follow({ entity_type: "company", entity_id: "41", name: null }),
      follow({ entity_type: "franchise", entity_id: "10", name: null }),
      follow({ entity_type: "title", entity_id: "11111111-1111-4111-8111-111111111111" }),
    ]);

    await screen.findByRole("heading", { name: /companies \(1\)/i });
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toContain("themoviedb.org");
    }
  });

  it("says where a follow came from when it was not the user's own click", async () => {
    renderPage([
      follow({ source: "letterboxd_import" }),
      follow({ entity_id: "1", source: "manual" }),
    ]);

    expect(await screen.findByText(/from Letterboxd import/)).toBeInTheDocument();
    // A manual follow says only when it was made — the default source is not worth a line on
    // every row.
    expect(screen.queryByText(/· manual/)).not.toBeInTheDocument();
  });

  it("unfollows a row, and the row goes", async () => {
    const graph = renderPage([follow()]);

    const button = await screen.findByRole("button", { name: "Unfollow Christopher Nolan" });
    await userEvent.click(button);

    await waitFor(() => expect(graph.follows).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument());
  });

  it("offers a person follow all three coverage tiers, on the default", async () => {
    renderPage([follow()]);

    expect(await screen.findByRole("radio", { name: "Lead roles" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Major credits" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Every credit" })).not.toBeChecked();
  });

  it("widening a person follow to every credit PATCHes its coverage", async () => {
    const graph = renderPage([follow()]);

    await userEvent.click(await screen.findByRole("radio", { name: "Every credit" }));

    await waitFor(() => expect(graph.follows[0].coverage).toBe("any"));
  });

  it("PATCHes the middle tier as `major`, the value that replaced `all`", async () => {
    const graph = renderPage([follow()]);

    await userEvent.click(await screen.findByRole("radio", { name: "Major credits" }));

    await waitFor(() => expect(graph.follows[0].coverage).toBe("major"));
  });

  it("says that the widest tier widens the timeline as well as the alerts (D-47)", async () => {
    // The note the group carried before NEU-1419 said the timeline was untouched whatever the
    // reader picked, which `any` made false.
    renderPage([follow()]);

    expect(await screen.findByText(/Every credit widens both/)).toBeInTheDocument();
  });

  it("gives company, franchise and title rows no coverage control", async () => {
    // They name one thing each, so there is nothing to narrow — and the backend refuses a
    // `coverage` on them outright, so a control here would only ever mint a 422.
    renderPage([
      follow({ entity_type: "company", entity_id: "41" }),
      follow({ entity_type: "franchise", entity_id: "10" }),
      follow({ entity_type: "title", entity_id: "11111111-1111-4111-8111-111111111111" }),
    ]);

    await screen.findByRole("heading", { name: /companies \(1\)/i });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("names a row the moment it is followed, before the server answers", async () => {
    // The optimistic row carries the name and face the search result already had, so following
    // someone does not flash "Person 525" for the length of a round trip. The request is held
    // open, so anything on screen can only be the optimistic edit.
    const graph = followGraphHandlers();
    server.use(
      // First, so it beats the graph's own POST — `server.use` resolves in the order given.
      // The request never completes, so anything on screen can only be the optimistic edit.
      http.post(`${env.apiBaseUrl}/me/follows`, async () => {
        await delay("infinite");
        return HttpResponse.json(makeFollow(), { status: 201 });
      }),
      meHandler({ entitled: true }),
      ...graph.handlers,
      ...entitySearchHandlers({ people: [{ id: 525, name: "Christopher Nolan" }] }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Stub = createRoutesStub([{ path: "/me/follows", Component: MyFollows }]);
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Stub initialEntries={["/me/follows"]} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByRole("searchbox"), "nolan");
    await userEvent.click(
      await screen.findByRole("button", { name: /^follow christopher nolan$/i }),
    );

    // The People group now holds a named row, not a placeholder.
    const people = await screen.findByRole("heading", { name: /people \(1\)/i });
    const list = people.parentElement as HTMLElement;
    expect(within(list).getByRole("link", { name: "Christopher Nolan" })).toBeInTheDocument();
    expect(within(list).queryByText(/Person 525/)).toBeNull();
  });

  it("keeps the name once the server answers, not just while the request is open", async () => {
    // The other half of the optimistic path. `onSettled` invalidates and refetches, so a
    // just-followed row could flash a name and then lose it — which is what would happen if
    // the create answered with a null name. The backend cannot: it refuses to create a follow
    // whose entity the catalog cannot name, so the answer always carries one.
    const graph = followGraphHandlers({
      catalog: { "person:525": { name: "Christopher Nolan", image_path: "/nolan.jpg" } },
    });
    server.use(
      meHandler({ entitled: true }),
      ...graph.handlers,
      ...entitySearchHandlers({ people: [{ id: 525, name: "Christopher Nolan" }] }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Stub = createRoutesStub([{ path: "/me/follows", Component: MyFollows }]);
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Stub initialEntries={["/me/follows"]} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByRole("searchbox"), "nolan");
    await userEvent.click(
      await screen.findByRole("button", { name: /^follow christopher nolan$/i }),
    );

    await waitFor(() => expect(graph.follows).toHaveLength(1));
    expect(graph.follows[0].name).toBe("Christopher Nolan");

    // Still named after the refetch the settle triggered — no flash back to "Person 525".
    const people = await screen.findByRole("heading", { name: /people \(1\)/i });
    const list = people.parentElement as HTMLElement;
    await waitFor(() =>
      expect(within(list).getByRole("link", { name: "Christopher Nolan" })).toBeInTheDocument(),
    );
    expect(within(list).queryByText(/Person 525/)).toBeNull();
  });

  it("says the alerts are built from these, not that films are added for you", async () => {
    renderPage([]);
    expect(
      await screen.findByText("Your timeline and your alerts are built from these."),
    ).toBeInTheDocument();
  });

  it("invites the user to search or use a film page when they follow nothing", async () => {
    renderPage([]);
    expect(await screen.findByText(/do not follow anything yet/i)).toBeInTheDocument();
  });

  it("keeps a row whose entity it cannot name rather than pruning it (D-40)", async () => {
    // Two rows, neither with a remembered label. A list that quietly dropped what it could not
    // resolve is exactly how the "restored exactly as you left them" guarantee breaks.
    renderPage([follow({ entity_id: "1" }), follow({ entity_id: "2" })]);

    const people = await screen.findByRole("heading", { name: /people \(2\)/i });
    expect(people).toBeInTheDocument();
    const list = people.parentElement as HTMLElement;
    expect(within(list).getAllByRole("button", { name: /unfollow/i })).toHaveLength(2);
  });
});
