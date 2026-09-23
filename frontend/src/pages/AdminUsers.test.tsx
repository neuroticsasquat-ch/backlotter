import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { env } from "@/env";
import type { AdminUser } from "@/api/types";
import { AuthProvider } from "@/components/AuthContext";
import RequireAdmin from "@/components/RequireAdmin";
import { AdminUsers } from "./AdminUsers";

const base = env.apiBaseUrl;

// Frozen so "one year out" and the active/expired split are deterministic rather than
// relative to whenever the suite happens to run.
const NOW = new Date("2026-09-17T12:00:00Z");

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "u1",
    email: "alice@example.com",
    is_admin: false,
    email_verified_at: "2026-01-02T00:00:00Z",
    entitled_until: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function page(items: AdminUser[], overrides: { total?: number; offset?: number } = {}) {
  return {
    items,
    total: overrides.total ?? items.length,
    limit: 50,
    offset: overrides.offset ?? 0,
  };
}

function listHandler(items: AdminUser[], overrides: { total?: number } = {}) {
  return http.get(`${base}/admin/users`, () => HttpResponse.json(page(items, overrides)));
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminUsers />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AdminUsers", () => {
  it("renders a row per account with signup, verification and admin columns", async () => {
    server.use(
      listHandler([
        makeUser({ id: "u1", email: "alice@example.com" }),
        makeUser({ id: "u2", email: "bob@example.com", is_admin: true }),
      ]),
    );
    renderPage();

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    const bobRow = screen.getByText("bob@example.com").closest("tr")!;
    expect(within(bobRow).getByText("Admin")).toBeInTheDocument();
    expect(within(bobRow).getByText("Jan 1, 2026")).toBeInTheDocument();
  });

  it("marks an account with no verification timestamp as unverified", async () => {
    server.use(listHandler([makeUser({ email_verified_at: null })]));
    renderPage();
    expect(await screen.findByText("Unverified")).toBeInTheDocument();
  });

  it("renders an ungranted account as having no access", async () => {
    server.use(listHandler([makeUser({ entitled_until: null })]));
    renderPage();
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });

  it("renders a live grant with its expiry date", async () => {
    server.use(listHandler([makeUser({ entitled_until: "2027-03-01T00:00:00Z" })]));
    renderPage();
    expect(await screen.findByText(/Until\s+Mar 1, 2027/)).toBeInTheDocument();
  });

  it("renders a lapsed grant as expired rather than dropping the row", async () => {
    server.use(
      listHandler([
        makeUser({ id: "u1", email: "lapsed@example.com", entitled_until: "2026-08-01T00:00:00Z" }),
      ]),
    );
    renderPage();

    // The row survives, and reads as expired — distinguishable from never-granted, which is
    // the difference between extending a grant and making one.
    expect(await screen.findByText("lapsed@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Expired\s+Aug 1, 2026/)).toBeInTheDocument();
    expect(screen.queryByText("No access")).not.toBeInTheDocument();
  });

  it("defaults the date picker to one year out", async () => {
    server.use(listHandler([makeUser()]));
    renderPage();
    expect(await screen.findByLabelText("Access until for alice@example.com")).toHaveValue(
      "2027-09-17",
    );
  });

  it("labels the action Grant for an account without a live grant", async () => {
    server.use(listHandler([makeUser({ entitled_until: null })]));
    renderPage();
    expect(
      await screen.findByRole("button", { name: "Grant access for alice@example.com" }),
    ).toBeInTheDocument();
  });

  it("labels the action Extend for an account whose grant is still live", async () => {
    server.use(listHandler([makeUser({ entitled_until: "2027-03-01T00:00:00Z" })]));
    renderPage();
    expect(
      await screen.findByRole("button", { name: "Extend access for alice@example.com" }),
    ).toBeInTheDocument();
  });

  it("labels a lapsed account's action Grant, not Extend", async () => {
    server.use(listHandler([makeUser({ entitled_until: "2026-08-01T00:00:00Z" })]));
    renderPage();
    expect(
      await screen.findByRole("button", { name: "Grant access for alice@example.com" }),
    ).toBeInTheDocument();
  });

  it("PUTs the picked date as an end-of-day UTC instant and re-renders the granted row", async () => {
    let body: unknown = null;
    server.use(
      listHandler([makeUser({ id: "u1", entitled_until: null })]),
      http.put(`${base}/admin/users/u1/entitlement`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeUser({ id: "u1", entitled_until: "2027-09-17T00:00:00Z" }));
      }),
    );
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Grant access for alice@example.com" }),
    );

    await waitFor(() => expect(body).toEqual({ entitled_until: "2027-09-17T23:59:59Z" }));
    // The mutation's reply is written back into the cached page, so the row updates without
    // a refetch — and the action becomes Extend now that the grant is live.
    expect(await screen.findByText(/Until\s+Sep 17, 2027/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Extend access for alice@example.com" }),
    ).toBeInTheDocument();
  });

  it("sends the edited date rather than the default when the admin picks one", async () => {
    let body: unknown = null;
    server.use(
      listHandler([makeUser({ id: "u1" })]),
      http.put(`${base}/admin/users/u1/entitlement`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeUser({ id: "u1", entitled_until: "2026-12-25T00:00:00Z" }));
      }),
    );
    renderPage();

    const picker = await screen.findByLabelText("Access until for alice@example.com");
    await userEvent.clear(picker);
    await userEvent.type(picker, "2026-12-25");
    await userEvent.click(
      screen.getByRole("button", { name: "Grant access for alice@example.com" }),
    );

    await waitFor(() => expect(body).toEqual({ entitled_until: "2026-12-25T23:59:59Z" }));
  });

  it("offers no Revoke control for an account that has never been granted", async () => {
    server.use(listHandler([makeUser({ entitled_until: null })]));
    renderPage();
    await screen.findByText("alice@example.com");
    expect(
      screen.queryByRole("button", { name: "Revoke access for alice@example.com" }),
    ).not.toBeInTheDocument();
  });

  it("revokes only after the confirm is accepted", async () => {
    let revoked = false;
    server.use(
      listHandler([makeUser({ id: "u1", entitled_until: "2027-03-01T00:00:00Z" })]),
      http.delete(`${base}/admin/users/u1/entitlement`, () => {
        revoked = true;
        return HttpResponse.json(makeUser({ id: "u1", entitled_until: null }));
      }),
    );
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Revoke access for alice@example.com" }),
    );
    // The dialog is open; nothing has been sent yet.
    expect(revoked).toBe(false);

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(revoked).toBe(true));
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });

  it("does not revoke when the confirm is cancelled", async () => {
    let revoked = false;
    server.use(
      listHandler([makeUser({ id: "u1", entitled_until: "2027-03-01T00:00:00Z" })]),
      http.delete(`${base}/admin/users/u1/entitlement`, () => {
        revoked = true;
        return HttpResponse.json(makeUser({ id: "u1", entitled_until: null }));
      }),
    );
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Revoke access for alice@example.com" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(revoked).toBe(false);
    expect(screen.getByText(/Until\s+Mar 1, 2027/)).toBeInTheDocument();
  });

  it("passes the search box through to the backend as ?q=", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${base}/admin/users`, ({ request }) => {
        const q = new URL(request.url).searchParams.get("q");
        seen.push(q);
        return HttpResponse.json(
          page(q ? [makeUser({ id: "u2", email: "bob@example.com" })] : [makeUser()]),
        );
      }),
    );
    renderPage();

    await screen.findByText("alice@example.com");
    await userEvent.type(screen.getByLabelText("Search accounts"), "bob");

    // Debounced: the filter is one request at the end of a pause, not one per keystroke.
    expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
    expect(seen).toEqual([null, "bob"]);
  });

  it("shows a search-specific empty state when nothing matches", async () => {
    server.use(
      http.get(`${base}/admin/users`, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("q") ? page([]) : page([makeUser()]),
        ),
      ),
    );
    renderPage();

    await screen.findByText("alice@example.com");
    await userEvent.type(screen.getByLabelText("Search accounts"), "zzz");
    expect(await screen.findByText(/no accounts match your search/i)).toBeInTheDocument();
  });

  it("shows the plain empty state when there are no accounts at all", async () => {
    server.use(listHandler([]));
    renderPage();
    expect(await screen.findByText(/no accounts yet/i)).toBeInTheDocument();
  });

  it("shows an error state when the list request fails", async () => {
    server.use(
      http.get(`${base}/admin/users`, () =>
        HttpResponse.json({ detail: "admin_required" }, { status: 403 }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/failed to load accounts/i)).toBeInTheDocument();
  });

  it("pages forward with an offset and reports the window", async () => {
    const offsets: (string | null)[] = [];
    server.use(
      http.get(`${base}/admin/users`, ({ request }) => {
        const offset = new URL(request.url).searchParams.get("offset");
        offsets.push(offset);
        return HttpResponse.json(
          page([makeUser({ id: `u-${offset}`, email: `user-${offset}@example.com` })], {
            total: 60,
          }),
        );
      }),
    );
    renderPage();

    await screen.findByText("user-0@example.com");
    expect(screen.getByText("1–1 of 60")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("user-50@example.com")).toBeInTheDocument();
    expect(offsets).toEqual(["0", "50"]);
  });
});

describe("/admin/users access", () => {
  function renderRoute() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Stub = createRoutesStub([
      {
        path: "/admin/users",
        Component: RequireAdmin,
        children: [{ index: true, Component: AdminUsers }],
      },
      { path: "/", Component: () => <div>home feed</div> },
    ]);
    return render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Stub initialEntries={["/admin/users"]} />
        </AuthProvider>
      </QueryClientProvider>,
    );
  }

  it("bounces a signed-in non-admin back to the feed", async () => {
    server.use(meHandler({ is_admin: false }), listHandler([makeUser()]));
    renderRoute();
    expect(await screen.findByText("home feed")).toBeInTheDocument();
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
  });

  it("lets an admin through to the grant page", async () => {
    server.use(meHandler({ is_admin: true }), listHandler([makeUser()]));
    renderRoute();
    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
  });
});
