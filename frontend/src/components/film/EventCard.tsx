import type { FilmEvent } from "@/api/types";
import { cn } from "@/lib/cn";
import { formatEventDate } from "@/lib/format";
import { eventTypeLabel } from "./labels";
import { SourceLinks } from "./SourceLinks";

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const known = confidence === "confirmed" || confidence === "rumored";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        confidence === "confirmed" && "bg-green-100 text-green-800",
        confidence === "rumored" && "bg-amber-100 text-amber-800",
        !known && "bg-gray-100 text-gray-700",
      )}
    >
      {confidence === "confirmed" ? "Confirmed" : confidence === "rumored" ? "Rumored" : confidence}
    </span>
  );
}

/** One event in the timeline: beat, confidence, date, summary, and source links. */
export function EventCard({ event }: { event: FilmEvent }) {
  return (
    <article className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-indigo-800">
          {eventTypeLabel(event.event_type)}
        </span>
        <ConfidenceBadge confidence={event.confidence} />
        <time dateTime={event.occurred_at} className="ml-auto text-gray-400">
          {formatEventDate(event.occurred_at)}
        </time>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{event.summary}</p>
      <SourceLinks sources={event.sources} />
    </article>
  );
}
