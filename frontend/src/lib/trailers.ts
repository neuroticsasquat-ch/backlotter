import type { FilmDayGroup, FilmEvent } from "@/api/types";

/** A sortable key for an ISO-8601 instant, in milliseconds, that survives the mixed fractional
 *  precision the backend emits.
 *
 *  Two trailers published in the same TMDB second are pushed 1µs apart so both can card
 *  (backend `_TIE_BREAK_STEP`), and Pydantic drops the fractional part entirely when it is
 *  zero — so the pair serialises as `…T00:00:00Z` and `…T00:00:00.000001Z`. Comparing those as
 *  strings puts the *older* one first (`"Z"` > `"."`), and `Date.parse` alone truncates to
 *  milliseconds and calls them equal. Neither orders the nudge the backend went to the trouble
 *  of making, so the sub-millisecond digits are added back on by hand. */
function instantKey(iso: string): number {
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? "";
  // Date.parse already consumes the first three fractional digits as milliseconds; anything
  // past them is the sub-millisecond remainder, as a fraction of one.
  const subMs = fraction.length > 3 ? Number(`0.${fraction.slice(3)}`) : 0;
  return Date.parse(iso) + subMs;
}

/** The video key of the newest trailer on a film page, for the header's promoted button — or
 *  null when the page holds no trailer worth offering.
 *
 *  Newest by `occurred_at`, the day the trailer was published, rather than `created_at`, the
 *  day the poll happened to notice it: a backfill can card an old trailer today.
 *
 *  Superseded events are skipped here alone. The general rule is that a retracted card still
 *  renders in place, marked (D-2) — and it still does, down in the timeline. This button is
 *  not a card but a promotion, and promoting a claim we have withdrawn is a different act. */
export function latestTrailerKey(dayGroups: FilmDayGroup[]): string | null {
  // Loose `!= null`, not `!== null`: nothing validates these payloads at runtime (`api/public.ts`
  // casts the JSON straight across), so an API older than NEU-1385 omits the field rather than
  // nulling it, and `undefined` has to fall out here too.
  const trailers = dayGroups
    .flatMap((g): FilmEvent[] => [...g.news_events, ...g.tmdb_events])
    .filter((e) => e.video_key != null && e.video_key !== "" && e.status !== "superseded");
  if (trailers.length === 0) return null;
  return trailers.reduce((a, b) => (instantKey(b.occurred_at) > instantKey(a.occurred_at) ? b : a))
    .video_key;
}
