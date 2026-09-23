import type { ArcStage } from "@/api/types";

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

/** What to call each beat on screen. The wording matches the backend's `DIGEST_BEAT_LABELS`
 *  exactly, because the digest mail and the card are the same beat described twice and a
 *  reader who gets both must not have to work out that they agree.
 *
 *  The organisation beats read **Studio** and **Franchise**, never `company` / `collection`
 *  (EF-19): the code keeps the payload's words and the reader never sees them. */
const EVENT_TYPE_LABELS: Record<string, string> = {
  announced: "Announced",
  // The film is not happening. One card per film (`ONCE_PER_FILM_EVENT_TYPES`), and the end of
  // the alert window for it (NEU-1417).
  canceled: "Canceled",
  casting: "Casting",
  crew_attached: "Crew attached",
  // A studio or a franchise joining or leaving the film — the attachment stream an entity
  // follow delivers (EF-3, M2). Both halves of each pair are spelled out: a detachment is as
  // much news as an attachment, and the title-case fallback would render "Company Removed",
  // which names neither the right thing nor the right word for it.
  company_attached: "Studio attached",
  company_removed: "Studio removed",
  collection_attached: "Franchise attached",
  collection_removed: "Franchise removed",
  production_start: "Production start",
  production_wrap: "Production wrap",
  release_date: "Release date",
  // Catalog-sourced, one card per (film, monetization type) the first time a poll sees the film
  // on a provider (D-28). Spelled out here rather than left to the title-case fallback, which
  // would render "Now Available".
  now_available: "Now available",
  trailer: "Trailer",
  first_look: "First look",
  other: "Update",
};

/** Shared heading for the catalog-sourced section on both the grouped feed and the film page.
 *  It names provenance — no trade outlet has covered the beat yet — never truth: "unconfirmed"
 *  belongs to the card's confidence badge alone (NEU-1406). */
export const NOT_YET_REPORTED_LABEL = "Not yet reported";

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
 *  `rumored`; the card reads `confirmed` / `unconfirmed`. This badge is the card's veracity
 *  signal; the section heading above it is a provenance signal, and the two are independent — a
 *  `confirmed` badge under NOT_YET_REPORTED_LABEL is normal (NEU-1406). Anything that is not
 *  `confirmed` reads as unconfirmed — a value the frontend doesn't know must never be promoted to
 *  confirmed. */
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
