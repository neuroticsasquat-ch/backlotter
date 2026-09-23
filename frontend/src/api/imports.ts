import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { env } from "@/env";
import { ApiError, apiFetch } from "./client";
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

/** `import_job.error` on a job discarded while it awaited review, because another import was
 *  started before its list was confirmed (EF-22). The one `error` value that is ours rather than
 *  an exception's text, so the one the UI may branch on (backend `IMPORT_SUPERSEDED`). */
export const IMPORT_SUPERSEDED = "superseded";

/** The field name the multipart handler reads. */
const UPLOAD_FIELD = "file";

/** A job that has stopped moving on its own, which is what ends the poll. The two terminal
 *  values, and `awaiting_review`: the job has found its films and now waits on the user's
 *  confirm (EF-22), which answers with the finished job itself — there is nothing left for a
 *  poll to see change until the user acts. */
export const isSettled = (status: ImportJob["status"]) =>
  status === "awaiting_review" || status === "succeeded" || status === "failed";

/** Upload a Letterboxd export (the zip, or the `watchlist.csv` inside it) and get back the id to
 *  poll. The response is a 202 — the work has not started, let alone finished. */
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

/** Follow the films the user kept from a job's review list (EF-22). Answers 200 with the job,
 *  now `succeeded`; 409 once the list is no longer open — already confirmed, or superseded by a
 *  newer import. Ids that are not selectable candidates are ignored server-side. */
export const confirmImport = ({ jobId, filmIds }: { jobId: string; filmIds: string[] }) =>
  apiFetch<ImportJob>(`/me/import/${encodeURIComponent(jobId)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ film_ids: filmIds }),
  });

/**
 * The confirm is the one request that writes follows (EF-22), so it is what makes the cached
 * follows stale, and the timeline with them — the feed filtered by exactly those follows (D-11).
 * `followsKey` covers the My films calendar too, whose key sits under it (EF-14). The finished
 * job it answers with is written into the poll's cache rather than refetched: the poll stopped
 * at `awaiting_review` and would otherwise never see the job reach `succeeded`.
 *
 * A 409 is the opposite case — the list closed under the user, confirmed elsewhere or superseded
 * — so the job is refetched instead, and the panel leaves a list it can no longer confirm.
 */
export function useConfirmImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: confirmImport,
    onSuccess: (job) => {
      qc.setQueryData(importJobKey(job.id), job);
      void qc.invalidateQueries({ queryKey: followsKey });
      void qc.invalidateQueries({ queryKey: timelineKey });
    },
    onError: (error, { jobId }) => {
      if (error instanceof ApiError && error.status === 409)
        void qc.invalidateQueries({ queryKey: importJobKey(jobId) });
    },
  });
}

/**
 * Watch one import job until it stops.
 *
 * Polling ends the moment the job settles ({@link isSettled}), so a job waiting on review or
 * finished is not asked about again for as long as the page stays open; `refetchIntervalInBackground` is left off,
 * which means a user who tabs away stops spending requests and catches up on their return.
 *
 * `retry: false` because the two failures this can see are both permanent: a 404 for a job id
 * this account does not own, and the 403 an account whose grant lapsed mid-import gets. Neither
 * improves by being asked again every two seconds.
 */
export function useImportJob(jobId: string | null) {
  return useQuery({
    queryKey: importJobKey(jobId ?? ""),
    // No follow invalidation here: the job writes none until the user confirms its list
    // (EF-22), so {@link useConfirmImport} owns that.
    queryFn: () => fetchImportJob(jobId!),
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
      return status && isSettled(status) ? false : POLL_INTERVAL_MS;
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
