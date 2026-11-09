import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { invalidTokenResponse } from "@/test/msw/handlers";
import { meHandler } from "@/test/msw/me";
import { env } from "@/env";
import { AuthProvider } from "@/components/AuthContext";
import { Verify } from "./Verify";

function renderVerify(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/verify", Component: Verify },
    { path: "/", Component: () => <div>feed</div> },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={[path]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Verify", () => {
  it("spends the token from the query string and confirms", async () => {
    const seen: unknown[] = [];
    server.use(
      http.post(`${env.apiBaseUrl}/auth/verify`, async ({ request }) => {
        seen.push(await request.json());
        return new Response(null, { status: 204 });
      }),
    );
    renderVerify("/verify?token=tok-123");

    expect(await screen.findByRole("heading", { name: /email confirmed/i })).toBeInTheDocument();
    expect(seen).toEqual([{ token: "tok-123" }]);
  });

  it("spends the token exactly once", async () => {
    // The token is single-use: a second POST would 400 and turn a success into an error.
    let calls = 0;
    server.use(
      http.post(`${env.apiBaseUrl}/auth/verify`, () => {
        calls += 1;
        return calls === 1 ? new Response(null, { status: 204 }) : invalidTokenResponse();
      }),
    );
    renderVerify("/verify?token=tok-123");

    expect(await screen.findByRole("heading", { name: /email confirmed/i })).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("offers a fresh link when the token is expired or already spent", async () => {
    server.use(http.post(`${env.apiBaseUrl}/auth/verify`, () => invalidTokenResponse()));
    renderVerify("/verify?token=stale");

    expect(await screen.findByRole("heading", { name: /didn't work/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send a new link/i })).toBeInTheDocument();
  });

  it("does not call a server failure an expired link", async () => {
    // A 500 or a dropped connection leaves the token unspent; telling the user it expired
    // would send them to burn a fresh one for nothing.
    server.use(http.post(`${env.apiBaseUrl}/auth/verify`, () => Response.error()));
    renderVerify("/verify?token=tok-123");

    expect(
      await screen.findByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/has not been used/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send a new link/i })).not.toBeInTheDocument();
  });

  it("is the re-send form when reached with no token", async () => {
    let posted: unknown;
    server.use(
      http.post(`${env.apiBaseUrl}/auth/verify/request`, async ({ request }) => {
        posted = await request.json();
        return new Response(null, { status: 202 });
      }),
    );
    renderVerify("/verify");

    expect(screen.getByRole("heading", { name: /confirm your email/i })).toBeInTheDocument();
    // The form waits for `/me` to settle before it seeds its default address.
    await userEvent.type(await screen.findByLabelText(/email/i), "alice@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send a new link/i }));

    expect(await screen.findByText(/a new link is on its way/i)).toBeInTheDocument();
    expect(posted).toEqual({ email: "alice@example.com" });
  });

  it("prefills the re-send address for a signed-in user", async () => {
    server.use(meHandler({ email: "signedin@example.com", email_verified: false }));
    renderVerify("/verify");

    expect(await screen.findByDisplayValue("signedin@example.com")).toBeInTheDocument();
  });
});
