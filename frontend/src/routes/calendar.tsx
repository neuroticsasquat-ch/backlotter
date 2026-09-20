/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { Link } from "react-router";
import type { Route } from "./+types/calendar";
import { getCalendar } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { ssrOriginHeaders } from "@/lib/ssr-origin";
import { buildMeta } from "@/lib/seo";
import { DATES_PER_PAGE } from "@/lib/calendar";
import { CalendarView } from "@/components/calendar/CalendarView";

/** The all-releases calendar, server-rendered for everyone. It stays anonymous and cacheable
 *  whoever is looking (D-12): the reader's own calendar is a client-side fetch inside
 *  `CalendarView`, after the account lands. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const calendar = await getCalendar(env.API_BASE_URL, {
    limit: DATES_PER_PAGE,
    headers: ssrOriginHeaders(env, request),
  });
  return { calendar };
}

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Release Calendar",
    description:
      "Upcoming movie releases by date — limited and wide theatrical openings plus US digital and physical home releases for every film we track.",
    pathname: location.pathname,
    type: "website",
  });
}

export default function CalendarPage({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Calendar</h1>
      <CalendarView calendar={loaderData.calendar} />
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
