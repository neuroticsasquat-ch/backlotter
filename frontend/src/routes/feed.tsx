/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { Link } from "react-router";
import type { Route } from "./+types/feed";
import { getFeed } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { buildMeta } from "@/lib/seo";
import { groupByDay } from "@/lib/feed-groups";
import { FeedItemCard } from "@/components/feed/FeedItemCard";

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const feed = await getFeed(env.API_BASE_URL);
  return { feed };
}

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Latest Updates",
    description:
      "The latest casting, trailers, release dates, and production updates across every movie we track.",
    pathname: location.pathname,
    type: "website",
  });
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { feed } = loaderData;
  const groups = groupByDay(feed.items);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Latest Updates</h1>
      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">No updates yet — check back soon.</p>
      ) : (
        groups.map((group) => (
          <section key={group.dayKey} className="mt-8">
            <h2 className="text-sm font-medium text-gray-500">
              <time dateTime={group.dayKey}>{group.heading}</time>
            </h2>
            <div className="mt-3 space-y-4">
              {group.items.map((item, i) => (
                <FeedItemCard key={`${item.film_slug}-${item.created_at}-${i}`} item={item} />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-gray-500">
        We couldn&apos;t load the latest updates. Please try again in a moment.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Reload
      </Link>
    </main>
  );
}
