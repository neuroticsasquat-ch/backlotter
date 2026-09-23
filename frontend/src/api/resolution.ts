import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { franchisePath, personPath, studioPath } from "@/lib/film-entities";
import { apiFetch } from "./client";
import type {
  ResolutionCandidate,
  ResolutionKind,
  ResolutionDecisionPage,
  ResolutionPath,
} from "./types";

export const DEFAULT_PAGE_SIZE = 50;

/** The four paths a mention can take, in the order the page's filter tabs show them: the two
 *  D-25 calls a queue first, then the two that need no looking at. */
export const RESOLUTION_PATHS: readonly ResolutionPath[] = [
  "unlinked",
  "tiebreak",
  "accepted",
  "not_in_tmdb",
] as const;

export const PATH_LABELS: Record<ResolutionPath, string> = {
  unlinked: "Unlinked",
  tiebreak: "Tiebreak",
  accepted: "Accepted",
  not_in_tmdb: "Not in TMDB",
};

/** The three kinds the page can list, person first — the backend's own default, so the tab an
 *  admin lands on is the queue D-25 built the page for (EF-12). */
export const RESOLUTION_KINDS: readonly ResolutionKind[] = [
  "person",
  "company",
  "collection",
] as const;

/** The reader's word for one row's kind. The wire keeps TMDB's `company` and `collection`;
 *  "Studio" and "Franchise" are the only spellings that reach the screen (EF-19). */
export const KIND_LABELS: Record<ResolutionKind, string> = {
  person: "Person",
  company: "Studio",
  collection: "Franchise",
};

/** The same vocabulary in the plural, for the filter — a tab names the queue it opens, and
 *  "Studios" reads as a queue where "Studio" reads as one row's type. */
export const KIND_FILTER_LABELS: Record<ResolutionKind, string> = {
  person: "People",
  company: "Studios",
  collection: "Franchises",
};

/** The entity page a resolved mention points at, by the ref slug rule all three kinds share
 *  (`<tmdb_id>-<slug>`, resolving on the leading id — see `lib/film-entities`). `null` for a
 *  `kind` this build has not learned, which the page renders as plain text rather than as a
 *  link to a route that does not exist. */
export function resolvedEntityPath(kind: string, id: number, name: string): string | null {
  switch (kind) {
    case "person":
      return personPath(id, name);
    case "company":
      return studioPath(id, name);
    case "collection":
      return franchisePath(id, name);
    default:
      return null;
  }
}

/** One candidate's TMDB id, under whichever name its resolver logged it (EF-12): the person
 *  resolver writes `person_id`, the organisation one writes `entity_id`. */
export function candidateId(candidate: ResolutionCandidate): number | null {
  return candidate.entity_id ?? candidate.person_id;
}

export type ResolutionQuery = {
  /** Required, unlike `path`: the endpoint reads one table per request and defaults to
   *  `person`, so there is no "all kinds" page to ask for by leaving this out — an omitted
   *  `kind` is the person queue, not every queue. */
  kind: ResolutionKind;
  /** Omitted for the "All" tab; the backend 422s on a path outside the D-24 vocabulary. */
  path?: ResolutionPath;
  limit?: number;
  /** A `next_cursor` from the previous page; absent for the first one. Only meaningful within
   *  one `kind`: the two tables number their rows independently. */
  cursor?: string;
};

export function fetchResolutionDecisions({
  kind,
  path,
  limit = DEFAULT_PAGE_SIZE,
  cursor,
}: ResolutionQuery) {
  const params = new URLSearchParams({ kind, limit: String(limit) });
  if (path) params.set("path", path);
  if (cursor) params.set("cursor", cursor);
  return apiFetch<ResolutionDecisionPage>(`/admin/resolution?${params}`);
}

/** One page of resolver decisions for the review page. `keepPreviousData` holds the current
 *  rows while the next page or a new filter loads, so paging doesn't flash the table through
 *  an empty state. The cursor is part of the key: two pages of the same filter are two
 *  entries, and going back to one already fetched renders it from cache. */
export function useResolutionDecisions(params: ResolutionQuery) {
  const { kind, path, limit = DEFAULT_PAGE_SIZE, cursor } = params;
  return useQuery({
    queryKey: ["admin-resolution", { kind, path: path ?? "", limit, cursor: cursor ?? "" }],
    queryFn: () => fetchResolutionDecisions({ kind, path, limit, cursor }),
    placeholderData: keepPreviousData,
  });
}
