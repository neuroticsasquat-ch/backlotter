import type { FilmDayGroup, FilmEvent } from "@/api/types";
import {
  NOT_YET_REPORTED_LABEL,
  NOT_YET_REPORTED_QUALIFIER,
  SECTION_SPLIT_EXPLAINER,
} from "./labels";
import { SectionHeading } from "./SectionHeading";
import { CollapsibleSection } from "./CollapsibleSection";
import { EventCard } from "./EventCard";

// The filled heading bar is the divider; this is only the space before the second section.
const SECTION_BREAK = "[&:not(:first-child)]:mt-6";

function TmdbSubSection({ events, day }: { events: FilmEvent[]; day: string }) {
  return (
    <div className={SECTION_BREAK}>
      <SectionHeading
        as="h4"
        label={NOT_YET_REPORTED_LABEL}
        qualifier={NOT_YET_REPORTED_QUALIFIER}
      />
      <EventList events={events} day={day} showConfidence={false} />
    </div>
  );
}

/** `day` is the group's heading date, handed to each card for its first-seen disclosure. */
function EventList({
  events,
  day,
  showConfidence = true,
}: {
  events: FilmEvent[];
  day: string;
  showConfidence?: boolean;
}) {
  return (
    <ol className="mt-2 space-y-4">
      {events.map((event, i) => (
        <li
          key={`${event.event_type}-${event.created_at}-${i}`}
          className="border-l-2 border-border pl-3"
        >
          <EventCard event={event} day={day} showConfidence={showConfidence} />
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
          <p className="text-sm text-muted-foreground">{SECTION_SPLIT_EXPLAINER}</p>
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
                    <div className={SECTION_BREAK}>
                      <SectionHeading as="h4" label="In the news" />
                      <EventList events={group.news_events} day={group.day} />
                    </div>
                  )}
                  {hasTmdb && <TmdbSubSection events={group.tmdb_events} day={group.day} />}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}
