import { useRuns } from "@/api/runs";
import type { IngestRunStatus, LlmStageUsage } from "@/api/types";
import { formatUsd } from "@/lib/format";

const STATUS_STYLES: Record<IngestRunStatus, string> = {
  running: "bg-blue-100 text-blue-800",
  succeeded: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
};

const TOKEN_FMT = new Intl.NumberFormat("en-US");

function formatTokens(n: number): string {
  return TOKEN_FMT.format(n);
}

function runTotalCost(usage: LlmStageUsage[]): number {
  return usage.reduce((sum, u) => sum + u.cost_usd, 0);
}

function StatusBadge({ status }: { status: IngestRunStatus }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function CostCell({ usage }: { usage: LlmStageUsage[] }) {
  if (usage.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <details>
      <summary className="cursor-pointer list-none font-medium">
        {formatUsd(runTotalCost(usage))}
        <span className="ml-1 text-xs text-muted-foreground">(breakdown)</span>
      </summary>
      <table className="mt-2 w-full text-left text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Stage</th>
            <th className="py-1 pr-3 font-medium">Model</th>
            <th className="py-1 pr-3 font-medium">Input</th>
            <th className="py-1 pr-3 font-medium">Output</th>
            <th className="py-1 pr-3 font-medium">Cache read</th>
            <th className="py-1 pr-3 font-medium">Cache write</th>
            <th className="py-1 font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((u) => (
            <tr key={`${u.stage}-${u.model}`} className="border-b last:border-0">
              <td className="py-1 pr-3">{u.stage}</td>
              <td className="py-1 pr-3">{u.model}</td>
              <td className="py-1 pr-3">{formatTokens(u.input_tokens)}</td>
              <td className="py-1 pr-3">{formatTokens(u.output_tokens)}</td>
              <td className="py-1 pr-3">{formatTokens(u.cache_read_input_tokens)}</td>
              <td className="py-1 pr-3">{formatTokens(u.cache_creation_input_tokens)}</td>
              <td className="py-1">{formatUsd(u.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function AdminIngest() {
  const { data: runs, isLoading, isError, error } = useRuns();

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Ingestion status</h1>

      {isLoading && <p className="mt-4 text-muted-foreground">Loading runs…</p>}

      {isError && (
        <p className="mt-4 text-red-600">
          Failed to load runs{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {runs && runs.length === 0 && (
        <p className="mt-4 text-muted-foreground">No ingestion runs yet.</p>
      )}

      {runs && runs.length > 0 && (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4 font-medium">Kind</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Processed</th>
              <th className="py-2 pr-4 font-medium">Failed</th>
              <th className="py-2 pr-4 font-medium">Started</th>
              <th className="py-2 pr-4 font-medium">Finished</th>
              <th className="py-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b align-top">
                <td className="py-2 pr-4">{run.kind}</td>
                <td className="py-2 pr-4">
                  <StatusBadge status={run.status} />
                </td>
                <td className="py-2 pr-4">{run.items_processed}</td>
                <td className="py-2 pr-4">{run.items_failed}</td>
                <td className="py-2 pr-4">{formatTime(run.started_at)}</td>
                <td className="py-2 pr-4">{formatTime(run.finished_at)}</td>
                <td className="py-2">
                  <CostCell usage={run.llm_usage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default AdminIngest;
