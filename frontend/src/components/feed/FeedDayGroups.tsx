import { useState } from "react";
import type { FeedDayItem } from "@/api/types";
import { groupByDay, splitByNewsBacked } from "@/lib/feed-groups";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import { FeedDayPosters } from "@/components/feed/FeedDayPosters";
import { UNCONFIRMED_UPDATES_LABEL } from "@/components/film/labels";

// Every section opens with a rule and real space: the sub-heading otherwise lands between two
// striped rows and reads as one of them, and the first one needs the break just as much — to
// stand off the poster strip above it on a phone, and the dateline on desktop. The extra top
// margin is only from the second section on, so the first rule stays level with the top of the
// day's poster column rather than floating below it.
const SECTION_BREAK = "border-t border-border pt-4 [&:not(:first-child)]:mt-5";

/**
 * The day-by-day body of a grouped feed: one section per day, each split into its news-backed
 * and unconfirmed halves above a strip of that day's posters.
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
        // Every day renders both labelled sections. An empty section shows a static
        // "None today" line so the absence of catalog or news activity is legible.
        const sections = [
          { key: "news", label: "In the news", items: newsBacked },
          { key: "tmdb", label: UNCONFIRMED_UPDATES_LABEL, items: tmdbOnly },
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

/** Wraps a day section: "In the news" is always expanded; "unconfirmed updates" is
 *  collapsible and collapsed by default when non-empty, with a count of movies listed.
 *  An empty section renders a static "None today" line without a toggle. */
function SectionWrapper({
  section,
  children,
}: {
  section: { key: string; label: string; items: unknown[] };
  children: React.ReactNode;
}) {
  // TMDB section: collapsible, collapsed by default. Must be declared before any
  // early return so React hooks are called unconditionally (lint rule).
  const [open, setOpen] = useState(section.key !== "tmdb");

  const count = section.items.length;
  if (count === 0) {
    return (
      <div className={SECTION_BREAK}>
        <h3 className="px-2 pb-1.5 text-xs font-semibold tracking-wide text-foreground/80">
          {section.label}
        </h3>
        <p className="px-2 text-sm text-muted-foreground">None today</p>
      </div>
    );
  }

  const label = `${section.label} (${count} movie${count === 1 ? "" : "s"})`;

  if (section.key === "news") {
    return (
      <div className={SECTION_BREAK}>
        <h3 className="px-2 pb-1.5 text-xs font-semibold tracking-wide text-foreground/80">
          {label}
        </h3>
        {children}
      </div>
    );
  }
  return (
    <div className={SECTION_BREAK}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 pb-1.5 text-xs font-semibold tracking-wide text-foreground/80"
      >
        <svg
          className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path
            d="M5.5 3.5L10.5 8L5.5 12.5"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{label}</span>
      </button>
      {open && children}
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
