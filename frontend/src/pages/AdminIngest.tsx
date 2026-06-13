import { useRuns } from "@/api/runs";
import type { IngestRunStatus } from "@/api/types";

const STATUS_STYLES: Record<IngestRunStatus, string> = {
  running: "bg-blue-100 text-blue-800",
  succeeded: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
};

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
              <th className="py-2 font-medium">Finished</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b">
                <td className="py-2 pr-4">{run.kind}</td>
                <td className="py-2 pr-4">
                  <StatusBadge status={run.status} />
                </td>
                <td className="py-2 pr-4">{run.items_processed}</td>
                <td className="py-2 pr-4">{run.items_failed}</td>
                <td className="py-2 pr-4">{formatTime(run.started_at)}</td>
                <td className="py-2">{formatTime(run.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
