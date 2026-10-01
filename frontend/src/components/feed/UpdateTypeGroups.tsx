import type { UpdateTypeGroup } from "@/lib/feed-groups";
import { FEED_ROW, FeedEvents, FeedRowTitle } from "@/components/feed/FeedDayCard";
import { JustWatchAttribution } from "@/components/film/JustWatchAttribution";

/**
 * A day section laid out by update type: an h4 per heading, then one row per film with only
 * that heading's events (NR-3, NR-4). Takes the grouped headings rather than a section, so it
 * renders whatever `groupByUpdateType` was handed — today only Not yet reported (NR-7).
 *
 * A row is a `FeedDayCard` header without its badges or credit. Its event lines drop the beat
 * pill, which would only repeat the heading, except under Other updates, whose heading names
 * nothing (NR-5), and always drop the confidence badge, which the section heading's
 * "(unconfirmed)" replaces. Source chips still render when an event has any. The JustWatch credit appears
 * once, beneath the Now available block, the only heading whose bodies name providers (NR-8).
 * Each heading opens a new list, so the zebra stripe restarts under it. Groups sit well apart,
 * so a heading reads as the start of its block rather than the tail of the one above; the first
 * (the section's first `div`, after its h3) keeps a small gap under the section heading.
 */
export function UpdateTypeGroups({ groups }: { groups: UpdateTypeGroup[] }) {
  return groups.map((group) => (
    <div key={group.key} className="mt-6 first-of-type:mt-3">
      <h4 className="mb-1 border-b border-foreground/20 px-2 pb-1 text-xs font-bold uppercase tracking-wider text-foreground">
        {group.label}
      </h4>
      {group.rows.map(({ item, events }) => (
        <div key={item.film_ref} className={FEED_ROW}>
          <FeedRowTitle item={item} />
          <FeedEvents
            events={events}
            filmRef={item.film_ref}
            showBeat={group.key === "other"}
            showConfidence={false}
          />
        </div>
      ))}
      {group.key === "now_available" && (
        <div className="mt-1 px-2">
          <JustWatchAttribution />
        </div>
      )}
    </div>
  ));
}
