import { Link } from "react-router";
import type { FeedDayItem, FilmEvent } from "@/api/types";
import {
  RETRACTED_LABEL,
  confidenceLabel,
  eventAnchorId,
  eventTypeLabel,
} from "@/components/film/labels";
import { JustWatchAttribution } from "@/components/film/JustWatchAttribution";
import { filmParenthetical } from "@/lib/format";

const PILL =
  "inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase leading-none tracking-wide";

const CONFIDENCE_PILL = {
  confirmed: "bg-muted text-muted-foreground",
  unconfirmed: "bg-amber-100 text-amber-800",
} as const;

/** One (film, day) row for the home feed: the film title + its parenthetical, linked to the
 *  film page. The parenthetical carries country, director, and year (NEU-1215) — country and
 *  director being what let a reader place an unfamiliar title without a page load, on a feed
 *  where 78% of films have no year at all. It is never empty: `filmParenthetical` falls back
 *  to the arc-stage label.
 *  Two row shapes, never both — a news-backed row lists each event as a summary line with
 *  real anchor source chips below it; a catalog row (which ships no events since NEU-1208)
 *  labels the day's beats as badges inline after the title, so it can be triaged without a
 *  page load (NEU-1212). Those badges need `indent-0`: the link's `-indent-3` hanging indent
 *  inherits into them, and an inline-block re-applies it to its own first line, which paints
 *  the label outside its own pill (NEU-1214).
 *  Zebra-striped within its section — a day that carries both news-backed and TMDB-only
 *  updates renders them as two lists, and the stripe restarts under each. */
export function FeedDayCard({ item }: { item: FeedDayItem }) {
  // A now_available beat's body names the providers a poll found the film on (D-28), so this row
  // is a surface where provider names render and TMDB's terms want JustWatch credited on it.
  // Keyed off `event_types` rather than the row's events, because a catalog row ships none
  // (NEU-1208) and the badge set is all it has; once per row, whichever shape it takes. The row
  // has no per-film watch link to pass — that is the film page's `where_to_watch.link`.
  const showAttribution = item.event_types.includes("now_available");
  return (
    <div className="block rounded px-2 py-1.5 text-sm odd:bg-muted/40 hover:bg-muted">
      <Link
        to={`/film/${item.film_ref}`}
        className="block -indent-3 pl-3 font-medium text-foreground hover:text-foreground"
      >
        {item.film_title}
        <span className="font-normal text-muted-foreground"> ({filmParenthetical(item)})</span>
        {item.events.length === 0 &&
          item.event_types.length > 0 &&
          item.event_types.map((eventType) => (
            <span
              key={eventType}
              className="ml-2 inline-block indent-0 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground"
            >
              {eventTypeLabel(eventType)}
            </span>
          ))}
      </Link>
      {item.events.length > 0 && (
        <div className="mt-1 space-y-1.5 pl-3">
          {item.events.map((event) => (
            <FeedEvent key={event.event_id} event={event} filmRef={item.film_ref} />
          ))}
        </div>
      )}
      {showAttribution && (
        <div className="mt-1 pl-3">
          <JustWatchAttribution />
        </div>
      )}
    </div>
  );
}

/** One event line on a news-backed feed row. Carries the D-9 confidence badge and, on a
 *  superseded event, the D-2 "later retracted" marker — linked to the film page, since the
 *  retraction is a different day's card and so never on this row. No first-seen line: the feed
 *  is a publication log (ADR-0016), so its heading already says when this was published. */
function FeedEvent({ event, filmRef }: { event: FilmEvent; filmRef: string }) {
  const confidence = confidenceLabel(event.confidence);
  return (
    <div>
      <p className="text-xs leading-relaxed text-foreground">
        <span className={`mr-1 bg-muted text-muted-foreground ${PILL}`}>
          {eventTypeLabel(event.event_type)}
        </span>
        <span className={`mr-1 ${CONFIDENCE_PILL[confidence]} ${PILL}`}>{confidence}</span>
        {event.summary}
        {event.summary_edited ? (
          <span className={`ml-1 bg-muted text-muted-foreground ${PILL}`}>edited</span>
        ) : null}
        {event.status === "superseded" ? (
          event.superseded_by ? (
            <Link
              to={`/film/${filmRef}#${eventAnchorId(event.superseded_by)}`}
              className="ml-1 text-[11px] italic text-muted-foreground underline-offset-2 hover:underline"
            >
              {RETRACTED_LABEL}
            </Link>
          ) : (
            <span className="ml-1 text-[11px] italic text-muted-foreground">{RETRACTED_LABEL}</span>
          )
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
