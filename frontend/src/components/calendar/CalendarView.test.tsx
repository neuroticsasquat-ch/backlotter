import { createRoutesStub } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import {
  emptyWatchlistCalendarHandler,
  failingWatchlistCalendarHandler,
  lockedWatchlistCalendarHandler,
  watchlistCalendarHandler,
} from "@/test/msw/calendar";
import type { CalendarItem, CalendarResponse } from "@/api/types";
import { AuthProvider, useAuth } from "@/components/AuthContext";
import { CalendarView } from "@/components/calendar/CalendarView";

const base = env.apiBaseUrl;

function item(overrides: Partial<CalendarItem> & { film_ref: string }): CalendarItem {
  return {
    film_title: overrides.film_ref,
    release_year: 2026,
    poster_path: null,
    release_date: "2026-07-04",
    release_type: "wide",
    director: null,
    stars: [],
    genres: [],
    ...overrides,
  };
}

/** The SSR'd all-releases calendar the loader hands the island. Titles are deliberately unlike
 *  the watchlist fixture's, so a `getByText` says which panel it found. */
const publicCalendar: CalendarResponse = {
  items: [
    item({ film_ref: "public-odyssey", film_title: "Public Odyssey", release_date: "2026-07-04" }),
    item({ film_ref: "public-avatar", film_title: "Public Avatar", release_date: "2026-07-11" }),
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

/** The loader's first page when there is a second one: one date of two, so the all-releases
 *  tab has a "View more" of its own to page and then lose or keep across a switch. */
const pagedPublicCalendar: CalendarResponse = {
  items: [publicCalendar.items[0]],
  total: 2,
  limit: 20,
  offset: 0,
};

const watchlistItems = [
  item({ film_ref: "mine-dune", film_title: "Mine Dune", release_date: "2026-08-01" }),
  item({
    film_ref: "mine-sinners",
    film_title: "Mine Sinners",
    release_date: "2026-09-05",
    release_type: "limited",
  }),
];

/** 21 dates — one more than `DATES_PER_PAGE` — so "View more" is real arithmetic over the page
 *  size the app actually asks for, rather than a fixture backend that under-fills a page. */
const twentyOneDates = Array.from({ length: 21 }, (_, n) =>
  item({
    film_ref: `mine-${n}`,
    film_title: `Mine Film ${n}`,
    release_date: `2026-07-${String(n + 1).padStart(2, "0")}`,
  }),
);

/** The account state the page decides on, rendered so a test can wait for it. Without it,
 *  "there is no tab strip" is true before `/me` has answered as well as after, and every
 *  assertion about the un-tabbed page passes for the wrong reason. */
function AuthProbe() {
  const { user, loading } = useAuth();
  if (loading) return <p>account loading</p>;
  if (!user) return <p>account anonymous</p>;
  return <p>account {user.entitled ? "entitled" : "locked"}</p>;
}

const accountResolvedAs = (state: "anonymous" | "locked" | "entitled") =>
  screen.findByText(`account ${state}`);

/** `/calendar` with the providers the public layout gives it, so the island can resolve `me`
 *  the way it does in the app. */
function renderCalendar(calendar: CalendarResponse = publicCalendar) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    {
      path: "/calendar",
      Component: () => (
        <main>
          <h1>Calendar</h1>
          <AuthProbe />
          <CalendarView calendar={calendar} />
        </main>
      ),
    },
    { path: "/film/:slug", Component: () => null },
    { path: "/welcome", Component: () => <h1>Welcome</h1> },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/calendar"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const tabStrip = () => screen.queryByRole("tablist", { name: "Calendar view" });
const watchlistTab = () => screen.getByRole("tab", { name: "My watchlist" });
const allReleasesTab = () => screen.getByRole("tab", { name: "All releases" });

/** A `/me/calendar` handler that counts what was asked for, so a test can prove how many
 *  requests a switch cost and at which offsets. Pages by date over the fixture, as
 *  `watchlistCalendarHandler` does — spelled out here because the record is the point. */
function countingWatchlistCalendar(items: CalendarItem[]) {
  const calls: { limit: string | null; offset: string | null; credentials: RequestCredentials }[] =
    [];
  const dates = [...new Set(items.map((i) => i.release_date))];
  const handler = http.get(`${base}/me/calendar`, ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    calls.push({
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
      credentials: request.credentials,
    });
    const page = dates.slice(offset, offset + limit);
    return HttpResponse.json({
      items: items.filter((i) => page.includes(i.release_date)),
      total: dates.length,
      limit,
      offset,
    } satisfies CalendarResponse);
  });
  return { calls, handler };
}

describe("calendar view — no tabs for anyone without a grant", () => {
  it("renders the SSR'd calendar alone for an anonymous visitor, and asks for no watchlist", async () => {
    let asked = false;
    server.use(
      unauthMeHandler(),
      http.get(`${base}/me/calendar`, () => {
        asked = true;
        return HttpResponse.json({ detail: "auth_required" }, { status: 401 });
      }),
    );
    renderCalendar();

    expect(await screen.findByText("Public Odyssey")).toBeVisible();
    // Waited for the account to have landed, so "no tab strip" is a decision and not a race.
    await accountResolvedAs("anonymous");
    expect(tabStrip()).toBeNull();
    expect(asked).toBe(false);
  });

  it("renders the same page for a signed-in reader without a grant — not a locked or disabled tab", async () => {
    // The 403 handler is installed *and* counted: registering it alone would let a stray
    // request pass as a silent forbidden rather than trip MSW's unhandled-request guard, and
    // the point of this test is that the request is never made at all.
    let asked = false;
    const locked = lockedWatchlistCalendarHandler();
    server.use(
      meHandler({ entitled: false }),
      http.get(`${base}/me/calendar`, (info) => {
        asked = true;
        return (locked as unknown as { resolver: (i: typeof info) => Response }).resolver(info);
      }),
    );
    renderCalendar();

    expect(await screen.findByText("Public Odyssey")).toBeVisible();
    await accountResolvedAs("locked");
    expect(tabStrip()).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText(/nothing on your watchlist/i)).toBeNull();
    expect(asked).toBe(false);
  });
});

describe("calendar view — entitled", () => {
  it("opens on the reader's watchlist, with the all-releases panel mounted and hidden", async () => {
    server.use(meHandler({ entitled: true }), watchlistCalendarHandler(watchlistItems));
    const { container } = renderCalendar();

    expect(await screen.findByText("Mine Dune")).toBeVisible();
    expect(screen.getByText("Mine Sinners")).toBeVisible();
    expect(tabStrip()).toBeInTheDocument();
    expect(watchlistTab()).toHaveAttribute("aria-selected", "true");
    expect(allReleasesTab()).toHaveAttribute("aria-selected", "false");

    // The public calendar is still in the document, holding the loader's rows, but hidden.
    const panels = container.querySelectorAll('[role="tabpanel"]');
    expect(panels).toHaveLength(2);
    expect(panels[1]).toHaveAttribute("hidden");
    expect(screen.getByText("Public Odyssey")).not.toBeVisible();
  });

  it("wires each tab to its own panel", async () => {
    server.use(meHandler({ entitled: true }), watchlistCalendarHandler(watchlistItems));
    const { container } = renderCalendar();

    await screen.findByText("Mine Dune");
    for (const tab of [watchlistTab(), allReleasesTab()]) {
      const panelId = tab.getAttribute("aria-controls");
      const panel = container.querySelector(`#${CSS.escape(panelId!)}`);
      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    }
  });

  it("switches to the loader's rows without refetching the public calendar", async () => {
    let publicCalls = 0;
    server.use(
      meHandler({ entitled: true }),
      watchlistCalendarHandler(watchlistItems),
      http.get(`${base}/calendar`, () => {
        publicCalls += 1;
        return HttpResponse.json(publicCalendar);
      }),
    );
    renderCalendar();

    await screen.findByText("Mine Dune");
    await userEvent.click(allReleasesTab());

    expect(screen.getByText("Public Odyssey")).toBeVisible();
    expect(screen.getByText("Mine Dune")).not.toBeVisible();
    expect(allReleasesTab()).toHaveAttribute("aria-selected", "true");
    expect(publicCalls).toBe(0);
  });

  it("keeps all-releases paging across a tab switch, and pays for that page once", async () => {
    // The other half of D-1412.2, and the half a "no request on switch" assertion cannot reach:
    // the panel is never fetched on mount, so only a page the reader asked for proves it was
    // not remounted underneath them.
    let publicCalls = 0;
    server.use(
      meHandler({ entitled: true }),
      watchlistCalendarHandler(watchlistItems),
      http.get(`${base}/calendar`, () => {
        publicCalls += 1;
        return HttpResponse.json({
          items: [publicCalendar.items[1]],
          total: 2,
          limit: 20,
          offset: 1,
        } satisfies CalendarResponse);
      }),
    );
    renderCalendar(pagedPublicCalendar);

    await screen.findByText("Mine Dune");
    await userEvent.click(allReleasesTab());
    await userEvent.click(screen.getByRole("button", { name: /view more/i }));
    expect(await screen.findByText("Public Avatar")).toBeVisible();

    await userEvent.click(watchlistTab());
    await userEvent.click(allReleasesTab());

    expect(screen.getByText("Public Avatar")).toBeVisible();
    expect(publicCalls).toBe(1);
  });

  it("pages the watchlist by date, from the count of dates already on screen", async () => {
    let captured: Request | undefined;
    server.use(
      meHandler({ entitled: true }),
      http.get(`${base}/me/calendar`, (info) => {
        captured = info.request;
        const url = new URL(info.request.url);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 20);
        return HttpResponse.json({
          items: twentyOneDates.slice(offset, offset + limit),
          total: twentyOneDates.length,
          limit,
          offset,
        } satisfies CalendarResponse);
      }),
    );
    renderCalendar();

    expect(await screen.findByText("Mine Film 0", {}, { timeout: 3000 })).toBeVisible();
    expect(screen.queryByText("Mine Film 20")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /view more/i }));

    expect(await screen.findByText("Mine Film 20", {}, { timeout: 3000 })).toBeVisible();
    // Cookie-authed, like every other `/me/*` read — and asked for by date, not by film row.
    expect(captured?.credentials).toBe("include");
    expect(new URL(captured!.url).searchParams.get("offset")).toBe("20");
  });

  it("keeps paging progress across a tab switch, and pays for each page once", async () => {
    const counted = countingWatchlistCalendar(twentyOneDates);
    server.use(meHandler({ entitled: true }), counted.handler);
    renderCalendar();

    await screen.findByText("Mine Film 0", {}, { timeout: 3000 });
    await userEvent.click(screen.getByRole("button", { name: /view more/i }));
    await screen.findByText("Mine Film 20", {}, { timeout: 3000 });

    await userEvent.click(allReleasesTab());
    expect(screen.getByText("Public Odyssey")).toBeVisible();
    await userEvent.click(watchlistTab());

    // Both pages are still on screen, and nothing was fetched a second time to get them back.
    expect(screen.getByText("Mine Film 20")).toBeVisible();
    expect(counted.calls.map((c) => c.offset)).toEqual(["0", "20"]);
    expect(counted.calls.every((c) => c.limit === "20")).toBe(true);
    expect(counted.calls.every((c) => c.credentials === "include")).toBe(true);
  });
});

describe("calendar view — the three watchlist states", () => {
  it("reads an empty watchlist as empty, and offers the other tab and onboarding", async () => {
    server.use(meHandler({ entitled: true }), emptyWatchlistCalendarHandler());
    renderCalendar();

    expect(await screen.findByText(/nothing on your watchlist has a date yet/i)).toBeVisible();
    expect(screen.queryByText(/couldn't load your watchlist calendar/i)).toBeNull();
    expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute("href", "/welcome");

    await userEvent.click(screen.getByRole("button", { name: /browse all releases/i }));
    expect(allReleasesTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Public Odyssey")).toBeVisible();
  });

  it("reads a failed load as unavailable, without the onboarding link", async () => {
    server.use(meHandler({ entitled: true }), failingWatchlistCalendarHandler());
    renderCalendar();

    expect(await screen.findByText(/couldn't load your watchlist calendar/i)).toBeVisible();
    expect(screen.queryByText(/nothing on your watchlist has a date yet/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /get started/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /browse all releases/i }));
    expect(allReleasesTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Public Odyssey")).toBeVisible();
  });

  it("drops the tabs when the grant lapsed mid-session, showing no error copy on the way", async () => {
    let meCalls = 0;
    server.use(
      http.get(`${base}/me`, () => {
        meCalls += 1;
        return HttpResponse.json({
          id: "u1",
          email: "a@b.com",
          display_name: "Test User",
          is_admin: false,
          email_verified: true,
          // The cached account said entitled; the re-read the 403 provokes says otherwise.
          entitled: meCalls === 1,
          created_at: new Date().toISOString(),
          csrf_token: "test-csrf",
        });
      }),
      lockedWatchlistCalendarHandler(),
    );
    renderCalendar();

    // The tabs are up first, on the cached grant — then the 403 provokes the re-read that
    // takes them away again.
    await accountResolvedAs("entitled");
    expect(tabStrip()).toBeInTheDocument();

    await accountResolvedAs("locked");
    await waitFor(() => expect(tabStrip()).toBeNull());
    expect(screen.getByText("Public Odyssey")).toBeVisible();
    expect(screen.queryByText(/couldn't load your watchlist calendar/i)).toBeNull();
    expect(screen.queryByText(/nothing on your watchlist has a date yet/i)).toBeNull();
    expect(meCalls).toBeGreaterThan(1);
  });
});
