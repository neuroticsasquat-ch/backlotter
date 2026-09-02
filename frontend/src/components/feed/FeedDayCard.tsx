import { Link } from "react-router";
import type { FeedDayItem, FilmEvent } from "@/api/types";
import { arcStageLabel, eventTypeLabel } from "@/components/film/labels";

/** One (film, day) row for the home feed: the film title + year linked to the film page.
 *  Two row shapes, never both — a news-backed row lists each event as a summary line with
 *  real anchor source chips below it; a catalog row (which ships no events since NEU-1208)
 *  labels the day's beats as badges inline after the title, so it can be triaged without a
 *  page load (NEU-1212).
 *  Zebra-striped within its section — a day that carries both news-backed and TMDB-only
 *  updates renders them as two lists, and the stripe restarts under each. */
export function FeedDayCard({ item }: { item: FeedDayItem }) {
  return (
    <div className="block rounded px-2 py-1.5 text-sm odd:bg-muted/40 hover:bg-muted">
      <Link
        to={`/film/${item.film_ref}`}
        className="block -indent-3 pl-3 font-medium text-foreground hover:text-foreground"
      >
        {item.film_title}
        <span className="font-normal text-muted-foreground">
          {" "}
          ({item.release_year ?? arcStageLabel(item.arc_stage)})
        </span>
        {item.events.length === 0 &&
          item.event_types.length > 0 &&
          item.event_types.map((eventType) => (
            <span
              key={eventType}
              className="ml-2 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground"
            >
              {eventTypeLabel(eventType)}
            </span>
          ))}
      </Link>
      {item.events.length > 0 && (
        <div className="mt-1 space-y-1.5 pl-3">
          {item.events.map((event) => (
            <FeedEvent key={event.event_id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedEvent({ event }: { event: FilmEvent }) {
  return (
    <div>
      <p className="text-xs leading-relaxed text-foreground">
        <span className="mr-1 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground">
          {eventTypeLabel(event.event_type)}
        </span>
        {event.summary}
        {event.summary_edited ? (
          <span className="ml-1 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground">
            edited
          </span>
        ) : null}
      </p>
      <FeedEventSources sources={event.sources} />
    </div>
  );
}

function FeedEventSources({ sources }: { sources: FilmEvent["sources"] }) {
  if (sources.length === 0) {
    return null;
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      {sources.map((source, i) => (
        <a
          key={`${source.url}-${i}`}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={source.title}
          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground transition-colors hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-400"
        >
          {source.source}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-2.5 w-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 17 17 7" />
            <path d="M9 7h8v8" />
          </svg>
        </a>
      ))}
    </div>
  );
}
