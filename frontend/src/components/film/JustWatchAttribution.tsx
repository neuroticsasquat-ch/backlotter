/**
 * The JustWatch credit and the link back to TMDB's watch page.
 *
 * An obligation, not a caption: TMDB's terms for `/movie/{id}/watch/providers` require crediting
 * JustWatch wherever the data renders and linking back to TMDB's own page (D-28, D-29). It lives
 * in its own module, and the wording is written here rather than taken from a payload, so that
 * the terms exist in exactly one version. The film page's where-to-watch box is the first
 * surface; the `now_available` cards on the feed and the timeline are the second (NEU-1402) and
 * import this rather than restate it.
 *
 * `link` is nullable because TMDB omits it for some regions — the credit renders either way, and
 * a card has no link to offer at all.
 */
export function JustWatchAttribution({ link }: { link?: string | null }) {
  return (
    <p className="text-xs text-muted-foreground">
      Availability from JustWatch
      {link && (
        <>
          {" · "}
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            View on TMDB
          </a>
        </>
      )}
    </p>
  );
}
