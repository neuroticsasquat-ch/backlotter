import { Link } from "react-router";
import type { FeedDayItem } from "@/api/types";
import { arcStageLabel } from "@/components/film/labels";

/** One (film, day) row for the home feed: just the film title + year, the whole
 *  row linked. An undated film shows its arc-stage label ("Announced") in the year's
 *  slot — the feed is the discovery surface for undated films, so an empty slot there
 *  would read as missing data rather than as a meaningful state.
 *  The home feed only signals that a film has an update that day — not how many or
 *  what kind. Zebra-striped within its day list. */
export function FeedDayCard({ item }: { item: FeedDayItem }) {
  return (
    <Link
      to={`/film/${item.film_slug}`}
      className="block truncate rounded px-2 py-1.5 text-sm font-medium odd:bg-muted/40 hover:bg-muted"
    >
      {item.film_title}
      <span className="font-normal text-muted-foreground">
        {" "}
        ({item.release_year ?? arcStageLabel(item.arc_stage)})
      </span>
    </Link>
  );
}
