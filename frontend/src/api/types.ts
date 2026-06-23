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
