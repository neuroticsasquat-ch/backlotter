/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/feed";
import { getFeedGrouped } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { env } from "@/env";
import { buildMeta } from "@/lib/seo";
import { groupByDay, splitByNewsBacked } from "@/lib/feed-groups";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import { FeedDayPoster } from "@/components/feed/FeedDayPoster";

// How many days the feed shows per page. "View more" fetches the next page of days
// (manual — never auto-loads — so the footer stays reachable).
const DAYS_PER_PAGE = 10;

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const feed = await getFeedGrouped(env.API_BASE_URL, { limit: DAYS_PER_PAGE });
  return { feed };
}

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  // No page title → the tab reads "production log — backlotter".
  return buildMeta({
    description:
      "The latest casting, trailers, release dates, and production updates across every movie we track.",
    pathname: location.pathname,
    type: "website",
  });
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { feed } = loaderData;
  const [items, setItems] = useState(feed.items);
  const [loading, setLoading] = useState(false);
  const groups = groupByDay(items);
  const hasMore = groups.length < feed.total;

  async function loadMore() {
    if (loading) return;
    setLoading(true);
    try {
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
      <h1 className="text-2xl font-semibold">Latest Updates for Upcoming Movies</h1>
      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No updates yet — check back soon.</p>
      ) : (
        <>
          <div className="mt-6 space-y-8">
            {groups.map((group) => {
              const { newsBacked, tmdbOnly } = splitByNewsBacked(group.items);
              // The sub-headings exist to separate the two kinds. A day with only one kind has
              // nothing to separate it from, so it renders as a single unlabelled list rather
              // than under a lone heading.
              const sections =
                newsBacked.length > 0 && tmdbOnly.length > 0
                  ? [
                      { key: "news", label: "In the news", items: newsBacked },
                      { key: "tmdb", label: "via TMDB", items: tmdbOnly },
                    ]
                  : [{ key: "all", label: null, items: group.items }];
              return (
                <section key={group.dayKey}>
                  <h2 className="text-sm font-medium text-muted-foreground">
                    <time dateTime={group.dayKey}>{group.heading}</time>
                  </h2>
                  <div className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-3 sm:flex-row">
                    {/* One poster per day, not per section — the strip anchors the date. It sits
                        beside the list from `sm` up; on a phone the column is too narrow to give
                        up ~90px to it, so it stacks above the day's updates instead. */}
                    <FeedDayPoster items={group.items} />
                    <div className="min-w-0 flex-1 space-y-2">
                      {sections.map((section) => (
                        <div key={section.key}>
                          {section.label !== null && (
                            <h3 className="px-2 pb-0.5 text-xs font-medium text-muted-foreground">
                              {section.label}
                            </h3>
                          )}
                          {/* Each section is its own striping context, so the zebra pattern
                              restarts under each sub-heading. */}
                          <div>
                            {section.items.map((item) => (
                              <FeedDayCard key={item.film_slug} item={item} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
          {hasMore && (
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {loading ? "Loading…" : "View more"}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export function ErrorBoundary() {
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
