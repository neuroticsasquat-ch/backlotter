import { Link } from "react-router";
import type { FeedDayItem, FilmEvent } from "@/api/types";
import { arcStageLabel, eventTypeLabel } from "@/components/film/labels";

/** One (film, day) row for the home feed: the film title + year, then each event rendered
 *  as a summary line with source chips below it, matching the film detail page format.
 *  The title wraps rather than truncating (long titles are common and the mobile column is
 *  narrow); wrapped lines take a hanging indent so a second line reads as continuation rather
 *  than as its own row. Zebra-striped within its section — a day that carries both news-backed
 *  and TMDB-only updates renders them as two lists, and the stripe restarts under each. */
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
      {item.events.length > 0 && (
        <div className="mt-1 space-y-1.5 pl-3">
          {item.events.map((event) => (
            <FeedEvent key={event.event_id} event={event} />
          ))}
        </div>
      )}
    </Link>
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
      <FeedEventSources sources={event.sources} provenance={event.provenance} />
    </div>
  );
}

function FeedEventSources({
  sources,
  provenance,
}: {
  sources: FilmEvent["sources"];
  provenance: FilmEvent["provenance"];
}) {
  if (sources.length === 0) {
    if (provenance !== "catalog") return null;
    return <p className="mt-1 text-[11px] text-muted-foreground">via TMDB</p>;
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      {sources.map((source, i) => (
        <span
          key={`${source.url}-${i}`}
          role="link"
          tabIndex={0}
          title={source.title}
          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground transition-colors hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-400"
          onClick={(e) => {
            e.stopPropagation();
            window.open(source.url, "_blank", "noopener,noreferrer");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              window.open(source.url, "_blank", "noopener,noreferrer");
            }
          }}
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
        </span>
      ))}
    </div>
  );
}
