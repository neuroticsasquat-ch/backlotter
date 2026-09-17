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
