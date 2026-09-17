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

  it("shows the alert prefs as pressed chips", async () => {
    renderPage([makeWatchlistItem({ alert_prefs: ["rent", "stream"] })]);

    const rent = await screen.findByRole("button", { name: "Rent alerts for The Odyssey" });
    expect(rent).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Stream alerts for The Odyssey" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Buy alerts for The Odyssey" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("turning a chip on PATCHes the item with the whole canonical set", async () => {
    const graph = renderPage([makeWatchlistItem({ alert_prefs: ["stream"] })]);

    await userEvent.click(await screen.findByRole("button", { name: /buy alerts/i }));

    // Canonical order (buy, rent, stream), matching the backend's normalise_alert_prefs — not
    // the order the user happened to click them in.
    await waitFor(() => expect(graph.watchlist[0].alert_prefs).toEqual(["buy", "stream"]));
  });

  it("turning the last chip off is a real setting, not a no-op", async () => {
    const graph = renderPage([makeWatchlistItem({ alert_prefs: ["stream"] })]);

    await userEvent.click(await screen.findByRole("button", { name: /stream alerts/i }));

    await waitFor(() => expect(graph.watchlist[0].alert_prefs).toEqual([]));
  });

  it("removes a manually added film on one click", async () => {
    const graph = renderPage([makeWatchlistItem()]);

    await userEvent.click(await screen.findByRole("button", { name: /remove the odyssey/i }));

    await waitFor(() => expect(graph.watchlist).toHaveLength(0));
  });

  it("marks a derived item and confirms before removing it, because the dismissal is forever", async () => {
    const graph = renderPage([makeWatchlistItem({ source: "derived_from_follow" })]);

    expect(await screen.findByText(/added by a follow/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove the odyssey/i }));

    // The click opened the confirm rather than removing anything.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(graph.watchlist).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(graph.watchlist).toHaveLength(0));
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
