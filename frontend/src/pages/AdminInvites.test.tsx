import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { invitesHandler, makeInvite } from "@/test/msw/invites";
import { env } from "@/env";
import { AuthProvider } from "@/components/AuthContext";
import RequireAdmin from "@/components/RequireAdmin";
import { AdminInvites } from "./AdminInvites";

const base = env.apiBaseUrl;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminInvites />
    </QueryClientProvider>,
  );
}

function section(name: string) {
  return within(screen.getByRole("region", { name }));
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminInvites", () => {
  it("splits the list into outstanding and used, newest first", async () => {
    server.use(
      invitesHandler([
        makeInvite({ code: "open-new", created_at: "2026-09-19T10:00:00Z" }),
        makeInvite({
          code: "spent-later",
          email_hint: "carol@example.com",
          created_at: "2026-09-18T10:00:00Z",
          consumed_at: "2026-09-18T12:00:00Z",
          consumed_by_user_id: "u9",
          consumed_by_email: "carol@example.com",
        }),
        makeInvite({ code: "open-old", created_at: "2026-09-17T10:00:00Z" }),
        makeInvite({
          code: "spent-earlier",
          created_at: "2026-09-10T10:00:00Z",
          consumed_at: "2026-09-11T12:00:00Z",
          consumed_by_user_id: null,
          consumed_by_email: null,
        }),
      ]),
    );
    renderPage();

    await screen.findByText("open-new");
    const outstanding = section("Outstanding");
    const outstandingCodes = outstanding
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(outstandingCodes).toEqual(["open-new", "open-old"]);

    const used = section("Used");
    const usedCodes = used
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(usedCodes).toEqual(["spent-later", "spent-earlier"]);
  });

  it("renders an unhinted code as for Anyone and a hinted one with its address", async () => {
    server.use(
      invitesHandler([
        makeInvite({ code: "c1", email_hint: null }),
        makeInvite({ code: "c2", email_hint: "alice@example.com" }),
      ]),
    );
    renderPage();

    const row1 = (await screen.findByText("c1")).closest("tr")!;
    expect(within(row1).getByText("Anyone")).toBeInTheDocument();
    const row2 = screen.getByText("c2").closest("tr")!;
    expect(within(row2).getByText("alice@example.com")).toBeInTheDocument();
  });

  it("shows a used row's date and consumer, and no copy control", async () => {
    server.use(
      invitesHandler([
        makeInvite({
          code: "spent",
          consumed_at: "2026-09-18T12:00:00Z",
          consumed_by_user_id: "u9",
          consumed_by_email: "carol@example.com",
        }),
      ]),
    );
    renderPage();

    const row = (await screen.findByText("spent")).closest("tr")!;
    expect(within(row).getByText("Sep 18, 2026")).toBeInTheDocument();
    expect(within(row).getByText("carol@example.com")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /copy link/i })).not.toBeInTheDocument();
  });

  it("renders a used row whose account is gone with a blank By", async () => {
    server.use(
      invitesHandler([
        makeInvite({
          code: "spent",
          consumed_at: "2026-09-18T12:00:00Z",
          consumed_by_user_id: null,
          consumed_by_email: null,
        }),
      ]),
    );
    renderPage();

    const row = (await screen.findByText("spent")).closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("shows both empty states when nothing has been minted", async () => {
    server.use(invitesHandler([]));
    renderPage();
    expect(await screen.findByText("No outstanding invites.")).toBeInTheDocument();
    expect(screen.getByText("No invites have been used yet.")).toBeInTheDocument();
  });

  it("shows an error state when the list request fails", async () => {
    server.use(
      http.get(`${base}/admin/invites`, () =>
        HttpResponse.json({ detail: "admin_required" }, { status: 403 }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/failed to load invites/i)).toBeInTheDocument();
  });

  it("mints an unhinted code and prepends it to Outstanding", async () => {
    let body: unknown = null;
    server.use(
      invitesHandler([makeInvite({ code: "existing" })]),
      http.post(`${base}/admin/invites`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeInvite({ code: "fresh" }), { status: 201 });
      }),
    );
    renderPage();

    await screen.findByText("existing");
    await userEvent.click(screen.getByRole("button", { name: "Mint invite" }));

    await waitFor(() => expect(body).toEqual({}));
    expect(await screen.findByText("fresh")).toBeInTheDocument();
    const codes = section("Outstanding")
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(codes).toEqual(["fresh", "existing"]);
    const freshRow = screen.getByText("fresh").closest("tr")!;
    expect(within(freshRow).getByText("Anyone")).toBeInTheDocument();
  });

  it("mints a hinted code, shows the address, and clears the input", async () => {
    let body: unknown = null;
    server.use(
      invitesHandler([]),
      http.post(`${base}/admin/invites`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeInvite({ code: "hinted", email_hint: "alice@example.com" }), {
          status: 201,
        });
      }),
    );
    renderPage();

    await screen.findByText("No outstanding invites.");
    const input = screen.getByLabelText("Email (optional)");
    await userEvent.type(input, "alice@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Mint invite" }));

    await waitFor(() => expect(body).toEqual({ email_hint: "alice@example.com" }));
    const row = (await screen.findByText("hinted")).closest("tr")!;
    expect(within(row).getByText("alice@example.com")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("keeps the typed address when minting fails", async () => {
    server.use(
      invitesHandler([]),
      http.post(`${base}/admin/invites`, () =>
        HttpResponse.json({ detail: "csrf_invalid" }, { status: 403 }),
      ),
    );
    renderPage();

    await screen.findByText("No outstanding invites.");
    const input = screen.getByLabelText("Email (optional)");
    await userEvent.type(input, "alice@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Mint invite" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Mint invite" })).toBeEnabled());
    expect(input).toHaveValue("alice@example.com");
    expect(screen.getByText("No outstanding invites.")).toBeInTheDocument();
  });

  it("copies the signup link for one row, and only that row reads Copied", async () => {
    server.use(
      invitesHandler([
        makeInvite({ code: "c1", email_hint: null }),
        makeInvite({ code: "c2", email_hint: "alice+films@example.com" }),
      ]),
    );
    renderPage();

    await screen.findByText("c1");
    await userEvent.click(screen.getByRole("button", { name: "Copy link for c2" }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/signup?invite=c2&email=alice%2Bfilms%40example.com`,
    );
    const row2 = screen.getByText("c2").closest("tr")!;
    expect(await within(row2).findByText("Copied.")).toBeInTheDocument();
    const row1 = screen.getByText("c1").closest("tr")!;
    expect(within(row1).queryByText("Copied.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Copy link for c1" }));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/signup?invite=c1`);
    expect(await within(row1).findByText("Copied.")).toBeInTheDocument();
    expect(within(row2).queryByText("Copied.")).not.toBeInTheDocument();
  });

  it("shows the link in a selectable field with an alert when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    server.use(invitesHandler([makeInvite({ code: "c1" })]));
    renderPage();

    await screen.findByText("c1");
    await userEvent.click(screen.getByRole("button", { name: "Copy link for c1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach your clipboard/i);
    expect(screen.getByLabelText("Link for c1")).toHaveValue(
      `${window.location.origin}/signup?invite=c1`,
    );
    expect(screen.queryByText("Copied.")).not.toBeInTheDocument();
  });
});

describe("/admin/invites access", () => {
  function renderRoute() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Stub = createRoutesStub([
      {
        path: "/admin/invites",
        Component: RequireAdmin,
        children: [{ index: true, Component: AdminInvites }],
      },
      { path: "/", Component: () => <div>home feed</div> },
    ]);
    return render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Stub initialEntries={["/admin/invites"]} />
        </AuthProvider>
      </QueryClientProvider>,
    );
  }

  it("bounces a signed-in non-admin back to the feed", async () => {
    server.use(meHandler({ is_admin: false }), invitesHandler([makeInvite({ code: "c1" })]));
    renderRoute();
    expect(await screen.findByText("home feed")).toBeInTheDocument();
    expect(screen.queryByText("c1")).not.toBeInTheDocument();
  });

  it("lets an admin through to the invites page", async () => {
    server.use(meHandler({ is_admin: true }), invitesHandler([makeInvite({ code: "c1" })]));
    renderRoute();
    expect(await screen.findByText("c1")).toBeInTheDocument();
  });
});
