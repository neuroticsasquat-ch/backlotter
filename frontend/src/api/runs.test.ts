import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { fetchRun, fetchRuns } from "./runs";

const base = env.apiBaseUrl;

describe("runs api", () => {
  it("fetchRuns requests the list with a limit and returns typed rows", async () => {
    let seenUrl = "";
    server.use(
      http.get(`${base}/admin/runs`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json([
          {
            id: "r1",
            kind: "tmdb",
            status: "succeeded",
            started_at: "2026-06-13T09:00:00Z",
            finished_at: "2026-06-13T09:05:00Z",
            items_processed: 10,
            items_failed: 0,
            last_progress_at: null,
            detail: null,
            error: null,
            llm_usage: [],
          },
        ]);
      }),
    );
    const runs = await fetchRuns(25);
    expect(new URL(seenUrl).searchParams.get("limit")).toBe("25");
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe("tmdb");
  });

  it("fetchRun requests a single run by id", async () => {
    server.use(
      http.get(`${base}/admin/runs/r9`, () =>
        HttpResponse.json({
          id: "r9",
          kind: "feeds",
          status: "running",
          started_at: "2026-06-13T09:00:00Z",
          finished_at: null,
          items_processed: 3,
          items_failed: 0,
          last_progress_at: null,
          detail: null,
          error: null,
          llm_usage: [],
        }),
      ),
    );
    const run = await fetchRun("r9");
    expect(run.id).toBe("r9");
    expect(run.status).toBe("running");
  });

  it("fetchRuns surfaces the llm_usage breakdown on a run", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([
          {
            id: "r2",
            kind: "feeds",
            status: "succeeded",
            started_at: "2026-06-13T09:00:00Z",
            finished_at: "2026-06-13T09:05:00Z",
            items_processed: 12,
            items_failed: 0,
            last_progress_at: null,
            detail: null,
            error: null,
            llm_usage: [
              {
                stage: "link",
                model: "claude-haiku-4-5",
                batched: true,
                input_tokens: 12000,
                output_tokens: 800,
                cache_read_input_tokens: 4000,
                cache_creation_input_tokens: 1000,
                cost_usd: 0.0123,
              },
            ],
          },
        ]),
      ),
    );
    const runs = await fetchRuns();
    expect(runs[0].llm_usage).toHaveLength(1);
    expect(runs[0].llm_usage[0].stage).toBe("link");
    expect(runs[0].llm_usage[0].cost_usd).toBeCloseTo(0.0123);
  });
});
