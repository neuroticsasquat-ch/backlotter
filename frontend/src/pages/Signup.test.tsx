import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { installFakeTurnstile, TEST_TURNSTILE_TOKEN, type FakeTurnstile } from "@/test/turnstile";
import { env } from "@/env";
import { AuthProvider } from "@/components/AuthContext";
import { Signup } from "./Signup";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/signup" element={<Signup />} />
            <Route path="/" element={<div>home feed</div>} />
            <Route path="/welcome" element={<div>onboarding</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const loggedOut = () =>
  http.get(`${env.apiBaseUrl}/me`, () =>
    HttpResponse.json({ detail: "auth_required" }, { status: 401 }),
  );

const createdUser = () =>
  HttpResponse.json(
    {
      id: "u1",
      email: "x@y.com",
      display_name: "X",
      created_at: new Date().toISOString(),
      csrf_token: "test-csrf",
    },
    { status: 201 },
  );

/** Everything the form needs bar the invite code, which is optional since NEU-1345. */
async function fillCommonFields() {
  await userEvent.type(screen.getByLabelText(/email/i), "x@y.com");
  await userEvent.type(screen.getByLabelText(/username/i), "X");
  await userEvent.type(screen.getByLabelText(/password/i), "hunter2hunter2");
}

const submit = () => userEvent.click(screen.getByRole("button", { name: /sign up/i }));

describe("Signup", () => {
  let turnstile: FakeTurnstile;

  beforeEach(() => {
    turnstile = installFakeTurnstile();
  });
  afterEach(() => turnstile.uninstall());

  it("creates an account without an invite code and lands on onboarding (D-17)", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loggedOut(),
      http.post(`${env.apiBaseUrl}/auth/signup`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return createdUser();
      }),
    );
    renderAt("/signup");
    await fillCommonFields();
    await submit();
    await waitFor(() => expect(screen.getByText("onboarding")).toBeInTheDocument());
    expect(body).toMatchObject({
      email: "x@y.com",
      display_name: "X",
      turnstile_token: TEST_TURNSTILE_TOKEN,
    });
    // Omitted entirely rather than sent empty — the backend validates any code it is given.
    expect(body).not.toHaveProperty("invite_code");
  });

  it("sends an invite code when the user opens the field and enters one", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      loggedOut(),
      http.post(`${env.apiBaseUrl}/auth/signup`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return createdUser();
      }),
    );
    renderAt("/signup");
    await fillCommonFields();
    await userEvent.click(screen.getByRole("button", { name: /have an invite code/i }));
    await userEvent.type(screen.getByLabelText(/invite code/i), "comp-code");
    await submit();
    await waitFor(() => expect(screen.getByText("onboarding")).toBeInTheDocument());
    expect(body).toMatchObject({ invite_code: "comp-code" });
  });

  it("keeps the invite field collapsed until asked for", async () => {
    renderAt("/signup");
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    expect(screen.queryByLabelText(/invite code/i)).not.toBeInTheDocument();
    const disclosure = screen.getByRole("button", { name: /have an invite code/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(disclosure);
    expect(screen.getByLabelText(/invite code/i)).toBeInTheDocument();
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
  });

  it("opens and pre-fills the invite field from ?invite=", async () => {
    renderAt("/signup?invite=abc123");
    const input = await screen.findByLabelText(/invite code/i);
    expect(input).toHaveValue("abc123");
  });

  it("pre-fills email from ?email= as well", async () => {
    renderAt("/signup?invite=XYZ&email=foo%40bar.com");
    expect(await screen.findByLabelText(/invite code/i)).toHaveValue("XYZ");
    expect(screen.getByLabelText(/email/i)).toHaveValue("foo@bar.com");
  });

  it("refuses to submit before the bot check is solved", async () => {
    turnstile.uninstall();
    turnstile = installFakeTurnstile({ autoSolve: false });
    server.use(loggedOut());
    renderAt("/signup");
    await fillCommonFields();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/not a robot/i);
    expect(screen.queryByText("onboarding")).not.toBeInTheDocument();
  });

  it("surfaces a refused bot check (403 invalid_turnstile) and raises a fresh challenge", async () => {
    server.use(
      loggedOut(),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json({ detail: "invalid_turnstile" }, { status: 403 }),
      ),
    );
    renderAt("/signup");
    await fillCommonFields();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/bot check didn't go through/i);
    // The token was spent by siteverify, so a retry needs a new widget, not the old token.
    await waitFor(() => expect(turnstile.renderCount()).toBe(2));
  });

  it("surfaces a bad invite (403 invalid_invite) distinctly from a bad bot check", async () => {
    server.use(
      loggedOut(),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json({ detail: "invalid_invite" }, { status: 403 }),
      ),
    );
    renderAt("/signup");
    await fillCommonFields();
    await userEvent.click(screen.getByRole("button", { name: /have an invite code/i }));
    await userEvent.type(screen.getByLabelText(/invite code/i), "bogus");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/invite code is invalid/i);
  });

  it("surfaces email_in_use (409)", async () => {
    server.use(
      loggedOut(),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json({ detail: "email_in_use" }, { status: 409 }),
      ),
    );
    renderAt("/signup");
    await fillCommonFields();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/already registered/i);
  });

  it("turns a 429 into a wait in minutes", async () => {
    server.use(
      loggedOut(),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json(
          { detail: "rate_limited", bucket: "signup", retry_after: 90 },
          { status: 429, headers: { "Retry-After": "90" } },
        ),
      ),
    );
    renderAt("/signup");
    await fillCommonFields();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /too many signup attempts.*try again in 2 minutes/i,
    );
  });

  it("turns a 429 under a minute into a wait in seconds", async () => {
    server.use(
      loggedOut(),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json(
          { detail: "rate_limited", bucket: "signup", retry_after: 30 },
          { status: 429, headers: { "Retry-After": "30" } },
        ),
      ),
    );
    renderAt("/signup");
    await fillCommonFields();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again in 30 seconds/i);
  });

  it("tells the user to retry when Turnstile itself is down (503)", async () => {
    server.use(
      loggedOut(),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json({ detail: "turnstile_unavailable" }, { status: 503 }),
      ),
    );
    renderAt("/signup");
    await fillCommonFields();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/briefly unavailable/i);
  });

  it("keeps saying the bot check couldn't load when submit is attempted anyway", async () => {
    turnstile.uninstall();
    turnstile = installFakeTurnstile({ autoSolve: false });
    server.use(loggedOut());
    renderAt("/signup");
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    turnstile.fail();
    await fillCommonFields();
    await submit();
    // Not downgraded to "complete the check below", which would point at a widget the user
    // has no way to complete.
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load/i);
  });

  it("asks for an invite instead of blaming one when signup is closed (403, none entered)", async () => {
    server.use(
      loggedOut(),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json({ detail: "invalid_invite" }, { status: 403 }),
      ),
    );
    renderAt("/signup");
    await fillCommonFields();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/invite-only right now/i);
    // And the field is opened so there is somewhere to put the code being asked for.
    expect(screen.getByLabelText(/invite code/i)).toBeInTheDocument();
  });

  it("explains a bot check that cannot load at all", async () => {
    turnstile.uninstall();
    turnstile = installFakeTurnstile({ autoSolve: false });
    server.use(loggedOut());
    renderAt("/signup");
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    turnstile.fail();
    expect(await screen.findByRole("alert")).toHaveTextContent(/bot check couldn't load/i);
  });

  it("shows the backlotter brand in the heading and no longer claims invite-only", async () => {
    renderAt("/signup");
    expect(
      screen.getByRole("heading", { name: /create your backlotter account/i }),
    ).toBeInTheDocument();
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    expect(screen.queryByText(/invite-only/i)).not.toBeInTheDocument();
  });
});
