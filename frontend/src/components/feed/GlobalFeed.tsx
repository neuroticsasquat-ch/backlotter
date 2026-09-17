import { useState } from "react";
import { Link } from "react-router";
import { getFeedGrouped } from "@/api/public";
import type { FeedDayResponse } from "@/api/types";
import { env } from "@/env";
import { groupByDay } from "@/lib/feed-groups";
import { DAYS_PER_PAGE } from "@/lib/global-feed";
import { FeedDayGroups, ViewMoreButton } from "@/components/feed/FeedDayGroups";

/**
 * The global grouped feed: every film we track, newest day first.
 *
 * Rendered by both `/` (for anonymous and unentitled visitors) and `/feed` (for everyone), which
 * is why the heading is a prop — the two routes are the same page under two names and two
 * `meta()` exports, not two implementations that have to be kept in step.
 *
 * `intro` is whatever the home route wants to say above the days: a sign-in line for an anonymous
 * visitor, the locked-timeline panel for a signed-in one without access. `/feed` passes nothing.
 * It renders inside the page rather than around it so the heading stays the first thing in the
 * document, and so neither branch can shift the header, search bar or footer.
 */
export function GlobalFeed({
  feed,
  heading,
  intro,
}: {
  feed: FeedDayResponse;
  heading: string;
  intro?: React.ReactNode;
}) {
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
      <h1 className="text-2xl font-semibold">{heading}</h1>
      {intro}
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
