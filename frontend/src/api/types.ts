export interface AuthedUser {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  csrf_token: string;
}

export type IngestRunKind = "tmdb" | "feeds" | "link" | "synthesize";
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
  created_at: string;
  summary: string;
  sources: FilmSource[];
}

export interface FilmCollection {
  name: string;
}

export interface ReleaseDate {
  country: string; // ISO 3166-1 (e.g. "US")
  release_type: number; // TMDB type 1..6; FE renders type_label, not this
  type_label: string; // human label from the backend (e.g. "Theatrical (limited)")
  date: string; // ISO datetime (timestamptz, e.g. "2026-06-25T00:00:00Z")
  certification: string | null; // e.g. "PG-13"; may be "" → treat as absent
}

export interface FilmDetail {
  slug: string;
  title: string;
  release_date: string | null;
  release_year: number | null;
  poster_path: string | null;
  arc_stage: ArcStage;
  events: FilmEvent[];
  overview: string | null;
  tagline: string | null;
  runtime: number | null;
  genres: string[];
  vote_average: number | null;
  vote_count: number | null;
  original_language: string | null;
  backdrop_path: string | null;
  production_companies: string[];
  collection: FilmCollection | null;
  release_dates: ReleaseDate[];
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

export interface FilmIndexItem {
  slug: string;
  title: string;
  release_year: number | null;
  poster_path: string | null; // raw TMDB path; FE builds the URL via posterUrl()
  arc_stage: ArcStage; // mirrors the backend; not rendered on /browse yet (reserved for a future badge)
}

export interface FilmIndexResponse {
  items: FilmIndexItem[];
  total: number;
  limit: number;
  offset: number;
}
