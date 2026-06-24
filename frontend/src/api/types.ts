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

export type LlmStage = "link" | "cluster" | "summarize";

/** Per-stage LLM token usage + estimated dollar cost for one ingest run. Mirrors the
 * backend `RunOut.llm_usage` element (NEU-375). Older runs predate telemetry and return []. */
export interface LlmStageUsage {
  stage: LlmStage;
  model: string;
  batched: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}

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
  llm_usage: LlmStageUsage[];
}

export type ArcStage =
  | "announced"
  | "cast"
  | "shooting"
  | "wrapped"
  | "dated"
  | "trailer"
  | "released";

export interface FilmSource {
  url: string;
  source: string;
  title: string;
  published_at: string | null;
}

export interface FilmEvent {
  event_type: string;
  confidence: string; // "confirmed" | "rumored" (backend free text; rendered via a map)
  occurred_at: string;
  summary: string;
  sources: FilmSource[];
}

export interface FilmDetail {
  slug: string;
  title: string;
  release_date: string | null;
  release_year: number | null;
  poster_path: string | null;
  arc_stage: ArcStage;
  events: FilmEvent[];
}

export interface FeedDayItem {
  film_slug: string;
  film_title: string;
  poster_path: string | null;
  day: string; // "YYYY-MM-DD" (UTC); one row per film per day
  top_event_type: string; // raw event_type, rendered via eventTypeLabel
  event_count: number;
}

export interface FeedDayResponse {
  items: FeedDayItem[];
  total: number;
  limit: number;
  offset: number;
}
