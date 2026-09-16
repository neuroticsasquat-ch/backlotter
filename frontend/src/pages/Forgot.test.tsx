import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { Forgot } from "./Forgot";

function renderForgot() {
  const Stub = createRoutesStub([
    { path: "/forgot", Component: Forgot },
    { path: "/login", Component: () => <div>login page</div> },
  ]);
  return render(<Stub initialEntries={["/forgot"]} />);
}

async function submit(email: string) {
  await userEvent.type(screen.getByLabelText(/email/i), email);
  await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));
}

describe("Forgot", () => {
  it("posts the address and confirms without saying whether the account exists", async () => {
    let body: unknown;
    server.use(
      http.post(`${env.apiBaseUrl}/auth/reset/request`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 202 });
      }),
    );
    renderForgot();
    await submit("alice@example.com");

    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getByText(/if an account exists/i)).toBeInTheDocument();
    expect(body).toEqual({ email: "alice@example.com" });
  });

  it("confirms identically for an address with no account", async () => {
    // The backend answers 202 for an unknown address too; the page must not tell them apart.
    renderForgot();
    await submit("nobody@example.com");
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
  });

  it("reports a transport failure rather than claiming the mail was sent", async () => {
    server.use(http.post(`${env.apiBaseUrl}/auth/reset/request`, () => HttpResponse.error()));
    renderForgot();
    await submit("alice@example.com");

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/if an account exists/i)).not.toBeInTheDocument();
  });

  it("links back to log in", () => {
    renderForgot();
    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute("href", "/login");
  });
});
