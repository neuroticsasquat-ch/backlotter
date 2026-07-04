/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/feed";
import { getFeedGrouped } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { env } from "@/env";
import { buildMeta } from "@/lib/seo";
import { groupByDay } from "@/lib/feed-groups";
import { FeedDayCard } from "@/components/feed/FeedDayCard";

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

// Each day starts collapsed to its most-popular films (the backend orders within-day
// by popularity); the rest expand behind a disclosure. Kept even so the zebra stripe
// pattern stays continuous across the visible/hidden split.
const DAY_INITIAL_VISIBLE = 8;

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
      <h1 className="text-2xl font-semibold">Latest Updates</h1>
      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No updates yet — check back soon.</p>
      ) : (
        <>
          <div className="mt-6 space-y-8">
            {groups.map((group) => {
              const visible = group.items.slice(0, DAY_INITIAL_VISIBLE);
              const hidden = group.items.slice(DAY_INITIAL_VISIBLE);
              return (
                <section key={group.dayKey}>
                  <h2 className="text-sm font-medium text-muted-foreground">
                    <time dateTime={group.dayKey}>{group.heading}</time>
                  </h2>
                  <div className="mt-2 border-l-2 border-border pl-3">
                    <div>
                      {visible.map((item) => (
                        <FeedDayCard key={item.film_slug} item={item} />
                      ))}
                    </div>
                    {hidden.length > 0 && (
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 [&::-webkit-details-marker]:hidden">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-90"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 6 15 12 9 18" />
                          </svg>
                          <span className="group-open:hidden">
                            Show all {group.items.length} updates
                          </span>
                          <span className="hidden group-open:inline">Show fewer</span>
                        </summary>
                        <div>
                          {hidden.map((item) => (
                            <FeedDayCard key={item.film_slug} item={item} />
                          ))}
                        </div>
                      </details>
                    )}
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
