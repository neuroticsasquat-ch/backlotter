/** Outbound links to the film on IMDb and TMDB, shown as clearly-clickable chips. The IMDb
 *  chip is omitted when the film has no imdb_id.
 *
 *  `watchable` adds a third, **Where to watch (TMDB)**, to TMDB's own watch page for the film
 *  — what replaced the where-to-watch box (NEU-1542, ADR-0023): the site follows a film to its
 *  first home availability and no further, so where it streams today is TMDB's to answer. The
 *  page hosts no provider data, so the chip carries no JustWatch attribution. */
export function ExternalLinks({
  tmdbId,
  imdbId,
  watchable = false,
}: {
  tmdbId: number;
  imdbId: string | null;
  watchable?: boolean;
}) {
  const chip =
    "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-400";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {imdbId && (
        <a
          href={`https://www.imdb.com/title/${imdbId}/`}
          target="_blank"
          rel="noopener noreferrer"
          className={chip}
        >
          IMDb
        </a>
      )}
      <a
        href={`https://www.themoviedb.org/movie/${tmdbId}`}
        target="_blank"
        rel="noopener noreferrer"
        className={chip}
      >
        TMDB
      </a>
      {watchable && (
        <a
          href={`https://www.themoviedb.org/movie/${tmdbId}/watch?locale=US`}
          target="_blank"
          rel="noopener noreferrer"
          className={chip}
        >
          Where to watch (TMDB)
        </a>
      )}
    </div>
  );
}
