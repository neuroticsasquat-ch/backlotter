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
