import { posterUrl } from "@/lib/poster";
import type { FeedDayItem } from "@/api/types";

/** The day's lead poster: the first film in the day's list that has one (the backend
 *  orders within-day by popularity, so that's the day's headliner). Fixed at roughly
 *  three feed rows tall so a one-update day gets the same visual anchor as a busy one.
 *  w92 is the same source the calendar rows use — right-sized for this display width. */
export function FeedDayPoster({ items }: { items: FeedDayItem[] }) {
  const lead = items.find((item) => item.poster_path);
  const poster = posterUrl(lead?.poster_path ?? null, "w92");
  if (!lead || !poster) return null;
  return (
    <img
      src={poster}
      alt={`${lead.film_title} poster`}
      className="h-24 w-16 flex-none rounded object-cover"
    />
  );
}
