import { Link } from "react-router";
import type { FeedDayItem } from "@/api/types";
import { arcStageLabel, eventTypeLabel } from "@/components/film/labels";
import { outletLabel } from "@/lib/feed-labels";

/** One (film, day) row for the home feed: the film title + year, then a badge for every beat
 *  the film saw that day, the whole row linked. An undated film shows its arc-stage label
 *  ("Announced") in the year's slot — the feed is the discovery surface for undated films, so an
 *  empty slot there would read as missing data rather than as a meaningful state.
 *  The title wraps rather than truncating (long titles are common and the mobile column is
 *  narrow); wrapped lines take a hanging indent so a second line reads as continuation rather
 *  than as its own row. The beat badges sit at that same indent, subordinate to the title.
 *  Zebra-striped within its section — a day that carries both news-backed and TMDB-only
 *  updates renders them as two lists, and the stripe restarts under each.
 *  When the row carries news stories (event_story_sources), each story is listed beneath the
 *  beat badges linked to its URL. */
export function FeedDayCard({ item }: { item: FeedDayItem }) {
  return (
    <Link
      to={`/film/${item.film_ref}`}
      className="block rounded px-2 py-1.5 text-sm odd:bg-muted/40 hover:bg-muted"
    >
      <span className="block -indent-3 pl-3 font-medium">
        {item.film_title}
        <span className="font-normal text-muted-foreground">
          {" "}
          ({item.release_year ?? arcStageLabel(item.arc_stage)})
        </span>
      </span>
      {item.event_types.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-1 pl-3">
          {item.event_types.map((eventType) => (
            <span
              key={eventType}
              className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase leading-none tracking-wide text-muted-foreground"
            >
              {eventTypeLabel(eventType)}
            </span>
          ))}
        </span>
      )}
      {item.event_story_sources && item.event_story_sources.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 pl-3">
          {item.event_story_sources.map((src, i) => (
            <li key={i}>
              <span
                role="link"
                tabIndex={0}
                className="group inline-flex cursor-pointer items-baseline gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(src.url, "_blank", "noopener,noreferrer");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    window.open(src.url, "_blank", "noopener,noreferrer");
                  }
                }}
              >
                <span className="shrink-0 font-medium text-foreground/60">
                  {outletLabel(src)}
                </span>
                <span className="truncate underline decoration-dotted underline-offset-2">
                  {src.title}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
