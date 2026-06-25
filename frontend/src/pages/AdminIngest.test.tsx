import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import type { IngestRun, LlmStageUsage } from "@/api/types";
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
    llm_usage: [],
    ...overrides,
  };
}

function makeUsage(overrides: Partial<LlmStageUsage> = {}): LlmStageUsage {
  return {
    stage: "link",
    model: "claude-haiku-4-5",
    batched: true,
    input_tokens: 12000,
    output_tokens: 800,
    cache_read_input_tokens: 4000,
    cache_creation_input_tokens: 1000,
    cost_usd: 0.0123,
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
    expect(await screen.findByText("TMDB")).toBeInTheDocument();
    expect(screen.getByText("Feeds")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders friendly labels for link and synthesize run kinds", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([makeRun({ kind: "link" }), makeRun({ kind: "synthesize" })]),
      ),
    );
    renderPage();
    expect(await screen.findByText("Link")).toBeInTheDocument();
    expect(screen.getByText("Synthesize")).toBeInTheDocument();
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

  it("shows the per-run total cost", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([
          makeRun({
            kind: "tmdb",
            llm_usage: [
              makeUsage({ stage: "link", cost_usd: 0.025 }),
              makeUsage({ stage: "summarize", cost_usd: 0.025 }),
            ],
          }),
        ]),
      ),
    );
    renderPage();
    // total = 0.025 + 0.025 = 0.05 -> "$0.05"
    expect(await screen.findByText("$0.05")).toBeInTheDocument();
  });

  it("reveals per-stage tokens and cost when the breakdown is expanded", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([
          makeRun({
            kind: "tmdb",
            llm_usage: [
              makeUsage({
                stage: "link",
                model: "claude-haiku-4-5",
                input_tokens: 12000,
                output_tokens: 800,
                cache_read_input_tokens: 4000,
                cache_creation_input_tokens: 1000,
                cost_usd: 0.0123,
              }),
            ],
          }),
        ]),
      ),
    );
    renderPage();
    const toggle = await screen.findByText(/breakdown/i);
    await userEvent.click(toggle);
    expect(screen.getByText("link")).toBeInTheDocument();
    expect(screen.getByText("claude-haiku-4-5")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("4,000")).toBeInTheDocument();
    // $0.0123 appears in both summary and breakdown td — both are valid
    expect(screen.getAllByText("$0.0123").length).toBeGreaterThanOrEqual(1);
  });

  it("renders runs with empty llm_usage without a breakdown", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([makeRun({ kind: "tmdb", llm_usage: [] })]),
      ),
    );
    renderPage();
    expect(await screen.findByText("TMDB")).toBeInTheDocument();
    // empty usage -> no disclosure control, muted dash for cost
    expect(screen.queryByText(/breakdown/i)).not.toBeInTheDocument();
  });
});
