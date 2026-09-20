import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import type { Follow } from "@/api/types";
import { rememberFollowLabel, resetFollowLabelCache } from "@/lib/follow-labels";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { entitySearchHandlers, followGraphHandlers } from "@/test/msw/follows";
import { MyFollows } from "./MyFollows";

const follow = (overrides: Partial<Follow> = {}): Follow => ({
  entity_type: "person",
  entity_id: "525",
  source: "manual",
  coverage: "lead",
  created_at: "2026-09-12T00:00:00Z",
  ...overrides,
});

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

beforeEach(() => {
  localStorage.clear();
  resetFollowLabelCache();
});

describe("MyFollows", () => {
  it("groups follows by entity type under their own headings", async () => {
    rememberFollowLabel("person", "525", "Christopher Nolan");
    rememberFollowLabel("company", "41", "A24");
    renderPage([
      follow(),
      follow({ entity_type: "company", entity_id: "41" }),
      follow({ entity_type: "franchise", entity_id: "10" }),
    ]);

    expect(await screen.findByText("Christopher Nolan")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /people \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /companies \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /collections \(1\)/i })).toBeInTheDocument();
    // No films followed, so no Films heading — the groups are fixed in order but only the
    // occupied ones render.
    expect(screen.queryByRole("heading", { name: /films/i })).not.toBeInTheDocument();
  });

  it("labels a row from the name this browser learned when the follow was made", async () => {
    rememberFollowLabel("person", "525", "Christopher Nolan", "/nolan.jpg");
    renderPage([follow()]);

    expect(await screen.findByText("Christopher Nolan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unfollow Christopher Nolan" })).toBeInTheDocument();
  });

  it("falls back to the type, the id and a TMDB link for a row it has no name for", async () => {
    renderPage([follow({ entity_id: "287" })]);

    // Scoped to the row's own name line: the coverage control's group label names the row
    // too, so an unscoped match would find both.
    expect(await screen.findByText(/Person 287/, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /look up on tmdb/i })).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/person/287",
    );
  });

  it("gives a title follow no TMDB link — the id is ours, not theirs", async () => {
    renderPage([
      follow({ entity_type: "title", entity_id: "11111111-1111-4111-8111-111111111111" }),
    ]);

    expect(await screen.findByRole("heading", { name: /films \(1\)/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /look up on tmdb/i })).not.toBeInTheDocument();
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
    rememberFollowLabel("person", "525", "Christopher Nolan");
    const graph = renderPage([follow()]);

    const button = await screen.findByRole("button", { name: "Unfollow Christopher Nolan" });
    await userEvent.click(button);

    await waitFor(() => expect(graph.follows).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText("Christopher Nolan")).not.toBeInTheDocument());
  });

  it("offers a person follow both coverage tiers, on the default", async () => {
    rememberFollowLabel("person", "525", "Christopher Nolan");
    renderPage([follow()]);

    const lead = await screen.findByRole("radio", { name: "Lead roles only" });
    expect(lead).toBeChecked();
    expect(screen.getByRole("radio", { name: "Every credit" })).not.toBeChecked();
  });

  it("widening a person follow PATCHes its coverage", async () => {
    rememberFollowLabel("person", "525", "Christopher Nolan");
    const graph = renderPage([follow()]);

    await userEvent.click(await screen.findByRole("radio", { name: "Every credit" }));

    await waitFor(() => expect(graph.follows[0].coverage).toBe("all"));
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
