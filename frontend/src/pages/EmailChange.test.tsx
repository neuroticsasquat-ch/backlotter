import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { emailInUseResponse, invalidTokenResponse } from "@/test/msw/handlers";
import { env } from "@/env";
import { AuthProvider } from "@/components/AuthContext";
import { EmailChange } from "./EmailChange";

function renderPage(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/email-change", Component: EmailChange },
    { path: "/me/settings", Component: () => <div>settings</div> },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={[path]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("EmailChange", () => {
  it("spends the token from the query string exactly once and confirms", async () => {
    const seen: unknown[] = [];
    server.use(
      http.post(`${env.apiBaseUrl}/auth/email-change/confirm`, async ({ request }) => {
        seen.push(await request.json());
        return seen.length === 1 ? new Response(null, { status: 204 }) : invalidTokenResponse();
      }),
    );
    renderPage("/email-change?token=tok-123");

    expect(await screen.findByRole("heading", { name: /address changed/i })).toBeInTheDocument();
    expect(seen).toEqual([{ token: "tok-123" }]);
  });

  it("re-reads the account for a signed-in owner so the new address shows", async () => {
    let reads = 0;
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () => {
        reads += 1;
        return HttpResponse.json({
          id: "u1",
          email: reads === 1 ? "old@example.com" : "new@example.com",
          display_name: "Test User",
          is_admin: false,
          email_verified: true,
          entitled: false,
          created_at: "2026-09-18T00:00:00Z",
          csrf_token: "test-csrf",
        });
      }),
    );
    renderPage("/email-change?token=tok-123");

    expect(await screen.findByRole("heading", { name: /address changed/i })).toBeInTheDocument();
    expect(await screen.findByText(/new@example.com/)).toBeInTheDocument();
  });

  it("explains a spent or expired link and points back to settings", async () => {
    server.use(
      http.post(`${env.apiBaseUrl}/auth/email-change/confirm`, () => invalidTokenResponse()),
    );
    renderPage("/email-change?token=tok-old");

    expect(await screen.findByRole("heading", { name: /didn't work/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/me/settings");
  });

  it("distinguishes an address taken since the mail went out", async () => {
    server.use(
      http.post(`${env.apiBaseUrl}/auth/email-change/confirm`, () => emailInUseResponse()),
    );
    renderPage("/email-change?token=tok-123");

    expect(await screen.findByRole("heading", { name: /already in use/i })).toBeInTheDocument();
  });

  it("does not post anything without a token", async () => {
    let calls = 0;
    server.use(
      http.post(`${env.apiBaseUrl}/auth/email-change/confirm`, () => {
        calls += 1;
        return new Response(null, { status: 204 });
      }),
    );
    renderPage("/email-change");

    expect(await screen.findByRole("heading", { name: /didn't work/i })).toBeInTheDocument();
    expect(calls).toBe(0);
  });
});
