import type { ImportJob } from "@/api/types";

/** Report on one import job, whatever state it is in (NEU-1356 §1).
 *
 *  The same panel covers all four statuses rather than one component per outcome, because the
 *  user watches it move through them: the bar that was counting rows becomes the summary of
 *  what those rows produced, in place, and a job that fails does so where its progress was.
 *
 *  Live region, because reaching `succeeded` is the one thing on this page that happens
 *  without the user doing anything — a screen reader that is not told has no way to find out. */
export function ImportProgress({ job }: { job: ImportJob }) {
  const running = job.status === "queued" || job.status === "running";

  return (
    <div
      className="mt-4 rounded-lg border border-border bg-muted/30 p-4"
      aria-live="polite"
      aria-busy={running}
    >
      {running && <RunningProgress job={job} />}
      {job.status === "succeeded" && <SucceededReport job={job} />}
      {job.status === "failed" && (
        <>
          <p className="text-sm font-medium text-red-600">We could not finish that import.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {job.error ?? "The import stopped before it finished."} Anything imported before it
            stopped is kept — you can upload the file again to pick up the rest.
          </p>
        </>
      )}
    </div>
  );
}

function RunningProgress({ job }: { job: ImportJob }) {
  // A `queued` job has done no rows and may not know its total yet; guarding the division
  // keeps the bar at zero rather than rendering `NaN%` for the second between the 202 and the
  // first poll.
  const percent = job.rows_total > 0 ? Math.round((job.rows_done / job.rows_total) * 100) : 0;

  return (
    <>
      <p className="text-sm font-medium text-foreground">
        {job.status === "queued" ? "Your import is queued…" : "Importing your library…"}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={job.rows_total}
        aria-valuenow={job.rows_done}
        aria-label="Import progress"
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {job.rows_done} of {job.rows_total} films checked. Every title is looked up against TMDB, so
        a large library takes a few minutes — you can carry on and it will keep going.
      </p>
    </>
  );
}

function SucceededReport({ job }: { job: ImportJob }) {
  return (
    <>
      <p className="text-sm font-medium text-foreground">Import finished.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {job.follows_created} {job.follows_created === 1 ? "follow" : "follows"} and{" "}
        {job.watchlist_created} {job.watchlist_created === 1 ? "watchlist film" : "watchlist films"}{" "}
        added.
      </p>
      {job.unmatched.length > 0 && <UnmatchedList unmatched={job.unmatched} />}
    </>
  );
}

/** The titles the import refused to guess at (D-15). Listed in full rather than counted: the
 *  point of reporting them is that the user can go and find those few films by hand, which a
 *  number alone does not let them do. */
function UnmatchedList({ unmatched }: { unmatched: ImportJob["unmatched"] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm text-foreground">
        {unmatched.length} {unmatched.length === 1 ? "title" : "titles"} we could not match
      </summary>
      <p className="mt-1 text-xs text-muted-foreground">
        We only match a film when the title and year line up exactly, so these were left alone
        rather than guessed at. You can search for them here and follow them yourself.
      </p>
      <ul className="mt-2 space-y-1">
        {unmatched.map((row) => (
          <li key={`${row.kind}:${row.name}:${row.year ?? ""}`} className="text-xs">
            <span className="text-foreground">{row.name}</span>
            {row.year !== null && <span className="text-muted-foreground"> ({row.year})</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
