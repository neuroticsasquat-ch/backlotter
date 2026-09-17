import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { makeImportJob } from "@/test/msw/imports";
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
    expect(screen.getByText(/7 follows and 3 watchlist films added/i)).toBeInTheDocument();
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
});
