import type { FilmEvent } from "@/api/types";
import { groupEventsByDay } from "@/lib/feed-groups";
import { CollapsibleSection } from "./CollapsibleSection";
import { EventCard } from "./EventCard";

/** The "Latest updates" section: summarized events grouped by day (newest day first),
 *  each a divider-separated row (no card chrome) under a muted day heading. A collapsible
 *  section like Cast / Companies, but expanded by default, showing the total event count.
 *  Events carry their own per-event rails, so the section itself isn't railed. */
export function EventTimeline({ events }: { events: FilmEvent[] }) {
  const groups = events.length > 0 ? groupEventsByDay(events) : [];
  return (
    <CollapsibleSection title="Latest updates" count={events.length} defaultOpen railed={false}>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No updates yet — check back soon.</p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.dayKey}>
              <h3 className="text-sm font-medium text-muted-foreground">
                <time dateTime={group.dayKey}>{group.heading}</time>
              </h3>
              <ol className="mt-2 space-y-4">
                {group.events.map((event, i) => (
                  <li
                    key={`${event.event_type}-${event.created_at}-${i}`}
                    className="border-l-2 border-border pl-3"
                  >
                    <EventCard event={event} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}
