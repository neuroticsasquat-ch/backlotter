import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { ImportJob } from "@/api/types";

const base = env.apiBaseUrl;

const JOB_ID = "33333333-3333-4333-8333-333333333333";

export function makeImportJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: JOB_ID,
    source: "letterboxd",
    status: "queued",
    rows_total: 10,
    rows_done: 0,
    watchlist_created: 0,
    follows_created: 0,
    unmatched: [],
    tmdb_username: null,
    error: null,
    created_at: "2026-09-17T00:00:00Z",
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

/**
 * The upload and the poll behind it, scripted rather than stateful: a test names the sequence
 * of job rows it wants the poll to answer with, and the last one is repeated once the script
 * runs out. That is what makes "queued, then running, then succeeded" a property of the test
 * rather than of a fake clock — the component's only job is to keep asking until a terminal
 * status arrives, and this lets a test hand it one on the second poll.
 */
export function importJobHandlers(sequence: ImportJob[] = [makeImportJob()]) {
  const polls: string[] = [];
  const uploaded: string[] = [];
  let index = 0;

  const handlers = [
    http.post(`${base}/me/import/letterboxd`, async ({ request }) => {
      // Parsed so the request is consumed as the real route consumes it, and so a test can
      // assert the file actually rode along in the multipart body. Duck-typed on `name`
      // rather than checked with `instanceof File`: the entry MSW hands back is built by the
      // interceptor's own `File`, which is not the one this realm's global points at, so the
      // instance check fails for a body that is perfectly well formed.
      const form = await request.formData();
      const file = form.get("file");
      if (file === null || typeof file === "string")
        return HttpResponse.json({ detail: "import_file_required" }, { status: 422 });
      uploaded.push(file.name);
      return HttpResponse.json({ job_id: sequence[0]?.id ?? JOB_ID }, { status: 202 });
    }),

    http.get(`${base}/me/import/:jobId`, ({ params }) => {
      polls.push(String(params.jobId));
      const job = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      return HttpResponse.json(job);
    }),
  ];

  return { handlers, polls, uploaded };
}

/** The 202-then-error cases the upload answers: a file the parser cannot read, a second upload
 *  while one is running, an oversized body, and an account whose grant has not been made. */
export function importUploadFailure(status: number, detail: string) {
  return http.post(`${base}/me/import/letterboxd`, () => HttpResponse.json({ detail }, { status }));
}

/** `GET /people/popular` — the onboarding grid's faces (NEU-1350). A capped list, so no
 *  `total` or `offset` in the envelope. */
export function popularPeopleHandler(
  people: { id: number; name: string; known_for_department?: string | null }[] = [],
) {
  return http.get(`${base}/people/popular`, ({ request }) =>
    HttpResponse.json({
      items: people.map((p) => ({
        id: p.id,
        name: p.name,
        known_for_department: p.known_for_department ?? "Acting",
        profile_path: null,
      })),
      limit: Number(new URL(request.url).searchParams.get("limit") ?? 30),
    }),
  );
}

const TMDB_JOB_ID = "44444444-4444-4444-8444-444444444444";

/** A TMDB job row. The shape is the Letterboxd one with the two fields that only a TMDB import
 *  fills: `source` and the account it read (NEU-1357 §3). */
export function makeTmdbJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return makeImportJob({
    id: TMDB_JOB_ID,
    source: "tmdb",
    tmdb_username: "cinephile",
    ...overrides,
  });
}

/**
 * `POST /me/import/tmdb/callback` — the 202 that turns an approved request token into a job
 * (NEU-1357 §2). Records what was posted so a test can assert the token TMDB appended actually
 * rode along, and that it was only spent once.
 *
 * `failWith` answers a refusal instead while still recording the attempt, which is the only way
 * to test the case that matters most: a grant that lapsed mid-flow must *still* reach this
 * route, because posting is what makes the backend delete the live TMDB session.
 */
export function tmdbCallbackHandler(
  options: { jobId?: string; failWith?: { status: number; detail: string } } = {},
) {
  const { jobId = TMDB_JOB_ID, failWith } = options;
  const posted: { request_token: string; approved: boolean }[] = [];

  const handler = http.post(`${base}/me/import/tmdb/callback`, async ({ request }) => {
    posted.push((await request.json()) as { request_token: string; approved: boolean });
    return failWith
      ? HttpResponse.json({ detail: failWith.detail }, { status: failWith.status })
      : HttpResponse.json({ job_id: jobId }, { status: 202 });
  });

  return { handler, posted };
}

/** The callback's refusals, when a test only cares about the message they produce: a token that
 *  is not this user's (403), one that expired or was never approved (400), a grant that lapsed
 *  mid-flow (403), and a second import (409). */
export function tmdbCallbackFailure(status: number, detail: string) {
  return tmdbCallbackHandler({ failWith: { status, detail } }).handler;
}
