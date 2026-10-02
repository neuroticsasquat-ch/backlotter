import type { FeedDayItem } from "@/api/types";
import {
  ENTITY_UPDATE_TYPE_MAP,
  type FollowBlockGroup,
  groupByDay,
  groupByEntity,
  groupByFollowBlock,
  groupByUpdateType,
  rowKey,
  splitByNewsBacked,
  type UpdateTypeRow,
} from "@/lib/feed-groups";
import { EntityRow } from "@/components/feed/EntityRow";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import { SectionWrapper } from "@/components/feed/FeedDayGroups";
import { FeedDayPosters } from "@/components/feed/FeedDayPosters";
import { UpdateTypeGroups } from "@/components/feed/UpdateTypeGroups";
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
 * A card that reached the reader two ways is in both blocks (FB-5): rows are keyed by reach
 * (`rowKey`), never by film alone.
 */
export function TimelineDayGroups({ items }: { items: FeedDayItem[] }) {
  return (
    <div className="mt-6 space-y-8">
      {groupByDay(items).map((day) => (
        <section key={day.dayKey}>
          <h2 className="text-sm font-medium text-muted-foreground">
            <time dateTime={day.dayKey}>{day.heading}</time>
          </h2>
          <div className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-3">
            {/* The whole day's rows, every block's: `dayPosterLeads` de-duplicates a film two
                follows reached, and an entity-only day still gets its strip (FB-7). */}
            <FeedDayPosters items={day.items} />
            <div className="min-w-0 flex-1">
              {groupByFollowBlock(day.items).map((block) => (
                <FollowBlock key={block.key} block={block} />
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/** One follow block: its h3, then In the news and Not yet reported as h4 sections, each
 *  rendered only when it has rows (NEU-1467). */
function FollowBlock({ block }: { block: FollowBlockGroup }) {
  const { newsBacked, tmdbOnly } = splitByNewsBacked(block.items);
  return (
    <div className={BLOCK_BREAK}>
      <h3 className="mb-2 text-base font-semibold text-foreground">{block.label}</h3>
      <div>
        <SectionWrapper label="In the news" empty={newsBacked.length === 0} headingAs="h4">
          {block.key === "films" ? (
            newsBacked.map((item) => <FeedDayCard key={rowKey(item)} item={item} />)
          ) : (
            <EntityRows items={newsBacked} showBeat showConfidence />
          )}
        </SectionWrapper>
        <SectionWrapper
          label={NOT_YET_REPORTED_LABEL}
          qualifier={NOT_YET_REPORTED_QUALIFIER}
          empty={tmdbOnly.length === 0}
          headingAs="h4"
        >
          {block.key === "films" ? (
            <UpdateTypeGroups groups={groupByUpdateType(tmdbOnly)} headingAs="h5" />
          ) : (
            <UpdateTypeGroups
              groups={groupByUpdateType(tmdbOnly, ENTITY_UPDATE_TYPE_MAP)}
              headingAs="h5"
              // The heading names the type under Attached, Detached and Canceled, so the beat
              // pill goes; under Other updates it names nothing, and the pill stays (NR-5).
              renderGroup={(group) => (
                <EntityRows
                  items={group.rows}
                  showBeat={group.key === "other"}
                  showConfidence={false}
                />
              )}
            />
          )}
        </SectionWrapper>
      </div>
    </div>
  );
}

/** A section's (or an update type's) entity-reach rows, merged to one row per entity. Under In
 *  the news a line keeps both its pills; under Not yet reported the confidence pill goes — the
 *  section heading says "(unconfirmed)" — and the beat pill goes wherever the update-type
 *  heading already names it (NR-5). */
function EntityRows({
  items,
  showBeat,
  showConfidence,
}: {
  items: (FeedDayItem | UpdateTypeRow)[];
  showBeat: boolean;
  showConfidence: boolean;
}) {
  return groupByEntity(items).map((row) => (
    <EntityRow key={row.key} row={row} showBeat={showBeat} showConfidence={showConfidence} />
  ));
}
