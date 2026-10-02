import type { UpdateTypeGroup } from "@/lib/feed-groups";
import { rowKey } from "@/lib/feed-groups";
import { FEED_ROW, FeedEvents, FeedRowTitle } from "@/components/feed/FeedDayCard";
import { JustWatchAttribution } from "@/components/film/JustWatchAttribution";

/**
 * A day section laid out by update type: a heading per update type, then its rows (NR-3, NR-4).
 * Takes the grouped headings rather than a section, so it renders whatever `groupByUpdateType`
 * was handed — today only Not yet reported (NR-7), under whichever map the caller chose (FB-4).
 *
 * The heading is an h4 on the feed, whose sections are h3s, and an h5 on the timeline, where a
 * follow block sits between the day and the section (FB-1). What sits under each heading is the
 * caller's `renderGroup`: by default, film rows (`FilmUpdateTypeRows`) — the feed's layout and
 * the timeline's Films block; an entity block passes its own. Each heading opens a new list, so
 * the zebra stripe restarts under it. Groups sit well apart, so a heading reads as the start of
 * its block rather than the tail of the one above; the first (the section's first `div`, after
 * its section heading) keeps a small gap under that heading.
 */
export function UpdateTypeGroups<K extends string>({
  groups,
  headingAs: Heading = "h4",
  renderGroup = FilmUpdateTypeRows,
}: {
  groups: UpdateTypeGroup<K>[];
  headingAs?: "h4" | "h5";
  renderGroup?: (group: UpdateTypeGroup<K>) => React.ReactNode;
}) {
  return groups.map((group) => (
    <div key={group.key} className="mt-6 first-of-type:mt-3">
      <Heading className="mb-1 border-b border-foreground/20 px-2 pb-1 text-xs font-bold uppercase tracking-wider text-foreground">
        {group.label}
      </Heading>
      {renderGroup(group)}
    </div>
  ));
}

/**
 * One update type's film rows: a `FeedDayCard` header without its badges or credit. Its event
 * lines drop the beat pill, which would only repeat the heading, except under Other updates,
 * whose heading names nothing (NR-5), and always drop the confidence badge, which the section
 * heading's "(unconfirmed)" replaces. Source chips still render when an event has any. The
 * JustWatch credit appears once, beneath the Now available block, the only heading whose bodies
 * name providers (NR-8) — and only here, so it never fires under an entity block.
 */
function FilmUpdateTypeRows<K extends string>(group: UpdateTypeGroup<K>) {
  return (
    <>
      {group.rows.map(({ item, events }) => (
        <div key={rowKey(item)} className={FEED_ROW}>
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
    </>
  );
}
