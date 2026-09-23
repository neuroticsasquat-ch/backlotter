import type { ReactNode } from "react";
import { Link } from "react-router";
import type { FilmRow } from "@/api/types";
import { formatHeadlineRelease } from "@/lib/format";
import { posterSrcSet, posterUrl } from "@/lib/poster";

/**
 * One film cited on an entity page — a person's, a studio's or a franchise's: poster, title,
 * the one release date the backend chose.
 *
 * That is the whole row for a studio and a franchise, whose relationship to a film has nothing
 * to name. A person's adds a line of credits and a tier badge through `children` and `badge`,
 * which is the only difference between the three pages — the same split the backend made when
 * it pulled `FilmRowOut` out from under `PersonFilmOut` (NEU-1428). Keeping the poster, the
 * link and the date here means a film cannot render differently depending on whose page it is
 * cited on.
 */
export function EntityFilmRow({
  film,
  children,
  badge,
}: {
  film: FilmRow;
  children?: ReactNode;
  badge?: ReactNode;
}) {
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
        {children}
      </div>

      {badge}
    </li>
  );
}

/** One of an entity page's two lists, or the line that says why it is empty. The empty state is
 *  a sentence rather than a hidden section: "no upcoming films" is real information about a
 *  thing the reader is deciding whether to follow.
 *
 *  Takes the rows as `children` rather than mapping them itself, because the three pages hang
 *  different rows off the same section — bare for a studio and a franchise, credit-bearing for
 *  a person — and `count` is what the heading needs. */
export function EntityFilmSection({
  heading,
  count,
  empty,
  children,
}: {
  heading: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-foreground">
        {heading} <span className="font-normal text-muted-foreground">({count})</span>
      </h2>
      {count === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">{children}</ul>
      )}
    </section>
  );
}
