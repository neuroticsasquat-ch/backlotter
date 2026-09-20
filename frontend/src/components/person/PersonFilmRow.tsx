import { Link } from "react-router";
import type { CreditTier, PersonCredit, PersonFilm } from "@/api/types";
import { formatHeadlineRelease } from "@/lib/format";
import { posterSrcSet, posterUrl } from "@/lib/poster";

/** The badge on a row, one terse word per tier. Deliberately shorter than the coverage
 *  radios' labels ("Lead roles", "Major credits", "Every credit"): those name a *setting* the
 *  reader picks, this names the narrowest one that reaches this film, and it has to sit inside
 *  a row without crowding the title. */
const TIER_LABELS: Record<CreditTier, string> = {
  lead: "Lead",
  major: "Major",
  any: "Any",
};

/** What a follow at each tier would actually get you, for the badge's tooltip — the row says
 *  "Any", and the reader deserves to be told that is the widest setting rather than left to
 *  guess the ordering of three one-word badges. */
const TIER_HINTS: Record<CreditTier, string> = {
  lead: "Reaches this film at any coverage setting.",
  major: "Reaches this film at Major credits or Every credit.",
  any: "Only reaches this film at Every credit.",
};

/** One credit, in the word the reader knows it by: a crew member's job, a cast member's
 *  character. Both are nullable in the catalog — an uncredited crew role, a cast entry TMDB
 *  has no character for — so each falls back to its own kind rather than to an empty segment
 *  that would leave the line ending in a separator. */
function creditLabel(credit: PersonCredit): string {
  if (credit.credit_type === "crew") return credit.job ?? "Crew";
  return credit.character ?? "Cast";
}

/**
 * One film on a person's page, in the watchlist row's shape (poster, title, headline release)
 * plus what they did on it and the tier that reaches it.
 *
 * The credits are rendered in the order the backend sent them — narrowest tier first, then
 * billing — rather than re-sorted here, so "Director · Writer" reads the same way on both
 * sides of the wire.
 */
export function PersonFilmRow({ row }: { row: PersonFilm }) {
  const { film, credits, tier } = row;
  const poster = posterUrl(film.poster_path, "w92");
  const href = `/film/${film.ref}`;

  return (
    <li className="flex gap-3 py-3">
      <Link to={href} className="flex-none" tabIndex={-1} aria-hidden="true">
        {poster ? (
          <img
            src={poster}
            srcSet={posterSrcSet(film.poster_path) ?? undefined}
            sizes="48px"
            alt=""
            loading="lazy"
            className="h-[72px] w-12 rounded object-cover"
          />
        ) : (
          <div className="h-[72px] w-12 rounded bg-muted" />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link to={href} className="text-sm font-medium text-foreground hover:underline">
          {film.title}
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatHeadlineRelease(film.headline_release)}
        </p>
        {credits.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {credits.map(creditLabel).join(" · ")}
          </p>
        )}
      </div>

      <span
        title={TIER_HINTS[tier]}
        className="flex-none self-start rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
      >
        {TIER_LABELS[tier]}
      </span>
    </li>
  );
}

/** One of the page's two lists, or the line that says why it is empty. The empty state is a
 *  sentence rather than a hidden section: "no upcoming films" is real information about a
 *  person the reader is deciding whether to follow. */
export function PersonFilmSection({
  heading,
  rows,
  empty,
}: {
  heading: string;
  rows: PersonFilm[];
  empty: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-foreground">
        {heading} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {rows.map((row) => (
            <PersonFilmRow key={row.film.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
