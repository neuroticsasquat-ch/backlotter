import type { ReleaseDate } from "@/api/types";

/**
 * Whether a film is out in the US by the dates this site displays — what gates the film page's
 * "Where to watch (TMDB)" chip (NEU-1542, D-1542.8).
 *
 * True when some row is a US date with a display label — theatrical or digital, never the
 * primary-date fallback row, whose `type_label` is `""` — on or before `today`. Before that,
 * TMDB's watch page for the film is empty, so the chip would point at nothing.
 *
 * `today` is a `YYYY-MM-DD` string the caller supplies, and ISO dates compare lexically, so the
 * date half of each row's timestamp is compared as a string. The caller is the route
 * **loader**, never a render: the server and the hydrating client must agree on the answer, and
 * two reads of the clock either side of midnight would not.
 */
export function isWatchable(dates: ReleaseDate[], today: string): boolean {
  return dates.some(
    (d) => d.country === "US" && d.type_label !== "" && d.date.slice(0, 10) <= today,
  );
}

/** Today's UTC date as `YYYY-MM-DD`, for `isWatchable`. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
