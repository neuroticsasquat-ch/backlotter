import { Link } from "react-router";
import type { FeedDayItem } from "@/api/types";
import { eventTypeLabel } from "@/components/film/labels";

/** One (film, day) row: title + the day's top beat (with a muted +N when there were more), the whole row linked. */
export function FeedDayCard({ item }: { item: FeedDayItem }) {
  return (
    <Link
      to={`/film/${item.film_slug}`}
      className="flex items-center justify-between gap-3 px-2 py-2 hover:bg-gray-50"
    >
      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{item.film_title}</h3>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-indigo-800">
          {eventTypeLabel(item.top_event_type)}
        </span>
        {item.event_count > 1 && <span className="text-gray-500">+{item.event_count - 1}</span>}
      </div>
    </Link>
  );
}
