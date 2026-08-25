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
import { FeedDayPosters } from "@/components/feed/FeedDayPosters";

// Every section opens with a rule and real space: the sub-heading otherwise lands between two
// striped rows and reads as one of them, and the first one needs the break just as much — to
// stand off the poster strip above it on a phone, and the dateline on desktop. The extra top
// margin is only from the second section on, so the first rule stays level with the top of the
// day's poster column rather than floating below it.
const SECTION_BREAK = "border-t border-border pt-4 [&:not(:first-child)]:mt-5";

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
                  <div className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-3">
                    {/* One strip per day, not per section — it anchors the date, and takes the
                        whole day's items so its own news-first ordering applies. Above the list at
                        every width: beside it, a poster lined up with whatever row happened to sit
                        next to it and read as a label for an unrelated film. */}
                    <FeedDayPosters items={group.items} />
                    <div className="min-w-0 flex-1">
                      {sections.map((section) => (
                        <SectionWrapper key={section.key} section={section}>
                          {section.items.map((item) => (
                            <FeedDayCard key={item.film_ref} item={item} />
                          ))}
                        </SectionWrapper>
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

/** Wraps a day section: "In the news" is always expanded; "via TMDB" is collapsible and
 *  collapsed by default, with a count of movies listed. A single unlabelled section renders
 *  as a plain broke. */
function SectionWrapper({
  section,
  children,
}: {
  section: { key: string; label: string | null; items: unknown[] };
  children: React.ReactNode;
}) {
  // TMDB section: collapsible, collapsed by default. Must be declared before any
  // early return so React hooks are called unconditionally (lint rule).
  const [open, setOpen] = useState(section.key !== "tmdb");

  if (section.label === null) {
    return <div className={SECTION_BREAK}>{children}</div>;
  }

  const count = section.items.length;
  const label = `${section.label} (${count} movie${count === 1 ? "" : "s"})`;

  if (section.key === "news") {
    return (
      <div className={SECTION_BREAK}>
        <h3 className="px-2 pb-1.5 text-xs font-semibold tracking-wide text-foreground/80">
          {label}
        </h3>
        {children}
      </div>
    );
  }
  return (
    <div className={SECTION_BREAK}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 pb-1.5 text-xs font-semibold tracking-wide text-foreground/80"
      >
        <svg
          className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M5.5 3.5L10.5 8L5.5 12.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{label}</span>
      </button>
      {open && children}
    </div>
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
