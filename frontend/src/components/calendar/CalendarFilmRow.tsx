import { Link } from "react-router";
import type { CalendarItem } from "@/api/types";

/** One calendar row: film title + year, the whole row linked to /film/{slug}. Mirrors the
 *  home-feed row; zebra-striped within its release-type group. */
export function CalendarFilmRow({ item }: { item: CalendarItem }) {
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
