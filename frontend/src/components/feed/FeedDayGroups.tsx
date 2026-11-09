import type { FeedDayItem } from "@/api/types";
import { type FilmSectionLayout, groupByDay, layoutFeedDay } from "@/lib/feed-groups";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import { FeedDayPosters } from "@/components/feed/FeedDayPosters";
import { FilmUpdateTypeRows, UpdateTypeGroups } from "@/components/feed/UpdateTypeGroups";
import { NOT_YET_REPORTED_LABEL, NOT_YET_REPORTED_QUALIFIER } from "@/components/film/labels";
import { SectionHeading } from "@/components/film/SectionHeading";

// Space before every section after the first. The filled heading bar is the divider itself, so
// the rule that used to open each section would only draw a second line above it.
const SECTION_BREAK = "[&:not(:first-child)]:mt-6";

/**
 * The day-by-day body of a grouped feed: one section per day, each split into its news-backed
 * and not-yet-reported halves under a strip of that day's posters. In the news is one row per
 * film; Not yet reported is laid out by update type (NR-1).
 *
 * Each day is `layoutFeedDay`'s one Films block, whose heading the feed does not draw. The strip
 * and the sections render that same layout, so the strip reads in the sections' order
 * (NEU-1533). The global feed's alone: the signed-in timeline renders the same DTO but lays each
 * day out by follow block, through `TimelineDayGroups` (FB-8); it borrows `SectionWrapper` from
 * here, a heading level down.
 */
export function FeedDayGroups({ items }: { items: FeedDayItem[] }) {
  const groups = groupByDay(items);
  return (
    <div className="mt-6 space-y-8">
      {groups.map((group) => {
        const day = layoutFeedDay(group.items);
        return (
          <section key={group.dayKey}>
            <h2 className="text-sm font-medium text-muted-foreground">
              <time dateTime={group.dayKey}>{group.heading}</time>
            </h2>
            <div className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-3">
              {/* One strip per day, not per section — it anchors the date. Above the list at
                  every width: beside it, a poster lined up with whatever row happened to sit
                  next to it and read as a label for an unrelated film. */}
              <FeedDayPosters day={day} />
              <div className="min-w-0 flex-1">
                {/* The layout holds only sections with rows — an empty one is silence, never a
                    placeholder line (NEU-1467). */}
                {day.blocks.flatMap((block) =>
                  block.sections.map((section) => (
                    <FeedSection key={section.section} section={section} />
                  )),
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FeedSection({ section }: { section: FilmSectionLayout }) {
  return section.section === "news" ? (
    <SectionWrapper label="In the news">
      {section.rows.map((item) => (
        <FeedDayCard key={item.film_ref} item={item} />
      ))}
    </SectionWrapper>
  ) : (
    <SectionWrapper label={NOT_YET_REPORTED_LABEL} qualifier={NOT_YET_REPORTED_QUALIFIER}>
      <UpdateTypeGroups groups={section.groups} renderGroup={FilmUpdateTypeRows} />
    </SectionWrapper>
  );
}

/** Wraps a day section: a static heading, then the rows, always expanded. Only a section with
 *  rows reaches it — the day layout leaves an empty one out, so there is no "None today"
 *  (NEU-1467). The heading carries no movie count (NR-6): under update types a film can appear
 *  more than once, so a count of rows would no longer be a count of films. An h3 under the feed's
 *  day, an h4 under the timeline's follow block (FB-1). */
export function SectionWrapper({
  label,
  qualifier,
  headingAs = "h3",
  children,
}: {
  label: string;
  qualifier?: string;
  headingAs?: "h3" | "h4";
  children: React.ReactNode;
}) {
  return (
    <div className={SECTION_BREAK}>
      <SectionHeading as={headingAs} label={label} qualifier={qualifier} />
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
