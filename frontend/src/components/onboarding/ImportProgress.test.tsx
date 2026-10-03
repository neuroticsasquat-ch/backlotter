import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { ImportJob } from "@/api/types";
import { server } from "@/test/msw/server";
import { importJobHandlers, makeCandidate, makeImportJob, makeTmdbJob } from "@/test/msw/imports";
import { ImportProgress } from "./ImportProgress";

/** The review list confirms through a mutation, so it needs a client; the other states are
 *  pure and render without one, which is how the rest of this file tests them. */
function renderReview(job: ImportJob) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ImportProgress job={job} />
    </QueryClientProvider>,
  );
}

const IN_A = makeCandidate({ film_id: "a", title: "Arrival Two" });
const IN_B = makeCandidate({ film_id: "b", title: "Before Dawn" });
const OLD = { name: "Old Classic", year: 2001, kind: "outside_window" } as const;
const NOBODY_HAS = { name: "A Film Nobody Has", year: 2027, kind: "watchlist" } as const;

const reviewJob = (overrides: Partial<ImportJob> = {}) =>
  makeImportJob({
    status: "awaiting_review",
    rows_total: 4,
    rows_done: 4,
    watchlist_created: 2,
    candidates: [IN_A, IN_B],
    unmatched: [OLD, NOBODY_HAS],
    ...overrides,
  });

describe("ImportProgress", () => {
  it("shows how far a running job has got, as a proportion of its rows", () => {
    render(
      <ImportProgress job={makeImportJob({ status: "running", rows_total: 40, rows_done: 10 })} />,
    );

    const bar = screen.getByRole("progressbar", { name: /import progress/i });
    expect(bar).toHaveAttribute("aria-valuenow", "10");
    expect(bar).toHaveAttribute("aria-valuemax", "40");
    expect(screen.getByText(/10 of 40 films checked/i)).toBeInTheDocument();
  });

  it("does not divide by a row count a queued job does not have yet", () => {
    render(
      <ImportProgress job={makeImportJob({ status: "queued", rows_total: 0, rows_done: 0 })} />,
    );

    expect(screen.getByText(/queued/i)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  // `follows_created` is what the confirm wrote; `watchlist_created` is what the list offered,
  // which is more whenever the user unticked something (EF-22). And no people: EF-20.
  it("reports the films the confirm followed, not the films the list offered", () => {
    render(
      <ImportProgress
        job={makeImportJob({
          status: "succeeded",
          rows_total: 10,
          rows_done: 10,
          follows_created: 7,
          watchlist_created: 9,
        })}
      />,
    );

    expect(screen.getByText(/import finished/i)).toBeInTheDocument();
    expect(screen.getByText(/^7 films followed\.$/i)).toBeInTheDocument();
    expect(screen.queryByText(/people/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("names every title it could not place, rather than counting them (D-15)", () => {
    render(
      <ImportProgress
        job={makeImportJob({
          status: "succeeded",
          unmatched: [
            { name: "A Film Nobody Has", year: 1994, kind: "watchlist" },
            { name: "Untitled Project", year: null, kind: "rating" },
          ],
        })}
      />,
    );

    expect(screen.getByText(/2 titles we could not match/i)).toBeInTheDocument();
    expect(screen.getByText("A Film Nobody Has")).toBeInTheDocument();
    expect(screen.getByText("(1994)")).toBeInTheDocument();
    // A row with no year renders its name and nothing beside it.
    expect(screen.getByText("Untitled Project")).toBeInTheDocument();
  });

  // NEU-1505: a film declined as too old was matched, so there is nothing to go and find by
  // hand — it is a count beside the list, never a row in it.
  it("counts the titles declined as too old apart from the ones it could not place", () => {
    render(
      <ImportProgress
        job={makeImportJob({
          status: "succeeded",
          unmatched: [
            { name: "Mank", year: 2020, kind: "outside_window" },
            { name: "The Killer", year: 2023, kind: "outside_window" },
            NOBODY_HAS,
          ],
        })}
      />,
    );

    expect(
      screen.getByText("2 titles were released more than a year ago and were not imported."),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 title we could not match/i)).toBeInTheDocument();
    expect(screen.getByText("A Film Nobody Has")).toBeInTheDocument();
    expect(screen.queryByText("Mank")).not.toBeInTheDocument();
  });

  it("shows no could-not-match list when every left-out title was too old", () => {
    render(
      <ImportProgress
        job={makeImportJob({
          status: "succeeded",
          unmatched: [{ name: "Mank", year: 2020, kind: "outside_window" }],
        })}
      />,
    );

    expect(
      screen.getByText("1 title was released more than a year ago and was not imported."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not match/i)).not.toBeInTheDocument();
  });

  // A job fails before it has a list to confirm, and follows nothing until one is (EF-22).
  it("shows a failed job's cause and says nothing was followed", () => {
    render(<ImportProgress job={makeImportJob({ status: "failed", error: "TMDB timed out" })} />);

    expect(screen.getByText(/could not finish that import/i)).toBeInTheDocument();
    expect(screen.getByText(/TMDB timed out/)).toBeInTheDocument();
    expect(screen.getByText(/nothing was followed/i)).toBeInTheDocument();
    expect(screen.queryByText(/is kept/i)).not.toBeInTheDocument();
  });

  it("says a superseded list was replaced, not that the import failed", () => {
    render(<ImportProgress job={makeImportJob({ status: "failed", error: "superseded" })} />);

    expect(screen.getByText(/replaced by a newer import/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not finish/i)).not.toBeInTheDocument();
    expect(screen.queryByText("superseded")).not.toBeInTheDocument();
  });

  describe("a job awaiting review (EF-22)", () => {
    it("lists in-window films ticked, with the release they lead with", () => {
      renderReview(reviewJob());

      const a = screen.getByRole("checkbox", { name: /arrival two/i });
      expect(a).toBeChecked();
      expect(a).toBeEnabled();
      expect(screen.getByRole("checkbox", { name: /before dawn/i })).toBeChecked();
      expect(screen.getAllByText("Opens Oct 3, 2026 · Wide · US")).toHaveLength(2);
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    // NEU-1505, D-1505.3: an import never lists a film it cannot follow.
    it("lists only the films it can follow, every one of them tickable", () => {
      renderReview(reviewJob());

      const boxes = screen.getAllByRole("checkbox");
      expect(boxes).toHaveLength(2);
      boxes.forEach((box) => expect(box).toBeEnabled());
      expect(screen.queryByText("Old Classic")).not.toBeInTheDocument();
      expect(screen.queryByText("A Film Nobody Has")).not.toBeInTheDocument();
      expect(
        screen.getByText(/upcoming and recently released films from your watchlist/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/nothing is followed until you confirm/i)).toBeInTheDocument();
    });

    it("says in one line what it left out", () => {
      renderReview(reviewJob());

      expect(
        screen.getByText(
          "We left out 1 title released more than a year ago and 1 we could not match.",
        ),
      ).toBeInTheDocument();
    });

    it("says nothing about leaving out when nothing was", () => {
      renderReview(reviewJob({ unmatched: [] }));

      expect(screen.queryByText(/we left out/i)).not.toBeInTheDocument();
    });

    it("counts the ticked rows against the candidates only", async () => {
      renderReview(reviewJob());

      expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("checkbox", { name: /arrival two/i }));
      expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    });

    it("selects none and all", async () => {
      renderReview(reviewJob());

      await userEvent.click(screen.getByRole("button", { name: /select none/i }));
      expect(screen.getByText("0 of 2 selected")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /arrival two/i })).not.toBeChecked();

      await userEvent.click(screen.getByRole("button", { name: /select all/i }));
      expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    });

    // Moving on to the report is the poll cache's job, so `Welcome.test.tsx` covers it.
    it("confirms the ids still ticked, and only those", async () => {
      const jobs = importJobHandlers([reviewJob()]);
      server.use(...jobs.handlers);
      renderReview(reviewJob());

      await userEvent.click(screen.getByRole("checkbox", { name: /arrival two/i }));
      await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

      await waitFor(() => expect(jobs.confirmed).toEqual([["b"]]));
    });

    const confirmFailure = (status: number, detail: string) =>
      http.post(`${env.apiBaseUrl}/me/import/:jobId/confirm`, () =>
        HttpResponse.json({ detail }, { status }),
      );

    // Moving the panel on to what the job became needs the poll's observer, so the refetch half
    // of this is in `Welcome.test.tsx`.
    it("explains a 409 as the list having closed, not as a failure to retry", async () => {
      server.use(confirmFailure(409, "import_not_awaiting_review"));
      renderReview(reviewJob());

      await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/no longer open/i);
    });

    it("does not print the 404's identifier at the user", async () => {
      server.use(confirmFailure(404, "import_job_not_found"));
      renderReview(reviewJob());

      await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/could not find that import/i);
      expect(alert).not.toHaveTextContent("import_job_not_found");
    });
  });

  describe("a TMDB job, which does no title matching at all (NEU-1357 §3)", () => {
    it("credits the account it read on the finished line", () => {
      render(<ImportProgress job={makeTmdbJob({ status: "succeeded" })} />);

      expect(screen.getByText(/import finished, from @cinephile/i)).toBeInTheDocument();
    });

    it("does not describe the running job as looking titles up", () => {
      render(
        <ImportProgress job={makeTmdbJob({ status: "running", rows_total: 20, rows_done: 5 })} />,
      );

      expect(screen.getByText(/5 of 20 films read/i)).toBeInTheDocument();
      expect(screen.getByText(/TMDB watchlist a page at a time/i)).toBeInTheDocument();
      expect(screen.queryByText(/favourite/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/every title is looked up against TMDB/i)).not.toBeInTheDocument();
    });

    // `kind=tmdb_missing` is a film TMDB itself 404s for, not a title we declined to guess at:
    // the ids came from TMDB, so there was never any matching to be exact about.
    it("explains an unbrought title as TMDB having nothing behind it", () => {
      render(
        <ImportProgress
          job={makeTmdbJob({
            status: "succeeded",
            unmatched: [{ name: "Deleted From TMDB", year: 2019, kind: "tmdb_missing" }],
          })}
        />,
      );

      expect(screen.getByText(/1 title we could not bring over/i)).toBeInTheDocument();
      expect(screen.getByText(/TMDB no longer has a film behind them/i)).toBeInTheDocument();
      expect(
        screen.queryByText(/we only match a film when the title and year line up/i),
      ).not.toBeInTheDocument();
    });

    it("points a failed job back at the approve flow, not at a file", () => {
      render(<ImportProgress job={makeTmdbJob({ status: "failed", error: "TMDB timed out" })} />);

      expect(screen.getByText(/connect TMDB again to try once more/i)).toBeInTheDocument();
      expect(screen.queryByText(/upload the file again/i)).not.toBeInTheDocument();
    });
  });
});
