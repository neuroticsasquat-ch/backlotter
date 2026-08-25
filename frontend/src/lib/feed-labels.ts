import type { FilmSource } from "@/api/types";

/** Brief display label for a story source: outlet name (Variety, Deadline, etc.) */
export function outletLabel(source: FilmSource): string {
  return source.source;
}
