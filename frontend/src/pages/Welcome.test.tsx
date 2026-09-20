import { beforeEach, describe, expect, it } from "vitest";
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
import {
  importJobHandlers,
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
          follows_created: 5,
          watchlist_created: 2,
          unmatched: [{ name: "A Film Nobody Has", year: 1994, kind: "watchlist" }],
        }),
      ]).handlers as never,
    });

    await userEvent.upload(await screen.findByLabelText(/letterboxd export file/i), zip());

    expect(await screen.findByText(/import finished/i)).toBeInTheDocument();
    expect(screen.getByText(/5 follows and 2 watchlist films added/i)).toBeInTheDocument();
    expect(screen.getByText(/1 title we could not match/i)).toBeInTheDocument();
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
      const job = makeTmdbJob({ status: "succeeded", follows_created: 4, watchlist_created: 3 });
      renderWelcome({
        entry: RETURN(),
        extraHandlers: [callback.handler, ...importJobHandlers([job]).handlers] as never,
      });

      expect(await screen.findByText(/import finished, from @cinephile/i)).toBeInTheDocument();
      expect(screen.getByText(/4 follows and 3 watchlist films added/i)).toBeInTheDocument();
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
});
