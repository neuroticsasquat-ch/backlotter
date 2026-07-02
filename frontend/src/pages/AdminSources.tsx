import { effectiveTier, useSetSourceOverride, useSources, type EffectiveTier } from "@/api/sources";
import type { SourceDomain, SourceOverride } from "@/api/types";

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
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4 font-medium">Domain</th>
              <th className="py-2 pr-4 font-medium">LLM tier</th>
              <th className="py-2 pr-4 font-medium">Effective</th>
              <th className="py-2 pr-4 font-medium">Reason</th>
              <th className="py-2 pr-4 font-medium">Override</th>
              <th className="py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((row) => (
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
    </div>
  );
}

export default AdminSources;
