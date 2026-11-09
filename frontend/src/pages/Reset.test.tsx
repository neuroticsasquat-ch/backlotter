import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { invalidTokenResponse } from "@/test/msw/handlers";
import { env } from "@/env";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { Reset } from "./Reset";

function renderReset(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/reset", Component: Reset },
    { path: "/login", Component: () => <div>login page</div> },
    { path: "/forgot", Component: () => <div>forgot page</div> },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={[path]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(password: string, confirm = password) {
  await userEvent.type(screen.getByLabelText(/^new password$/i), password);
  await userEvent.type(screen.getByLabelText(/confirm new password/i), confirm);
  await userEvent.click(screen.getByRole("button", { name: /set new password/i }));
}

describe("Reset", () => {
  it("sends the token from the query string with the new password", async () => {
    let body: unknown;
    server.use(
      http.post(`${env.apiBaseUrl}/auth/reset`, async ({ request }) => {
        body = await request.json();
        return new Response(null, { status: 204 });
      }),
    );
    renderReset("/reset?token=tok-123");
    await fillAndSubmit("hunter2hunter2");

    expect(await screen.findByRole("heading", { name: /password updated/i })).toBeInTheDocument();
    expect(body).toEqual({ token: "tok-123", new_password: "hunter2hunter2" });
  });

  it("sends the user to log in, because the reset does not open a session", async () => {
    renderReset("/reset?token=tok-123");
    await fillAndSubmit("hunter2hunter2");

    // The backend drops every session for the account, this browser's included — the copy
    // must not promise the current device survives.
    expect(await screen.findByText(/every device, including this one/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute("href", "/login");
  });

  it("re-reads /me so a signed-in tab does not keep a dead session", async () => {
    let meCalls = 0;
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () => {
        meCalls += 1;
        return HttpResponse.json({ detail: "auth_required" }, { status: 401 });
      }),
    );
    renderReset("/reset?token=tok-123");
    await waitFor(() => expect(meCalls).toBe(1));

    await fillAndSubmit("hunter2hunter2");
    expect(await screen.findByRole("heading", { name: /password updated/i })).toBeInTheDocument();
    await waitFor(() => expect(meCalls).toBeGreaterThan(1));
  });

  it("does not send a password longer than the backend accepts", async () => {
    let posted = false;
    server.use(
      http.post(`${env.apiBaseUrl}/auth/reset`, () => {
        posted = true;
        return new Response(null, { status: 204 });
      }),
    );
    renderReset("/reset?token=tok-123");
    await fillAndSubmit("x".repeat(129));

    expect(posted).toBe(false);
    expect(screen.queryByRole("heading", { name: /password updated/i })).not.toBeInTheDocument();
  });

  it("refuses a link with no token instead of posting an empty one", async () => {
    // The default handler would answer 204 for anything, so a POST here would falsely succeed.
    renderReset("/reset");
    expect(screen.getByRole("heading", { name: /link is incomplete/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ask for a new one/i })).toHaveAttribute(
      "href",
      "/forgot",
    );
  });

  it("does not send a password shorter than the backend would accept", async () => {
    // `minLength` stops the submit natively, so the guard in onSubmit never runs here; what
    // matters either way is that nothing reaches a route that would answer 422.
    let posted = false;
    server.use(
      http.post(`${env.apiBaseUrl}/auth/reset`, () => {
        posted = true;
        return new Response(null, { status: 204 });
      }),
    );
    renderReset("/reset?token=tok-123");
    await fillAndSubmit("short");

    expect(posted).toBe(false);
    expect(screen.queryByRole("heading", { name: /password updated/i })).not.toBeInTheDocument();
  });

  it("rejects mismatched passwords", async () => {
    renderReset("/reset?token=tok-123");
    await fillAndSubmit("hunter2hunter2", "hunter2hunter3");
    expect(await screen.findByText(/don't match/i)).toBeInTheDocument();
  });

  it("explains an expired or spent token and offers a fresh link", async () => {
    server.use(http.post(`${env.apiBaseUrl}/auth/reset`, () => invalidTokenResponse()));
    renderReset("/reset?token=stale");
    await fillAndSubmit("hunter2hunter2");

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new reset link/i })).toHaveAttribute(
      "href",
      "/forgot",
    );
  });
});
