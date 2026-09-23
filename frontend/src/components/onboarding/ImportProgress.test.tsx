import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { makeImportJob, makeTmdbJob } from "@/test/msw/imports";
import { ImportProgress } from "./ImportProgress";

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

  it("reports the counts a succeeded job produced", () => {
    render(
      <ImportProgress
        job={makeImportJob({
          status: "succeeded",
          rows_total: 10,
          rows_done: 10,
          follows_created: 7,
          watchlist_created: 3,
        })}
      />,
    );

    expect(screen.getByText(/import finished/i)).toBeInTheDocument();
    expect(screen.getByText(/3 films and 7 people followed/i)).toBeInTheDocument();
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

  it("shows a failed job's cause and says earlier rows were kept", () => {
    render(<ImportProgress job={makeImportJob({ status: "failed", error: "TMDB timed out" })} />);

    expect(screen.getByText(/could not finish that import/i)).toBeInTheDocument();
    expect(screen.getByText(/TMDB timed out/)).toBeInTheDocument();
    expect(screen.getByText(/anything imported before it stopped is kept/i)).toBeInTheDocument();
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
      expect(
        screen.getByText(/TMDB watchlist and favourites a page at a time/i),
      ).toBeInTheDocument();
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

      expect(screen.getByText(/connect TMDB again to pick up the rest/i)).toBeInTheDocument();
      expect(screen.queryByText(/upload the file again/i)).not.toBeInTheDocument();
    });
  });
});
