import { useState } from "react";
import { Link } from "react-router";
import { getFeedGrouped } from "@/api/public";
import type { FeedDayResponse } from "@/api/types";
import { env } from "@/env";
import { groupByDay } from "@/lib/feed-groups";
import { DAYS_PER_PAGE } from "@/lib/global-feed";
import { FeedDayGroups, ViewMoreButton } from "@/components/feed/FeedDayGroups";

/** The page's name, matching the nav item that leads to it (NEU-1410). */
export const GLOBAL_FEED_HEADING = "All updates";

/**
 * The line under the heading.
 *
 * It carries the phrase the old home-page `<h1>` existed to put in front of a crawler — that
 * heading was "Latest Updates for Upcoming Movies" precisely because only the anonymous render
 * of `/` is indexed. Naming the page after its nav item costs that `<h1>`, so the words move
 * here, where they are still indexable body copy on the same document.
 */
export const GLOBAL_FEED_STANDFIRST =
  "Every casting change, trailer and release date across every film we track.";

/**
 * The global grouped feed: every film we track, newest day first.
 *
 * Rendered by `/` (for anonymous and unentitled visitors) and by `/feed` (for everyone).
 *
 * **It takes no heading prop, deliberately.** It used to, so the two routes could label
 * themselves differently — `/` said "Latest Updates for Upcoming Movies" and `/feed` said "All
 * updates" — which made one page look like two depending on how you arrived. The heading and
 * standfirst are constants here instead, so the two routes cannot drift apart again: they are
 * the same page under two URLs and two `meta()` exports, and nothing about the body differs.
 */
export function GlobalFeed({ feed }: { feed: FeedDayResponse }) {
  const [items, setItems] = useState(feed.items);
  const [loading, setLoading] = useState(false);
  const groups = groupByDay(items);
  const hasMore = groups.length < feed.total;

  async function loadMore() {
    if (loading) return;
    setLoading(true);
    try {
      // Browser-side, so no signing headers: the request already carries the visitor's own IP,
      // which is what the backend's rate limiter wants to key on (`lib/ssr-origin.ts`).
      const next = await getFeedGrouped(env.apiBaseUrl, {
        limit: DAYS_PER_PAGE,
        offset: groups.length,
      });
      setItems((prev) => [...prev, ...next.items]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{GLOBAL_FEED_HEADING}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{GLOBAL_FEED_STANDFIRST}</p>
      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No updates yet — check back soon.</p>
      ) : (
        <>
          <FeedDayGroups items={items} />
          <ViewMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />
        </>
      )}
    </main>
  );
}

/** The error state both feed routes render when their loader throws. */
export function FeedErrorBoundary() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We couldn&apos;t load the latest updates. Please try again in a moment.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Reload
      </Link>
    </main>
  );
}
