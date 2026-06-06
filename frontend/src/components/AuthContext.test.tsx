import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { AuthProvider, useAuth } from "./AuthContext";

const AUTHED_USER = {
  id: "u1",
  email: "alice@example.com",
  display_name: "Alice",
  created_at: new Date().toISOString(),
  csrf_token: "tok-abc",
};

function ProbeUser() {
  const { user, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{user ? user.email : "anon"}</div>;
}

function LoginButton() {
  const { login } = useAuth();
  return (
    <button onClick={() => login("alice@example.com", "password123")}>
      login
    </button>
  );
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
    server.use(
      http.post(`${env.apiBaseUrl}/auth/login`, () =>
        HttpResponse.json(AUTHED_USER),
      ),
    );

    renderWithProviders(
      <>
        <ProbeUser />
        <LoginButton />
      </>,
    );

    // Wait for bootstrap to settle (shows "anon" while /me returns 401)
    await waitFor(() => expect(screen.getByText("anon")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "login" }));

    await waitFor(() =>
      expect(screen.getByText("alice@example.com")).toBeInTheDocument(),
    );
  });
});
