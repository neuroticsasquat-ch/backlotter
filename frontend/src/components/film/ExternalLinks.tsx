/** Outbound links to the film on IMDb and TMDB, shown as clearly-clickable chips. The IMDb
 *  chip is omitted when the film has no imdb_id. */
export function ExternalLinks({ tmdbId, imdbId }: { tmdbId: number; imdbId: string | null }) {
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
    </div>
  );
}
