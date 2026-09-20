import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import {
  entitlementRequiredHandlers,
  followGraphHandlers,
  makeWatchlistFilm,
} from "@/test/msw/follows";
import { AuthProvider } from "@/components/AuthContext";
import { WatchlistButton } from "./WatchlistButton";

const FILM = makeWatchlistFilm();

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/film/:ref", Component: () => <WatchlistButton film={FILM} /> },
    { path: "/login", Component: () => <p>Login page</p> },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/film/603-the-odyssey"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const add = () => screen.findByRole("button", { name: /add the odyssey to your watchlist/i });

describe("WatchlistButton", () => {
  it("offers a sign-in prompt to a signed-out visitor", async () => {
    // The default /me handler answers 401.
    renderButton();
    const link = await screen.findByRole("link", { name: /sign in to add the odyssey/i });
    expect(link).toHaveTextContent("Watchlist");
    expect(link).toHaveAttribute("href", "/login?next=%2Ffilm%2F603-the-odyssey");
  });

  it("renders disabled, with the explanation, for an account with no grant", async () => {
    server.use(meHandler({ entitled: false }), ...entitlementRequiredHandlers());
    renderButton();

    const button = await add();
    await waitFor(() => expect(button).toBeDisabled());
    expect(button.parentElement?.getAttribute("title")).toMatch(/access is limited/i);
  });

  it("adds the film on click and flips to On watchlist", async () => {
    const graph = followGraphHandlers();
    server.use(meHandler({ entitled: true }), ...graph.handlers);
    renderButton();

    await userEvent.click(await add());

    expect(
      await screen.findByRole("button", { name: /remove the odyssey from your watchlist/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(graph.watchlist).toEqual([expect.objectContaining({ followed: true, muted: false })]);
  });

  it("removes a film the user put there themselves", async () => {
    const graph = followGraphHandlers({
      watchlist: [
        {
          film: FILM,
          covered_by: [{ entity_type: "title", entity_id: FILM.id, name: FILM.title }],
          followed: true,
          muted: false,
          created_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    server.use(meHandler({ entitled: true }), ...graph.handlers);
    renderButton();

    await userEvent.click(await screen.findByRole("button", { name: /remove the odyssey/i }));

    expect(await add()).toHaveAttribute("aria-pressed", "false");
    // Nothing else covered it, so stopping took it off the list outright.
    expect(graph.watchlist).toEqual([]);
  });
});
