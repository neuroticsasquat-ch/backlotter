import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { toast } from "sonner";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { digestPreviewHandler, digestTestSendHandler } from "@/test/msw/admin-digest";
import { env } from "@/env";
import type { AdminUser } from "@/api/types";
import { AuthProvider } from "@/components/AuthContext";
import RequireAdmin from "@/components/RequireAdmin";
import { AdminDigest } from "./AdminDigest";

const base = env.apiBaseUrl;
const ALICE_ID = "7f1c3a52-9d1e-4a4b-8e0f-2b6c1d9e4a10";

// 23:30 UTC, so a date field defaulting to the local day rather than the UTC one would show.
const NOW = new Date("2026-09-24T23:30:00Z");

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: ALICE_ID,
    email: "alice@example.com",
    is_admin: false,
    email_verified_at: null,
    entitled_until: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function usersHandler(items: AdminUser[], queries: string[] = []) {
  return http.get(`${base}/admin/users`, ({ request }) => {
    queries.push(new URL(request.url).searchParams.get("q") ?? "");
    return HttpResponse.json({ items, total: items.length, limit: 10, offset: 0 });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminDigest />
    </QueryClientProvider>,
  );
}

async function pickAlice() {
  await userEvent.type(screen.getByLabelText("Account"), "alice");
  await userEvent.click(await screen.findByRole("button", { name: "alice@example.com" }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AdminDigest", () => {
  it("defaults the date to today in UTC and waits for an account before previewing", async () => {
    const requests: URLSearchParams[] = [];
    server.use(digestPreviewHandler({ html: "<p>mail</p>", text: "mail" }, requests));
    renderPage();

    expect(screen.getByLabelText("Date (UTC)")).toHaveValue("2026-09-24");
    expect(screen.getByText("Pick an account to preview their digest.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to me" })).toBeDisabled();
    expect(requests).toHaveLength(0);
  });

  it("finds an account by email and renders its HTML digest in a frame", async () => {
    const queries: string[] = [];
    const requests: URLSearchParams[] = [];
    server.use(
      usersHandler([makeUser()], queries),
      digestPreviewHandler({ html: "<h1>Your week</h1>", text: "Your week" }, requests),
    );
    renderPage();

    await pickAlice();

    const frame = await screen.findByTitle("Digest preview");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("srcdoc", "<h1>Your week</h1>");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(queries).toContain("alice");
    expect(Object.fromEntries(requests.at(-1)!)).toEqual({
      user_id: ALICE_ID,
      cadence: "daily",
      format: "html",
      today: "2026-09-24",
    });
  });

  it("takes a pasted id as-is without searching addresses for it", async () => {
    const queries: string[] = [];
    const requests: URLSearchParams[] = [];
    server.use(
      usersHandler([], queries),
      digestPreviewHandler({ html: "<p>mail</p>", text: "mail" }, requests),
    );
    renderPage();

    await userEvent.type(screen.getByLabelText("Account"), ALICE_ID);

    expect(await screen.findByTitle("Digest preview")).toHaveAttribute("srcdoc", "<p>mail</p>");
    expect(requests.at(-1)!.get("user_id")).toBe(ALICE_ID);
    expect(queries).not.toContain(ALICE_ID);
  });

  it("toggles between the HTML frame and the plain-text part", async () => {
    server.use(
      usersHandler([makeUser()]),
      digestPreviewHandler({ html: "<h1>Your week</h1>", text: "Your week\n* Dune" }),
    );
    renderPage();
    await pickAlice();
    await screen.findByTitle("Digest preview");

    await userEvent.click(screen.getByRole("button", { name: "Text" }));

    const pre = await screen.findByLabelText("Digest preview");
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveTextContent("Your week * Dune");
    expect(screen.queryByTitle("Digest preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "HTML" }));
    expect(await screen.findByTitle("Digest preview")).toHaveAttribute(
      "srcdoc",
      "<h1>Your week</h1>",
    );
  });

  it("re-renders on a new cadence and date", async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      usersHandler([makeUser()]),
      digestPreviewHandler({ html: "<p>mail</p>", text: "mail" }, requests),
    );
    renderPage();
    await pickAlice();
    await screen.findByTitle("Digest preview");

    await userEvent.click(screen.getByLabelText("Weekly"));
    const date = screen.getByLabelText("Date (UTC)");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-10-01");

    await waitFor(() => expect(requests.at(-1)!.get("today")).toBe("2026-10-01"));
    expect(requests.at(-1)!.get("cadence")).toBe("weekly");
  });

  it("shows the empty state as the backend sends it", async () => {
    server.use(
      usersHandler([makeUser()]),
      digestPreviewHandler({ html: "Nothing to send.", text: "Nothing to send." }),
    );
    renderPage();
    await pickAlice();
    await userEvent.click(screen.getByRole("button", { name: "Text" }));

    expect(await screen.findByLabelText("Digest preview")).toHaveTextContent("Nothing to send.");
  });

  it("says so when the id belongs to no account", async () => {
    server.use(
      http.get(`${base}/admin/digest/preview`, () =>
        HttpResponse.json({ detail: "user_not_found" }, { status: 404 }),
      ),
    );
    renderPage();

    await userEvent.type(screen.getByLabelText("Account"), ALICE_ID);

    expect(await screen.findByText("No account with that id.")).toBeInTheDocument();
  });

  it("mails the previewed digest to the admin and toasts the message id", async () => {
    const success = vi.spyOn(toast, "success");
    const bodies: unknown[] = [];
    server.use(
      usersHandler([makeUser()]),
      digestPreviewHandler({ html: "<p>mail</p>", text: "mail" }),
      digestTestSendHandler("msg-42", bodies),
    );
    renderPage();
    await pickAlice();
    await userEvent.click(screen.getByLabelText("Weekly"));

    await userEvent.click(screen.getByRole("button", { name: "Send to me" }));

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("Test digest sent — message id msg-42"),
    );
    expect(bodies).toEqual([{ user_id: ALICE_ID, cadence: "weekly", today: "2026-09-24" }]);
  });

  it("reports an empty digest's 409 as nothing sent", async () => {
    const error = vi.spyOn(toast, "error");
    server.use(
      usersHandler([makeUser()]),
      digestPreviewHandler({ html: "Nothing to send.", text: "Nothing to send." }),
      http.post(`${base}/admin/digest/test`, () =>
        HttpResponse.json({ detail: "nothing_to_send" }, { status: 409 }),
      ),
    );
    renderPage();
    await pickAlice();

    await userEvent.click(screen.getByRole("button", { name: "Send to me" }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Nothing to send — no test mail went out."),
    );
  });

  it("blames the provider for a 502 rather than the page", async () => {
    const error = vi.spyOn(toast, "error");
    server.use(
      usersHandler([makeUser()]),
      digestPreviewHandler({ html: "<p>mail</p>", text: "mail" }),
      http.post(`${base}/admin/digest/test`, () =>
        HttpResponse.json({ detail: "mail_failed" }, { status: 502 }),
      ),
    );
    renderPage();
    await pickAlice();

    await userEvent.click(screen.getByRole("button", { name: "Send to me" }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("The mail provider refused the test send."),
    );
  });
});

describe("/admin/digest access", () => {
  function renderRoute() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Stub = createRoutesStub([
      {
        path: "/admin/digest",
        Component: RequireAdmin,
        children: [{ index: true, Component: AdminDigest }],
      },
      { path: "/", Component: () => <div>home feed</div> },
    ]);
    return render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Stub initialEntries={["/admin/digest"]} />
        </AuthProvider>
      </QueryClientProvider>,
    );
  }

  it("bounces a signed-in non-admin back to the feed", async () => {
    server.use(meHandler({ is_admin: false }));
    renderRoute();
    expect(await screen.findByText("home feed")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Digest" })).not.toBeInTheDocument();
  });

  it("lets an admin through to the digest page", async () => {
    server.use(meHandler({ is_admin: true }));
    renderRoute();
    expect(await screen.findByRole("heading", { name: "Digest" })).toBeInTheDocument();
  });
});
