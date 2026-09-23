import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { env } from "@/env";
import { apiFetch } from "./client";
import { followsKey, importJobKey, timelineKey } from "./query-keys";
import type { ImportJob, ImportJobStarted } from "./types";

/** How often the UI asks a live job how far it has got (NEU-1356 §1). Two seconds is the
 *  cadence the backend's own docstring names, and `GET /me/import/{id}` is deliberately kept
 *  off the six-an-hour `import` rate-limit bucket so this can run without spending it. */
export const POLL_INTERVAL_MS = 2000;

/** The cap the upload route enforces (`MAX_UPLOAD_BYTES`). Checked here as well so an oversized
 *  file is refused while the user is still looking at the picker, rather than after a 5 MB
 *  round trip that ends in a 413. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** `app.import_job.source` for a job the TMDB approve flow started, as the backend writes it
 *  (NEU-1357 §3). The two import sources share one job row, one poll and one progress panel,
 *  so this is what tells them apart where the copy has to differ. */
export const TMDB_SOURCE = "tmdb";

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
      // The import writes follows — title ones for the films, person ones for the taste it
      // infers — straight into the account, so the cached copy is stale the moment it
      // succeeds, and so is the timeline, which is the feed filtered by exactly those follows
      // (D-11). `followsKey` covers the My films calendar too, whose key sits under it
      // (EF-14). Invalidated here, on the poll that first sees the terminal status, because
      // nothing else in the app is watching this job: step 2's grid is rendering follow
      // buttons against the very list the import just added rows to.
      if (job.status === "succeeded") {
        void qc.invalidateQueries({ queryKey: followsKey });
        void qc.invalidateQueries({ queryKey: timelineKey });
      }
      return job;
    },
    enabled: jobId !== null,
    retry: false,
    refetchInterval: (query) => {
      // A failed poll stops the clock as well as a finished job. `retry: false` only ends the
      // retries *within* one fetch; without this the interval keeps firing, and since an error
      // leaves `data` undefined the check below would read it as "no answer yet, keep asking".
      // Harmless for an id that came from a fresh 202, permanent for one restored from storage
      // (`lib/tmdb-import`), which is how a 404 turns into a request every two seconds forever.
      if (query.state.status === "error") return false;
      const status = query.state.data?.status;
      // No data yet is "keep asking" rather than "stop": the first poll has not answered.
      return status && isTerminal(status) ? false : POLL_INTERVAL_MS;
    },
  });
}

/**
 * Where TMDB's approve flow begins (NEU-1357 §2).
 *
 * A URL to navigate to rather than something to fetch: the route answers **302** to
 * themoviedb.org, and the whole point of the v3 flow is that the user's TMDB password is typed
 * into TMDB's own page and never into ours. `apiFetch` would follow that redirect and hand back
 * TMDB's HTML, having authenticated nobody.
 *
 * The session cookie rides along because it is `SameSite=Lax` and this is a top-level GET
 * navigation — the one cross-site case Lax still sends on.
 */
export const tmdbStartUrl = () => `${env.apiBaseUrl}/me/import/tmdb/start`;

/** What TMDB appends to its `redirect_to` when it sends the user back, and what the callback
 *  route wants posted to it. */
export interface TmdbApproval {
  requestToken: string;
  approved: boolean;
}

/**
 * Hand the approved request token back to the API, which exchanges it for a session id and
 * schedules the import (NEU-1357 §2). Answers **202** with the id to poll, exactly like the
 * Letterboxd upload — from here the two imports are the same job and the same progress panel.
 *
 * Posted rather than sent as a redirect the backend could read itself, because the exchange
 * needs the session cookie *and* the CSRF header, and TMDB's redirect carries neither.
 */
export const submitTmdbApproval = ({ requestToken, approved }: TmdbApproval) =>
  apiFetch<ImportJobStarted>("/me/import/tmdb/callback", {
    method: "POST",
    body: JSON.stringify({ request_token: requestToken, approved }),
  });

export function useSubmitTmdbApproval() {
  return useMutation({ mutationFn: submitTmdbApproval });
}
