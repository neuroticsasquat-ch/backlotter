import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

/** The follows list itself, told apart by its label from the add box's results list, which is
 *  also a `<ul>` of followable entities on the same page. */
const followsList = () => screen.findByRole("list", { name: "Your follows" });

/** The rows on screen, in the order the page put them — the name cell of each, so the sorts
 *  can be asserted on as a plain array. */
async function rowNames(): Promise<string[]> {
  const list = await followsList();
  return within(list)
    .getAllByRole("listitem")
    .map((li) => (li.querySelector("p > span")?.textContent ?? "").trim());
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(() => localStorage.clear());

describe("MyFollows", () => {
  it("puts every type in one flat list, with no heading per type", async () => {
    // EF-15 replaces NEU-1415's four groups: the reader's question is "what do I follow", and
    // a heading per kind answered it by making them read four lists to find one row.
    renderPage([
      follow(),
      follow({ entity_type: "company", entity_id: "41", name: "A24" }),
      follow({ entity_type: "franchise", entity_id: "10", name: "Star Wars Collection" }),
      follow({
        entity_type: "title",
        entity_id: "11111111-1111-4111-8111-111111111111",
        name: "Dune: Part Three",
      }),
    ]);

    expect(await screen.findByText("Christopher Nolan")).toBeInTheDocument();
    expect(await rowNames()).toHaveLength(4);
    for (const heading of [/people/i, /companies/i, /collections/i, /studios \(/i]) {
      expect(screen.queryByRole("heading", { name: heading })).not.toBeInTheDocument();
    }
  });

  it("names each row's type on the row itself, in the on-screen vocabulary (EF-19)", async () => {
    renderPage([
      follow({ entity_type: "company", entity_id: "41", name: "A24" }),
      follow({ entity_type: "franchise", entity_id: "10", name: "Star Wars Collection" }),
    ]);

    await screen.findByText("A24");
    // The payload says `company` and `franchise`; the reader is shown Studio and Franchise.
    expect(screen.getByText("Studio")).toBeInTheDocument();
    expect(screen.getByText("Franchise")).toBeInTheDocument();
  });

  // --- Chips ---------------------------------------------------------------

  it("shows every type until a chip is pressed", async () => {
    // None selected means all, not none: the empty selection is the page's resting state.
    renderPage([follow(), follow({ entity_type: "company", entity_id: "41", name: "A24" })]);

    await screen.findByText("Christopher Nolan");
    const chips = screen.getByRole("group", { name: /filter by type/i });
    for (const chip of within(chips).getAllByRole("button")) {
      expect(chip).toHaveAttribute("aria-pressed", "false");
    }
    expect(await rowNames()).toHaveLength(2);
  });

  it("narrows the list to the pressed chip, and widens again when it is released", async () => {
    renderPage([
      follow(),
      follow({ entity_type: "company", entity_id: "41", name: "A24" }),
      follow({ entity_type: "franchise", entity_id: "10", name: "Star Wars Collection" }),
    ]);

    await screen.findByText("Christopher Nolan");
    const chips = screen.getByRole("group", { name: /filter by type/i });
    const studios = within(chips).getByRole("button", { name: "Studios" });

    await userEvent.click(studios);
    expect(studios).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => expect(await rowNames()).toHaveLength(1));
    expect(screen.getByText("A24")).toBeInTheDocument();
    expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument();

    await userEvent.click(studios);
    expect(studios).toHaveAttribute("aria-pressed", "false");
    await waitFor(async () => expect(await rowNames()).toHaveLength(3));
  });

  it("adds up multiple chips rather than replacing the selection", async () => {
    renderPage([
      follow(),
      follow({ entity_type: "company", entity_id: "41", name: "A24" }),
      follow({ entity_type: "franchise", entity_id: "10", name: "Star Wars Collection" }),
    ]);

    await screen.findByText("Christopher Nolan");
    const chips = screen.getByRole("group", { name: /filter by type/i });
    await userEvent.click(within(chips).getByRole("button", { name: "Studios" }));
    await userEvent.click(within(chips).getByRole("button", { name: "Franchises" }));

    await waitFor(async () => expect(await rowNames()).toHaveLength(2));
    expect(screen.getByText("A24")).toBeInTheDocument();
    expect(screen.getByText("Star Wars Collection")).toBeInTheDocument();
    expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument();
  });

  it("remembers the chip selection for the next visit", async () => {
    const rows = [follow(), follow({ entity_type: "company", entity_id: "41", name: "A24" })];
    renderPage(rows);
    await screen.findByText("Christopher Nolan");
    await userEvent.click(screen.getByRole("button", { name: "Studios" }));
    await waitFor(async () => expect(await rowNames()).toEqual(["A24"]));

    // A second mount, as a return visit would be: the chip comes back pressed and the list
    // comes back narrowed, without the reader doing it again.
    cleanup();
    renderPage(rows);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Studios" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(await rowNames()).toEqual(["A24"]);
  });

  it("ignores a stored selection it cannot read rather than rendering nothing", async () => {
    // A value written by another build, or corrupted. Falling back to "no chips" is the page's
    // resting state, so the reader sees every row instead of an empty list with no visible
    // chip to switch back off.
    localStorage.setItem("backlotter:follows-types", "{not json");
    renderPage([follow()]);

    expect(await screen.findByText("Christopher Nolan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-pressed", "false");
  });

  // --- Sorts ---------------------------------------------------------------

  it("sorts by newest followed by default", async () => {
    renderPage([
      follow({ entity_id: "1", name: "Older", created_at: "2026-01-01T00:00:00Z" }),
      follow({ entity_id: "2", name: "Newest", created_at: "2026-09-01T00:00:00Z" }),
      follow({ entity_id: "3", name: "Middle", created_at: "2026-05-01T00:00:00Z" }),
    ]);

    expect(await screen.findByLabelText("Sort by")).toHaveValue("created");
    expect(await rowNames()).toEqual(["Newest", "Middle", "Older"]);
  });

  it("sorts by name A–Z, with the rows it cannot name last", async () => {
    renderPage([
      follow({ entity_id: "1", name: "Zoe Kravitz" }),
      follow({ entity_id: "2", name: null }),
      follow({ entity_id: "3", name: "Ava DuVernay" }),
    ]);

    await screen.findByText("Zoe Kravitz");
    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "name");

    // Null is an absence the reader is not looking for, so it sinks rather than leading.
    expect(await rowNames()).toEqual(["Ava DuVernay", "Zoe Kravitz", "Person 2"]);
  });

  it("sorts by last activity, newest first, with the quiet follows last", async () => {
    renderPage([
      follow({ entity_id: "1", name: "Quiet", last_activity_at: null }),
      follow({ entity_id: "2", name: "Stale", last_activity_at: "2026-01-01T00:00:00Z" }),
      follow({ entity_id: "3", name: "Fresh", last_activity_at: "2026-09-20T00:00:00Z" }),
    ]);

    await screen.findByText("Quiet");
    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "activity");

    // Null means "nothing has happened yet", a real state rather than a missing value, and it
    // belongs at the bottom of this sort rather than the top.
    expect(await rowNames()).toEqual(["Fresh", "Stale", "Quiet"]);
  });

  // --- Text filter ---------------------------------------------------------

  it("filters the list by name as the user types, case-insensitively", async () => {
    renderPage([
      follow({ entity_id: "1", name: "Christopher Nolan" }),
      follow({ entity_id: "2", name: "Greta Gerwig" }),
      follow({ entity_type: "company", entity_id: "41", name: "A24" }),
    ]);

    await screen.findByText("Greta Gerwig");
    await userEvent.type(screen.getByLabelText("Find"), "gret");

    await waitFor(async () => expect(await rowNames()).toEqual(["Greta Gerwig"]));
  });

  it("says so when the filters leave nothing, rather than showing an empty list", async () => {
    renderPage([follow()]);

    await screen.findByText("Christopher Nolan");
    await userEvent.type(screen.getByLabelText("Find"), "nobody");

    expect(await screen.findByText(/nothing here matches/i)).toBeInTheDocument();
  });

  it("combines the text filter with the chips", async () => {
    renderPage([
      follow({ entity_id: "1", name: "A24 Films Person" }),
      follow({ entity_type: "company", entity_id: "41", name: "A24" }),
    ]);

    await screen.findByText("A24");
    await userEvent.click(screen.getByRole("button", { name: "Studios" }));
    await userEvent.type(screen.getByLabelText("Find"), "a24");

    await waitFor(async () => expect(await rowNames()).toEqual(["A24"]));
  });

  // --- The row -------------------------------------------------------------

  it("gives a film row its headline release, and no other type one", async () => {
    renderPage([
      follow({
        entity_type: "title",
        entity_id: "11111111-1111-4111-8111-111111111111",
        name: "Dune: Part Three",
        headline_release: { date: "2026-07-17", kind: "upcoming", country: "US", bucket: "wide" },
      }),
      follow({ entity_id: "1", name: "Christopher Nolan" }),
    ]);

    expect(await screen.findByText(/Opens Jul 17, 2026/)).toBeInTheDocument();
    // One date line on the page, on the one row that has a date of its own (EF-15).
    expect(screen.getAllByText(/Opens |No date yet/, { selector: "p" })).toHaveLength(1);
  });

  it("says when a follow last delivered something, and stays quiet when it never has", async () => {
    renderPage([
      follow({ entity_id: "1", name: "Busy", last_activity_at: daysAgo(3) }),
      follow({ entity_id: "2", name: "Quiet", last_activity_at: null }),
    ]);

    expect(await screen.findByText(/Last activity 3 days ago/)).toBeInTheDocument();
    // "Last activity never" would read as a fault; a follow made this morning has simply not
    // delivered anything yet. Pinned to the meta line, since an ancestor's text matches too.
    expect(screen.getAllByText(/Last activity/, { selector: "p" })).toHaveLength(1);
  });

  it("links a named person row to their page, slugged from the name the API gave", async () => {
    renderPage([follow()]);

    expect(await screen.findByRole("link", { name: "Christopher Nolan" })).toHaveAttribute(
      "href",
      "/person/525-christopher-nolan",
    );
  });

  it("links a named company row to its studio page, slugged from the name", async () => {
    renderPage([follow({ entity_type: "company", entity_id: "41", name: "A24" })]);

    expect(await screen.findByRole("link", { name: "A24" })).toHaveAttribute(
      "href",
      "/studio/41-a24",
    );
  });

  it("links a franchise row to its franchise page", async () => {
    renderPage([
      follow({ entity_type: "franchise", entity_id: "10", name: "Star Wars Collection" }),
    ]);

    expect(await screen.findByRole("link", { name: "Star Wars Collection" })).toHaveAttribute(
      "href",
      "/franchise/10-star-wars-collection",
    );
  });

  it("links a row it has no name for to its page anyway", async () => {
    // Well formed from the id alone (NEU-1419). The page it reaches 404s while the catalog
    // cannot name the id, which is the honest answer for a row D-40 keeps after its entity
    // left the catalog — better than rendering the id as dead text.
    renderPage([follow({ entity_id: "287", name: null })]);

    expect(await screen.findByRole("link", { name: "Person 287" })).toHaveAttribute(
      "href",
      "/person/287",
    );
  });

  it("leaves a title row unlinked — the payload carries no film ref to link to", async () => {
    // A title follow's `entity_id` is our film UUID, and `/film/:ref` is addressed by
    // `<tmdb_id>-<slug>`; `GET /me/follows` ships neither, so the row cannot mint a link.
    renderPage([
      follow({
        entity_type: "title",
        entity_id: "11111111-1111-4111-8111-111111111111",
        name: "Dune: Part Three",
      }),
    ]);

    expect(await screen.findByText("Dune: Part Three")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dune: Part Three" })).not.toBeInTheDocument();
  });

  it("links nothing on the page out to TMDB", async () => {
    // EF-15: every row links inward. The page had one outbound link, on unnamed company and
    // collection rows, and NEU-1431 deleted it with `tmdbUrl`.
    renderPage([
      follow({ name: null }),
      follow({ entity_type: "company", entity_id: "41", name: null }),
      follow({ entity_type: "franchise", entity_id: "10", name: null }),
    ]);

    await screen.findByRole("link", { name: "Studio 41" });
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

  it("draws no coverage control on any row — a follow is binary now", async () => {
    // EF-1: the tier is gone from the payload, the PATCH that set it is a no-op, and the
    // radios that wrote it went with `FollowCoverageControl`.
    renderPage([
      follow(),
      follow({ entity_type: "company", entity_id: "41" }),
      follow({ entity_type: "title", entity_id: "11111111-1111-4111-8111-111111111111" }),
    ]);

    await followsList();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    for (const label of ["Lead roles", "Major credits", "Every credit"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("unfollows a row, and the row goes", async () => {
    const graph = renderPage([follow()]);

    const button = await screen.findByRole("button", { name: "Unfollow Christopher Nolan" });
    await userEvent.click(button);

    await waitFor(() => expect(graph.follows).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument());
  });

  // --- The add box and the empty states ------------------------------------

  it("names a row the moment it is followed, before the server answers", async () => {
    // The optimistic row carries the name and face the search result already had, so following
    // someone does not flash "Person 525" for the length of a round trip. The request is held
    // open, so anything on screen can only be the optimistic edit.
    const graph = followGraphHandlers();
    server.use(
      // First, so it beats the graph's own POST — `server.use` resolves in the order given.
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

    await userEvent.type(screen.getByLabelText("Search people…"), "nolan");
    await userEvent.click(
      await screen.findByRole("button", { name: /^follow christopher nolan$/i }),
    );

    const list = await followsList();
    expect(
      await within(list).findByRole("link", { name: "Christopher Nolan" }),
    ).toBeInTheDocument();
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

    await userEvent.type(screen.getByLabelText("Search people…"), "nolan");
    await userEvent.click(
      await screen.findByRole("button", { name: /^follow christopher nolan$/i }),
    );

    await waitFor(() => expect(graph.follows).toHaveLength(1));
    expect(graph.follows[0].name).toBe("Christopher Nolan");
    expect(graph.follows[0]).not.toHaveProperty("coverage");

    const list = await followsList();
    await waitFor(() =>
      expect(within(list).getByRole("link", { name: "Christopher Nolan" })).toBeInTheDocument(),
    );
    expect(within(list).queryByText(/Person 525/)).toBeNull();
  });

  it("says the digest is built from these, not that films are added for you", async () => {
    renderPage([]);
    expect(
      await screen.findByText("Your timeline and your digest are built from these."),
    ).toBeInTheDocument();
  });

  it("invites the user to search or use a film page when they follow nothing", async () => {
    renderPage([]);
    expect(await screen.findByText(/do not follow anything yet/i)).toBeInTheDocument();
    // No controls over an empty list — the chips and sorts would have nothing to act on.
    expect(screen.queryByRole("group", { name: /filter by type/i })).not.toBeInTheDocument();
  });

  it("keeps a row whose entity it cannot name rather than pruning it (D-40)", async () => {
    // Two rows, neither with a name the catalog could resolve. A list that quietly dropped what
    // it could not resolve is exactly how the "restored exactly as you left them" guarantee
    // breaks.
    renderPage([follow({ entity_id: "1", name: null }), follow({ entity_id: "2", name: null })]);

    const list = await followsList();
    expect(within(list).getAllByRole("button", { name: /unfollow/i })).toHaveLength(2);
  });
});
