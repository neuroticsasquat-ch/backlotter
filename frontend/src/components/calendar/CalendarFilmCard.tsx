import { Link } from "react-router";
import type { CalendarItem } from "@/api/types";
import { posterUrl } from "@/lib/poster";

/** One grid cell on the /calendar page: poster (or placeholder) + title, linked to /film/{slug}. */
export function CalendarFilmCard({ item }: { item: CalendarItem }) {
  const poster = posterUrl(item.poster_path, "w185");

  return (
    <Link
      to={`/film/${item.film_slug}`}
      className="group flex flex-col overflow-hidden rounded-md shadow-sm hover:shadow-md"
    >
      {/* 2:3 aspect poster area */}
      <div className="aspect-[2/3] w-full overflow-hidden bg-gray-100">
        {poster ? (
          <img
            src={poster}
            alt={`${item.film_title} poster`}
            width={185}
            height={278}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            data-testid="poster-placeholder"
            className="flex h-full w-full items-center justify-center bg-gray-200 text-xs text-gray-400"
          >
            No poster
          </div>
        )}
      </div>

      {/* Text area */}
      <div className="p-2">
        <p className="truncate text-sm font-semibold">{item.film_title}</p>
      </div>
    </Link>
  );
}
