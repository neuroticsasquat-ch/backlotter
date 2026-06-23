import type { FilmDetail } from "@/api/types";
import { posterUrl } from "@/lib/poster";
import { ArcStepper } from "./ArcStepper";

/** Poster + title + year + the status arc. */
export function FilmHeader({ film }: { film: FilmDetail }) {
  const poster = posterUrl(film.poster_path, "w342");
  return (
    <header>
      <div className="flex items-start gap-4">
        {poster && (
          <img
            src={poster}
            alt={`${film.title} poster`}
            width={92}
            height={138}
            className="rounded-md"
          />
        )}
        <div>
          <h1 className="text-2xl font-bold">{film.title}</h1>
          {film.release_year && <p className="text-gray-500">{film.release_year}</p>}
        </div>
      </div>
      <ArcStepper current={film.arc_stage} />
    </header>
  );
}
