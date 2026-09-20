import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { env } from "@/env";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import type { WatchlistItem } from "@/api/types";
import { server } from "@/test/msw/server";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { followGraphHandlers, makeWatchlistFilm, makeWatchlistItem } from "@/test/msw/follows";
import { LOCKED_COPY } from "./access";
import { TitleFollowButton } from "./TitleFollowButton";

const film = makeWatchlistFilm();

/** A film reached only through someone the user follows — no direct title follow of its own,
 *  which is what makes it a "via …" row rather than one they chose. */
const viaNolan = (extra: { name: string; id: string }[] = []): WatchlistItem =>
  makeWatchlistItem({
    followed: false,
    covered_by: [
      { entity_type: "person", entity_id: "525", name: "Christopher Nolan" },
      ...extra.map((e) => ({ entity_type: "person" as const, entity_id: e.id, name: e.name })),
    ],
  });

function renderButton({
  entitled = true,
  anonymous = false,
  watchlist = [] as WatchlistItem[],
} = {}) {
  const graph = followGraphHandlers({ watchlist });
  server.use(anonymous ? unauthMeHandler() : meHandler({ entitled }), ...graph.handlers);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/film/:ref", Component: () => <TitleFollowButton film={film} /> },
    { path: "/login", Component: () => <h1>Log in</h1> },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/film/603-the-odyssey"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return graph;
}

beforeEach(() => localStorage.clear());

describe("TitleFollowButton — access states", () => {
  it("sends an anonymous visitor to sign in rather than showing a dead button", async () => {
    renderButton({ anonymous: true });
    expect(
      await screen.findByRole("link", { name: "Sign in to follow The Odyssey" }),
    ).toHaveAttribute("href", expect.stringContaining("/login"));
  });

  it("shows a signed-in account without a grant what it is missing (D-41)", async () => {
    renderButton({ entitled: false });
    const button = await screen.findByRole("button", { name: "Follow The Odyssey" });
    expect(button).toBeDisabled();
    // On the wrapper, not the button: a disabled button takes no pointer events, so a tooltip
    // hung on it never opens.
    expect(button.parentElement).toHaveAttribute("title", LOCKED_COPY);
  });
});

describe("TitleFollowButton — the three ready states", () => {
  it("offers Follow for a film that is not on the list", async () => {
    renderButton();
    const button = await screen.findByRole("button", { name: "Follow The Odyssey" });
    expect(button).toHaveTextContent("Follow");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("says Following for a film the user hears about", async () => {
    renderButton({ watchlist: [makeWatchlistItem()] });
    const button = await screen.findByRole("button", { name: "Stop hearing about The Odyssey" });
    expect(button).toHaveTextContent("Following");
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("says Muted, and is not pressed — a muted film is on the list and still silent", async () => {
    renderButton({ watchlist: [makeWatchlistItem({ muted: true })] });
    const button = await screen.findByRole("button", { name: "Hear about The Odyssey again" });
    expect(button).toHaveTextContent("Muted");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});

describe("TitleFollowButton — what a press sends", () => {
  it("wants a film that is not on the list, creating the title follow for it", async () => {
    const graph = renderButton();

    await userEvent.click(await screen.findByRole("button", { name: "Follow The Odyssey" }));

    await waitFor(() => expect(graph.watchlist).toHaveLength(1));
    expect(graph.watchlist[0]).toMatchObject({ followed: true, muted: false });
    expect(await screen.findByRole("button", { name: /stop hearing about/i })).toBeInTheDocument();
  });

  it("unmutes a muted film rather than adding a second row", async () => {
    const graph = renderButton({ watchlist: [makeWatchlistItem({ muted: true })] });

    await userEvent.click(
      await screen.findByRole("button", { name: "Hear about The Odyssey again" }),
    );

    await waitFor(() => expect(graph.watchlist[0].muted).toBe(false));
    expect(graph.watchlist).toHaveLength(1);
  });

  it("mutes rather than removes when another follow still covers the film", async () => {
    // *Stop* is two acts wearing one endpoint (D-45). Here something else reaches the film, so
    // the row stays and goes quiet — the user can undo it from the Muted section.
    const graph = renderButton({ watchlist: [viaNolan()] });

    await userEvent.click(
      await screen.findByRole("button", { name: "Stop hearing about The Odyssey" }),
    );

    await waitFor(() => expect(graph.watchlist[0].muted).toBe(true));
    expect(graph.watchlist).toHaveLength(1);
  });

  it("removes the row outright when the user's own follow was the only thing holding it", async () => {
    const graph = renderButton({ watchlist: [makeWatchlistItem()] });

    await userEvent.click(
      await screen.findByRole("button", { name: "Stop hearing about The Odyssey" }),
    );

    await waitFor(() => expect(graph.watchlist).toHaveLength(0));
    expect(await screen.findByRole("button", { name: "Follow The Odyssey" })).toBeInTheDocument();
  });
});

describe("TitleFollowButton — while the request is in flight", () => {
  it("shows the new state optimistically and refuses a second press", async () => {
    // The optimistic edit is the point of the hook, and a settled assertion cannot see it:
    // holding the response open is what separates "the cache flipped under the finger" from
    // "the refetch landed".
    renderButton();
    // The request never completes, which is what makes this deterministic rather than a race:
    // anything the button says from here can only be the optimistic edit, because the server
    // has not answered and cannot.
    server.use(
      http.post(`${env.apiBaseUrl}/me/watchlist`, async () => {
        await delay("infinite");
        return HttpResponse.json(makeWatchlistItem(), { status: 200 });
      }),
    );

    await userEvent.click(await screen.findByRole("button", { name: "Follow The Odyssey" }));

    const pending = await screen.findByRole("button", {
      name: "Stop hearing about The Odyssey",
    });
    expect(pending).toHaveTextContent("Following");
    expect(pending).toBeDisabled();
  });
});

describe("TitleFollowButton — the reason line", () => {
  it("names the follow that reached a film the user never asked for", async () => {
    renderButton({ watchlist: [viaNolan()] });
    expect(await screen.findByText("via Christopher Nolan")).toBeInTheDocument();
  });

  it("counts the rest rather than listing them", async () => {
    renderButton({
      watchlist: [
        viaNolan([
          { id: "1", name: "Emma Thomas" },
          { id: "2", name: "Hoyte van Hoytema" },
        ]),
      ],
    });
    expect(await screen.findByText("via Christopher Nolan and 2 more")).toBeInTheDocument();
  });

  it("says nothing for a film the user followed themselves", async () => {
    // They chose this one; explaining a decision they remember making is noise — even though
    // another follow also covers it.
    renderButton({
      watchlist: [
        makeWatchlistItem({
          followed: true,
          covered_by: [
            { entity_type: "title", entity_id: film.id, name: film.title },
            { entity_type: "person", entity_id: "525", name: "Christopher Nolan" },
          ],
        }),
      ],
    });

    await screen.findByRole("button", { name: /stop hearing about/i });
    expect(screen.queryByText(/^via /)).toBeNull();
  });

  it("says nothing for a muted film — the button already reads Muted", async () => {
    renderButton({ watchlist: [makeWatchlistItem({ muted: true, followed: false })] });
    await screen.findByRole("button", { name: /hear about the odyssey again/i });
    expect(screen.queryByText(/^via /)).toBeNull();
  });

  it("says nothing rather than 'via null' for a cover the backend could not name", async () => {
    // A follow outlives the entity it names and D-40 keeps the row, so a null name is a real
    // payload, not a bug to render.
    renderButton({
      watchlist: [
        makeWatchlistItem({
          followed: false,
          covered_by: [{ entity_type: "person", entity_id: "525", name: null }],
        }),
      ],
    });
    await screen.findByRole("button", { name: /stop hearing about/i });
    expect(screen.queryByText(/^via /)).toBeNull();
  });
});
