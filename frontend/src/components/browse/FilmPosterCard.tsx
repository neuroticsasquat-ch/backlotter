import { Link } from "react-router";
import type { FilmIndexItem } from "@/api/types";
import { posterUrl } from "@/lib/poster";

/** One grid cell on the /browse page: poster (or placeholder) + title + year, linked to /film/{slug}. */
export function FilmPosterCard({ item }: { item: FilmIndexItem }) {
  const poster = posterUrl(item.poster_path, "w342");

  return (
    <Link
      to={`/film/${item.slug}`}
      className="group flex flex-col overflow-hidden rounded-md shadow-sm hover:shadow-md"
    >
      {/* 2:3 aspect poster area */}
      <div className="aspect-[2/3] w-full overflow-hidden bg-gray-100">
        {poster ? (
          <img
            src={poster}
            alt={`${item.title} poster`}
            width={342}
            height={513}
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
        <p className="truncate text-sm font-semibold">{item.title}</p>
        {item.release_year && <p className="text-xs text-gray-500">{item.release_year}</p>}
      </div>
    </Link>
  );
}
