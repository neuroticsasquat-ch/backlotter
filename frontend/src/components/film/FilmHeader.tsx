import type { FilmDetail } from "@/api/types";
import { formatRuntime, pickRating } from "@/lib/format";
import { posterUrl } from "@/lib/poster";
import { ArcStepper } from "./ArcStepper";
import { ExternalLinks } from "./ExternalLinks";

/** Title + parenthetical year, then the poster beside the production-status arc
 *  (left-aligned), with a labeled spec sheet (countries, director, runtime, rating, genres)
 *  below. An undated film drops the parenthetical entirely rather than showing its arc-stage
 *  label: the `ArcStepper` directly below states production status in a better form, so
 *  "(Announced)" beside the title is duplication (NEU-1215). The feed row, which has no such
 *  affordance, keeps that fallback.
 *  The spec sheet is the complete structured record — it caps nothing, and the title
 *  parenthetical stays year-only here so the director is not repeated 100px above its own
 *  labelled row.
 *  Production companies render in their own collapsible section below the cast. */
export function FilmHeader({ film }: { film: FilmDetail }) {
  const poster = posterUrl(film.poster_path, "w342");
  const runtime = film.runtime != null && film.runtime > 0 ? formatRuntime(film.runtime) : null;
  const rating = pickRating(film.release_dates);

  const billing: [string, string[]][] = (
    [
      ["Director", "Director"],
      ["Screenplay", "Screenplay"],
      ["Writer", "Writer"],
      ["Story", "Story"],
    ] as const
  )
    .map(
      ([label, job]) =>
        [label, film.crew.filter((c) => c.job === job).map((c) => c.name)] as [string, string[]],
    )
    .filter(([, names]) => names.length > 0);

  return (
    <header>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h1 className="text-2xl font-bold">{film.title}</h1>
        {film.release_year != null && (
          <span className="text-2xl font-normal text-muted-foreground">({film.release_year})</span>
        )}
      </div>

      <div className="mt-4 flex items-start gap-4">
        {poster && (
          <img
            src={poster}
            alt={`${film.title} poster`}
            width={128}
            height={192}
            className="shrink-0 rounded-lg shadow-md ring-1 ring-black/10"
          />
        )}
        <div className="min-w-0 flex-1">
          <ArcStepper current={film.arc_stage} />
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2 text-sm text-foreground">
        {film.production_countries.length > 0 && (
          <>
            <dt className="text-muted-foreground">
              {film.production_countries.length === 1 ? "Country" : "Countries"}
            </dt>
            <dd>
              {film.production_countries.map((country) => (
                <div key={country}>{country}</div>
              ))}
            </dd>
          </>
        )}
        {billing.map(([label, names]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>
              {names.map((name, i) => (
                <div key={`${name}-${i}`}>{name}</div>
              ))}
            </dd>
          </div>
        ))}
        {runtime && (
          <>
            <dt className="text-muted-foreground">Runtime</dt>
            <dd>{runtime}</dd>
          </>
        )}
        {rating && (
          <>
            <dt className="text-muted-foreground">Rating</dt>
            <dd className="flex items-center gap-1.5">
              <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-xs font-semibold">
                {rating.certification}
              </span>
              {rating.country !== "US" && (
                <span className="text-xs text-muted-foreground">{rating.country}</span>
              )}
            </dd>
          </>
        )}
        {film.genres.length > 0 && (
          <>
            <dt className="text-muted-foreground">Genres</dt>
            <dd>
              <ul className="flex flex-wrap gap-1.5">
                {film.genres.map((genre) => (
                  <li
                    key={genre}
                    className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-300"
                  >
                    {genre}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      <div className="mt-4">
        <ExternalLinks tmdbId={film.tmdb_id} imdbId={film.imdb_id} />
      </div>
    </header>
  );
}
