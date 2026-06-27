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

  it("renders no account UI when unauthenticated (no public Log in until a paid tier)", async () => {
    server.use(unauthMeHandler());
    const { container } = renderAccountArea();
    // Cold cache → user is null → renders nothing, synchronously (no hydration mismatch).
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("link", { name: /log in/i })).not.toBeInTheDocument();
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

  it("island smoke test: default export renders nothing when logged out, without explicit providers", () => {
    server.use(unauthMeHandler());
    const { container } = render(
      <MemoryRouter>
        <HeaderAccount />
      </MemoryRouter>,
    );
    // Cold cache → user null → renders nothing (no public Log in link).
    expect(container).toBeEmptyDOMElement();
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
