import { Link } from "react-router";
import { posterUrl } from "@/lib/poster";
import type { CalendarItem } from "@/api/types";

/** One calendar row: poster thumbnail + title/year, director, top-billed stars, and genres.
 *  The whole row links to /film/{slug}; zebra-striped within its release-type group. */
export function CalendarFilmRow({ item }: { item: CalendarItem }) {
  const poster = posterUrl(item.poster_path, "w92");
  return (
    <Link
      to={`/film/${item.film_slug}`}
      className="flex gap-3 rounded px-2 py-2 odd:bg-muted/40 hover:bg-muted"
    >
      {poster ? (
        <img
          src={poster}
          alt={item.film_title}
          className="h-[72px] w-12 flex-none rounded object-cover"
        />
      ) : (
        <div className="h-[72px] w-12 flex-none rounded bg-muted" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 text-sm">
        <div className="truncate font-medium">
          {item.film_title}
          {item.release_year != null && (
            <span className="font-normal text-muted-foreground"> ({item.release_year})</span>
          )}
        </div>
        {item.director && (
          <div className="truncate text-muted-foreground">Dir. {item.director}</div>
        )}
        {item.stars.length > 0 && (
          <div className="truncate text-muted-foreground">{item.stars.join(" · ")}</div>
        )}
        {item.genres.length > 0 && (
          <div className="truncate text-muted-foreground">{item.genres.join(" · ")}</div>
        )}
      </div>
    </Link>
  );
}
