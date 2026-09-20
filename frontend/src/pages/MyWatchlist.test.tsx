import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import type { WatchlistItem } from "@/api/types";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { followGraphHandlers, makeWatchlistItem } from "@/test/msw/follows";
import { MyWatchlist } from "./MyWatchlist";

/** `makeWatchlistFilm`'s id, which a `covered_by` entry has to match to read as the film's own
 *  direct title follow rather than as something else reaching it. */
const FILM_ID = "11111111-1111-4111-8111-111111111111";

function renderPage(watchlist: WatchlistItem[] = []) {
  const graph = followGraphHandlers({ watchlist });
  server.use(meHandler({ entitled: true }), ...graph.handlers);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/me/watchlist", Component: MyWatchlist },
    { path: "/film/:ref", Component: () => <p>Film page</p> },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/me/watchlist"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return graph;
}

describe("MyWatchlist", () => {
  it("renders a film with its date, linked to its film page by TMDB ref", async () => {
    renderPage([makeWatchlistItem()]);

    const link = await screen.findByRole("link", { name: "The Odyssey" });
    // The bare TMDB id is a valid ref; /film/:ref 301s it to the canonical slugged form, which
    // is why this page does not try to build that slug itself.
    expect(link).toHaveAttribute("href", "/film/603");
    expect(screen.getByText(/Jul 17, 2026/)).toBeInTheDocument();
  });

  // The four headline-release kinds (NEU-1398). They have to be distinguishable on sight — the
  // whole point of NEU-1397 was that one row was quietly citing a date the film page never
  // showed, so a `primary` date that reads like a confirmed opening would reintroduce it.
  it("gives an upcoming release a future tense, its bucket and its country", async () => {
    renderPage([
      makeWatchlistItem({
        film: {
          headline_release: {
            date: "2026-10-03",
            kind: "upcoming",
            country: "US",
            bucket: "limited",
          },
        },
      }),
    ]);

    expect(await screen.findByText(/Opens Oct 3, 2026 · Limited · US/)).toBeInTheDocument();
  });

  it("puts a film that has already opened in the past tense", async () => {
    renderPage([
      makeWatchlistItem({
        film: {
          headline_release: { date: "2026-03-03", kind: "released", country: "US", bucket: "wide" },
        },
      }),
    ]);

    expect(await screen.findByText(/Opened Mar 3, 2026 · Wide · US/)).toBeInTheDocument();
  });

  it("marks a primary-date fallback unconfirmed, with no bucket or country to imply otherwise", async () => {
    renderPage([
      makeWatchlistItem({
        film: {
          headline_release: { date: "2026-10-03", kind: "primary", country: null, bucket: null },
        },
      }),
    ]);

    const line = await screen.findByText(/Oct 3, 2026 \(unconfirmed\)/);
    expect(line).toBeInTheDocument();
    expect(line).not.toHaveTextContent(/Opens|Opened/);
  });

  it("says so rather than blanking when a film has no date yet", async () => {
    renderPage([makeWatchlistItem({ film: { headline_release: null } })]);
    expect(await screen.findByText(/no date yet/i)).toBeInTheDocument();
  });

  it("says a film is here because the user follows it", async () => {
    renderPage([makeWatchlistItem()]);

    expect(await screen.findByText(/· followed/)).toBeInTheDocument();
    expect(screen.queryByText(/via /)).not.toBeInTheDocument();
  });

  it("names the follow a film arrived through when the user did not add it", async () => {
    renderPage([
      makeWatchlistItem({
        followed: false,
        covered_by: [{ entity_type: "person", entity_id: "525", name: "Christopher Nolan" }],
      }),
    ]);

    expect(await screen.findByText(/· via Christopher Nolan/)).toBeInTheDocument();
  });

  it("says both ways when a film is followed and covered", async () => {
    // Not exclusive: unfollowing the title would leave the film here via Nolan, so a row that
    // named only one of them would be a row that changed its story for no visible reason.
    renderPage([
      makeWatchlistItem({
        followed: true,
        covered_by: [
          { entity_type: "title", entity_id: FILM_ID, name: "The Odyssey" },
          { entity_type: "person", entity_id: "525", name: "Christopher Nolan" },
        ],
      }),
    ]);

    expect(await screen.findByText(/· followed · via Christopher Nolan/)).toBeInTheDocument();
  });

  it("counts the rest rather than listing every follow that reaches a film", async () => {
    renderPage([
      makeWatchlistItem({
        followed: false,
        covered_by: [
          { entity_type: "person", entity_id: "525", name: "Christopher Nolan" },
          { entity_type: "company", entity_id: "41", name: "A24" },
          { entity_type: "franchise", entity_id: "10", name: "The Odyssey Collection" },
        ],
      }),
    ]);

    expect(await screen.findByText(/via Christopher Nolan and 2 more/)).toBeInTheDocument();
  });

  it("mutes a film another follow still covers, and offers to unmute it", async () => {
    const graph = renderPage([
      makeWatchlistItem({
        followed: true,
        covered_by: [
          { entity_type: "title", entity_id: FILM_ID, name: "The Odyssey" },
          { entity_type: "person", entity_id: "525", name: "Christopher Nolan" },
        ],
      }),
    ]);

    // No confirm: a mute is reversible, which is the whole difference from the dismissal it
    // replaced (D-45).
    await userEvent.click(await screen.findByRole("button", { name: "Mute The Odyssey" }));

    await waitFor(() => expect(graph.watchlist[0].muted).toBe(true));
    expect(await screen.findByRole("heading", { name: "Muted" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Unmute The Odyssey" })).toBeInTheDocument();
  });

  it("unmutes a muted film back onto the list", async () => {
    const graph = renderPage([
      makeWatchlistItem({
        muted: true,
        followed: false,
        covered_by: [{ entity_type: "person", entity_id: "525", name: "Christopher Nolan" }],
      }),
    ]);

    await userEvent.click(await screen.findByRole("button", { name: "Unmute The Odyssey" }));

    await waitFor(() => expect(graph.watchlist[0].muted).toBe(false));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Muted" })).not.toBeInTheDocument(),
    );
  });

  it("offers to unfollow, not to mute, a film nothing else covers", async () => {
    // Stopping this one deletes the title follow and the row is simply gone — there is no
    // muted row to undo it from, so calling the button "Mute" would promise an undo the page
    // cannot keep.
    const graph = renderPage([makeWatchlistItem()]);

    expect(screen.queryByRole("button", { name: "Mute The Odyssey" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Unfollow The Odyssey" }));

    await waitFor(() => expect(graph.watchlist).toHaveLength(0));
    // Nothing covers it any more, so there is no muted row to show either.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Muted" })).not.toBeInTheDocument(),
    );
  });

  it("keeps the muted section out of the empty state's way", async () => {
    // Every film muted is not an empty watchlist: the follows that cover them are still there,
    // and the page has to offer the undo rather than tell the user to go and follow something.
    renderPage([makeWatchlistItem({ muted: true, followed: false })]);

    expect(await screen.findByRole("heading", { name: "Muted" })).toBeInTheDocument();
    expect(screen.queryByText(/watchlist is empty/i)).not.toBeInTheDocument();
  });

  it("offers no per-film store chips anywhere — the stores are one account setting", async () => {
    renderPage([makeWatchlistItem()]);

    await screen.findByRole("link", { name: "The Odyssey" });
    for (const store of ["Buy", "Rent", "Stream"]) {
      expect(
        screen.queryByRole("button", { name: new RegExp(store, "i") }),
      ).not.toBeInTheDocument();
    }
  });

  it("points an empty watchlist at the follows page that would fill it", async () => {
    renderPage([]);

    expect(await screen.findByText(/watchlist is empty/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /follow a director or studio/i })).toHaveAttribute(
      "href",
      "/me/follows",
    );
  });
});
