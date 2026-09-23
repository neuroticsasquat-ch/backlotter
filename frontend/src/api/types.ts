export interface AuthedUser {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  // Derived server-side from `email_verified_at` — the backend deliberately exposes the
  // yes/no and not the timestamp (M1 contract). Present on every authed response, so the
  // signup and login replies populate it too, not just `GET /me`.
  email_verified: boolean;
  // Derived server-side from `entitled_until` on the same terms and for the same reason
  // (D-41): the context branches on a yes/no — locked panel or timeline — and the grant's
  // end date is the admin surface's business, not the account holder's. Rides every authed
  // response, so a grant made mid-session takes effect on the next `/me` rather than
  // needing a sign-out.
  entitled: boolean;
  created_at: string;
  csrf_token: string;
}

/** How often the digest mail goes out (D-33). `off` is a real choice, distinct from never
 *  having chosen: the row exists with `weekly` from the first read of `/me/settings`. */
export type DigestCadence = "daily" | "weekly" | "off";

/** The whole of `/me/settings`, mirroring the backend `UserSettingsOut`. Subscriber-only
 *  (D-39): an account without a grant never gets a row, so the hooks that read this are
 *  gated on `entitled` and never ask. `ical_token` is here for NEU-1384's calendar section;
 *  this page does not render it. */
export interface UserSettings {
  digest_cadence: DigestCadence;
  /** The availability beats this account is alerted on, product-wide (D-44). `[]` is a real
   *  answer — no store alerts at all — and is not the same as the `["stream"]` default. */
  alert_stores: AlertStore[];
  ical_token: string;
  created_at: string;
  updated_at: string;
}

/** One account as the admin grant page sees it. Distinct from {@link AuthedUser}, which is
 *  the account holder's view of themselves: this carries the raw `entitled_until` and
 *  `email_verified_at` timestamps rather than the booleans derived from them, because an
 *  admin deciding whether to extend a grant is asking *when*, not *whether*. Mirrors the
 *  backend `AdminUserOut` (D-38). */
export interface AdminUser {
  id: string;
  email: string;
  is_admin: boolean;
  email_verified_at: string | null;
  entitled_until: string | null;
  created_at: string;
}

/** A page of accounts plus the total it was drawn from, so a search can be paged without
 *  the caller having to know its result count up front. */
export interface AdminUserPage {
  items: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}

/** One invite code as the admin page sees it. Mirrors the backend `InviteOut` (NEU-1408).
 *  Both consumer fields are null while the code is outstanding, and also once it was spent by
 *  an account that has since been deleted; `consumed_by_email` is what the page shows, because
 *  `/admin/users` searches by address, not by id. */
export interface Invite {
  code: string;
  email_hint: string | null;
  created_at: string;
  consumed_at: string | null;
  consumed_by_user_id: string | null;
  consumed_by_email: string | null;
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

/** Whether a claim still stands. A `superseded` event was later retracted by the event in
 *  `superseded_by` (D-2). It still renders in place on every surface — marked, never hidden. */
export type EventStatus = "published" | "superseded";

export interface FilmEvent {
  event_id: string;
  event_type: string;
  confidence: string; // "confirmed" | "rumored" (backend free text; rendered via confidenceLabel)
  created_at: string;
  // When the beat itself happened, as against `created_at` when it was carded. The film page
  // discloses it as a "first seen" line when it falls outside the day heading (D-9, ADR-0016).
  occurred_at: string;
  summary: string;
  summary_edited: boolean;
  provenance: EventProvenance;
  status: EventStatus;
  // The event_id of the retraction that superseded this one; null unless `status` is
  // "superseded". The card anchors its "later retracted" marker to that event.
  superseded_by: string | null;
  // The YouTube key of the trailer this card is about, for the inline player (D-35). Set only
  // on a `trailer` event the backend's video poll raised from a video it can name; null on
  // every other event, and on a story-born trailer card, where outlets reported a trailer but
  // no video is held. Required, unlike the optional ids elsewhere on these DTOs: the backend
  // ships the field on every `EventOut` (NEU-1385), nulling it rather than omitting it.
  video_key: string | null;
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
  // TMDB collection id — the `franchise` entity id in the follow graph (D-10). Optional
  // for the same reason as the other ids on this DTO; see {@link FilmDetail.id}.
  id?: number;
}

/** A production company as the page lists it: the name, plus the TMDB company id a `company`
 *  follow keys on where the payload carries one. The id is optional for the same reason as the
 *  rest of them — see {@link FilmDetail.id} — and a company without one renders as a name with
 *  no follow button. */
export interface FilmCompany {
  name: string;
  id?: number;
}

export interface ReleaseDate {
  country: string; // ISO 3166-1 (e.g. "US")
  release_type: number; // TMDB type 1..6; FE renders type_label, not this
  // Human label from the backend, one short word per display bucket: "Limited" | "Wide" |
  // "Digital" | "Physical". The two home-release labels are US-only (D-26).
  type_label: string;
  date: string; // ISO datetime (timestamptz, e.g. "2026-06-25T00:00:00Z")
  certification: string | null; // e.g. "PG-13"; may be "" → treat as absent
}

export interface CastMember {
  name: string;
  character: string | null;
  profile_path: string | null; // raw TMDB path; FE builds the URL via profileUrl()
  // TMDB person id (= `catalog.person`'s PK), the `person` entity id in the follow graph
  // (D-10). Optional; see {@link FilmDetail.id}.
  person_id?: number;
}

export interface CrewMember {
  name: string;
  job: string | null;
  department: string | null;
  // TMDB person id, as on {@link CastMember}.
  person_id?: number;
}

/** A day's events on a film page, split into news-backed and TMDB-only subgroups (NEU-1201). */
export interface FilmDayGroup {
  day: string; // "YYYY-MM-DD"
  heading: string; // "Monday, June 23, 2026"
  news_events: FilmEvent[];
  tmdb_events: FilmEvent[];
}

/** One service carrying a film, as TMDB (sourcing JustWatch) names it. `id` is TMDB's
 *  `provider_id` — JustWatch's id space — exposed so a client can key a logo cache on it; it is
 *  not a follow-graph entity and no route accepts it. */
export interface WatchProvider {
  id: number;
  name: string;
  logo_path: string | null; // raw TMDB path; FE builds the URL via logoUrl()
}

/**
 * The current US where-to-watch box (D-29) — a snapshot, never a history.
 *
 * Bucketed by how a reader pays rather than by service, because that is the decision the box
 * answers. Each bucket is always present and may be empty, so the component renders whichever
 * sections have providers without guarding three keys.
 *
 * Named `...Box` rather than `WhereToWatch` so the component of that name can import it without
 * shadowing itself; the backend calls it `WhereToWatchOut`.
 *
 * `link` and `attribution` are TMDB's terms, not decoration: the terms for
 * `/movie/{id}/watch/providers` require crediting JustWatch wherever the data renders and
 * linking back to TMDB's own watch page. Render the attribution whenever any provider renders.
 * `link` is nullable only because TMDB itself omits it for some regions.
 */
export interface WhereToWatchBox {
  region: string; // "US" in v1
  flatrate: WatchProvider[]; // subscription — rendered as "Stream", matching AlertStore
  rent: WatchProvider[];
  buy: WatchProvider[];
  link: string | null; // TMDB's per-film watch page
  attribution: "JustWatch";
}

export interface FilmDetail {
  // `<tmdb_id>-<slug-of-current-title>`, the film's canonical URL segment. Resolved on the
  // leading id, so the trailing half is decorative and follows the current title (NEU-1143).
  ref: string;
  // `catalog.film`'s UUID — the `title` entity id in the follow graph (D-10). The public film
  // DTO does not carry it, or any of the other entity ids on this interface, yet:
  // `/films/{ref}` answers with display names alone, so the film page can only offer a follow
  // button for an entity the payload actually identifies. Every such id is therefore optional
  // and every affordance that needs one renders only when it is present — today none are, so
  // the page is unchanged until the backend widens the DTO, and lights up per entity as it
  // does. Deploys are independent in either direction, so this stays optional even after that
  // lands.
  id?: string;
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
  // Display forms, already abbreviated and sorted by display name. No `directors` counterpart:
  // the film page reads its director out of `crew` (NEU-1215).
  production_countries: string[];
  vote_average: number | null;
  vote_count: number | null;
  original_language: string | null;
  backdrop_path: string | null;
  production_companies: string[];
  // The same companies as `production_companies`, carrying the TMDB company id that a
  // `company` follow needs (D-10). Optional; see {@link FilmDetail.id}. The page reads the
  // names from whichever of the two it is given, never both, so the list is rendered once.
  //
  // This spelling — a new field beside the names rather than `production_companies` widened
  // into objects — is the shape the backend ticket for those ids should implement, and it is
  // the one that needs no flag day: the names keep their type, so an older frontend and a
  // newer backend still agree.
  companies?: FilmCompany[];
  collection: FilmCollection | null;
  release_dates: ReleaseDate[];
  alternative_titles: string[];
  cast: CastMember[];
  crew: CrewMember[];
  // `null` — not an empty box — when no poll has found the film anywhere (D-29). The two are
  // different answers: an empty box would claim we looked and it is nowhere, which is only true
  // for a film the providers poll actually reaches. Optional for the same reason as the entity
  // ids above — an older backend deploy omits the key entirely, so the page must render without
  // it and light up when it arrives.
  where_to_watch?: WhereToWatchBox | null;
}

export interface FeedDayItem {
  // `<tmdb_id>-<slug-of-current-title>`, the film's canonical URL segment. Resolved on the
  // leading id, so the trailing half is decorative and follows the current title (NEU-1143).
  film_ref: string;
  film_title: string;
  release_year: number | null;
  poster_path: string | null;
  // Mirrors the backend; the title parenthetical's last resort, rendered only when the film has
  // no country, director, or year (NEU-1215).
  arc_stage: ArcStage;
  // The other two elements of the title parenthetical, display-ready and never null. Uncapped —
  // each surface caps for itself (the feed row at 3 countries / 2 directors).
  production_countries: string[];
  directors: string[];
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
  // Display bucket: "limited" | "wide" | "digital" | "physical" — rendered via
  // releaseBucketLabel. The two home-release buckets are US-only and arrived with D-26;
  // premiere (TMDB type 1) is excluded backend-side and never reaches the calendar.
  release_type: string;
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

// --- The follow graph (NEU-1353, M3 contracts) ---

/** What can be followed (D-10). `franchise` is a TMDB collection, `title` a `catalog.film`. */
export type FollowEntityType = "person" | "company" | "franchise" | "title";

/** How a follow came to exist. `derived` and the two import values are written by the
 *  backend; anything this app creates is `manual`. */
export type FollowSource = "manual" | "letterboxd_import" | "tmdb_import" | "derived";

export interface Follow {
  entity_type: FollowEntityType;
  // A TMDB id for `person` / `company` / `franchise`, a film UUID for `title` — a string in
  // every case, because that is how the backend stores and compares them (its
  // `normalise_entity_id`). Compare as strings here too, never as numbers.
  entity_id: string;
  /** The entity's own name, resolved from the catalog (NEU-1396). Nullable, and that is
   *  load-bearing: a follow outlives the entity it names and D-40 keeps the row, so one the
   *  catalog can no longer resolve arrives with nulls rather than being dropped — which would
   *  make a followed thing look unfollowed. */
  name: string | null;
  /** TMDB `profile_path` / `logo_path` / `poster_path` for the entity, on the same terms. */
  image_path: string | null;
  source: FollowSource;
  /** The one release date a **title** row leads with, from the same batch query the film and
   *  entity pages read (EF-15), so two surfaces cannot disagree about a film's date. Null on
   *  every other type — a followed person has no date of their own, and the next release they
   *  are credited on would be exactly the indirect reach this project took away, smuggled back
   *  in as a column — and null for a title row whose film has no displayable date either. */
  headline_release: HeadlineRelease | null;
  created_at: string;
  /** When the newest card this follow delivers was published — every beat on the film for a
   *  title row, the entity's own attach, detach and `canceled` cards for the other three.
   *
   *  **Null means nothing has happened yet**, not "unknown": a follow taken out this morning
   *  on a film the site has never carded is a real and common state. The "Last activity" sort
   *  puts those rows last rather than treating them as missing data. */
  last_activity_at: string | null;
}

export interface FollowListResponse {
  items: Follow[];
}

/** An availability beat the reader can be alerted on. One set per account
 *  (`UserSettings.alert_stores`, D-44) — the per-film `alert_prefs` this replaced is gone, and
 *  no per-film preference exists any more. */
export type AlertStore = "buy" | "rent" | "stream";

/**
 * The one release date a film row shows, chosen by the backend (NEU-1397).
 *
 * Not `film.release_date`: that is TMDB's primary date — the earliest release anywhere, of any
 * type — which the film page never lists, so a row citing it could disagree with the page it
 * links to. `kind` says which of three things this date is, and the row renders each one
 * differently:
 *
 * - `upcoming` / `released` — a real theatrical date the film page also lists, the next one
 *   ahead or, when they have all passed, the most recent behind. Carries its `country` and
 *   its `bucket`.
 * - `primary` — the TMDB primary date after all, shown only because the film has no
 *   displayable theatrical date at all. `country` and `bucket` are null, and the row must not
 *   render it as a confirmed opening.
 */
export interface HeadlineRelease {
  date: string; // "YYYY-MM-DD"
  kind: "upcoming" | "released" | "primary";
  country: string | null; // ISO 3166-1 alpha-2; null when kind === "primary"
  bucket: string | null; // "limited" | "wide" — rendered via releaseBucketLabel; null when primary
}

// --- The person page (NEU-1418 contracts, D-1416.6) ---

/** The film as an entity page cites it — a person's, a studio's or a franchise's: enough to
 *  render a row without a request per item, plus the URL ref.
 *
 *  `ref` rather than the bare `tmdb_id`: the backend already knows the canonical
 *  `<tmdb_id>-<slug>`, so linking by it spares the reader a 301.
 *
 *  Named for the backend's `FilmRowOut`, which three endpoints emit: the studio and franchise
 *  pages return it bare, the person page wraps it in {@link PersonFilm} to hang that person's
 *  credits off it, and that wrapper is the only thing the three pages do differently. */
export interface FilmRow {
  id: string;
  tmdb_id: number;
  slug: string | null;
  title: string;
  poster_path: string | null;
  headline_release: HeadlineRelease | null;
  ref: string;
}

/** One credit a person holds on one film. A writer-director holds two of these on the same
 *  film; they are listed rather than folded, because "Director · Writer" is what the page
 *  reads. `credit_order` is TMDB's 0-indexed billing, null for crew and for an unbilled cast
 *  entry. The backend still orders them narrowest first, then billing — render them in the
 *  order they arrive rather than re-sorting, or the two renderings can disagree.
 *
 *  No `tier` since EF-1: a follow is binary and reaches every credit, so there is no cut left
 *  for a badge to name. */
export interface PersonCredit {
  credit_type: "cast" | "crew";
  job: string | null;
  character: string | null;
  credit_order: number | null;
}

/** One film on a person's page, with every credit they hold on it. Every row is reached by a
 *  follow of this person (EF-2), so the row carries no tier of its own — the list *is* what
 *  following them delivers. */
export interface PersonFilm {
  film: FilmRow;
  credits: PersonCredit[];
}

/**
 * `GET /people/{ref}` — who someone is, and the films a follow of them could reach.
 *
 * Upcoming and recently released only, and never both for one film: `upcoming` is the in-play
 * set and `recent` the alert window less that set, which between them are exactly what a
 * follow delivers (D-46). Their back catalogue is absent by design, not by pagination — the
 * page's job is to show what following this person would get you.
 *
 * `id` is the TMDB person id; stringified it is the `entity_id` a `person` follow is keyed on.
 * `ref` is canonical, and the route redirects to it when the one asked with differs.
 */
export interface PersonDetail {
  ref: string;
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string | null;
  birthday: string | null; // "YYYY-MM-DD"
  deathday: string | null; // "YYYY-MM-DD"
  upcoming: PersonFilm[];
  recent: PersonFilm[];
}

// --- The studio and franchise pages (NEU-1428 contracts, EF-17) ---

/**
 * `GET /companies/{ref}` — a studio, and the films a follow of it could reach.
 *
 * "Studio" on screen, `company` in the code (EF-19). Same two lists as {@link PersonDetail}
 * and drawn the same way, but over bare {@link FilmRow}s: a studio's relationship to a film is
 * a single membership row, so there is no job to name and no tier to badge.
 *
 * `id` is the TMDB company id; stringified it is the `entity_id` a `company` follow is keyed
 * on. `ref` is canonical, and the route redirects to it when the one asked with differs.
 */
export interface CompanyDetail {
  ref: string;
  id: number;
  name: string;
  logo_path: string | null;
  upcoming: FilmRow[];
  recent: FilmRow[];
}

/** `GET /collections/{ref}` — {@link CompanyDetail} over a TMDB collection, carrying the
 *  collection's `poster_path` where a studio carries its `logo_path`. "Franchise" on screen,
 *  `franchise` as the follow's `entity_type`, `collection` in the backend's URL (EF-19).
 *
 *  `id` is the TMDB collection id; stringified it is the `entity_id` a `franchise` follow is
 *  keyed on. */
export interface CollectionDetail {
  ref: string;
  id: number;
  name: string;
  poster_path: string | null;
  upcoming: FilmRow[];
  recent: FilmRow[];
}

/**
 * `GET /people/{ref}/events`, `/companies/{ref}/events`, `/collections/{ref}/events` — one
 * page of an entity's own cards, newest first (EF-18).
 *
 * The items are the same {@link FilmEvent} the feed and the film page carry, so an entity page
 * renders a card with the component those already use rather than a second one that drifts.
 * Note what that shape does *not* carry: a film. The backend's `EventOut` has no film ref, so
 * these cards cannot link anywhere — the summary text is the only place the film is named.
 *
 * **Keyset-paginated, so no `total`.** The list grows at the top while it is read — the next
 * attachment lands above whatever the visitor is looking at — and an offset would push unread
 * cards past the boundary. `next_cursor` is null on the last page, which is how a caller knows
 * it has reached the end.
 */
export interface EntityEventsPage {
  items: FilmEvent[];
  next_cursor: string | null;
}

// --- Entity search, the follow graph's add path (NEU-1350 contracts) ---

/** A person who can be followed. `id` is TMDB's person id; stringified it is the `entity_id`
 *  `POST /me/follows` takes for `entity_type=person`. Mirrors the backend `PersonSearchItem`. */
export interface PersonSearchItem {
  id: number;
  name: string;
  known_for_department: string | null;
  profile_path: string | null;
}

/** Mirrors the backend `CompanySearchItem`; `id` follows as `entity_type=company`. */
export interface CompanySearchItem {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string | null;
}

/** A TMDB collection. Mirrors `CollectionSearchItem`; `id` follows as `entity_type=franchise`
 *  — the API calls the entity type "franchise" and the catalog table "collection" (D-10). */
export interface CollectionSearchItem {
  id: number;
  name: string;
  poster_path: string | null;
}

/** The three search endpoints answer the same paged envelope. */
export interface EntitySearchResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** The onboarding grid's page (NEU-1350). Deliberately not an {@link EntitySearchResponse}:
 *  the backend answers a capped list with no `total` or `offset`, because the grid never
 *  scrolls past the first `limit` faces. */
export interface PopularPeopleResponse {
  items: PersonSearchItem[];
  limit: number;
}

/** Where a terminal import job ended up, or how far along a live one is. The UI polls while
 *  the status is `queued` or `running` and stops on either terminal value (D-15). */
export type ImportJobStatus = "queued" | "running" | "succeeded" | "failed";

/** A title the import could not place, verbatim from the user's own export so they can find
 *  it there. `rating` and `watchlist` say which file the row came from; `tmdb_missing` is the
 *  TMDB import's only failure (NEU-1357) and carries no resolution step. */
export interface ImportUnmatched {
  name: string;
  year: number | null;
  kind: "watchlist" | "rating" | "tmdb_missing";
}

/** One row of `app.import_job`, as `GET /me/import/{id}` answers it. Mirrors the backend
 *  `ImportJobOut` (NEU-1356 §1). `error` is set only on a `failed` job and is a one-line cause
 *  to show the user, never something to branch on. */
export interface ImportJob {
  id: string;
  source: string;
  status: ImportJobStatus;
  rows_total: number;
  rows_done: number;
  // The backend's name, kept because it is the field it sends: the count of *title* follows
  // made from the source account's watchlist. The watchlist itself is gone (EF-14) — one of
  // these rows is a followed film — so the screen says "films", not "watchlist films".
  watchlist_created: number;
  // Person follows, inferred from what the source account rated highly or favourited.
  follows_created: number;
  unmatched: ImportUnmatched[];
  tmdb_username: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** The 202 from an upload: the id to poll, and nothing else — the job has not run yet. */
export interface ImportJobStarted {
  job_id: string;
}

/** Where the resolver put a mention — `news.story_person.path`'s vocabulary (D-24). The
 *  `/admin/resolution` filter narrows to exactly one of these; omitting it lists all four. */
export type ResolutionPath = "accepted" | "tiebreak" | "unlinked" | "not_in_tmdb";

/** The story a mention was extracted from — enough to go and read the sentence yourself. */
export interface ResolutionStory {
  id: string;
  title: string;
  url: string;
  outlet: string | null;
}

/** The film the story is about. Null when the story's link was removed after the mention was
 *  extracted, which leaves the decision standing and its film gone. */
export interface ResolutionFilm {
  id: string;
  tmdb_id: number;
  title: string;
}

/** One person the scorer considered, with the feature breakdown behind their score. Every
 *  field is nullable because the backend reads these straight out of the `candidates` JSONB
 *  and degrades an entry it cannot validate to an empty row rather than failing the page. */
export interface ResolutionCandidate {
  person_id: number | null;
  name: string | null;
  score: number | null;
  features: Record<string, unknown>;
}

/** One decided mention, as `GET /admin/resolution` answers it (D-25). Read-only: corrections
 *  are deliberately absent, because the next run re-derives every path from the scorer. */
export interface ResolutionDecision {
  id: string;
  story: ResolutionStory;
  film: ResolutionFilm | null;
  name_as_written: string;
  role: string | null;
  department: string | null;
  evidence_span: string | null;
  path: ResolutionPath;
  person_id: number | null;
  confidence: number | null;
  features: Record<string, unknown>;
  candidates: ResolutionCandidate[];
  resolved_at: string | null;
}

/** A page of decisions. Cursor-paged with no `total`, because the queue grows while it is
 *  being read; `next_cursor` is null on the last page. */
export interface ResolutionDecisionPage {
  items: ResolutionDecision[];
  next_cursor: string | null;
}

/** One browser's registration as `POST /me/push` takes it, mirroring the backend
 *  `PushSubscribeRequest` (D-36). This is `PushSubscription.toJSON()` minus `expirationTime`,
 *  which the backend deliberately neither models nor stores — it is null in every current
 *  implementation, and a field nothing writes is one a reader would eventually trust. */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** `GET /me/push/vapid-public-key` — the application server key the browser subscribes with.
 *  Served rather than bundled because it is a property of the deployment: staging and
 *  production hold different keypairs. */
export interface VapidPublicKey {
  public_key: string;
}
