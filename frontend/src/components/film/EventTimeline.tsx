import type { FilmEvent } from "@/api/types";
import { EventCard } from "./EventCard";

/** The chronological (ascending) list of summarized events, or an empty-state message. */
export function EventTimeline({ events }: { events: FilmEvent[] }) {
  if (events.length === 0) {
    return <p className="mt-8 text-sm text-gray-500">No updates yet — check back soon.</p>;
  }
  return (
    <ol className="mt-8 space-y-4">
      {events.map((event, i) => (
        <li key={`${event.event_type}-${event.occurred_at}-${i}`}>
          <EventCard event={event} />
        </li>
      ))}
    </ol>
  );
}
