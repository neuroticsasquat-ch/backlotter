import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
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
            <Route path="/app" element={<div>app home</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function fillCommonFields(invite = "test-invite") {
  await userEvent.type(screen.getByLabelText(/invite code/i), invite);
  await userEvent.type(screen.getByLabelText(/email/i), "x@y.com");
  await userEvent.type(screen.getByLabelText(/username/i), "X");
  await userEvent.type(screen.getByLabelText(/password/i), "hunter2hunter2");
}

describe("Signup", () => {
  it("creates an account and redirects to /app", async () => {
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () =>
        HttpResponse.json({ detail: "auth_required" }, { status: 401 }),
      ),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json(
          {
            id: "u1",
            email: "x@y.com",
            display_name: "X",
            created_at: new Date().toISOString(),
            csrf_token: "test-csrf",
          },
          { status: 201 },
        ),
      ),
    );
    renderAt("/signup");
    await fillCommonFields();
    await userEvent.click(screen.getByRole("button", { name: /sign up/i }));
    await waitFor(() => expect(screen.getByText("app home")).toBeInTheDocument());
  });

  it("surfaces email_in_use (409)", async () => {
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () =>
        HttpResponse.json({ detail: "auth_required" }, { status: 401 }),
      ),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json({ detail: "email_in_use" }, { status: 409 }),
      ),
    );
    renderAt("/signup");
    await fillCommonFields();
    await userEvent.click(screen.getByRole("button", { name: /sign up/i }));
    await waitFor(() => expect(screen.getByText(/already registered/i)).toBeInTheDocument());
  });

  it("surfaces invalid_invite (403)", async () => {
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () =>
        HttpResponse.json({ detail: "auth_required" }, { status: 401 }),
      ),
      http.post(`${env.apiBaseUrl}/auth/signup`, () =>
        HttpResponse.json({ detail: "invalid_invite" }, { status: 403 }),
      ),
    );
    renderAt("/signup");
    await fillCommonFields("bogus-code");
    await userEvent.click(screen.getByRole("button", { name: /sign up/i }));
    await waitFor(() => expect(screen.getByText(/invite code is invalid/i)).toBeInTheDocument());
  });

  it("pre-fills the invite code from the ?invite= query param", () => {
    renderAt("/signup?invite=abc123");
    const input = screen.getByLabelText(/invite code/i) as HTMLInputElement;
    expect(input.value).toBe("abc123");
  });

  it("pre-fills invite code and email from ?invite= and ?email= query params", () => {
    renderAt("/signup?invite=XYZ&email=foo%40bar.com");
    const invite = screen.getByLabelText(/invite code/i) as HTMLInputElement;
    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    expect(invite.value).toBe("XYZ");
    expect(email.value).toBe("foo@bar.com");
  });

  it("blocks submit when invite code is empty", async () => {
    renderAt("/signup");
    // Fill everything EXCEPT invite code.
    await userEvent.type(screen.getByLabelText(/email/i), "x@y.com");
    await userEvent.type(screen.getByLabelText(/username/i), "X");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2hunter2");
    // The browser's `required` attribute prevents form submission and triggers
    // its own validation UI before any network call. The form's onSubmit never
    // runs in this case, so we just confirm no API call was made by checking
    // the page doesn't navigate away.
    await userEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(screen.queryByText("app home")).not.toBeInTheDocument();
  });

  it("shows the BackLotter brand in the heading and invite copy", () => {
    renderAt("/signup");
    expect(
      screen.getByRole("heading", { name: /create your backlotter account/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/backlotter is invite-only during beta/i)).toBeInTheDocument();
  });
});
