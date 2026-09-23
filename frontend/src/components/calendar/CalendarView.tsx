import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { fetchMyFilmsCalendar, isEntitlementError, useMyFilmsCalendar } from "@/api/me";
import { getCalendar } from "@/api/public";
import type { CalendarItem, CalendarResponse } from "@/api/types";
import { useAuth } from "@/components/AuthContext";
import { useFollowAccess } from "@/components/follow/access";
import { ViewMoreButton } from "@/components/feed/FeedDayGroups";
import { CalendarDateGroups } from "@/components/calendar/CalendarDateGroups";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import { DATES_PER_PAGE } from "@/lib/calendar";
import { groupByReleaseDate } from "@/lib/calendar-groups";

type CalendarTab = "films" | "all";

/**
 * What `/calendar` renders under its heading, decided on the client (D-12, D-1412.1).
 *
 * The loader always SSRs the all-releases calendar — the `["me"]` query never resolves during
 * the server render (`routes/public-layout.tsx`), so the document, and the first client paint,
 * are the anonymous one. This island decides what to do with it once the account lands:
 *
 * - **ready** — signed in and entitled. Two tabs, opening on the films the reader follows,
 *   with the SSR'd calendar one click away on the second.
 * - **anything else** — anonymous, or signed in without a grant. Exactly the page they see
 *   today: the all-releases calendar, no tab strip, no locked or disabled tab. The
 *   subscription offer for them is NEU-1409's and lives on the feed routes, not here.
 *
 * The active tab is component state and never a URL or a remembered preference: `/calendar`
 * stays one indexable address, and the nav item lands an entitled reader on their own films
 * every time.
 */
export function CalendarView({ calendar }: { calendar: CalendarResponse }) {
  const access = useFollowAccess();
  const [tab, setTab] = useState<CalendarTab>("films");
  const baseId = useId();
  const tabId = (name: CalendarTab) => `${baseId}-${name}-tab`;
  const panelId = (name: CalendarTab) => `${baseId}-${name}-panel`;

  const tabbed = access === "ready";
  const showAllReleases = () => setTab("all");

  // Both panels stay mounted and the inactive one is `hidden` (D-1412.2): "View more" progress
  // survives a switch on either tab, and the all-releases panel is never refetched because it
  // is never unmounted. The wrapper below it is rendered in the same slot whether or not the
  // tabs exist, so the account landing swaps the *page* into its tabbed form without remounting
  // the calendar the server already rendered — and drops it back to a plain div, with no
  // dangling tab roles, if the grant lapses.
  return (
    <>
      {tabbed && (
        <div role="tablist" aria-label="Calendar view" className="mt-4 flex flex-wrap gap-2">
          <CalendarTabButton
            id={tabId("films")}
            controls={panelId("films")}
            selected={tab === "films"}
            onClick={() => setTab("films")}
          >
            My films
          </CalendarTabButton>
          <CalendarTabButton
            id={tabId("all")}
            controls={panelId("all")}
            selected={tab === "all"}
            onClick={showAllReleases}
          >
            All releases
          </CalendarTabButton>
        </div>
      )}
      {tabbed && (
        <div
          role="tabpanel"
          id={panelId("films")}
          aria-labelledby={tabId("films")}
          hidden={tab !== "films"}
        >
          <MyFilmsCalendar onShowAllReleases={showAllReleases} />
        </div>
      )}
      <div
        role={tabbed ? "tabpanel" : undefined}
        id={tabbed ? panelId("all") : undefined}
        aria-labelledby={tabbed ? tabId("all") : undefined}
        hidden={tabbed && tab !== "all"}
      >
        <AllReleasesCalendar calendar={calendar} />
      </div>
    </>
  );
}

/** One tab in the strip, styled like the one on `/admin/resolution`: a bordered current tab
 *  against muted others. Hand-rolled rather than a new UI primitive, as both existing strips
 *  are; arrow-key navigation between tabs would be its own ticket, for all three. */
function CalendarTabButton({
  id,
  controls,
  selected,
  onClick,
  children,
}: {
  id: string;
  controls: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      onClick={onClick}
      className={
        selected
          ? "rounded border border-foreground px-3 py-1 text-sm font-medium"
          : "rounded border border-transparent px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

/** The public calendar: the loader's first page of dates, paged on from the browser. The extra
 *  pages are fetched *unsigned* — `ssrOriginHeaders` belongs to the loader, and a browser
 *  request already arrives with the visitor's own IP for the backend to rate-limit on. */
function AllReleasesCalendar({ calendar }: { calendar: CalendarResponse }) {
  const [items, setItems] = useState(calendar.items);
  const [loading, setLoading] = useState(false);
  const dayGroups = groupByReleaseDate(items);
  const hasMore = dayGroups.length < calendar.total;

  async function loadMore() {
    if (loading) return;
    setLoading(true);
    try {
      const next = await getCalendar(env.apiBaseUrl, {
        limit: DATES_PER_PAGE,
        offset: dayGroups.length,
      });
      setItems((prev) => [...prev, ...next.items]);
    } finally {
      setLoading(false);
    }
  }

  if (dayGroups.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        No upcoming releases yet — check back soon.
      </p>
    );
  }
  return (
    <>
      <CalendarDateGroups items={items} />
      <ViewMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />
    </>
  );
}

/**
 * The reader's own calendar: the **films they follow** reaching a release date
 * (`GET /me/calendar`, NEU-1411, EF-14) — title follows only, never the entity ones, which
 * produce timeline rows and nothing else (EF-3). Mounted by {@link CalendarView} once the
 * account has resolved *and* proved entitled.
 */
function MyFilmsCalendar({ onShowAllReleases }: { onShowAllReleases: () => void }) {
  const { refresh } = useAuth();
  const first = useMyFilmsCalendar({ limit: DATES_PER_PAGE, offset: 0 });

  // A grant that lapses mid-session shows up here and nowhere else: the cached account still
  // says `entitled`, so the tabs are up and this panel mounted, and the request came back 403.
  // Re-reading `/me` flips the flag and `CalendarView` re-renders as the tab-less public
  // calendar, so no error copy is ever shown for it (D-41).
  const lapsed = first.isError && isEntitlementError(first.error);
  useEffect(() => {
    if (lapsed) void refresh();
  }, [lapsed, refresh]);

  // Pages 2+ are fetched imperatively and appended, as the timeline's are, stamped with the
  // first page they were appended to and read back only while that is still the first page. A
  // refreshed page one — after a follow change lands, or on the next mount — drops them
  // rather than splicing dates from two different follow lists together.
  const [more, setMore] = useState<{ from?: CalendarResponse; items: CalendarItem[] }>({
    items: [],
  });
  const [loading, setLoading] = useState(false);

  // The skeleton covers the re-read as well as the first load: the tab strip is one render away
  // from disappearing, and flashing "we couldn't load this" in between would name the wrong
  // problem.
  if (first.isPending || lapsed) return <MyFilmsCalendarSkeleton />;
  if (first.isError) return <MyFilmsCalendarUnavailable onShowAllReleases={onShowAllReleases} />;

  const total = first.data?.total ?? 0;
  const appended = more.from === first.data ? more.items : [];
  const items = [...(first.data?.items ?? []), ...appended];
  const dayGroups = groupByReleaseDate(items);
  const hasMore = dayGroups.length < total;

  async function loadMore() {
    if (loading) return;
    setLoading(true);
    try {
      const next = await fetchMyFilmsCalendar({
        limit: DATES_PER_PAGE,
        offset: dayGroups.length,
      });
      setMore({ from: first.data, items: [...appended, ...next.items] });
    } finally {
      setLoading(false);
    }
  }

  // Following no films with a date is a 200 with nothing in it, not a failure (NEU-1411), and
  // must never read as one.
  if (total === 0) return <EmptyMyFilmsCalendar onShowAllReleases={onShowAllReleases} />;
  return (
    <>
      <CalendarDateGroups items={items} />
      <ViewMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />
    </>
  );
}

/** Shown while the first page is in flight, and through the re-read of a lapsed grant. Occupies
 *  the content area only, so the swap from the server-rendered calendar does not reflow the
 *  heading and tab strip above it. */
function MyFilmsCalendarSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your films calendar" className="mt-6 space-y-8">
      {[0, 1, 2].map((n) => (
        <div key={n} className="animate-pulse space-y-2">
          <div className="h-4 w-48 rounded bg-muted" />
          <div className="ml-3 space-y-2 border-l-2 border-border pl-3">
            <div className="h-16 rounded bg-muted" />
            <div className="h-16 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The request failed for some reason other than the entitlement 403, which is handled above as
 *  a lapsed grant. Deliberately not the empty-state card and deliberately without the `/welcome`
 *  link: sending someone off to import films because a request failed names the wrong problem. */
function MyFilmsCalendarUnavailable({ onShowAllReleases }: { onShowAllReleases: () => void }) {
  return (
    <div className="mt-6 rounded-lg border border-border p-6">
      <p className="text-sm text-foreground">We couldn&apos;t load your films calendar just now.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Please try again in a moment — every release is still on the other tab.
      </p>
      <div className="mt-4">
        <Button size="sm" variant="outline" onClick={onShowAllReleases}>
          Browse all releases
        </Button>
      </div>
    </div>
  );
}

/** An entitled reader with nothing upcoming among the films they follow. Every word is an
 *  instruction rather than an apology, and the way out is a tab change — so a `<button>`, not a
 *  `<Link>`: the other calendar is on this page, not at another address. */
function EmptyMyFilmsCalendar({ onShowAllReleases }: { onShowAllReleases: () => void }) {
  return (
    <div className="mt-6 rounded-lg border border-border p-6">
      <p className="text-sm text-foreground">None of the films you follow has a date yet.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Follow films from any film page, or import your library to fill this in.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button size="sm" variant="outline" onClick={onShowAllReleases}>
          Browse all releases
        </Button>
        <Button asChild size="sm">
          <Link to="/welcome">Get started</Link>
        </Button>
      </div>
    </div>
  );
}
