import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { env } from "@/env";
import { activeImportKey } from "@/api/query-keys";
import { readTimelineHint, writeTimelineHint } from "@/lib/timeline-hint";
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

function LogoutButton() {
  const { logout } = useAuth();
  return <button onClick={() => logout()}>logout</button>;
}

function renderWithProviders(
  node: React.ReactNode,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
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

  // Otherwise the next reader on this tab has the last one's review list restored on `/welcome`
  // and announced on the timeline (NEU-1452).
  it("drops the open import on logout", async () => {
    server.use(
      meHandler({ entitled: true }),
      http.post(`${env.apiBaseUrl}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(activeImportKey, { id: "job" });
    renderWithProviders(<LogoutButton />, qc);

    await userEvent.click(await screen.findByRole("button", { name: "logout" }));

    await waitFor(() => expect(qc.getQueryState(activeImportKey)).toBeUndefined());
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

/** The timeline hint is written only where `["me"]` is written from a resolved account
 *  (NEU-1468, D-1468.2), so it can never run ahead of what the API said. */
describe("AuthContext — the timeline hint", () => {
  const hinted = () => readTimelineHint(document.cookie);

  it("writes the hint when /me answers entitled", async () => {
    server.use(meHandler({ entitled: true }));
    renderWithProviders(<ProbeEntitled />);
    await screen.findByText("entitled: true");
    expect(hinted()).toBe(true);
  });

  it("clears the hint when /me answers unentitled", async () => {
    writeTimelineHint({ ...AUTHED_USER, entitled: true });
    server.use(meHandler({ entitled: false }));
    renderWithProviders(<ProbeEntitled />);
    await screen.findByText("entitled: false");
    expect(hinted()).toBe(false);
  });

  it("clears the hint when /me answers 401", async () => {
    writeTimelineHint({ ...AUTHED_USER, entitled: true });
    server.use(unauthMeHandler());
    renderWithProviders(<ProbeUser />);
    await screen.findByText("anon");
    expect(hinted()).toBe(false);
  });

  it("leaves the hint alone when /me fails for any other reason", async () => {
    // An errored read proves nothing either way; clearing on a 500 would flash the global feed
    // at a subscriber on their next load for no reason of theirs.
    writeTimelineHint({ ...AUTHED_USER, entitled: true });
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    );
    function ProbeError() {
      const { loading, resolving } = useAuth();
      return <div>{loading || resolving ? "pending" : "settled"}</div>;
    }
    renderWithProviders(<ProbeError />);
    await screen.findByText("settled");
    expect(hinted()).toBe(true);
  });

  it("clears the hint on logout", async () => {
    server.use(
      meHandler({ entitled: true }),
      http.post(`${env.apiBaseUrl}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    );
    renderWithProviders(
      <>
        <ProbeEntitled />
        <LogoutButton />
      </>,
    );
    await screen.findByText("entitled: true");
    expect(hinted()).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "logout" }));

    await waitFor(() => expect(hinted()).toBe(false));
  });

  it("writes the hint for an entitled login before login() resolves", async () => {
    // `/login` navigates to `/` as soon as this resolves, and the public layout's loader for that
    // navigation must already see the cookie, or the landing flashes the global feed.
    server.use(http.post(`${env.apiBaseUrl}/auth/login`, () => HttpResponse.json(AUTHED_USER)));
    let hintAtResolve: boolean | undefined;
    function LoginAndRecord() {
      const { login } = useAuth();
      return (
        <button
          onClick={async () => {
            await login("alice@example.com", "password123");
            hintAtResolve = hinted();
          }}
        >
          login
        </button>
      );
    }
    renderWithProviders(<LoginAndRecord />);

    await userEvent.click(await screen.findByRole("button", { name: "login" }));

    await waitFor(() => expect(hintAtResolve).toBe(true));
  });

  it("clears the hint for a login that is not entitled", async () => {
    writeTimelineHint({ ...AUTHED_USER, entitled: true });
    server.use(
      http.post(`${env.apiBaseUrl}/auth/login`, () =>
        HttpResponse.json({ ...AUTHED_USER, entitled: false }),
      ),
    );
    renderWithProviders(
      <>
        <ProbeEntitled />
        <LoginButton />
      </>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "login" }));

    await screen.findByText("entitled: false");
    expect(hinted()).toBe(false);
  });
});
