import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import type { SourceDomain } from "@/api/types";
import { AdminSources } from "./AdminSources";

const base = env.apiBaseUrl;

function makeSource(overrides: Partial<SourceDomain> = {}): SourceDomain {
  return {
    domain: "example.com",
    llm_tier: "acceptable",
    llm_reason: "Regional outlet.",
    admin_override: "none",
    updated_at: "2026-07-01T12:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminSources />
    </QueryClientProvider>,
  );
}

describe("AdminSources", () => {
  it("renders a row per domain with the effective-tier badge applied", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "variety.com", llm_tier: "trusted", admin_override: "none" }),
          makeSource({ domain: "mshale.com", llm_tier: "low", admin_override: "block" }),
        ]),
      ),
    );
    renderPage();
    expect(await screen.findByText("variety.com")).toBeInTheDocument();
    expect(screen.getByText("mshale.com")).toBeInTheDocument();
    // mshale: admin-blocked -> effective badge "blocked" (unique to the effective column)
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });

  it("renders 'unjudged' in both tier columns for an unjudged domain", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "new.test", llm_tier: null, admin_override: "none" })]),
      ),
    );
    renderPage();
    await screen.findByText("new.test");
    // selector scoped to span to exclude the "unjudged" option in the tier filter <select>
    expect(screen.getAllByText("unjudged", { selector: "span" })).toHaveLength(2);
  });

  it("exposes the full reason via a title attribute", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "x.test", llm_reason: "Aggregator of wire copy." })]),
      ),
    );
    renderPage();
    const cell = await screen.findByText("Aggregator of wire copy.");
    expect(cell).toHaveAttribute("title", "Aggregator of wire copy.");
  });

  it("shows the current override value in the row's select", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "x.test", admin_override: "trust" })]),
      ),
    );
    renderPage();
    expect(await screen.findByLabelText("Override for x.test")).toHaveValue("trust");
  });

  it("shows an empty state when there are no domains", async () => {
    server.use(http.get(`${base}/admin/sources`, () => HttpResponse.json([])));
    renderPage();
    expect(await screen.findByText(/no source domains yet/i)).toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json({ detail: "admin_required" }, { status: 403 }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/failed to load sources/i)).toBeInTheDocument();
  });

  it("sets an override optimistically and persists it via POST", async () => {
    let body: unknown = null;
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "mshale.com", llm_tier: "low", admin_override: "none" })]),
      ),
      http.post(`${base}/admin/sources/mshale.com/override`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          makeSource({
            domain: "mshale.com",
            llm_tier: "low",
            admin_override: "block",
            updated_at: "2026-07-02T00:00:00Z",
          }),
        );
      }),
    );
    renderPage();
    const select = await screen.findByLabelText("Override for mshale.com");
    await userEvent.selectOptions(select, "block");
    await waitFor(() => expect(select).toHaveValue("block"));
    expect(body).toEqual({ override: "block" });
    // effective tier recomputes to blocked
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });

  it("reverts the override when the POST fails", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "mshale.com", llm_tier: "low", admin_override: "none" })]),
      ),
      http.post(`${base}/admin/sources/mshale.com/override`, () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    );
    renderPage();
    const select = await screen.findByLabelText("Override for mshale.com");
    await userEvent.selectOptions(select, "block");
    // optimistic flip to block, then rollback to none after the error
    await waitFor(() => expect(select).toHaveValue("none"));
  });

  it("filters rows by the domain search box", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "variety.com" }),
          makeSource({ domain: "mshale.com" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("variety.com");
    await userEvent.type(screen.getByLabelText("Search domains"), "msh");
    expect(screen.getByText("mshale.com")).toBeInTheDocument();
    expect(screen.queryByText("variety.com")).not.toBeInTheDocument();
  });

  it("filters rows by tier", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "variety.com", llm_tier: "trusted" }),
          makeSource({ domain: "mshale.com", llm_tier: "low" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("variety.com");
    await userEvent.selectOptions(screen.getByLabelText("Filter by tier"), "low");
    expect(screen.getByText("mshale.com")).toBeInTheDocument();
    expect(screen.queryByText("variety.com")).not.toBeInTheDocument();
  });

  it("filters to overridden domains only", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "variety.com", admin_override: "none" }),
          makeSource({ domain: "mshale.com", admin_override: "block" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("variety.com");
    await userEvent.click(screen.getByLabelText("Overridden only"));
    expect(screen.getByText("mshale.com")).toBeInTheDocument();
    expect(screen.queryByText("variety.com")).not.toBeInTheDocument();
  });

  it("shows a filtered-empty message when filters exclude every row", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "variety.com" })]),
      ),
    );
    renderPage();
    await screen.findByText("variety.com");
    await userEvent.type(screen.getByLabelText("Search domains"), "zzz");
    expect(screen.getByText(/no domains match your filters/i)).toBeInTheDocument();
  });

  it("sorts low-tier domains first by default", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "trusted.test", llm_tier: "trusted", updated_at: "2026-07-01T00:00:00Z" }),
          makeSource({ domain: "low.test", llm_tier: "low", updated_at: "2026-06-01T00:00:00Z" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("low.test");
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows[0]).toHaveTextContent("low.test");
  });

  it("sorts alphabetically by domain when the Domain header is clicked", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "zeta.test", llm_tier: "low" }),
          makeSource({ domain: "alpha.test", llm_tier: "trusted" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("alpha.test");
    await userEvent.click(screen.getByRole("button", { name: /^domain/i }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("alpha.test");
  });
});
