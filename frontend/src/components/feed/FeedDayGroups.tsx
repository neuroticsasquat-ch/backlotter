import type { FeedDayItem } from "@/api/types";
import { groupByDay, splitByNewsBacked } from "@/lib/feed-groups";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import { FeedDayPosters } from "@/components/feed/FeedDayPosters";
import { NOT_YET_REPORTED_LABEL } from "@/components/film/labels";

// Every section opens with a rule and real space: the sub-heading otherwise lands between two
// striped rows and reads as one of them, and the first one needs the break just as much — to
// stand off the poster strip above it on a phone, and the dateline on desktop. The extra top
// margin is only from the second section on, so the first rule stays level with the top of the
// day's poster column rather than floating below it.
const SECTION_BREAK = "border-t border-border pt-4 [&:not(:first-child)]:mt-5";

/**
 * The day-by-day body of a grouped feed: one section per day, each split into its news-backed
 * and not-yet-reported halves above a strip of that day's posters.
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
        // A day renders only the sections that have items — an empty one is silence, never a
        // placeholder line (NEU-1467).
        const sections = [
          { key: "news", label: "In the news", items: newsBacked },
          { key: "tmdb", label: NOT_YET_REPORTED_LABEL, items: tmdbOnly },
        ];
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
                {sections.map((section) => (
                  <SectionWrapper key={section.key} section={section}>
                    {section.items.map((item) => (
                      <FeedDayCard key={item.film_ref} item={item} />
                    ))}
                  </SectionWrapper>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Wraps a day section: a static heading with its movie count, then the rows, always expanded.
 *  A section with no items renders nothing — no heading, no "None today" (NEU-1467). */
function SectionWrapper({
  section,
  children,
}: {
  section: { key: string; label: string; items: unknown[] };
  children: React.ReactNode;
}) {
  const count = section.items.length;
  if (count === 0) return null;
  return (
    <div className={SECTION_BREAK}>
      <h3 className="px-2 pb-1.5 text-xs font-semibold tracking-wide text-foreground/80">
        {`${section.label} (${count} movie${count === 1 ? "" : "s"})`}
      </h3>
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
