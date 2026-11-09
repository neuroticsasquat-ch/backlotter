import { Link } from "react-router";
import { posterSrcSet, posterUrl } from "@/lib/poster";
import { type DayLayout, dayPosterLeads } from "@/lib/feed-groups";

/** The day's poster strip, a row above the day's updates at every width, each poster linking to
 *  its film.
 *
 *  Takes the day's layout, the one its renderer draws, and shows each film at its first
 *  appearance in it (`dayPosterLeads`): the strip reads in the order the rows below it do, and
 *  has no order of its own to drift from them. Its first poster is the first film the reader
 *  meets.
 *
 *  Posters are a fixed width and the row is clipped, so the number on screen is however many fit:
 *  about four on a phone, more on a wide viewport. The gradient mask fades the clipped edge rather
 *  than slicing a poster in half. It is CSS, not measurement, so nothing shifts on hydration and
 *  the count follows a resize for free.
 *
 *  A vertical column beside the list was the first attempt. It read badly — a poster sat level
 *  with whatever row happened to be beside it and looked like a label for a film it had nothing
 *  to do with. Above the list, the strip reads as belonging to the day. */
export function FeedDayPosters({ day }: { day: DayLayout }) {
  const leads = dayPosterLeads(day);
  if (leads.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-hidden [mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)]">
      {leads.map((item, index) => (
        <Link key={item.film_ref} to={`/film/${item.film_ref}`} className="w-20 flex-none">
          <img
            src={posterUrl(item.poster_path, "w185") ?? undefined}
            srcSet={posterSrcSet(item.poster_path) ?? undefined}
            sizes="5rem"
            alt={`${item.film_title} poster`}
            loading={index === 0 ? undefined : "lazy"}
            className="aspect-[2/3] w-full rounded object-cover"
          />
        </Link>
      ))}
    </div>
  );
}
