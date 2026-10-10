import type { FeedDayItem } from "@/api/types";
import {
  type BlockLayout,
  groupByDay,
  layoutTimelineDay,
  rowKey,
  type SectionLayout,
} from "@/lib/feed-groups";
import { EntityRow } from "@/components/feed/EntityRow";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import { SectionWrapper } from "@/components/feed/FeedDayGroups";
import { FeedDayPosters } from "@/components/feed/FeedDayPosters";
import { FilmUpdateTypeRows, UpdateTypeGroups } from "@/components/feed/UpdateTypeGroups";
import { NOT_YET_REPORTED_LABEL, NOT_YET_REPORTED_QUALIFIER } from "@/components/film/labels";

// Space before every follow block after the first, wider than a section's: a block heading opens
// a new kind of follow, not one more half of the same one.
const BLOCK_BREAK = "[&:not(:first-child)]:mt-8";

/**
 * The signed-in timeline's day-by-day body (FB-1, FB-8). A day reads as the feed's does — the
 * heading, then one poster strip over everything that day — and is then laid out by the kind of
 * follow that delivered its rows: Films, People, Studios, Franchises, in that order, each block
 * holding the feed's two sections. A block with nothing that day renders nothing; the Films
 * heading renders whenever Films has rows, even alone, so every day reads the same.
 *
 * The feed keeps `FeedDayGroups`. The two used to share it, and the Films block still renders
 * exactly what it renders for a day. A row without `via` — every row, from a backend older than
 * the field — is a title row (FB-9), so against that backend this is today's layout under one
 * Films heading.
 *
 * Each day is `layoutTimelineDay`'s, and the strip and the blocks render that same layout, so the
 * strip reads in the blocks' order (NEU-1533): a Films-block film's poster leads a People-block
 * one's, whichever section either sits in.
 *
 * A card that reached the reader two ways is in both blocks (FB-5): rows are keyed by reach
 * (`rowKey`), never by film alone.
 */
export function TimelineDayGroups({ items }: { items: FeedDayItem[] }) {
  return (
    <div className="mt-6 space-y-8">
      {groupByDay(items).map((day) => {
        const layout = layoutTimelineDay(day.items);
        return (
          <section key={day.dayKey}>
            <h2 className="text-sm font-medium text-muted-foreground">
              <time dateTime={day.dayKey}>{day.heading}</time>
            </h2>
            <div className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-3">
              {/* Every block's films, each at its first appearance: a film two follows reached
                  has one poster, and an entity-only day still gets its strip (FB-7). */}
              <FeedDayPosters day={layout} />
              <div className="min-w-0 flex-1">
                {layout.blocks.map((block) => (
                  <FollowBlock key={block.key} block={block} />
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One follow block: its h3, then In the news and Not yet reported as h4 sections — only those
 *  with rows, which is all the layout holds (NEU-1467). */
function FollowBlock({ block }: { block: BlockLayout }) {
  return (
    <div className={BLOCK_BREAK}>
      <h3 className="mb-2 text-base font-semibold text-foreground">{block.label}</h3>
      <div>
        {block.sections.map((section) =>
          section.section === "news" ? (
            <SectionWrapper key={section.section} label="In the news" headingAs="h4">
              <SectionRows section={section} />
            </SectionWrapper>
          ) : (
            <SectionWrapper
              key={section.section}
              label={NOT_YET_REPORTED_LABEL}
              qualifier={NOT_YET_REPORTED_QUALIFIER}
              headingAs="h4"
            >
              <SectionRows section={section} />
            </SectionWrapper>
          ),
        )}
      </div>
    </div>
  );
}

/** A section's rows. Films render as the feed's do; an entity block renders one `EntityRow` per
 *  entity. Under In the news an entity line keeps both its pills; under Not yet reported the
 *  confidence pill goes — the section heading says "(unconfirmed)" — and the beat pill goes
 *  wherever the update-type heading already names it: under Attached, Detached and Canceled, not
 *  under Other updates (NR-5). */
function SectionRows({ section }: { section: SectionLayout }) {
  if (section.kind === "films") {
    return section.section === "news" ? (
      section.rows.map((item) => <FeedDayCard key={rowKey(item)} item={item} />)
    ) : (
      <UpdateTypeGroups groups={section.groups} headingAs="h5" renderGroup={FilmUpdateTypeRows} />
    );
  }
  return section.section === "news" ? (
    section.rows.map((row) => <EntityRow key={row.key} row={row} showBeat showConfidence />)
  ) : (
    <UpdateTypeGroups
      groups={section.groups}
      headingAs="h5"
      renderGroup={(group) =>
        group.rows.map((row) => (
          <EntityRow
            key={row.key}
            row={row}
            showBeat={group.key === "other"}
            showConfidence={false}
          />
        ))
      }
    />
  );
}
