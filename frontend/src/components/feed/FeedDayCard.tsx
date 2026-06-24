import { Link } from "react-router";
import type { FeedDayItem } from "@/api/types";
import { posterUrl } from "@/lib/poster";
import { eventTypeLabel } from "@/components/film/labels";

/** One (film, day) row: poster + title + the day's top beat (with a muted +N when there were more). */
export function FeedDayCard({ item }: { item: FeedDayItem }) {
  const poster = posterUrl(item.poster_path, "w154");
  return (
    <Link
      to={`/film/${item.film_slug}`}
      className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50"
    >
      {poster ? (
        <img
          src={poster}
          alt={`${item.film_title} poster`}
          loading="lazy"
          className="aspect-[2/3] w-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="aspect-[2/3] w-12 shrink-0 rounded bg-gray-100" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold">{item.film_title}</h3>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-indigo-800">
            {eventTypeLabel(item.top_event_type)}
          </span>
          {item.event_count > 1 && <span className="text-gray-500">+{item.event_count - 1}</span>}
        </div>
      </div>
    </Link>
  );
}
