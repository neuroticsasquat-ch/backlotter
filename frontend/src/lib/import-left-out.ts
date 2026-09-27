import { TMDB_SOURCE } from "@/api/imports";
import type { ImportJob } from "@/api/types";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The one line that says what the import left off the list (NEU-1505, D-1505.3), counted from
 *  `unmatched[].kind`: the titles declined as too old (`outside_window`, EF-21's alert window)
 *  and the ones that could not be brought in at all. Counts only, no names — the finished report
 *  still lists the unmatched titles by name. `null` when nothing was left out. */
export function leftOutSummary(job: Pick<ImportJob, "source" | "unmatched">): string | null {
  const tooOld = job.unmatched.filter((row) => row.kind === "outside_window").length;
  const missing = job.unmatched.length - tooOld;
  const clauses: string[] = [];
  if (tooOld > 0)
    clauses.push(`${tooOld} ${plural(tooOld, "title", "titles")} released more than a year ago`);
  if (missing > 0) {
    // The noun is carried by the first clause when there is one ("14 titles … and 2 we …").
    const noun = tooOld > 0 ? "" : ` ${plural(missing, "title", "titles")}`;
    const reason = job.source === TMDB_SOURCE ? "that TMDB no longer has" : "we could not match";
    clauses.push(`${missing}${noun} ${reason}`);
  }
  return clauses.length > 0 ? `We left out ${clauses.join(" and ")}.` : null;
}
