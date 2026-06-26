/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { Link } from "react-router";
import type { Route } from "./+types/calendar";
import { getCalendar } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { buildMeta } from "@/lib/seo";
import { groupByReleaseDate } from "@/lib/calendar-groups";
import { CalendarFilmCard } from "@/components/calendar/CalendarFilmCard";

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const calendar = await getCalendar(env.API_BASE_URL);
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
  const groups = groupByReleaseDate(loaderData.calendar.items);
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Release Calendar</h1>
      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">No upcoming releases yet — check back soon.</p>
      ) : (
        groups.map((group) => (
          <section key={group.dateKey} className="mt-8">
            <h2 className="text-sm font-medium text-gray-500">
              <time dateTime={group.dateKey}>{group.heading}</time>
            </h2>
            {group.buckets.map((bucket) => (
              <div key={bucket.bucket} className="mt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {bucket.label}
                </h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {bucket.films.map((f) => (
                    <CalendarFilmCard item={f} key={f.film_slug} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-gray-500">
        We couldn&apos;t load the release calendar. Please try again in a moment.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Home
      </Link>
    </main>
  );
}
