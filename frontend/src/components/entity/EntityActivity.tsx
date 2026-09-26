import { useState } from "react";
import type { EntityEventsPage } from "@/api/types";
import { ENTITY_EVENTS_PAGE_SIZE, getEntityEvents, type EntityEventsKind } from "@/api/public";
import { EventCard } from "@/components/film/EventCard";
import { env } from "@/env";
import { dayKey, formatDayHeading } from "@/lib/format";

/** The line under the heading, in the second person because the section is an argument for the
 *  button above it: this is what the follow would have delivered. */
export const ACTIVITY_EMPTY = "Nothing yet — you'll hear when they join or leave a film";

/**
 * An entity page's **Recent activity**: the attach, detach and `canceled` cards this entity's
 * own follow would deliver (EF-18), newest first.
 *
 * The same {@link EventCard} the film page's timeline draws, over the same `EventOut` — the
 * point of the section is that the reader sees the card they would get, not a preview of one.
 * What the card cannot do here is link: the backend's `EventOut` carries no film ref, so the
 * summary text is the only place a film is named. Each card gets its own dateline instead of
 * the feed's day grouping — this list is one entity's thin stream, where grouping a single card
 * under a day heading would be more chrome than card.
 *
 * Paging is keyset, so it appends rather than replacing: the first page is server-rendered by
 * the route's loader and "Load more" fetches the next cursor browser-side (unsigned — the
 * request already carries the visitor's own IP, `lib/ssr-origin.ts`). A page that comes back
 * null means the entity 404'd between the two requests, which ends the list rather than
 * throwing over a card stream.
 */
export function EntityActivitySection({
  kind,
  entityRef,
  initial,
}: {
  kind: EntityEventsKind;
  entityRef: string;
  initial: EntityEventsPage;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.next_cursor);
  const [loading, setLoading] = useState(false);

  // Reset when the loader hands over a different page — React's documented "adjusting state
  // when a prop changes", not an effect, so the new entity never paints behind the old one's
  // cards. The header's `SearchBox` is what makes this reachable: searching a second person
  // from a person page is a same-route navigation, so this component stays mounted across it
  // and `useState` alone would keep the first person's stream while `entityRef` moved on —
  // "Load more" would then append the second person's page 2 under the first person's page 1.
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) {
    setSynced(initial);
    setItems(initial.items);
    setCursor(initial.next_cursor);
  }

  async function loadMore() {
    if (loading || !cursor) return;
    setLoading(true);
    try {
      const next = await getEntityEvents(env.apiBaseUrl, kind, entityRef, {
        limit: ENTITY_EVENTS_PAGE_SIZE,
        cursor,
      });
      setItems((prev) => [...prev, ...(next?.items ?? [])]);
      setCursor(next?.next_cursor ?? null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{ACTIVITY_EMPTY}</p>
      ) : (
        <>
          <ol className="mt-2 space-y-4">
            {items.map((event) => {
              // The feed's axis: `created_at` is when we published the card (ADR-0016). The card
              // takes that day too, so a beat that happened earlier still discloses "first seen".
              const day = dayKey(event.created_at);
              return (
                <li key={event.event_id} className="border-l-2 border-border pl-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    <time dateTime={day}>{formatDayHeading(event.created_at)}</time>
                  </p>
                  <div className="mt-1">
                    <EventCard event={event} day={day} />
                  </div>
                </li>
              );
            })}
          </ol>
          {cursor && (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
