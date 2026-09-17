import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { env } from "@/env";
import { AuthProvider, useAuth } from "./AuthContext";

const AUTHED_USER = {
  id: "u1",
  email: "alice@example.com",
  display_name: "Alice",
  is_admin: false,
  email_verified: false,
  entitled: true,
  created_at: new Date().toISOString(),
  csrf_token: "tok-abc",
};

function ProbeUser() {
  const { user, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{user ? user.email : "anon"}</div>;
}

/** `email_verified` rides every authed response, not just `/me` — the banner reads it off
 *  the context straight after login, with no second round trip. */
function ProbeVerified() {
  const { user } = useAuth();
  if (!user) return null;
  return <div>verified: {String(user.email_verified)}</div>;
}

/** `entitled` is the flag every gated surface branches on (D-41). Like `email_verified` it
 *  rides every authed response, so a grant takes effect on the next `/me` without a sign-out. */
function ProbeEntitled() {
  const { user } = useAuth();
  if (!user) return null;
  return <div>entitled: {String(user.entitled)}</div>;
}

function LoginButton() {
  const { login } = useAuth();
  return <button onClick={() => login("alice@example.com", "password123")}>login</button>;
}

function renderWithProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>{node}</AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AuthContext", () => {
  it("treats 401 from /me as anonymous (unauthenticated bootstrap)", async () => {
    // Default handler in handlers.ts returns 401; no override needed.
    renderWithProviders(<ProbeUser />);
    await waitFor(() => expect(screen.getByText("anon")).toBeInTheDocument());
  });

  it("populates user after successful login", async () => {
    server.use(http.post(`${env.apiBaseUrl}/auth/login`, () => HttpResponse.json(AUTHED_USER)));

    renderWithProviders(
      <>
        <ProbeUser />
        <LoginButton />
      </>,
    );

    // Wait for bootstrap to settle (shows "anon" while /me returns 401)
    await waitFor(() => expect(screen.getByText("anon")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "login" }));

    await waitFor(() => expect(screen.getByText("alice@example.com")).toBeInTheDocument());
  });

  it("carries email_verified from the login reply, without re-reading /me", async () => {
    server.use(http.post(`${env.apiBaseUrl}/auth/login`, () => HttpResponse.json(AUTHED_USER)));

    renderWithProviders(
      <>
        <ProbeVerified />
        <LoginButton />
      </>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "login" }));

    expect(await screen.findByText("verified: false")).toBeInTheDocument();
  });

  it("reflects a verified address from /me", async () => {
    server.use(meHandler({ email_verified: true }));
    renderWithProviders(<ProbeVerified />);
    expect(await screen.findByText("verified: true")).toBeInTheDocument();
  });

  it("exposes entitled: false for an account nobody has granted access to", async () => {
    // The default for every signup (D-37) — closed until an admin grants it by hand.
    server.use(meHandler());
    renderWithProviders(<ProbeEntitled />);
    expect(await screen.findByText("entitled: false")).toBeInTheDocument();
  });

  it("exposes entitled: true for a granted account", async () => {
    server.use(meHandler({ entitled: true }));
    renderWithProviders(<ProbeEntitled />);
    expect(await screen.findByText("entitled: true")).toBeInTheDocument();
  });

  it("carries entitled from the login reply, without re-reading /me", async () => {
    server.use(http.post(`${env.apiBaseUrl}/auth/login`, () => HttpResponse.json(AUTHED_USER)));

    renderWithProviders(
      <>
        <ProbeEntitled />
        <LoginButton />
      </>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "login" }));

    expect(await screen.findByText("entitled: true")).toBeInTheDocument();
  });
});
