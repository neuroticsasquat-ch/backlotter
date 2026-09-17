/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import type { Route } from "./+types/all-updates";
import { buildMeta } from "@/lib/seo";
import { loadGlobalFeed } from "@/lib/global-feed";
import { FeedErrorBoundary, GlobalFeed } from "@/components/feed/GlobalFeed";

/**
 * `/feed` — the global feed under its own permanent URL.
 *
 * `/` used to be the only way to reach it; since the home route swaps to the signed-in reader's
 * timeline (NEU-1354), everyone needs a place the unfiltered feed still lives. Same loader, same
 * page component, different heading and canonical — nothing here is a second implementation.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  return loadGlobalFeed({ request, context });
}

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  // The description home used to carry, now that this is the page it describes; the canonical
  // follows `location.pathname`, so it self-canonicalises to /feed rather than back to /.
  return buildMeta({
    title: "All updates",
    description:
      "The latest casting, trailers, release dates, and production updates across every movie we track.",
    pathname: location.pathname,
    type: "website",
  });
}

export default function AllUpdatesPage({ loaderData }: Route.ComponentProps) {
  return <GlobalFeed feed={loaderData.feed} heading="All updates" />;
}

export function ErrorBoundary() {
  return <FeedErrorBoundary />;
}
