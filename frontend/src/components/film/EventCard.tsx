import type { FilmEvent } from "@/api/types";
import { eventTypeLabel } from "./labels";
import { SourceLinks } from "./SourceLinks";

/** One update: a subtle inline beat tag leading the summary (the point of
 *  emphasis), then its source links. No card chrome and no per-event date — the
 *  timeline separates events with dividers and the day heading carries the date. */
export function EventCard({ event }: { event: FilmEvent }) {
  return (
    <article>
      <p className="text-[15px] leading-relaxed text-foreground">
        <span className="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[11px] font-medium uppercase leading-none tracking-wide text-muted-foreground">
          {eventTypeLabel(event.event_type)}
        </span>
        {event.summary}
      </p>
      <SourceLinks sources={event.sources} />
    </article>
  );
}
