export interface AuthedUser {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  csrf_token: string;
}

export type IngestRunKind = "tmdb" | "feeds";
export type IngestRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface IngestRun {
  id: string;
  kind: IngestRunKind;
  status: IngestRunStatus;
  started_at: string;
  finished_at: string | null;
  items_processed: number;
  items_failed: number;
  last_progress_at: string | null;
  detail: string | null;
  error: string | null;
}
