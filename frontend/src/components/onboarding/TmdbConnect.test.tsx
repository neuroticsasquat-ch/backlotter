import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { env } from "@/env";
import { server } from "@/test/msw/server";
import { importJobHandlers, makeImportJob, makeTmdbJob } from "@/test/msw/imports";
import { rememberTmdbImport } from "@/lib/tmdb-import";
import { POLL_INTERVAL_MS } from "@/api/imports";
import type { ImportJob } from "@/api/types";
import { TmdbConnect } from "./TmdbConnect";

const START_URL = `${env.apiBaseUrl}/me/import/tmdb/start`;

function renderPanel(job: ImportJob | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TmdbConnect job={job} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("TmdbConnect", () => {
  it("sends the user to the approve flow with a link, not a fetch", async () => {
    renderPanel();

    // A link, because the route answers 302 to themoviedb.org: the browser has to be the thing
    // that follows it. Asserted as an anchor with an href for exactly that reason — a button
    // with a click handler would pass a looser check and be wrong.
    const connect = await screen.findByRole("link", { name: /connect tmdb/i });
    expect(connect).toHaveAttribute("href", START_URL);
  });

  it("offers no unlink, because a one-shot import leaves nothing linked (NEU-1357 §4)", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /unlink/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /unlink/i })).not.toBeInTheDocument();
  });

  it("reports the last import this device ran, and offers to run it again", async () => {
    const job = makeTmdbJob({
      status: "succeeded",
      tmdb_username: "cinephile",
      finished_at: "2026-09-16T12:00:00Z",
    });
    rememberTmdbImport(job.id);
    server.use(...importJobHandlers([job]).handlers);

    renderPanel();

    expect(await screen.findByText(/last imported from/i)).toHaveTextContent(
      /@cinephile on Sep 16, 2026/i,
    );
    expect(await screen.findByRole("link", { name: /import again/i })).toHaveAttribute(
      "href",
      START_URL,
    );
  });

  it("says nothing about an import that has not finished", async () => {
    const job = makeTmdbJob({ status: "running" });
    rememberTmdbImport(job.id);
    server.use(...importJobHandlers([job]).handlers);

    renderPanel();

    expect(await screen.findByRole("link", { name: /connect tmdb/i })).toBeInTheDocument();
    expect(screen.queryByText(/last imported from/i)).not.toBeInTheDocument();
  });

  // The stored id is just an id; nothing stops a Letterboxd job from being behind it if the
  // key were ever crossed, and "Last imported from @null" is the failure that would produce.
  it("ignores a remembered job that did not come from TMDB", async () => {
    const job = makeImportJob({ status: "succeeded", source: "letterboxd" });
    rememberTmdbImport(job.id);
    server.use(...importJobHandlers([job]).handlers);

    renderPanel();

    expect(await screen.findByRole("link", { name: /connect tmdb/i })).toBeInTheDocument();
    expect(screen.queryByText(/last imported from/i)).not.toBeInTheDocument();
  });

  it("reports the import running in this session without waiting for it to be remembered", async () => {
    renderPanel(
      makeTmdbJob({
        status: "succeeded",
        tmdb_username: "freshly_connected",
        finished_at: "2026-09-17T09:00:00Z",
      }),
    );

    expect(await screen.findByText(/last imported from/i)).toHaveTextContent(/@freshly_connected/i);
  });

  it("falls back to the plain button when the remembered job is gone, and stops asking", async () => {
    rememberTmdbImport("44444444-4444-4444-8444-444444444444");
    // A job id this account no longer owns. Unlike an id from a fresh 202 this one is restored
    // from storage on every visit, so "the poll never stops" is not a blip that resolves when
    // the page closes — it is a request every two seconds for as long as the tab is open.
    let polls = 0;
    server.use(
      http.get(`${env.apiBaseUrl}/me/import/:jobId`, () => {
        polls += 1;
        return HttpResponse.json({ detail: "import_job_not_found" }, { status: 404 });
      }),
    );
    renderPanel();

    expect(await screen.findByRole("link", { name: /connect tmdb/i })).toBeInTheDocument();
    expect(screen.queryByText(/last imported from/i)).not.toBeInTheDocument();

    await waitFor(() => expect(polls).toBe(1));
    // Comfortably past two poll intervals: a failed poll must not be retried on the clock.
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 2));
    expect(polls).toBe(1);
    // Real time rather than fake timers: the interval lives inside TanStack Query, and the
    // point of the assertion is that the scheduler it actually runs on never fires again.
  }, 15000);
});
