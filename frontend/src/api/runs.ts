import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { IngestRun } from "./types";

export const fetchRuns = (limit = 50) => apiFetch<IngestRun[]>(`/admin/runs?limit=${limit}`);

export const fetchRun = (id: string) => apiFetch<IngestRun>(`/admin/runs/${id}`);

/**
 * Recent ingest runs for the admin UI. Polls every 5s while any run is still
 * `running`, then settles once everything is terminal.
 */
export function useRuns(limit = 50) {
  return useQuery({
    queryKey: ["admin-runs", limit],
    queryFn: () => fetchRuns(limit),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "running") ? 5000 : false,
  });
}

export function useRun(id: string) {
  return useQuery({
    queryKey: ["admin-run", id],
    queryFn: () => fetchRun(id),
  });
}
