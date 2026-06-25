import type { FilmEvent } from "@/api/types";
import { groupEventsByDay } from "@/lib/feed-groups";
import { EventCard } from "./EventCard";

/** Summarized events grouped by day (newest day first), or an empty-state message. */
export function EventTimeline({ events }: { events: FilmEvent[] }) {
  if (events.length === 0) {
    return <p className="mt-8 text-sm text-gray-500">No updates yet — check back soon.</p>;
  }
  const groups = groupEventsByDay(events);
  return (
    <div className="mt-8 space-y-8">
      {groups.map((group) => (
        <section key={group.dayKey}>
          <h2 className="text-sm font-medium text-gray-500">
            <time dateTime={group.dayKey}>{group.heading}</time>
          </h2>
          <ol className="mt-2 space-y-4">
            {group.events.map((event, i) => (
              <li key={`${event.event_type}-${event.occurred_at}-${i}`}>
                <EventCard event={event} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
