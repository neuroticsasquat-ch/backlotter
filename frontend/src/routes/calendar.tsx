/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/calendar";
import { getCalendar } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { env } from "@/env";
import { buildMeta } from "@/lib/seo";
import { groupByReleaseDate } from "@/lib/calendar-groups";
import { CalendarFilmRow } from "@/components/calendar/CalendarFilmRow";

// How many release dates the calendar shows per page. "View more" fetches the next page
// of dates (manual — never auto-loads — so the footer stays reachable).
const DATES_PER_PAGE = 20;

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const calendar = await getCalendar(env.API_BASE_URL, { limit: DATES_PER_PAGE });
  return { calendar };
}

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Release Calendar",
    description:
      "Upcoming movie releases by date — premieres, limited, and wide theatrical openings for every film we track.",
    pathname: location.pathname,
    type: "website",
  });
}

export default function CalendarPage({ loaderData }: Route.ComponentProps) {
  const [items, setItems] = useState(loaderData.calendar.items);
  const [loading, setLoading] = useState(false);
  const groups = groupByReleaseDate(items);
  const hasMore = groups.length < loaderData.calendar.total;

  async function loadMore() {
    if (loading) return;
    setLoading(true);
    try {
      const next = await getCalendar(env.apiBaseUrl, {
        limit: DATES_PER_PAGE,
        offset: groups.length,
      });
      setItems((prev) => [...prev, ...next.items]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Release Calendar</h1>
      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No upcoming releases yet — check back soon.
        </p>
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.dateKey} className="mt-8">
              <h2 className="text-sm font-medium text-muted-foreground">
                <time dateTime={group.dateKey}>{group.heading}</time>
              </h2>
              {/* Single rail for the whole date; wide group first, then limited. */}
              <div className="mt-2 space-y-3 border-l-2 border-border pl-3">
                {group.buckets.map((bucket) => (
                  <div key={bucket.bucket}>
                    <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                      {bucket.label}
                    </h3>
                    <div>
                      {bucket.films.map((f) => (
                        <CalendarFilmRow item={f} key={f.film_slug} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {hasMore && (
            <div className="mt-10 text-center">
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
        We couldn&apos;t load the release calendar. Please try again in a moment.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Home
      </Link>
    </main>
  );
}
