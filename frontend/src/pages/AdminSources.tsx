import { useMemo, useState } from "react";
import { effectiveTier, useSetSourceOverride, useSources, type EffectiveTier } from "@/api/sources";
import type { SourceDomain, SourceOverride, SourceTier } from "@/api/types";

type SortColumn = "domain" | "llm_tier" | "updated_at";
type SortState = { column: SortColumn; dir: "asc" | "desc" };

const TIER_RANK: Record<string, number> = { low: 0, acceptable: 1, trusted: 2 };
function tierRank(tier: SourceTier | null): number {
  return tier === null ? 3 : TIER_RANK[tier];
}

const TIER_LABELS: Record<string, string> = {
  trusted: "trusted",
  acceptable: "acceptable",
  low: "low",
  blocked: "blocked",
};

const TIER_STYLES: Record<string, string> = {
  trusted: "bg-green-100 text-green-800",
  acceptable: "bg-gray-100 text-gray-800",
  low: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-800",
};

function TierBadge({ tier }: { tier: EffectiveTier }) {
  if (tier === null) {
    return <span className="text-muted-foreground">unjudged</span>;
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TIER_STYLES[tier]}`}>
      {TIER_LABELS[tier]}
    </span>
  );
}

const OVERRIDE_OPTIONS: SourceOverride[] = ["none", "block", "allow", "trust"];

type TierFilter = "all" | "trusted" | "acceptable" | "low" | "unjudged";
const TIER_FILTERS: TierFilter[] = ["all", "trusted", "acceptable", "low", "unjudged"];

function OverrideSelect({ row }: { row: SourceDomain }) {
  const mutation = useSetSourceOverride();
  return (
    <select
      aria-label={`Override for ${row.domain}`}
      value={row.admin_override}
      disabled={mutation.isPending}
      onChange={(e) =>
        mutation.mutate({ domain: row.domain, override: e.target.value as SourceOverride })
      }
      className="rounded border px-2 py-1 text-sm disabled:opacity-50"
    >
      {OVERRIDE_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function AdminSources() {
  const { data: sources, isLoading, isError, error } = useSources();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [overriddenOnly, setOverriddenOnly] = useState(false);

  const visible = useMemo(() => {
    if (!sources) return [];
    const q = search.trim().toLowerCase();
    return sources.filter((r) => {
      if (q && !r.domain.toLowerCase().includes(q)) return false;
      if (tierFilter !== "all") {
        if (tierFilter === "unjudged" ? r.llm_tier !== null : r.llm_tier !== tierFilter) return false;
      }
      if (overriddenOnly && r.admin_override === "none") return false;
      return true;
    });
  }, [sources, search, tierFilter, overriddenOnly]);

  const [sort, setSort] = useState<SortState | null>(null);

  const sorted = useMemo(() => {
    const rows = [...visible];
    if (!sort) {
      // attention-first: low tier first, then newest updated_at
      rows.sort(
        (a, b) => tierRank(a.llm_tier) - tierRank(b.llm_tier) || b.updated_at.localeCompare(a.updated_at),
      );
      return rows;
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const cmp =
        sort.column === "domain"
          ? a.domain.localeCompare(b.domain)
          : sort.column === "llm_tier"
            ? tierRank(a.llm_tier) - tierRank(b.llm_tier)
            : a.updated_at.localeCompare(b.updated_at);
      return cmp * dir;
    });
    return rows;
  }, [visible, sort]);

  function toggleSort(column: SortColumn) {
    setSort((prev) =>
      prev?.column === column
        ? { column, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { column, dir: "asc" },
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Sources</h1>

      {isLoading && <p className="mt-4 text-muted-foreground">Loading sources…</p>}

      {isError && (
        <p className="mt-4 text-red-600">
          Failed to load sources{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {sources && sources.length === 0 && (
        <p className="mt-4 text-muted-foreground">No source domains yet.</p>
      )}

      {sources && sources.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <input
              type="search"
              aria-label="Search domains"
              placeholder="Search domains…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-2 py-1 text-sm"
            />
            <select
              aria-label="Filter by tier"
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as TierFilter)}
              className="rounded border px-2 py-1 text-sm"
            >
              {TIER_FILTERS.map((t) => (
                <option key={t} value={t}>
                  {t === "all" ? "All tiers" : t}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={overriddenOnly}
                onChange={(e) => setOverriddenOnly(e.target.checked)}
              />
              Overridden only
            </label>
          </div>

          {visible.length === 0 ? (
            <p className="mt-4 text-muted-foreground">No domains match your filters.</p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">
                    <button type="button" className="font-medium" onClick={() => toggleSort("domain")}>
                      Domain
                    </button>
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    <button type="button" className="font-medium" onClick={() => toggleSort("llm_tier")}>
                      LLM tier
                    </button>
                  </th>
                  <th className="py-2 pr-4 font-medium">Effective</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Override</th>
                  <th className="py-2 font-medium">
                    <button type="button" className="font-medium" onClick={() => toggleSort("updated_at")}>
                      Updated
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.domain} className="border-b align-top">
                    <td className="py-2 pr-4 font-medium">{row.domain}</td>
                    <td className="py-2 pr-4">
                      <TierBadge tier={row.llm_tier} />
                    </td>
                    <td className="py-2 pr-4">
                      <TierBadge tier={effectiveTier(row)} />
                    </td>
                    <td className="max-w-xs truncate py-2 pr-4" title={row.llm_reason ?? undefined}>
                      {row.llm_reason ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <OverrideSelect row={row} />
                    </td>
                    <td className="py-2">{formatTime(row.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

export default AdminSources;
