export interface AuthedUser {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  csrf_token: string;
}

export type IngestRunKind = "tmdb" | "feeds" | "link" | "synthesize" | "sweep";
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

export type ArcStage = "announced" | "shooting" | "wrapped" | "released";

export interface FilmSource {
  url: string;
  source: string;
  title: string;
  published_at: string | null;
}

/** Where an event came from. A `catalog` event was raised by a TMDB field or credit
 *  change with no story behind it, so its `sources` may legitimately be empty. */
export type EventProvenance = "story" | "catalog";

export interface FilmEvent {
  event_id: string;
  event_type: string;
  confidence: string; // "confirmed" | "rumored" (backend free text; rendered via a map)
  created_at: string;
  summary: string;
  summary_edited: boolean;
  provenance: EventProvenance;
  sources: FilmSource[];
}

export interface DelinkResponse {
  delinked: number;
  event_removed: boolean;
  resummarize_queued: boolean;
}

export interface EditSummaryResponse {
  summary: string;
  edited: boolean;
  edited_at: string | null;
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

export interface CastMember {
  name: string;
  character: string | null;
  profile_path: string | null; // raw TMDB path; FE builds the URL via profileUrl()
}

export interface CrewMember {
  name: string;
  job: string | null;
  department: string | null;
}

/** A day's events on a film page, split into news-backed and TMDB-only subgroups (NEU-1201). */
export interface FilmDayGroup {
  day: string; // "YYYY-MM-DD"
  heading: string; // "Monday, June 23, 2026"
  news_events: FilmEvent[];
  tmdb_events: FilmEvent[];
}

export interface FilmDetail {
  // `<tmdb_id>-<slug-of-current-title>`, the film's canonical URL segment. Resolved on the
  // leading id, so the trailing half is decorative and follows the current title (NEU-1143).
  ref: string;
  title: string;
  tmdb_id: number;
  imdb_id: string | null;
  release_date: string | null;
  release_year: number | null;
  poster_path: string | null;
  arc_stage: ArcStage;
  day_groups: FilmDayGroup[];
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
  alternative_titles: string[];
  cast: CastMember[];
  crew: CrewMember[];
}

export interface FeedDayItem {
  // `<tmdb_id>-<slug-of-current-title>`, the film's canonical URL segment. Resolved on the
  // leading id, so the trailing half is decorative and follows the current title (NEU-1143).
  film_ref: string;
  film_title: string;
  release_year: number | null;
  poster_path: string | null;
  arc_stage: ArcStage; // mirrors the backend; rendered in place of the year for an undated film
  day: string; // "YYYY-MM-DD" (UTC); one row per film per day
  top_event_type: string; // raw event_type, rendered via eventTypeLabel
  // Every distinct beat the film-day carries, most-significant first (so `event_types[0]`
  // is `top_event_type`). Raw event_types — render each via eventTypeLabel. The feed labels
  // the whole set inline after the title (NEU-1212), not beneath it, and only on a row that
  // ships no events; the lead type alone can't express a day pairing a trailer with a casting
  // beat.
  event_types: string[];
  event_count: number;
  // True when any of this film-day's events has a linked story. The backend derives it from
  // EXISTS(event_story), not from `provenance` — provenance is where an event was born and is
  // never mutated when a story attaches later. Drives the feed's within-day sectioning.
  news_backed: boolean;
  // The events on this (film, day), with summaries and sources — matches the EventOut
  // shape from the film detail page.
  events: FilmEvent[];
}

export interface FeedDayResponse {
  items: FeedDayItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface FilmIndexItem {
  // `<tmdb_id>-<slug-of-current-title>`, the film's canonical URL segment. Resolved on the
  // leading id, so the trailing half is decorative and follows the current title (NEU-1143).
  ref: string;
  title: string;
  release_year: number | null;
  poster_path: string | null; // raw TMDB path; FE builds the URL via posterUrl()
  arc_stage: ArcStage; // mirrors the backend; rendered in place of the year for an undated film
}

export interface FilmIndexResponse {
  items: FilmIndexItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CalendarItem {
  // `<tmdb_id>-<slug-of-current-title>`, the film's canonical URL segment. Resolved on the
  // leading id, so the trailing half is decorative and follows the current title (NEU-1143).
  film_ref: string;
  film_title: string;
  release_year: number | null;
  poster_path: string | null; // raw TMDB path; FE builds the URL via posterUrl()
  release_date: string; // "YYYY-MM-DD" (US date)
  release_type: string; // bucket: "premiere" | "limited" | "wide" — rendered via releaseBucketLabel
  director: string | null; // credited director(s), joined with ", "
  stars: string[]; // first 3 billed cast names
  genres: string[]; // up to 3 genre names
}

export interface CalendarResponse {
  items: CalendarItem[];
  total: number;
  limit: number;
  offset: number;
}

export type SourceTier = "trusted" | "acceptable" | "low";
export type SourceOverride = "none" | "block" | "allow" | "trust";

/** One resolved publisher domain in the source-quality gate (NEU-454). `llm_tier` is the
 *  cached LLM verdict (null until judged); `admin_override` is the human lever that wins
 *  over it. Mirrors the backend `SourceDomainOut`. */
export interface SourceDomain {
  domain: string;
  llm_tier: SourceTier | null;
  llm_reason: string | null;
  admin_override: SourceOverride;
  updated_at: string;
}
