import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { ResolutionDecisionPage, ResolutionPath } from "./types";

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

export type ResolutionQuery = {
  /** Omitted for the "All" tab; the backend 422s on a path outside the D-24 vocabulary. */
  path?: ResolutionPath;
  limit?: number;
  /** A `next_cursor` from the previous page; absent for the first one. */
  cursor?: string;
};

export function fetchResolutionDecisions({
  path,
  limit = DEFAULT_PAGE_SIZE,
  cursor,
}: ResolutionQuery = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (path) params.set("path", path);
  if (cursor) params.set("cursor", cursor);
  return apiFetch<ResolutionDecisionPage>(`/admin/resolution?${params}`);
}

/** One page of resolver decisions for the review page. `keepPreviousData` holds the current
 *  rows while the next page or a new filter loads, so paging doesn't flash the table through
 *  an empty state. The cursor is part of the key: two pages of the same filter are two
 *  entries, and going back to one already fetched renders it from cache. */
export function useResolutionDecisions(params: ResolutionQuery = {}) {
  const { path, limit = DEFAULT_PAGE_SIZE, cursor } = params;
  return useQuery({
    queryKey: ["admin-resolution", { path: path ?? "", limit, cursor: cursor ?? "" }],
    queryFn: () => fetchResolutionDecisions({ path, limit, cursor }),
    placeholderData: keepPreviousData,
  });
}
