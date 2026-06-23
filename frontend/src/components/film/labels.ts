import type { ArcStage } from "@/api/types";

/** The canonical arc, ascending — mirrors the backend's derivation order. */
export const ARC_STAGES: readonly ArcStage[] = [
  "announced",
  "cast",
  "shooting",
  "wrapped",
  "dated",
  "trailer",
  "released",
];

/** Display label for each arc stage. */
export const ARC_STAGE_LABELS: Record<ArcStage, string> = {
  announced: "Announced",
  cast: "Cast",
  shooting: "Shooting",
  wrapped: "Wrapped",
  dated: "Dated",
  trailer: "Trailer",
  released: "Released",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  announced: "Announced",
  casting: "Casting",
  production_start: "Production start",
  production_wrap: "Production wrap",
  release_date: "Release date",
  trailer: "Trailer",
  other: "Update",
};

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
