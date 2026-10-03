import type { ArcStage, FeedVia } from "@/api/types";
import type { EntityUpdateType, FollowBlock, UpdateType } from "@/lib/feed-groups";

/** The canonical arc, ascending — mirrors the backend's derivation order. */
export const ARC_STAGES: readonly ArcStage[] = ["announced", "shooting", "wrapped", "released"];

/** Display label for each arc stage. */
export const ARC_STAGE_LABELS: Record<ArcStage, string> = {
  announced: "Announced",
  shooting: "Shooting",
  wrapped: "Wrapped",
  released: "Released",
};

/** Display label for a film's arc stage, for use where a null release year would leave a
 *  hole. Falls back to "Announced" for a stage the frontend doesn't know — the backend
 *  derives the same default for an unmapped or absent TMDB status, and rendering nothing
 *  here would put an empty "()" on screen. */
export function arcStageLabel(stage: ArcStage): string {
  return ARC_STAGE_LABELS[stage] ?? ARC_STAGE_LABELS.announced;
}

/** What to call each beat on screen. Equal, key for key, to the backend's `DIGEST_BEAT_LABELS`
 *  (NR-14), because the digest mail and the card are the same beat described twice and a
 *  reader who gets both must not have to work out that they agree. `labels.test.ts` pins this
 *  map to a copy of the digest's, so change the two together.
 *
 *  There is no `other` entry: the digest has none, and the backend hides `other` on every surface
 *  (`HIDDEN_EVENT_TYPES`). Nor is there a `credit_removed`, which the backend split into
 *  `cast_removed` / `crew_removed` (NR-9) — a stray one reads "Credit Removed" via the fallback.
 *
 *  The organisation beats read **Studio** and **Franchise**, never `company` / `collection`
 *  (EF-19): the code keeps the payload's words and the reader never sees them. */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  announced: "Announced",
  // The film is not happening. One card per film (`ONCE_PER_FILM_EVENT_TYPES`), and the end of
  // the alert window for it (NEU-1417).
  canceled: "Canceled",
  casting: "Casting",
  crew_attached: "Crew attached",
  // A credit leaving the film, split by role (NR-9, NR-13).
  cast_removed: "Cast departure",
  crew_removed: "Crew departure",
  // A studio or a franchise joining or leaving the film — the attachment stream an entity
  // follow delivers (EF-3, M2). Both halves of each pair are spelled out: a detachment is as
  // much news as an attachment, and the title-case fallback would render "Company Removed",
  // which names neither the right thing nor the right word for it.
  company_attached: "Studio attached",
  company_removed: "Studio removed",
  collection_attached: "Franchise attached",
  collection_removed: "Franchise removed",
  production_start: "Production started",
  production_wrap: "Production wrapped",
  release_date: "Release date",
  // Catalog-sourced, one card per (film, monetization type) the first time a poll sees the film
  // on a provider (D-28). Spelled out here rather than left to the title-case fallback, which
  // would render "Now Available".
  now_available: "Now available",
  trailer: "New trailer",
  first_look: "First look",
};

/** Shared heading for the catalog-sourced section on both the grouped feed and the film page.
 *  It names provenance — no trade outlet has covered the beat yet. */
export const NOT_YET_REPORTED_LABEL = "Not yet reported";

/** Rendered after NOT_YET_REPORTED_LABEL in the section heading, and in place of a confidence
 *  badge on each event beneath it. Readers could not tell what put one catalog beat at
 *  "confirmed" and the next at "unconfirmed", and grouped by update type the badges ran in long
 *  identical blocks, so the section says it once. Kept out of the label itself so the
 *  explainer's quoted heading stays the bare name. */
export const NOT_YET_REPORTED_QUALIFIER = "(unconfirmed)";

/** The heading over each update type in the grouped feed's Not yet reported section (NR-3).
 *  A heading names a kind, not a beat, so these are not `EVENT_TYPE_LABELS`: "Trailer" here and
 *  a beat pill's own wording are free to differ. The order is `UPDATE_TYPES`'s, not this map's. */
export const UPDATE_TYPE_LABELS: Record<UpdateType, string> = {
  now_available: "Now available",
  trailer: "Trailer",
  release_date: "Release date",
  production_status: "Production status",
  cast: "Cast",
  crew: "Crew",
  studios: "Studios",
  franchise: "Franchise",
  other: "Other updates",
};

/** The heading over each update type under an entity block's Not yet reported (FB-4). A second
 *  map beside `UPDATE_TYPE_LABELS`, never merged with it: `casting` is Cast under Films and
 *  Attached under People. "Attached" / "Detached" are the words the studio and franchise beats
 *  already use. The order is `ENTITY_UPDATE_TYPES`'s, not this map's. */
export const ENTITY_UPDATE_TYPE_LABELS: Record<EntityUpdateType, string> = {
  attached: "Attached",
  detached: "Detached",
  canceled: "Canceled",
  other: "Other updates",
};

/** The heading over each follow block on a timeline day (FB-1). The order is `FOLLOW_BLOCKS`'s.
 *  "Studios" is screen vocabulary for the follow graph's `company` (EF-19). */
export const FOLLOW_BLOCK_LABELS: Record<FollowBlock, string> = {
  films: "Films",
  people: "People",
  studios: "Studios",
  franchises: "Franchises",
};

/** An entity row's headline when the catalog can no longer name the entity (`via.name` null,
 *  FB-10). Rendered unlinked — `via.ref` is null with it. */
export const ENTITY_FALLBACK_NAMES: Record<FeedVia["entity_type"], string> = {
  person: "A person you follow",
  company: "A studio you follow",
  franchise: "A franchise you follow",
};

/** The route an entity row's headline links under, `${segment}/${via.ref}`. The follow graph's
 *  `company` and `franchise` are the `/studio` and `/franchise` pages (EF-19), as the digest's
 *  `_FOLLOWING_ROUTES` maps them. */
export const ENTITY_ROUTE_SEGMENTS: Record<FeedVia["entity_type"], string> = {
  person: "/person",
  company: "/studio",
  franchise: "/franchise",
};

/** The one line that says what the "In the news" / NOT_YET_REPORTED_LABEL split means, once per
 *  page: the global feed, the signed-in timeline and the film page. Built from the heading
 *  constant so the two cannot drift. */
export const SECTION_SPLIT_EXPLAINER =
  "Each day leads with what the trades have covered. Changes TMDB has recorded that no outlet " +
  `has reported yet sit under “${NOT_YET_REPORTED_LABEL}”.`;

/** Display label for an event's beat (event_type). Unknown types fall back to title case. */
export function eventTypeLabel(eventType: string): string {
  return (
    EVENT_TYPE_LABELS[eventType] ??
    eventType
      .split(/[_\s]+/)
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
      .join(" ")
  );
}

/** Display label for an event's confidence (D-9). The backend's vocabulary is `confirmed` |
 *  `rumored`; the card reads `confirmed` / `unconfirmed`. Badged on In the news events only —
 *  under NOT_YET_REPORTED_LABEL the heading's NOT_YET_REPORTED_QUALIFIER stands in for it.
 *  Anything that is not `confirmed` reads as unconfirmed — a value the frontend doesn't know must
 *  never be promoted to confirmed. */
export function confidenceLabel(confidence: string): "confirmed" | "unconfirmed" {
  return confidence === "confirmed" ? "confirmed" : "unconfirmed";
}

/** Marker on an event a later event retracted (D-2). The original stays in place on every
 *  surface; this is the whole of the change to it. */
export const RETRACTED_LABEL = "later retracted";

/** The DOM id every event card carries, so a retraction marker can anchor to the card that
 *  superseded it — on the same film page, or from the feed via `/film/<ref>#<id>`. */
export function eventAnchorId(eventId: string): string {
  return `event-${eventId}`;
}
