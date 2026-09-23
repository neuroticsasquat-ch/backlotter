import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import type { Follow } from "@/api/types";
import { http, HttpResponse } from "msw";
import { env } from "@/env";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { entitySearchHandlers, followGraphHandlers } from "@/test/msw/follows";
import { activeImportKey, followsKey, importJobKey } from "@/api/query-keys";
import {
  activeImportHandler,
  importJobHandlers,
  makeCandidate,
  makeImportJob,
  makeTmdbJob,
  popularPeopleHandler,
  tmdbCallbackFailure,
  tmdbCallbackHandler,
} from "@/test/msw/imports";
import { readTmdbImport } from "@/lib/tmdb-import";
import { Welcome } from "./Welcome";

const POPULAR = [
  { id: 525, name: "Christopher Nolan", known_for_department: "Directing" },
  { id: 1892, name: "Matt Damon" },
];

/** Welcome plus the one thing a test cannot otherwise see: the query the router is left
 *  holding. The TMDB return has to clear it, and "the token is no longer in the URL" is the
 *  assertion that a refresh cannot respend it. */
function WelcomeProbe() {
  return (
    <>
      <Welcome />
      <span data-testid="location-search">{useLocation().search}</span>
    </>
  );
}

function renderWelcome(
  opts: {
    entitled?: boolean;
    follows?: Follow[];
    extraHandlers?: Parameters<typeof server.use>;
    entry?: string;
    client?: QueryClient;
  } = {},
) {
  const graph = followGraphHandlers({ follows: opts.follows ?? [] });
  server.use(
    meHandler({ entitled: opts.entitled ?? true }),
    ...graph.handlers,
    popularPeopleHandler(POPULAR),
    ...entitySearchHandlers({ people: [{ id: 138, name: "Quentin Tarantino" }] }),
    ...(opts.extraHandlers ?? []),
  );
  const qc = opts.client ?? testClient();
  const Stub = createRoutesStub([
    { path: "/welcome", Component: WelcomeProbe },
    { path: "/", Component: () => <p>Timeline</p> },
    { path: "/feed", Component: () => <p>Global feed</p> },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={[opts.entry ?? "/welcome"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return graph;
}

const testClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const zip = () => new File(["x"], "letterboxd-export.zip", { type: "application/zip" });

beforeEach(() => localStorage.clear());

describe("Welcome", () => {
  it("starts on the import step", async () => {
    renderWelcome();
    expect(
      await screen.findByRole("heading", { name: /bring your films with you/i }),
    ).toBeInTheDocument();
  });

  it("walks import → people → done, one step at a time", async () => {
    renderWelcome();

    await userEvent.click(await screen.findByRole("button", { name: /^continue$/i }));
    expect(
      await screen.findByRole("heading", { name: /follow a few people/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(await screen.findByRole("heading", { name: /that is everything/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to my timeline/i })).toHaveAttribute("href", "/");
  });

  it("lets each step be skipped on its own (D-17)", async () => {
    renderWelcome();

    await userEvent.click(await screen.findByRole("button", { name: /skip this step/i }));
    expect(
      await screen.findByRole("heading", { name: /follow a few people/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /skip this step/i }));
    expect(await screen.findByRole("heading", { name: /that is everything/i })).toBeInTheDocument();
  });

  it("renders the report once the job it uploaded reaches a terminal status", async () => {
    renderWelcome({
      extraHandlers: importJobHandlers([
        makeImportJob({
          status: "succeeded",
          rows_total: 4,
          rows_done: 4,
          follows_created: 2,
          watchlist_created: 3,
          unmatched: [{ name: "A Film Nobody Has", year: 1994, kind: "watchlist" }],
        }),
      ]).handlers as never,
    });

    await userEvent.upload(await screen.findByLabelText(/letterboxd export file/i), zip());

    expect(await screen.findByText(/import finished/i)).toBeInTheDocument();
    expect(screen.getByText(/2 films followed/i)).toBeInTheDocument();
    expect(screen.getByText(/1 title we could not match/i)).toBeInTheDocument();
  });

  it("stops polling at the review list, and confirms it into the report (EF-22)", async () => {
    const review = makeImportJob({
      status: "awaiting_review",
      rows_total: 2,
      rows_done: 2,
      watchlist_created: 2,
      candidates: [
        makeCandidate({ film_id: "a", title: "Arrival Two" }),
        makeCandidate({ film_id: "b", title: "Before Dawn" }),
      ],
    });
    const jobs = importJobHandlers([makeImportJob({ status: "running" }), review]);
    renderWelcome({ extraHandlers: jobs.handlers as never });

    await userEvent.upload(await screen.findByLabelText(/letterboxd export file/i), zip());

    const arrival = await screen.findByRole(
      "checkbox",
      { name: /arrival two/i },
      { timeout: 4000 },
    );
    // Settled: a job waiting on the user has nothing left for a poll to see change.
    const polled = jobs.polls.length;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(jobs.polls).toHaveLength(polled);

    await userEvent.click(arrival);
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(await screen.findByText(/import finished/i)).toBeInTheDocument();
    expect(screen.getByText(/^1 film followed\.$/i)).toBeInTheDocument();
    expect(jobs.confirmed).toEqual([["b"]]);
  }, 10_000);

  // Confirmed in another tab, or superseded by an import started there: the job is asked
  // again, and the panel leaves a list whose Confirm can no longer succeed.
  it("moves off a list that closed under the user", async () => {
    const jobs = importJobHandlers([
      makeImportJob({ status: "awaiting_review", candidates: [makeCandidate()] }),
      makeImportJob({ status: "failed", error: "superseded" }),
    ]);
    renderWelcome({
      // Ahead of `jobs.handlers`, whose own confirm would otherwise answer first.
      extraHandlers: [
        http.post(`${env.apiBaseUrl}/me/import/:jobId/confirm`, () =>
          HttpResponse.json({ detail: "import_not_awaiting_review" }, { status: 409 }),
        ),
        ...jobs.handlers,
      ] as never,
    });

    await userEvent.upload(await screen.findByLabelText(/letterboxd export file/i), zip());
    await userEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));

    expect(await screen.findByText(/replaced by a newer import/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^confirm$/i })).not.toBeInTheDocument();
  });

  it("keeps polling a running job after the user has moved on to step 2", async () => {
    const jobs = importJobHandlers([
      makeImportJob({ status: "running", rows_total: 50, rows_done: 5 }),
      makeImportJob({ status: "running", rows_total: 50, rows_done: 30 }),
    ]);
    renderWelcome({ extraHandlers: jobs.handlers as never });

    await userEvent.upload(await screen.findByLabelText(/letterboxd export file/i), zip());
    expect(await screen.findByText(/5 of 50 films checked/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(
      await screen.findByRole("heading", { name: /follow a few people/i }),
    ).toBeInTheDocument();
    // The bar the user was watching follows them to the next step rather than vanishing,
    // and it is still being refreshed there.
    expect(screen.getByRole("progressbar", { name: /import progress/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/30 of 50 films checked/i)).toBeInTheDocument(), {
      timeout: 4000,
    });
  });

  it("offers the popular faces and follows one when its card is tapped", async () => {
    const graph = renderWelcome();

    await userEvent.click(await screen.findByRole("button", { name: /^continue$/i }));
    const card = await screen.findByRole("button", { name: /follow christopher nolan/i });
    expect(card).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(card);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /unfollow christopher nolan/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(graph.follows).toContainEqual(
      expect.objectContaining({ entity_type: "person", entity_id: "525" }),
    );
  });

  it("swaps the grid to search results and back when the box is cleared", async () => {
    renderWelcome();

    await userEvent.click(await screen.findByRole("button", { name: /^continue$/i }));
    expect(await screen.findByRole("button", { name: /follow matt damon/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/search for a person/i), "tarantino");
    expect(
      await screen.findByRole("button", { name: /follow quentin tarantino/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /follow matt damon/i })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/search for a person/i));
    expect(await screen.findByRole("button", { name: /follow matt damon/i })).toBeInTheDocument();
  });

  it("says so when the poll cannot reach the job it just started", async () => {
    renderWelcome({
      extraHandlers: [
        http.post(`${env.apiBaseUrl}/me/import/letterboxd`, () =>
          HttpResponse.json({ job_id: "33333333-3333-4333-8333-333333333333" }, { status: 202 }),
        ),
        // The poll does not retry, so without a rendered error the user who just handed over a
        // file would watch nothing happen at all.
        http.get(`${env.apiBaseUrl}/me/import/:jobId`, () =>
          HttpResponse.json({ detail: "import_job_not_found" }, { status: 404 }),
        ),
      ] as never,
    });

    await userEvent.upload(await screen.findByLabelText(/letterboxd export file/i), zip());

    expect(await screen.findByRole("alert")).toHaveTextContent(/lost track of that import/i);
  });

  it("renders the locked state for an account without a grant, and starts no steps (D-41)", async () => {
    renderWelcome({ entitled: false });

    expect(
      await screen.findByRole("heading", { name: /not open to everyone yet/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /bring your films with you/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/nothing to buy yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse everything we track/i })).toHaveAttribute(
      "href",
      "/feed",
    );
  });

  describe("returning from TMDB's approve screen (NEU-1359)", () => {
    const RETURN = (params = "request_token=rt-123&approved=true") =>
      `/welcome?tmdb=callback&${params}`;

    it("spends the approved token and polls the job it starts", async () => {
      const callback = tmdbCallbackHandler();
      const job = makeTmdbJob({ status: "succeeded", follows_created: 3, watchlist_created: 4 });
      renderWelcome({
        entry: RETURN(),
        extraHandlers: [callback.handler, ...importJobHandlers([job]).handlers] as never,
      });

      expect(await screen.findByText(/import finished, from @cinephile/i)).toBeInTheDocument();
      expect(screen.getByText(/3 films followed/i)).toBeInTheDocument();
      expect(callback.posted).toEqual([{ request_token: "rt-123", approved: true }]);
    });

    // The token is single-use and deleted server-side on first sight, so a second POST of the
    // same one — StrictMode's replayed effect, or a refresh of the URL TMDB sent — comes back
    // 403 and would replace a running import with an error message.
    it("spends it exactly once, and leaves it out of the URL afterwards", async () => {
      const callback = tmdbCallbackHandler();
      renderWelcome({
        entry: RETURN(),
        extraHandlers: [
          callback.handler,
          ...importJobHandlers([makeTmdbJob({ status: "running" })]).handlers,
        ] as never,
      });

      await waitFor(() => expect(callback.posted).toHaveLength(1));
      await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent(""));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("remembers the job so the panel can report it on a later visit", async () => {
      const job = makeTmdbJob({ status: "succeeded" });
      renderWelcome({
        entry: RETURN(),
        extraHandlers: [
          tmdbCallbackHandler({ jobId: job.id }).handler,
          ...importJobHandlers([job]).handlers,
        ] as never,
      });

      await waitFor(() => expect(readTmdbImport()).toBe(job.id));
    });

    it("says so plainly when the user declined at TMDB", async () => {
      renderWelcome({
        entry: RETURN("request_token=rt-123&approved=false"),
        extraHandlers: [tmdbCallbackFailure(400, "tmdb_token_not_approved")] as never,
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/did not approve the connection/i);
    });

    it("tells the user to start over when the approval expired", async () => {
      renderWelcome({
        entry: RETURN(),
        extraHandlers: [tmdbCallbackFailure(400, "tmdb_token_expired")] as never,
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    });

    it("distinguishes a lapsed grant from a token that is not this account's", async () => {
      renderWelcome({
        entry: RETURN(),
        extraHandlers: [tmdbCallbackFailure(403, "entitlement_required")] as never,
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/part of the subscription/i);
    });

    it("refuses a return that carries no token at all", async () => {
      const callback = tmdbCallbackHandler();
      renderWelcome({
        entry: "/welcome?tmdb=callback",
        extraHandlers: [callback.handler] as never,
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/did not carry an approval/i);
      expect(callback.posted).toHaveLength(0);
    });

    // The one case where a locked account must still reach the API: the session id created at
    // TMDB is live, and the callback is what deletes it (NEU-1357, D-39). Refusing to call it
    // from the locked screen would strand the credential.
    it("still posts the callback for an account whose grant lapsed mid-flow", async () => {
      const callback = tmdbCallbackHandler({
        failWith: { status: 403, detail: "entitlement_required" },
      });
      renderWelcome({
        entitled: false,
        entry: RETURN(),
        extraHandlers: [callback.handler] as never,
      });

      expect(
        await screen.findByRole("heading", { name: /not open to everyone yet/i }),
      ).toBeInTheDocument();
      await waitFor(() => expect(callback.posted).toHaveLength(1));
      // And having spent the approval, the locked panel owns up to it rather than leaving the
      // user to guess what happened to the thing they just approved at TMDB (D-41).
      expect(await screen.findByRole("alert")).toHaveTextContent(/part of the subscription/i);
    });

    it("leaves an ordinary visit alone", async () => {
      const callback = tmdbCallbackHandler();
      renderWelcome({ extraHandlers: [callback.handler] as never });

      expect(
        await screen.findByRole("heading", { name: /bring your films with you/i }),
      ).toBeInTheDocument();
      expect(callback.posted).toHaveLength(0);
    });
  });

  describe("an open import is restored on arrival (NEU-1452)", () => {
    const REVIEW = makeImportJob({
      status: "awaiting_review",
      rows_total: 2,
      rows_done: 2,
      candidates: [
        makeCandidate({ film_id: "a", title: "Arrival Two" }),
        makeCandidate({ film_id: "b", title: "Before Dawn" }),
      ],
    });

    it("renders a waiting review list on a fresh mount, and confirming it closes it", async () => {
      const client = testClient();
      const invalidate = vi.spyOn(client, "invalidateQueries");
      const jobs = importJobHandlers([REVIEW]);
      renderWelcome({
        client,
        extraHandlers: [activeImportHandler(REVIEW).handler, ...jobs.handlers] as never,
      });

      // No upload: the list is the one the user walked away from.
      expect(await screen.findByRole("checkbox", { name: /arrival two/i })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /before dawn/i })).toBeInTheDocument();
      expect(jobs.uploaded).toHaveLength(0);

      await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

      expect(await screen.findByText(/import finished/i)).toBeInTheDocument();
      expect(jobs.confirmed).toEqual([["a", "b"]]);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: followsKey });
      // Written, not left to a refetch, so the timeline's notice cannot outlive the list.
      expect(client.getQueryData(activeImportKey)).toBeNull();
    });

    it("renders a running job's progress and keeps polling it", async () => {
      const jobs = importJobHandlers([
        makeImportJob({ status: "running", rows_total: 50, rows_done: 30 }),
      ]);
      renderWelcome({
        extraHandlers: [
          activeImportHandler(makeImportJob({ status: "running", rows_total: 50, rows_done: 5 }))
            .handler,
          ...jobs.handlers,
        ] as never,
      });

      expect(
        await screen.findByRole("progressbar", { name: /import progress/i }),
      ).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(/30 of 50 films checked/i)).toBeInTheDocument(), {
        timeout: 4000,
      });
      expect(jobs.polls.length).toBeGreaterThan(0);
    });

    it.each([
      ["nothing is open (204)", null],
      ["the read fails (500)", 500],
    ] as const)("restores nothing and says nothing when %s", async (_, answer) => {
      const active = activeImportHandler(answer);
      renderWelcome({ extraHandlers: [active.handler] as never });

      expect(await screen.findByLabelText(/letterboxd export file/i)).toBeInTheDocument();
      await waitFor(() => expect(active.calls).toBeGreaterThan(0));
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    // A cached answer from before this mount — a job since closed, or another reader's on this
    // tab — is not restored; only what the route says now is.
    it("ignores a cached answer until the route has answered on this mount", async () => {
      const client = testClient();
      client.setQueryData(activeImportKey, REVIEW);
      const active = activeImportHandler(null);
      renderWelcome({ client, extraHandlers: [active.handler] as never });

      expect(await screen.findByLabelText(/letterboxd export file/i)).toBeInTheDocument();
      await waitFor(() => expect(client.getQueryData(activeImportKey)).toBeNull());
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(client.getQueryData(importJobKey(REVIEW.id))).toBeUndefined();
    });

    it("never asks for a locked account (D-41)", async () => {
      const active = activeImportHandler(REVIEW);
      renderWelcome({ entitled: false, extraHandlers: [active.handler] as never });

      expect(
        await screen.findByRole("heading", { name: /not open to everyone yet/i }),
      ).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(active.calls).toBe(0);
    });

    // The callback's 202 is the newer job: whichever answer lands first, it is the one shown,
    // and the older open job the read answers with (superseded server-side) is not.
    it("shows the TMDB return's new job rather than an older open one", async () => {
      const older = makeImportJob({
        status: "awaiting_review",
        candidates: [makeCandidate({ film_id: "old", title: "Old Film" })],
      });
      const newer = makeTmdbJob({
        status: "awaiting_review",
        candidates: [makeCandidate({ film_id: "new", title: "New Film" })],
      });
      const active = activeImportHandler(older);
      renderWelcome({
        entry: "/welcome?tmdb=callback&request_token=rt-123&approved=true",
        extraHandlers: [
          active.handler,
          tmdbCallbackHandler({ jobId: newer.id }).handler,
          http.get(`${env.apiBaseUrl}/me/import/:jobId`, ({ params }) =>
            HttpResponse.json(params.jobId === newer.id ? newer : older),
          ),
        ] as never,
      });

      expect(await screen.findByRole("checkbox", { name: /new film/i })).toBeInTheDocument();
      await waitFor(() => expect(active.calls).toBeGreaterThan(0));
      expect(screen.queryByRole("checkbox", { name: /old film/i })).not.toBeInTheDocument();
    });
  });
});
