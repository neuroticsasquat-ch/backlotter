import type { FilmDetail } from "@/api/types";
import { formatEventDate, formatLanguage, formatRuntime } from "@/lib/format";
import { posterUrl } from "@/lib/poster";

/** Supplemental metadata section: tagline, backdrop, meta line, rating, genres,
 *  production companies, collection, and overview. Returns null when no data is present. */
export function FilmMeta({ film }: { film: FilmDetail }) {
  const hasAnyMeta =
    !!film.tagline ||
    !!film.backdrop_path ||
    !!film.release_date ||
    (film.runtime != null && film.runtime > 0) ||
    !!film.original_language ||
    (film.vote_average != null && film.vote_count != null && film.vote_count > 0) ||
    film.genres.length > 0 ||
    film.production_companies.length > 0 ||
    !!film.collection ||
    !!film.overview;

  if (!hasAnyMeta) return null;

  // Build the meta line by filtering truthy pieces and joining with " · "
  const metaPieces: string[] = [];
  if (film.release_date) metaPieces.push(formatEventDate(film.release_date));
  if (film.runtime != null && film.runtime > 0) metaPieces.push(formatRuntime(film.runtime));
  if (film.original_language) metaPieces.push(formatLanguage(film.original_language));
  const metaLine = metaPieces.join(" · ");

  const backdrop = posterUrl(film.backdrop_path, "w780");

  return (
    <section className="mt-6 space-y-3">
      {/* 1. Tagline */}
      {film.tagline && <p className="italic text-gray-500 text-sm">{film.tagline}</p>}

      {/* 2. Backdrop — fixed-ratio wrapper reserves space to avoid layout shift (CLS) */}
      {backdrop && (
        <div className="aspect-[16/9] overflow-hidden rounded-lg">
          <img
            src={backdrop}
            alt={`${film.title} backdrop`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* 3. Meta line */}
      {metaLine && <p className="text-sm text-gray-600">{metaLine}</p>}

      {/* 4. Rating */}
      {film.vote_average != null && film.vote_count != null && film.vote_count > 0 && (
        <p
          className="text-sm text-gray-700"
          aria-label={`Rating: ${film.vote_average.toFixed(1)} out of 10`}
        >
          {film.vote_average.toFixed(1)} /10
        </p>
      )}

      {/* 5. Genres */}
      {film.genres.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {film.genres.map((genre) => (
            <li key={genre} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {genre}
            </li>
          ))}
        </ul>
      )}

      {/* 6. Production companies */}
      {film.production_companies.length > 0 && (
        <p className="text-sm text-gray-600">{film.production_companies.join(", ")}</p>
      )}

      {/* 7. Collection — plain text, NOT a Link */}
      {film.collection && (
        <p className="text-sm text-gray-600">
          Part of <span className="font-medium">{film.collection.name}</span>
        </p>
      )}

      {/* 8. Overview */}
      {film.overview && <p className="text-sm leading-relaxed text-gray-700">{film.overview}</p>}
    </section>
  );
}
