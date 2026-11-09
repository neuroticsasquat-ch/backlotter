import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { AuthProvider } from "@/components/AuthContext";
import { Login } from "./Login";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<div>home feed</div>} />
            <Route path="/welcome" element={<div>onboarding</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Login", () => {
  it("logs in and redirects to the home feed", async () => {
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () =>
        HttpResponse.json({ detail: "auth_required" }, { status: 401 }),
      ),
      http.post(`${env.apiBaseUrl}/auth/login`, () =>
        HttpResponse.json({
          id: "u1",
          email: "a@b.com",
          display_name: "A",
          created_at: new Date().toISOString(),
          csrf_token: "test-csrf",
        }),
      ),
    );
    renderAt("/login");
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2hunter2");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));
    await waitFor(() => expect(screen.getByText("home feed")).toBeInTheDocument());
  });

  it("honours the ?next= redirect parameter", async () => {
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () =>
        HttpResponse.json({ detail: "auth_required" }, { status: 401 }),
      ),
      http.post(`${env.apiBaseUrl}/auth/login`, () =>
        HttpResponse.json({
          id: "u1",
          email: "a@b.com",
          display_name: "A",
          created_at: new Date().toISOString(),
          csrf_token: "test-csrf",
        }),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login?next=%2F"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<div>home page</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2hunter2");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));
    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
  });

  it("shows an error message on invalid credentials", async () => {
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () =>
        HttpResponse.json({ detail: "auth_required" }, { status: 401 }),
      ),
      http.post(`${env.apiBaseUrl}/auth/login`, () =>
        HttpResponse.json({ detail: "invalid_credentials" }, { status: 401 }),
      ),
    );
    renderAt("/login");
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));
    await waitFor(() => expect(screen.getByText(/incorrect/i)).toBeInTheDocument());
  });

  it("shows the backlotter brand in the heading", () => {
    renderAt("/login");
    expect(screen.getByRole("heading", { name: /log in to backlotter/i })).toBeInTheDocument();
  });
});

/** A `/auth/login` that answers with a whole account, so a test can say what `entitled` is —
 *  the older cases above post a minimal payload and get `undefined`, which is the unentitled
 *  path and is what they mean. */
const loginAs = (opts: { entitled: boolean }) =>
  http.post(`${env.apiBaseUrl}/auth/login`, () =>
    HttpResponse.json({
      id: "u1",
      email: "a@b.com",
      display_name: "A",
      is_admin: false,
      email_verified: true,
      entitled: opts.entitled,
      created_at: new Date().toISOString(),
      csrf_token: "test-csrf",
    }),
  );

const loggedOutMe = () =>
  http.get(`${env.apiBaseUrl}/me`, () =>
    HttpResponse.json({ detail: "auth_required" }, { status: 401 }),
  );

const signIn = async () => {
  await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
  await userEvent.type(screen.getByLabelText(/password/i), "hunter2hunter2");
  await userEvent.click(screen.getByRole("button", { name: /log in/i }));
};

describe("Login landing (NEU-1358)", () => {
  it("sends a granted account with an empty follow graph to onboarding", async () => {
    server.use(
      loggedOutMe(),
      loginAs({ entitled: true }),
      http.get(`${env.apiBaseUrl}/me/follows`, () => HttpResponse.json({ items: [] })),
    );
    renderAt("/login");
    await signIn();

    await waitFor(() => expect(screen.getByText("onboarding")).toBeInTheDocument());
  });

  it("leaves an account that already follows something on the timeline", async () => {
    server.use(
      loggedOutMe(),
      loginAs({ entitled: true }),
      http.get(`${env.apiBaseUrl}/me/follows`, () =>
        HttpResponse.json({
          items: [
            {
              entity_type: "person",
              entity_id: "525",
              source: "manual",
              created_at: "2026-09-01T00:00:00Z",
            },
          ],
        }),
      ),
    );
    renderAt("/login");
    await signIn();

    await waitFor(() => expect(screen.getByText("home feed")).toBeInTheDocument());
  });

  it("does not send an ungranted account to a page that would only lock it (D-41)", async () => {
    // No `/me/follows` handler at all: an unentitled account must not ask for it, and MSW is
    // configured to error on an unhandled request, so this failing would fail the test.
    server.use(loggedOutMe(), loginAs({ entitled: false }));
    renderAt("/login");
    await signIn();

    await waitFor(() => expect(screen.getByText("home feed")).toBeInTheDocument());
  });

  it("keeps an explicit ?next= ahead of the onboarding landing", async () => {
    server.use(
      loggedOutMe(),
      loginAs({ entitled: true }),
      http.get(`${env.apiBaseUrl}/me/follows`, () => HttpResponse.json({ items: [] })),
    );
    renderAt("/login?next=%2F");
    await signIn();

    await waitFor(() => expect(screen.getByText("home feed")).toBeInTheDocument());
  });

  it("falls back to the timeline when the follows read fails", async () => {
    server.use(
      loggedOutMe(),
      loginAs({ entitled: true }),
      http.get(`${env.apiBaseUrl}/me/follows`, () =>
        HttpResponse.json({ detail: "entitlement_required" }, { status: 403 }),
      ),
    );
    renderAt("/login");
    await signIn();

    await waitFor(() => expect(screen.getByText("home feed")).toBeInTheDocument());
  });
});
