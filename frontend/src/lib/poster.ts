import { env } from "@/env";

export function posterUrl(path: string | null, size: string): string | null {
  if (!path) return null;
  return `${env.tmdbImageBase}/${size}${path}`;
}

/** TMDB poster widths worth offering a browser. w92 covers the desktop feed column, w185 a
 *  phone at 1–2x, w342 a phone at 3x — past that the file cost outruns the visible gain at
 *  these display sizes. */
const POSTER_WIDTHS = [92, 185, 342];

/** A `srcSet` across `POSTER_WIDTHS`, for use with a `sizes` attribute. Returns null for a film
 *  with no poster, same as `posterUrl`. The feed strip renders one poster at ~64px on desktop
 *  and ~4x wider on a phone, so a single fixed width is either soft on one or wasteful on the
 *  other. */
export function posterSrcSet(path: string | null): string | null {
  if (!path) return null;
  return POSTER_WIDTHS.map((w) => `${env.tmdbImageBase}/w${w}${path} ${w}w`).join(", ");
}

export function profileUrl(path: string | null, size = "w185"): string | null {
  if (!path) return null;
  return `${env.tmdbImageBase}/${size}${path}`;
}
