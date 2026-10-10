/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { isRouteErrorResponse, Link, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/calendar";
import { getCalendar } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { ssrOriginHeaders } from "@/lib/ssr-origin";
import { buildMeta } from "@/lib/seo";
import {
  DATES_PER_PAGE,
  calendarPath,
  parseCalendarPath,
  type CalendarAddress,
} from "@/lib/calendar";
import { CalendarView } from "@/components/calendar/CalendarView";

/** The all-releases calendar of the address's kind, server-rendered for everyone. It stays
 *  anonymous and cacheable whoever is looking (D-12): a My films address renders its public
 *  twin's document, and the reader's own calendar is a client-side fetch inside `CalendarView`.
 *  Anything but the four addresses (NEU-1544, D-1544.1) is a 404. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const address = parseCalendarPath(params["*"]);
  if (!address) {
    throw new Response(null, { status: 404, statusText: "Calendar view not found" });
  }
  const { env } = context.get(cloudflareContext);
  const calendar = await getCalendar(env.API_BASE_URL, {
    kind: address.kind,
    limit: DATES_PER_PAGE,
    headers: ssrOriginHeaders(env, request),
  });
  return { calendar, kind: address.kind };
}

/** A tab or kind click moves between calendar addresses inside one mounted element, so it is a
 *  pure client navigation: no `.data` round trip, and `loaderData` keeps the kind the page was
 *  entered with — the panels for the other kind fetch their own first page. Every other way in
 *  (from a film page, Back from elsewhere, a full load) runs the loader as usual. */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (calendarAddressOf(currentUrl.pathname) && calendarAddressOf(nextUrl.pathname)) return false;
  return defaultShouldRevalidate;
}

function calendarAddressOf(pathname: string): CalendarAddress | null {
  const match = /^\/calendar(?:\/(.*))?$/.exec(pathname);
  return match ? parseCalendarPath(match[1]) : null;
}

const THEATRICAL_DESCRIPTION =
  "Upcoming movie releases by date — limited and wide theatrical openings and US digital home releases for every film we track.";
const HOME_DESCRIPTION = "Upcoming US digital home releases by date for every film we track.";

/** By address. The My films addresses canonical to their public twin, whose document theirs is
 *  — and carry no `noindex`, which would contradict the canonical. */
export function meta({ params, location }: Route.MetaArgs): Route.MetaDescriptors {
  const address = parseCalendarPath(params["*"]);
  if (!address) {
    return [
      ...buildMeta({ title: "Calendar view not found", pathname: location.pathname }),
      { name: "robots", content: "noindex" },
    ];
  }
  const home = address.kind === "home";
  const title =
    address.tab === "films"
      ? "My Films Calendar"
      : home
        ? "Home Release Calendar"
        : "Release Calendar";
  return buildMeta({
    title,
    description: home ? HOME_DESCRIPTION : THEATRICAL_DESCRIPTION,
    pathname: location.pathname,
    canonicalPathname: calendarPath({ tab: "all", kind: address.kind }),
    type: "website",
  });
}

export default function CalendarPage({ loaderData, params }: Route.ComponentProps) {
  // The loader has already 404'd anything else.
  const address = parseCalendarPath(params["*"])!;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Calendar</h1>
      {/* Out here, not in CalendarView, so it is server-rendered and shared by both tabs and kinds.
          The product is US-market (backend/docs/adr/0024-the-product-is-us-market.md). */}
      <p className="mt-1 text-sm text-muted-foreground">
        US release dates, in theaters and at home.
      </p>
      <CalendarView address={address} seededKind={loaderData.kind} calendar={loaderData.calendar} />
    </main>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Calendar view not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">That calendar view doesn&apos;t exist.</p>
        <Link to="/calendar" className="mt-6 inline-block text-sm text-blue-600 underline">
          Release calendar
        </Link>
      </main>
    );
  }
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
