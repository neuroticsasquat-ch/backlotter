import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { env } from "@/env";
import { server } from "@/test/msw/server";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { AuthProvider } from "@/components/AuthContext";
import { AccountArea, accountQueryClient } from "./HeaderAccount";
import HeaderAccount from "./HeaderAccount";

function renderAccountArea() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter>
          <AccountArea />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("HeaderAccount", () => {
  // The default export uses the module-level `accountQueryClient` singleton, which
  // persists across tests in this file. Reset it between cases so the singleton-dependent
  // tests below are order-independent.
  afterEach(() => accountQueryClient.clear());

  /** Reversed by NEU-1407. This used to render nothing at all when logged out, which left
   *  the site with no way into itself — the admin had to type `/login`. Sign up stays absent
   *  until there is a subscription to sell (NEU-1409). */
  it("offers Log in when unauthenticated", async () => {
    server.use(unauthMeHandler());
    renderAccountArea();

    const login = await screen.findByRole("link", { name: /log in/i });
    expect(login.getAttribute("href")).toContain("/login?next=");
    expect(screen.queryByRole("link", { name: /sign up/i })).not.toBeInTheDocument();
  });

  it("shows account menu when signed in as a non-admin", async () => {
    server.use(meHandler({ is_admin: false }));
    renderAccountArea();
    await screen.findByRole("button", { name: /log out/i });
    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("shows Admin link when signed in as admin", async () => {
    server.use(meHandler({ is_admin: true }));
    renderAccountArea();
    const adminLink = await screen.findByRole("link", { name: /admin/i });
    expect(adminLink).toHaveAttribute("href", "/admin/ingest");
  });

  it("shows the Follows link to an entitled account, and no Watchlist beside it (EF-14)", async () => {
    server.use(meHandler({ entitled: true }));
    renderAccountArea();

    expect(await screen.findByRole("link", { name: "Follows" })).toHaveAttribute(
      "href",
      "/me/follows",
    );
    expect(screen.queryByRole("link", { name: "Watchlist" })).not.toBeInTheDocument();
  });

  it("hides them from an account without a grant rather than rendering them dead (D-41)", async () => {
    server.use(meHandler({ entitled: false }));
    renderAccountArea();

    // Keyed off a post-auth control, so this is not passing merely because auth has not
    // resolved: the account is signed in and the links are still absent.
    await screen.findByRole("button", { name: /log out/i });
    expect(screen.queryByRole("link", { name: "Follows" })).not.toBeInTheDocument();
  });

  it("shows the Settings link to every signed-in account, grant or not", async () => {
    server.use(meHandler({ entitled: false }));
    renderAccountArea();

    expect(await screen.findByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/me/settings",
    );
  });

  it("clears the account UI after logout", async () => {
    server.use(
      meHandler({ is_admin: false }),
      http.post(`${env.apiBaseUrl}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    );
    renderAccountArea();
    const logoutButton = await screen.findByRole("button", { name: /log out/i });
    await userEvent.click(logoutButton);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument(),
    );
  });

  it("island smoke test: default export renders the logged-out offer without explicit providers", async () => {
    server.use(unauthMeHandler());
    render(
      <MemoryRouter>
        <HeaderAccount />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("link", { name: /log in/i })).toBeInTheDocument();
  });

  it("refetches /me on mount, overriding a stale cached logout state", async () => {
    // Simulate the singleton holding a still-fresh me=null (e.g. from an earlier public
    // visit) after the admin logs in via the SPA shell.
    accountQueryClient.setQueryData(["me"], null);
    server.use(meHandler({ is_admin: false }));
    render(
      <MemoryRouter>
        <HeaderAccount />
      </MemoryRouter>,
    );
    // refetchOnMount:"always" forces a fresh /me despite the cached null, so the header
    // reflects the authed session instead of staying empty.
    expect(await screen.findByRole("button", { name: /log out/i })).toBeInTheDocument();
  });
});
