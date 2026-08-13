import { Link } from "react-router";
import { posterSrcSet, posterUrl } from "@/lib/poster";
import { dayPosterLeads } from "@/lib/feed-groups";
import type { FeedDayItem } from "@/api/types";

/** How many of the strip's posters a phone shows. The rest stay in the DOM and are revealed
 *  from `sm` up, where the column is vertical and has the room. */
const MOBILE_POSTERS = 4;

/** The day's poster strip, each poster linking to its film.
 *
 *  Ordered by `dayPosterLeads`: news-backed films first, then TMDB-only ones, so the strip agrees
 *  with the sections below it. Backend order within a day is by popularity, so taking it raw put
 *  the day's most popular film here — TMDB-only often enough to look like a rule (NEU-1141).
 *
 *  Two layouts. On a phone it is a row above the day's updates, up to `MOBILE_POSTERS` wide,
 *  each poster growing to share the width. From `sm` up it is a column beside them, stretched to
 *  the event list's height and clipped to it, so the number on screen is however many fit — no
 *  measurement, so nothing shifts on hydration. The gradient mask fades the clipped edge rather
 *  than slicing a poster in half.
 *
 *  The clipping strip is absolutely positioned inside a stretched wrapper on purpose: laid out
 *  in flow it would contribute its full height, and a tall stack would set the row's height
 *  instead of the event list doing it. */
export function FeedDayPosters({ items }: { items: FeedDayItem[] }) {
  const leads = dayPosterLeads(items);
  if (leads.length === 0) return null;
  return (
    <div className="flex-none sm:relative sm:w-16 sm:self-stretch">
      <div className="flex gap-2 sm:absolute sm:inset-0 sm:flex-col sm:overflow-hidden sm:[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]">
        {leads.map((item, index) => (
          <Link
            key={item.film_ref}
            to={`/film/${item.film_ref}`}
            className={`min-w-0 max-w-28 flex-1 sm:max-w-none sm:flex-none ${
              index >= MOBILE_POSTERS ? "hidden sm:block" : ""
            }`}
          >
            <img
              src={posterUrl(item.poster_path, "w92") ?? undefined}
              srcSet={posterSrcSet(item.poster_path) ?? undefined}
              // A phone renders these ~4x wider than the desktop column does, so the width the
              // browser should fetch is not the same on both — `w92` alone came out upscaled
              // and soft on a phone.
              sizes="(min-width: 640px) 4rem, 22vw"
              alt={`${item.film_title} poster`}
              loading={index === 0 ? undefined : "lazy"}
              className="aspect-[2/3] w-full rounded object-cover sm:h-24 sm:w-16"
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
