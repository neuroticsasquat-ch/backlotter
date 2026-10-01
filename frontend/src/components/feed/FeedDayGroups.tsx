import type { FeedDayItem } from "@/api/types";
import { groupByDay, groupByUpdateType, splitByNewsBacked } from "@/lib/feed-groups";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import { FeedDayPosters } from "@/components/feed/FeedDayPosters";
import { UpdateTypeGroups } from "@/components/feed/UpdateTypeGroups";
import { NOT_YET_REPORTED_LABEL, NOT_YET_REPORTED_QUALIFIER } from "@/components/film/labels";
import { SectionHeading } from "@/components/film/SectionHeading";

// Space before every section after the first. The filled heading bar is the divider itself, so
// the rule that used to open each section would only draw a second line above it.
const SECTION_BREAK = "[&:not(:first-child)]:mt-6";

/**
 * The day-by-day body of a grouped feed: one section per day, each split into its news-backed
 * and not-yet-reported halves above a strip of that day's posters. In the news is one row per
 * film; Not yet reported is laid out by update type (NR-1). This is the one place that decides
 * which section is grouped — `groupByUpdateType` and `UpdateTypeGroups` take any rows.
 *
 * Shared by the global feed and the signed-in timeline, which render the same DTO — `/me/timeline`
 * answers with `/feed/grouped`'s exact shape (NEU-1351), so the two differ in what they fetch and
 * in their heading, never in how a day looks.
 */
export function FeedDayGroups({ items }: { items: FeedDayItem[] }) {
  const groups = groupByDay(items);
  return (
    <div className="mt-6 space-y-8">
      {groups.map((group) => {
        const { newsBacked, tmdbOnly } = splitByNewsBacked(group.items);
        return (
          <section key={group.dayKey}>
            <h2 className="text-sm font-medium text-muted-foreground">
              <time dateTime={group.dayKey}>{group.heading}</time>
            </h2>
            <div className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-3">
              {/* One strip per day, not per section — it anchors the date, and takes the
                  whole day's items so its own news-first ordering applies. Above the list at
                  every width: beside it, a poster lined up with whatever row happened to sit
                  next to it and read as a label for an unrelated film. */}
              <FeedDayPosters items={group.items} />
              <div className="min-w-0 flex-1">
                {/* A day renders only the sections that have items — an empty one is
                    silence, never a placeholder line (NEU-1467). */}
                <SectionWrapper label="In the news" empty={newsBacked.length === 0}>
                  {newsBacked.map((item) => (
                    <FeedDayCard key={item.film_ref} item={item} />
                  ))}
                </SectionWrapper>
                <SectionWrapper
                  label={NOT_YET_REPORTED_LABEL}
                  qualifier={NOT_YET_REPORTED_QUALIFIER}
                  empty={tmdbOnly.length === 0}
                >
                  <UpdateTypeGroups groups={groupByUpdateType(tmdbOnly)} />
                </SectionWrapper>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Wraps a day section: a static heading, then the rows, always expanded. A section with no
 *  items renders nothing — no heading, no "None today" (NEU-1467). The heading carries no movie
 *  count (NR-6): under update types a film can appear more than once, so a count of rows would
 *  no longer be a count of films. */
function SectionWrapper({
  label,
  qualifier,
  empty,
  children,
}: {
  label: string;
  qualifier?: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  if (empty) return null;
  return (
    <div className={SECTION_BREAK}>
      <SectionHeading as="h3" label={label} qualifier={qualifier} />
      {children}
    </div>
  );
}

/** The "View more" control both paginated feeds share. Manual by design — never an infinite
 *  scroll — so the footer stays reachable. Renders nothing when there is no next page. */
export function ViewMoreButton({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="mt-8 text-center">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
      >
        {loading ? "Loading…" : "View more"}
      </button>
    </div>
  );
}
