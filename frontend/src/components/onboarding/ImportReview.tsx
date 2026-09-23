import { useState } from "react";
import { ApiError } from "@/api/client";
import { TMDB_SOURCE, useConfirmImport } from "@/api/imports";
import type { ImportCandidate, ImportJob } from "@/api/types";
import { Button } from "@/components/ui/button";
import { formatHeadlineRelease } from "@/lib/format";

/** Why a row cannot be ticked, in the user's terms. `outside_window` is EF-21's alert window
 *  closing on the film; an unmatched title is not a candidate at all, but is listed beside them
 *  so the user sees everything the import read in one place. */
const OUTSIDE_WINDOW = "Already released more than a year ago";
const UNMATCHED = "Not found on TMDB";

const selectable = (c: ImportCandidate) => c.skip_reason === null;

/** The confirm's failures, in the user's terms. A 409 is the list having closed under the user
 *  — confirmed in another tab, or replaced by an import started since — which no retry fixes;
 *  {@link useConfirmImport} refetches the job so the panel moves on to what really happened. A
 *  404 is a job this account cannot see, answered as the poll answers it (spec §7). */
function confirmMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return "This list is no longer open — it was already confirmed, or replaced by a newer import.";
    if (error.status === 404) return "We could not find that import any more.";
    if (error.status === 403)
      return "Importing is part of the subscription, and your access has not been granted yet.";
  }
  return error instanceof Error ? error.message : "That did not go through. Please try again.";
}

/**
 * The review list an import stops at (EF-22): every film it found, and nothing followed until
 * the user confirms.
 *
 * In-window films open ticked, as the backend's `selected` says; the rest are greyed with the
 * reason they cannot be ticked, rather than left out, so an import that follows fewer films than
 * the user expected explains itself before the confirm and not after. Selection is local state
 * seeded from the job — keyed on the job id by the caller, so a new import starts a new list.
 */
export function ImportReview({ job }: { job: ImportJob }) {
  const [chosen, setChosen] = useState(
    () => new Set(job.candidates.filter((c) => c.selected && selectable(c)).map((c) => c.film_id)),
  );
  const confirm = useConfirmImport();

  const rows = job.candidates.length + job.unmatched.length;
  const toggle = (filmId: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(filmId)) next.add(filmId);
      return next;
    });

  return (
    <>
      <p className="text-sm font-medium text-foreground">
        {job.source === TMDB_SOURCE && job.tmdb_username !== null
          ? `Here is what we found on @${job.tmdb_username}'s watchlist.`
          : "Here is what we found on your watchlist."}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Nothing is followed until you confirm. Untick anything you would rather not follow.
      </p>

      {/* Out of the panel's live region: the heading above is the news, and a screen reader
          that read a few hundred titles aloud the moment the list arrived would bury it. */}
      <div aria-live="off">
        <div className="mt-3 flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            {chosen.size} of {rows} selected
          </span>
          <button
            type="button"
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() =>
              setChosen(new Set(job.candidates.filter(selectable).map((c) => c.film_id)))
            }
          >
            Select all
          </button>
          <button
            type="button"
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => setChosen(new Set())}
          >
            Select none
          </button>
        </div>

        <ul className="mt-2 max-h-96 space-y-1 overflow-y-auto">
          {job.candidates.map((c) => (
            <li key={c.film_id}>
              <label
                className={`flex items-start gap-2 text-sm ${selectable(c) ? "" : "opacity-60"}`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={chosen.has(c.film_id)}
                  disabled={!selectable(c)}
                  onChange={() => toggle(c.film_id)}
                />
                <span>
                  <span className="text-foreground">{c.title}</span>
                  {/* The release stays on a skipped row: the date is what shows a wrong
                      match, and the reason alone would hide it. */}
                  <span className="block text-xs text-muted-foreground">
                    {formatHeadlineRelease(c.headline_release)}
                    {c.skip_reason === "outside_window" && <> · {OUTSIDE_WINDOW}</>}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {job.unmatched.map((row) => (
            <li key={`${row.kind}:${row.name}:${row.year ?? ""}`}>
              <label className="flex items-start gap-2 text-sm opacity-60">
                <input type="checkbox" className="mt-1" checked={false} disabled readOnly />
                <span>
                  <span className="text-foreground">{row.name}</span>
                  {row.year !== null && (
                    <span className="text-muted-foreground"> ({row.year})</span>
                  )}
                  <span className="block text-xs text-muted-foreground">{UNMATCHED}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        {confirm.error && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {confirmMessage(confirm.error)}
          </p>
        )}

        <Button
          type="button"
          size="sm"
          className="mt-3"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate({ jobId: job.id, filmIds: [...chosen] })}
        >
          {confirm.isPending ? "Confirming…" : "Confirm"}
        </Button>
      </div>
    </>
  );
}
