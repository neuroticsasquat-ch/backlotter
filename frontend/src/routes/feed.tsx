/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import type { Route } from "./+types/feed";
import { buildMeta } from "@/lib/seo";
import { loadGlobalFeed } from "@/lib/global-feed";
import { FeedErrorBoundary } from "@/components/feed/GlobalFeed";
import { TimelineOrFeed } from "@/components/feed/TimelineOrFeed";

export async function loader({ request, context }: Route.LoaderArgs) {
  // Unchanged by the timeline swap, and deliberately so: `/` SSRs the global feed for every
  // visitor, signed in or not, which is what keeps the document anonymous-safe and cacheable.
  // Who is looking is decided afterwards, on the client, by `TimelineOrFeed`.
  return loadGlobalFeed({ request, context });
}

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  // No page title → the tab reads "production log — backlotter". Describes the global feed
  // because that is the only render that is ever indexed; signed-in users are not.
  return buildMeta({
    description:
      "The latest casting, trailers, release dates, and production updates across every movie we track.",
    pathname: location.pathname,
    type: "website",
  });
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  return <TimelineOrFeed feed={loaderData.feed} />;
}

export function ErrorBoundary() {
  return <FeedErrorBoundary />;
}
