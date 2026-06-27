import { Link } from "react-router";
import type { FeedDayItem } from "@/api/types";

/** One (film, day) row for the home feed: just the film title + year, the whole
 *  row linked. The home feed only signals that a film has an update that day — not
 *  how many or what kind. Zebra-striped within its day list. */
export function FeedDayCard({ item }: { item: FeedDayItem }) {
  return (
    <Link
      to={`/film/${item.film_slug}`}
      className="block truncate rounded px-2 py-1.5 text-sm font-medium odd:bg-muted/40 hover:bg-muted"
    >
      {item.film_title}
      {item.release_year != null && (
        <span className="font-normal text-muted-foreground"> ({item.release_year})</span>
      )}
    </Link>
  );
}
