import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchMyFilmsCalendar, isEntitlementError, useMyFilmsCalendar } from "@/api/me";
import { getCalendar } from "@/api/public";
import { publicCalendarFirstPageKey } from "@/api/query-keys";
import type { CalendarItem, CalendarResponse } from "@/api/types";
import { useAuth } from "@/components/AuthContext";
import { useFollowAccess } from "@/components/follow/access";
import { ViewMoreButton } from "@/components/feed/FeedDayGroups";
import { CalendarDateGroups } from "@/components/calendar/CalendarDateGroups";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import {
  DATES_PER_PAGE,
  calendarPath,
  type CalendarAddress,
  type CalendarKind,
  type CalendarTab,
} from "@/lib/calendar";
import { groupByReleaseDate } from "@/lib/calendar-groups";

/** Both kinds, in the order the control lists them and the panels are rendered. */
const CALENDAR_KINDS: readonly CalendarKind[] = ["theatrical", "home"];

/**
 * What `/calendar` renders under its heading, decided on the client (D-12, D-1412.1).
 *
 * The loader always SSRs an all-releases calendar — the `["me"]` query never resolves during
 * the server render (`routes/public-layout.tsx`), so the document, and the first client paint,
 * are the anonymous one. This island decides what to do with it once the account lands:
 *
 * - **ready** — signed in and entitled. Two tabs, My films and All releases, with the SSR'd
 *   calendar on the second.
 * - **anything else** — anonymous, or signed in without a grant. The all-releases calendar, no
 *   tab strip, no locked or disabled tab. The subscription offer for them is NEU-1409's and
 *   lives on the feed routes, not here.
 *
 * Across the tab sits the **calendar kind** (NEU-1542, D-1542.3): In theaters or At home, one
 * control for every reader, shared by both tabs — switching tab keeps the kind.
 *
 * The active tab and kind are the **address** (NEU-1544, D-1544.1,
 * `docs/adr/0002-calendar-views-are-paths.md`): each combo has a path, the tabs and kinds are
 * links that push history, and Back retraces the reader's steps on and off the page. The route
 * keeps this element mounted across those navigations, so the panels below still mount once
 * and then stay `hidden` (D-1412.2). The kind is still never a remembered preference.
 */
export function CalendarView({
  address,
  seededKind,
  calendar,
}: {
  address: CalendarAddress;
  /** The kind the loader fetched `calendar` for — the address the page was entered at. */
  seededKind: CalendarKind;
  calendar: CalendarResponse;
}) {
  const access = useFollowAccess();
  const { resolving } = useAuth();
  const navigate = useNavigate();
  const { tab, kind } = address;
  // The kinds the reader has opened so far. A kind's panels mount on its first appearance and
  // then stay mounted and `hidden`, as the tab panels do (D-1412.2), so "View more" progress
  // survives a round trip through the other kind. Grown during render, so a kind's panels are
  // in the very render that first names it.
  const [openedKinds, setOpenedKinds] = useState<ReadonlySet<CalendarKind>>(
    () => new Set<CalendarKind>([seededKind, kind]),
  );
  if (!openedKinds.has(kind)) setOpenedKinds(new Set([...openedKinds, kind]));
  const mountedKinds = CALENDAR_KINDS.filter((k) => openedKinds.has(k) || k === kind);
  const baseId = useId();
  const tabId = (name: CalendarTab) => `${baseId}-${name}-tab`;
  const panelId = (name: CalendarTab) => `${baseId}-${name}-panel`;

  const tabbed = access === "ready";

  // A My films address names a view only a granted reader has, so once the account read has
  // *settled* without one, the page replaces itself onto its public twin (D-1544.2): the URL
  // never names a view the reader cannot see, and nothing is pushed, so Back is untouched. The
  // settled check is load-bearing — an entitled reader whose hint cookie has expired reads as
  // `anonymous` until `/me` answers, and `resolving` is true through that whole window.
  // `hinted` is in flight by definition and waits.
  const settledWithoutGrant = access === "locked" || (access === "anonymous" && !resolving);
  useEffect(() => {
    if (tab === "films" && settledWithoutGrant) {
      void navigate(calendarPath({ tab: "all", kind }), { replace: true });
    }
  }, [tab, kind, settledWithoutGrant, navigate]);

  // Both panels stay mounted and the inactive one is `hidden` (D-1412.2): "View more" progress
  // survives a switch on either tab, and the all-releases panel is never refetched because it
  // is never unmounted. The wrapper below it is rendered in the same slot whether or not the
  // tabs exist, so the account landing swaps the *page* into its tabbed form without remounting
  // the calendar the server already rendered — and drops it back to a plain div, with no
  // dangling tab roles, if the grant lapses. Inside each, one panel per opened kind, `hidden`
  // unless it is the active kind; the tab panel's own `hidden` covers the other axis.
  return (
    <>
      {tabbed && (
        <div role="tablist" aria-label="Calendar view" className="mt-4 flex flex-wrap gap-2">
          <CalendarTabLink
            id={tabId("films")}
            controls={panelId("films")}
            selected={tab === "films"}
            to={calendarPath({ tab: "films", kind })}
          >
            My films
          </CalendarTabLink>
          <CalendarTabLink
            id={tabId("all")}
            controls={panelId("all")}
            selected={tab === "all"}
            to={calendarPath({ tab: "all", kind })}
          >
            All releases
          </CalendarTabLink>
        </div>
      )}
      <div
        role="radiogroup"
        aria-label="Calendar kind"
        className={`${tabbed ? "mt-2" : "mt-4"} flex flex-wrap gap-2`}
      >
        <CalendarKindLink
          checked={kind === "theatrical"}
          to={calendarPath({ tab, kind: "theatrical" })}
        >
          In theaters
        </CalendarKindLink>
        <CalendarKindLink checked={kind === "home"} to={calendarPath({ tab, kind: "home" })}>
          At home
        </CalendarKindLink>
      </div>
      {tabbed && (
        <div
          role="tabpanel"
          id={panelId("films")}
          aria-labelledby={tabId("films")}
          hidden={tab !== "films"}
        >
          {mountedKinds.map((k) => (
            <div key={k} hidden={k !== kind}>
              <MyFilmsCalendar kind={k} />
            </div>
          ))}
        </div>
      )}
      <div
        role={tabbed ? "tabpanel" : undefined}
        id={tabbed ? panelId("all") : undefined}
        aria-labelledby={tabbed ? tabId("all") : undefined}
        hidden={tabbed && tab !== "all"}
      >
        {mountedKinds.map((k) => (
          <div key={k} hidden={k !== kind}>
            {k === seededKind ? (
              <AllReleasesCalendar kind={k} calendar={calendar} />
            ) : (
              <BrowserAllReleasesCalendar kind={k} />
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/** One option of the kind control: a radio rather than a tab, because the kind is not a place
 *  with a panel of its own — it is a second axis across both tabs — so it gets no
 *  `aria-controls`. A link to the same tab under this kind (D-1544.3). Styled as the tab strip
 *  is, so the two controls read as one family; arrow-key movement is out of scope here for the
 *  reason it is on the tabs. */
function CalendarKindLink({
  checked,
  to,
  children,
}: {
  checked: boolean;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      role="radio"
      aria-checked={checked}
      className={
        checked
          ? "rounded border border-foreground px-3 py-1 text-sm font-medium"
          : "rounded border border-transparent px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}

/** One tab in the strip, styled like the one on `/admin/resolution`: a bordered current tab
 *  against muted others. A link to this tab under the current kind (D-1544.3). Hand-rolled
 *  rather than a new UI primitive, as both existing strips are; arrow-key navigation between
 *  tabs would be its own ticket, for all three. */
function CalendarTabLink({
  id,
  controls,
  selected,
  to,
  children,
}: {
  id: string;
  controls: string;
  selected: boolean;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      id={id}
      to={to}
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      className={
        selected
          ? "rounded border border-foreground px-3 py-1 text-sm font-medium"
          : "rounded border border-transparent px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}

/** The public calendar of one kind, from its first page of dates, paged on from the browser.
 *  The extra pages are fetched *unsigned* — `ssrOriginHeaders` belongs to the loader, and a
 *  browser request already arrives with the visitor's own IP for the backend to rate-limit on. */
function AllReleasesCalendar({
  kind,
  calendar,
}: {
  kind: CalendarKind;
  calendar: CalendarResponse;
}) {
  const [items, setItems] = useState(calendar.items);
  const [loading, setLoading] = useState(false);
  const dayGroups = groupByReleaseDate(items);
  const hasMore = dayGroups.length < calendar.total;

  async function loadMore() {
    if (loading) return;
    setLoading(true);
    try {
      const next = await getCalendar(env.apiBaseUrl, {
        kind,
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
        {kind === "theatrical"
          ? "No upcoming theatrical releases yet — check back soon."
          : "No upcoming home releases yet — check back soon."}
      </p>
    );
  }
  return (
    <>
      <CalendarDateGroups items={items} bucketHeadings={kind === "theatrical"} />
      <ViewMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />
    </>
  );
}

/** The public calendar of the kind the loader did not render — whichever the page was not
 *  entered at — fetched from the browser the first time the reader picks it, then paged on as
 *  the loader's one is. A failed first page is an inline retry inside this panel rather than
 *  the route's `ErrorBoundary`, which would take the server-rendered calendar down with it. No
 *  retries of its own: the reader has a button for that. */
function BrowserAllReleasesCalendar({ kind }: { kind: CalendarKind }) {
  const first = useQuery({
    queryKey: publicCalendarFirstPageKey(kind, DATES_PER_PAGE),
    queryFn: () => getCalendar(env.apiBaseUrl, { kind, limit: DATES_PER_PAGE, offset: 0 }),
    retry: false,
  });

  const releases = kind === "theatrical" ? "theatrical releases" : "home releases";
  if (first.isPending) return <CalendarSkeleton label={`Loading ${releases}`} />;
  // Only a failed *first* load is an error here: a background refetch that fails while a page
  // is on screen keeps that page — and the "View more" progress built on it.
  if (!first.data) {
    return (
      <div className="mt-6 rounded-lg border border-border p-6">
        <p className="text-sm text-foreground">We couldn&apos;t load {releases} just now.</p>
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={() => void first.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return <AllReleasesCalendar kind={kind} calendar={first.data} />;
}

/**
 * The reader's own calendar: the **films they follow** reaching a release date
 * (`GET /me/calendar`, NEU-1411, EF-14) — title follows only, never the entity ones, which
 * produce timeline rows and nothing else (EF-3). Mounted by {@link CalendarView} once the
 * account has resolved *and* proved entitled.
 */
function MyFilmsCalendar({ kind }: { kind: CalendarKind }) {
  const { refresh } = useAuth();
  const first = useMyFilmsCalendar({ kind, limit: DATES_PER_PAGE, offset: 0 });

  // A grant that lapses mid-session shows up here and nowhere else: the cached account still
  // says `entitled`, so the tabs are up and this panel mounted, and the request came back 403.
  // Re-reading `/me` flips the flag and `CalendarView` replaces itself onto the public twin's
  // address (D-1544.2), so no error copy is ever shown for it (D-41).
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
  if (first.isPending || lapsed) return <CalendarSkeleton label="Loading your films calendar" />;
  if (first.isError) return <MyFilmsCalendarUnavailable kind={kind} />;

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
        kind,
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
  if (total === 0) {
    return <EmptyMyFilmsCalendar kind={kind} />;
  }
  return (
    <>
      <CalendarDateGroups items={items} bucketHeadings={kind === "theatrical"} />
      <ViewMoreButton hasMore={hasMore} loading={loading} onClick={loadMore} />
    </>
  );
}

/** Shown while a panel's first page is in flight — and, on My films, through the re-read of a
 *  lapsed grant. Occupies the content area only, so the swap does not reflow the heading and
 *  the controls above it. */
function CalendarSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="mt-6 space-y-8">
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
function MyFilmsCalendarUnavailable({ kind }: { kind: CalendarKind }) {
  return (
    <div className="mt-6 rounded-lg border border-border p-6">
      <p className="text-sm text-foreground">We couldn&apos;t load your films calendar just now.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Please try again in a moment — every release is still on the other tab.
      </p>
      <div className="mt-4">
        <BrowseAllReleasesLink kind={kind} />
      </div>
    </div>
  );
}

/** An entitled reader with nothing upcoming among the films they follow. Every word is an
 *  instruction rather than an apology. */
function EmptyMyFilmsCalendar({ kind }: { kind: CalendarKind }) {
  return (
    <div className="mt-6 rounded-lg border border-border p-6">
      <p className="text-sm text-foreground">
        {kind === "theatrical"
          ? "None of the films you follow has a theatrical date yet."
          : "None of the films you follow has a home release date yet."}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Follow films from any film page, or import your library to fill this in.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <BrowseAllReleasesLink kind={kind} />
        <Button asChild size="sm">
          <Link to="/welcome">Get started</Link>
        </Button>
      </div>
    </div>
  );
}

/** The way out of an empty or unavailable My films panel: the same kind under All releases. A
 *  `<Link>`, not a `<button>` — the other calendar is at another address now (D-1544.3), so it
 *  is a navigation like the tab it duplicates, and Back returns to My films. */
function BrowseAllReleasesLink({ kind }: { kind: CalendarKind }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link to={calendarPath({ tab: "all", kind })}>Browse all releases</Link>
    </Button>
  );
}
