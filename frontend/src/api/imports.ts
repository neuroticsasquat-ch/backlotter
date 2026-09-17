import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { followsKey, importJobKey, timelineKey, watchlistKey } from "./query-keys";
import type { ImportJob, ImportJobStarted } from "./types";

/** How often the UI asks a live job how far it has got (NEU-1356 §1). Two seconds is the
 *  cadence the backend's own docstring names, and `GET /me/import/{id}` is deliberately kept
 *  off the six-an-hour `import` rate-limit bucket so this can run without spending it. */
export const POLL_INTERVAL_MS = 2000;

/** The cap the upload route enforces (`MAX_UPLOAD_BYTES`). Checked here as well so an oversized
 *  file is refused while the user is still looking at the picker, rather than after a 5 MB
 *  round trip that ends in a 413. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The field name the multipart handler reads. */
const UPLOAD_FIELD = "file";

/** A job that has stopped moving. Both terminal values end the poll; which of the two it is
 *  decides whether the step shows counts or an error. */
export const isTerminal = (status: ImportJob["status"]) =>
  status === "succeeded" || status === "failed";

/** Upload a Letterboxd export (the zip, or `watchlist.csv` / `ratings.csv` on its own) and get
 *  back the id to poll. The response is a 202 — the work has not started, let alone finished. */
export const startLetterboxdImport = (file: File) => {
  const body = new FormData();
  body.append(UPLOAD_FIELD, file);
  return apiFetch<ImportJobStarted>("/me/import/letterboxd", { method: "POST", body });
};

export const fetchImportJob = (jobId: string) =>
  apiFetch<ImportJob>(`/me/import/${encodeURIComponent(jobId)}`);

export function useStartLetterboxdImport() {
  return useMutation({ mutationFn: startLetterboxdImport });
}

/**
 * Watch one import job until it stops.
 *
 * Polling ends the moment the job reaches a terminal status, so a succeeded job is not asked
 * about again for as long as the page stays open; `refetchIntervalInBackground` is left off,
 * which means a user who tabs away stops spending requests and catches up on their return.
 *
 * `retry: false` because the two failures this can see are both permanent: a 404 for a job id
 * this account does not own, and the 403 an account whose grant lapsed mid-import gets. Neither
 * improves by being asked again every two seconds.
 */
export function useImportJob(jobId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: importJobKey(jobId ?? ""),
    queryFn: async () => {
      const job = await fetchImportJob(jobId!);
      // The import writes follows and watchlist items straight into the account, so the
      // cached copies of both are stale the moment it succeeds — and so is the timeline,
      // which is the feed filtered by exactly those follows (D-11). Invalidated here, on the
      // poll that first sees the terminal status, because nothing else in the app is watching
      // this job: step 2's grid is rendering follow buttons against the very list the import
      // just added rows to.
      if (job.status === "succeeded") {
        void qc.invalidateQueries({ queryKey: followsKey });
        void qc.invalidateQueries({ queryKey: watchlistKey });
        void qc.invalidateQueries({ queryKey: timelineKey });
      }
      return job;
    },
    enabled: jobId !== null,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // No data yet is "keep asking" rather than "stop": the first poll has not answered.
      return status && isTerminal(status) ? false : POLL_INTERVAL_MS;
    },
  });
}
