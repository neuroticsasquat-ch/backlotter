import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "./client";
import type { SourceDomain, SourceOverride, SourceTier } from "./types";

export const fetchSources = () => apiFetch<SourceDomain[]>("/admin/sources");

export const setSourceOverride = (domain: string, override: SourceOverride) =>
  apiFetch<SourceDomain>(`/admin/sources/${encodeURIComponent(domain)}/override`, {
    method: "POST",
    body: JSON.stringify({ override }),
  });

/** The resolved trust verdict the ingestion gate consumes: an admin override always wins
 *  over the LLM tier. `null` = unjudged (no override and no LLM tier yet). */
export type EffectiveTier = "blocked" | SourceTier | null;

export function effectiveTier(row: SourceDomain): EffectiveTier {
  switch (row.admin_override) {
    case "block":
      return "blocked";
    case "trust":
      return "trusted";
    case "allow":
      return "acceptable";
    case "none":
      return row.llm_tier;
  }
}

/** All known source domains for the admin Sources page. Near-static data — no polling
 *  (unlike useRuns); it only changes via this page's own override mutations. */
export function useSources() {
  return useQuery({ queryKey: ["admin-sources"], queryFn: fetchSources });
}

/** Set a domain's admin override with an optimistic cache update. Patches the cached
 *  ["admin-sources"] row immediately, reconciles with the server row on success, and rolls
 *  back + toasts on error. */
export function useSetSourceOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ domain, override }: { domain: string; override: SourceOverride }) =>
      setSourceOverride(domain, override),
    onMutate: async ({ domain, override }) => {
      await qc.cancelQueries({ queryKey: ["admin-sources"] });
      const previous = qc.getQueryData<SourceDomain[]>(["admin-sources"]);
      qc.setQueryData<SourceDomain[]>(["admin-sources"], (old) =>
        old?.map((r) => (r.domain === domain ? { ...r, admin_override: override } : r)),
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["admin-sources"], context.previous);
      toast.error(err instanceof Error ? err.message : "Failed to update override");
    },
    onSuccess: (updated) => {
      qc.setQueryData<SourceDomain[]>(["admin-sources"], (old) =>
        old?.map((r) => (r.domain === updated.domain ? updated : r)),
      );
      toast.success(`Override updated for ${updated.domain}`);
    },
  });
}
