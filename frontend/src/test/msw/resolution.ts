import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { ResolutionDecision, ResolutionDecisionPage, ResolutionPath } from "@/api/types";

const base = env.apiBaseUrl;

/** One decided mention, unlinked by default — the path D-25 built the page for. Override
 *  anything a test cares about; the rest is filler that exists so the row renders. */
export function makeDecision(overrides: Partial<ResolutionDecision> = {}): ResolutionDecision {
  return {
    id: "d1",
    story: {
      id: "s1",
      title: "Chris Evans joins the cast",
      url: "https://deadline.com/story",
      outlet: "Deadline",
    },
    film: { id: "f1", tmdb_id: 1234, title: "A Film" },
    name_as_written: "Chris Evans",
    role: "Actor",
    department: "Acting",
    evidence_span: "Chris Evans has joined the cast of A Film.",
    path: "unlinked",
    person_id: null,
    confidence: 0.41,
    features: { name_match: 0.9, already_credited: false },
    candidates: [],
    resolved_at: "2026-09-17T10:00:00Z",
    ...overrides,
  };
}

/** A `/admin/resolution` handler that pages over a fixed list and honours the `path` filter
 *  the way the backend does — narrowing when the param is present, listing everything when it
 *  is absent. `pageSize` caps the page below whatever `limit` the client asked for, which is
 *  how a test gets a second page out of two rows without building fifty.
 *
 *  The cursor here is the index of the next row rather than the backend's opaque
 *  `base64("<resolved_at>|<id>")` keyset token. The page round-trips a cursor and never parses
 *  one, so the double has to be opaque to it, not identical to what the server mints. */
export function resolutionHandler(items: ResolutionDecision[], pageSize = 50) {
  return http.get(`${base}/admin/resolution`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.searchParams.get("path") as ResolutionPath | null;
    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), pageSize);
    const matching = path ? items.filter((item) => item.path === path) : items;
    const slice = matching.slice(cursor, cursor + limit);
    const end = cursor + slice.length;
    return HttpResponse.json({
      items: slice,
      next_cursor: end < matching.length ? String(end) : null,
    } satisfies ResolutionDecisionPage);
  });
}

/** The 403 the endpoint answers a signed-in non-admin with. */
export function forbiddenResolutionHandler() {
  return http.get(`${base}/admin/resolution`, () =>
    HttpResponse.json({ detail: "admin_required" }, { status: 403 }),
  );
}
