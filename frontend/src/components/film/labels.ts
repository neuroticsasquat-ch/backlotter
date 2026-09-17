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

const EVENT_TYPE_LABELS: Record<string, string> = {
  announced: "Announced",
  casting: "Casting",
  crew_attached: "Crew attached",
  production_start: "Production start",
  production_wrap: "Production wrap",
  release_date: "Release date",
  trailer: "Trailer",
  first_look: "First look",
  other: "Update",
};

/** Shared heading for the catalog-sourced section on both the grouped feed and the film page. */
export const UNCONFIRMED_UPDATES_LABEL = "unconfirmed updates";

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
 *  `rumored`; the card reads `confirmed` / `unconfirmed`, matching UNCONFIRMED_UPDATES_LABEL.
 *  Anything that is not `confirmed` reads as unconfirmed — a value the frontend doesn't know
 *  must never be promoted to confirmed. */
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
