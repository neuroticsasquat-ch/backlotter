import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { env } from "@/env";
import { AuthProvider } from "@/components/AuthContext";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([{ path: "/", Component: VerifyEmailBanner }]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const prompt = /confirm your email address/i;

describe("VerifyEmailBanner", () => {
  beforeEach(() => sessionStorage.clear());

  it("prompts a signed-in user whose address is unconfirmed", async () => {
    server.use(meHandler({ email_verified: false }));
    renderBanner();
    expect(await screen.findByText(prompt)).toBeInTheDocument();
  });

  it("stays out of the way once the address is verified", async () => {
    server.use(meHandler({ email_verified: true }));
    renderBanner();
    // Wait for /me to settle, then assert the banner never appeared.
    await waitFor(() => expect(screen.queryByText(prompt)).not.toBeInTheDocument());
  });

  it("renders nothing for a signed-out visitor", async () => {
    // The default handler answers 401.
    renderBanner();
    await waitFor(() => expect(screen.queryByText(prompt)).not.toBeInTheDocument());
  });

  it("re-sends the confirmation mail to the account address", async () => {
    let posted: unknown;
    server.use(
      meHandler({ email: "unverified@example.com", email_verified: false }),
      http.post(`${env.apiBaseUrl}/auth/verify/request`, async ({ request }) => {
        posted = await request.json();
        return new Response(null, { status: 202 });
      }),
    );
    renderBanner();
    await userEvent.click(await screen.findByRole("button", { name: /resend/i }));

    expect(await screen.findByText(/check unverified@example\.com/i)).toBeInTheDocument();
    expect(posted).toEqual({ email: "unverified@example.com" });
  });

  it("does not claim the mail was sent when the request fails", async () => {
    server.use(
      meHandler({ email_verified: false }),
      http.post(`${env.apiBaseUrl}/auth/verify/request`, () => Response.error()),
    );
    renderBanner();
    await userEvent.click(await screen.findByRole("button", { name: /resend/i }));

    expect(await screen.findByText(/couldn't send just now/i)).toBeInTheDocument();
    expect(screen.queryByText(/^sent —/i)).not.toBeInTheDocument();
    // Still offering the retry the message tells them to make.
    expect(screen.getByRole("button", { name: /resend/i })).toBeInTheDocument();
  });

  it("stays dismissed for the rest of the session", async () => {
    server.use(meHandler({ email_verified: false }));
    const first = renderBanner();
    await userEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(prompt)).not.toBeInTheDocument();

    // A fresh mount stands in for navigating to another authed page in the same visit.
    first.unmount();
    renderBanner();
    await waitFor(() => expect(screen.queryByText(prompt)).not.toBeInTheDocument());
  });

  it("comes back in a new session", async () => {
    server.use(meHandler({ email_verified: false }));
    const first = renderBanner();
    await userEvent.click(await screen.findByRole("button", { name: /dismiss/i }));

    first.unmount();
    sessionStorage.clear(); // what closing the tab and returning does
    renderBanner();
    expect(await screen.findByText(prompt)).toBeInTheDocument();
  });
});
