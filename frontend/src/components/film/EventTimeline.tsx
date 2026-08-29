import type { FilmDayGroup, FilmEvent } from "@/api/types";
import { CollapsibleSection } from "./CollapsibleSection";
import { EventCard } from "./EventCard";

const SECTION_BREAK = "border-t border-border pt-4 [&:not(:first-child)]:mt-5";

function TmdbSubSection({ events }: { events: FilmEvent[] }) {
  return (
    <div className={SECTION_BREAK}>
      <h4 className="px-2 pb-1.5 text-xs font-semibold tracking-wide text-foreground/80">
        via TMDB
      </h4>
      <EventList events={events} />
    </div>
  );
}

function EventList({ events }: { events: FilmEvent[] }) {
  return (
    <ol className="mt-2 space-y-4">
      {events.map((event, i) => (
        <li
          key={`${event.event_type}-${event.created_at}-${i}`}
          className="border-l-2 border-border pl-3"
        >
          <EventCard event={event} />
        </li>
      ))}
    </ol>
  );
}

export function EventTimeline({ dayGroups }: { dayGroups: FilmDayGroup[] }) {
  const totalEvents = dayGroups.reduce(
    (acc, g) => acc + g.news_events.length + g.tmdb_events.length,
    0,
  );
  return (
    <CollapsibleSection title="Latest updates" count={totalEvents} defaultOpen railed={false}>
      {dayGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No updates yet — check back soon.</p>
      ) : (
        <div className="space-y-6">
          {dayGroups.map((group) => {
            const hasNews = group.news_events.length > 0;
            const hasTmdb = group.tmdb_events.length > 0;
            return (
              <section key={group.day}>
                <h3 className="text-sm font-medium text-muted-foreground">
                  <time dateTime={group.day}>{group.heading}</time>
                </h3>
                <div className="mt-2 space-y-0">
                  {hasNews && (
                    <div className={hasTmdb ? SECTION_BREAK : ""}>
                      <h4 className="px-2 pb-1.5 text-xs font-semibold tracking-wide text-foreground/80">
                        In the news
                      </h4>
                      <EventList events={group.news_events} />
                    </div>
                  )}
                  {hasTmdb && <TmdbSubSection events={group.tmdb_events} />}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}
