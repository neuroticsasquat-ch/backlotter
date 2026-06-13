import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import type { IngestRun } from "@/api/types";
import { AdminIngest } from "./AdminIngest";

const base = env.apiBaseUrl;

function makeRun(overrides: Partial<IngestRun> = {}): IngestRun {
  return {
    id: crypto.randomUUID(),
    kind: "tmdb",
    status: "succeeded",
    started_at: "2026-06-13T09:00:00Z",
    finished_at: "2026-06-13T09:05:00Z",
    items_processed: 42,
    items_failed: 0,
    last_progress_at: "2026-06-13T09:05:00Z",
    detail: null,
    error: null,
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminIngest />
    </QueryClientProvider>,
  );
}

describe("AdminIngest", () => {
  it("renders run rows from the API", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([
          makeRun({ kind: "tmdb", items_processed: 42 }),
          makeRun({ kind: "feeds", items_processed: 7, items_failed: 1 }),
        ]),
      ),
    );
    renderPage();
    expect(await screen.findByText("tmdb")).toBeInTheDocument();
    expect(screen.getByText("feeds")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows running vs terminal statuses", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([
          makeRun({ kind: "tmdb", status: "running", finished_at: null }),
          makeRun({ kind: "feeds", status: "succeeded" }),
        ]),
      ),
    );
    renderPage();
    expect(await screen.findByText("running")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
  });

  it("shows an empty state when there are no runs", async () => {
    server.use(http.get(`${base}/admin/runs`, () => HttpResponse.json([])));
    renderPage();
    expect(await screen.findByText(/no ingestion runs/i)).toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json({ detail: "admin_required" }, { status: 403 }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
  });
});
