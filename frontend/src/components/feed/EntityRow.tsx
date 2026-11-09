import { Link } from "react-router";
import type { FeedVia } from "@/api/types";
import type { EntityRow as EntityRowGroup } from "@/lib/feed-groups";
import { FEED_ROW, FeedEvent } from "@/components/feed/FeedDayCard";
import { ENTITY_FALLBACK_NAMES, ENTITY_ROUTE_SEGMENTS } from "@/components/film/labels";
import { filmParenthetical } from "@/lib/format";

/**
 * One followed entity's row under a People, Studios or Franchises block (FB-3): the entity's
 * name as the headline, then a line per card it delivered, each opening with the film it is
 * about. The feed row's shape turned inside out — the subject the reader follows leads, and the
 * film (which they may never have heard of) is named on the line.
 *
 * No image and no parenthetical on the headline. The pills follow the caller: `showBeat` off
 * under a heading that names the type, `showConfidence` off under Not yet reported (NR-5). No
 * JustWatch credit, ever: `now_available` cannot reach an entity follow (EF-3), and one that
 * somehow did reads as any Other update. Zebra-striped on its parent, as `FeedDayCard` is.
 */
export function EntityRow({
  row,
  showBeat,
  showConfidence,
}: {
  row: EntityRowGroup;
  showBeat: boolean;
  showConfidence: boolean;
}) {
  return (
    <div className={FEED_ROW}>
      <EntityHeadline via={row.via} />
      <div className="mt-1 space-y-1.5 pl-3">
        {row.lines.map(({ item, event }) => (
          <FeedEvent
            key={event.event_id}
            event={event}
            filmRef={item.film_ref}
            showBeat={showBeat}
            showConfidence={showConfidence}
            lead={
              <>
                {/* Title and parenthetical as one link, in the row-title weight: on this row
                    the film is the line's subject, as the entity is the row's. */}
                <Link
                  to={`/film/${item.film_ref}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {item.film_title}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    ({filmParenthetical(item)})
                  </span>
                </Link>
                {" — "}
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}

/** The entity's name in `FeedRowTitle`'s weight, linked to its page; or, for an entity the
 *  catalog can no longer name, its type fallback unlinked — there is no `ref` to link (FB-10). */
function EntityHeadline({ via }: { via: FeedVia }) {
  const className = "block font-medium text-foreground";
  if (via.name === null || via.ref === null) {
    return <span className={className}>{via.name ?? ENTITY_FALLBACK_NAMES[via.entity_type]}</span>;
  }
  return (
    <Link
      to={`${ENTITY_ROUTE_SEGMENTS[via.entity_type]}/${via.ref}`}
      className={`${className} hover:text-foreground`}
    >
      {via.name}
    </Link>
  );
}
