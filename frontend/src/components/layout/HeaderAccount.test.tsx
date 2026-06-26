import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("shows Login and Sign up links when unauthenticated", async () => {
    server.use(unauthMeHandler());
    renderAccountArea();
    expect(await screen.findByRole("link", { name: /log in/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign up/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
  });

  it("renders Login link on first synchronous paint (no hydration mismatch)", () => {
    server.use(unauthMeHandler());
    renderAccountArea();
    // Synchronous assertion — cache is cold so user is null → logged-out default is already rendered
    expect(screen.getByRole("link", { name: /log in/i })).toBeInTheDocument();
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

  it("reverts to logged-out default after logout", async () => {
    server.use(
      meHandler({ is_admin: false }),
      http.post(`${env.apiBaseUrl}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    );
    renderAccountArea();
    const logoutButton = await screen.findByRole("button", { name: /log out/i });
    await userEvent.click(logoutButton);
    expect(await screen.findByRole("link", { name: /log in/i })).toBeInTheDocument();
  });

  it("island smoke test: default export renders Login link without explicit providers", () => {
    render(
      <MemoryRouter>
        <HeaderAccount />
      </MemoryRouter>,
    );
    // Synchronous — module-level client is cache cold, so user is null → logged-out default
    expect(screen.getByRole("link", { name: /log in/i })).toBeInTheDocument();
  });

  it("refetches /me on remount so the header reflects a session established elsewhere", async () => {
    // First mount (public route, logged out): caches me=null in the singleton client.
    server.use(unauthMeHandler());
    const { unmount } = render(
      <MemoryRouter>
        <HeaderAccount />
      </MemoryRouter>,
    );
    await screen.findByRole("link", { name: /log in/i });
    unmount();

    // User logs in via the SPA shell (a separate QueryClient) — the singleton's cached
    // me=null is still within staleTime. The session now exists server-side.
    server.use(meHandler({ is_admin: false }));
    render(
      <MemoryRouter>
        <HeaderAccount />
      </MemoryRouter>,
    );

    // refetchOnMount:"always" forces a fresh /me despite the still-fresh cached null,
    // so the header updates to the authed state instead of remaining "Log in".
    expect(await screen.findByRole("button", { name: /log out/i })).toBeInTheDocument();
  });
});
