import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { CalendarItem, CalendarResponse } from "@/api/types";

const base = env.apiBaseUrl;

/** A `/me/calendar` handler that pages over a fixed list of items, so a test can click "View
 *  more" and get the next slice back rather than the same one twice. `limit`/`offset` count
 *  *distinct release dates*, matching NEU-1411's contract and what the panel compares its date
 *  count against — a film with two dates is two rows on two of them. */
export function watchlistCalendarHandler(items: CalendarItem[], total = countDates(items)) {
  return http.get(`${base}/me/calendar`, ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const dates = [...new Set(items.map((item) => item.release_date))].slice(
      offset,
      offset + limit,
    );
    const page = items.filter((item) => dates.includes(item.release_date));
    return HttpResponse.json({ items: page, total, limit, offset } satisfies CalendarResponse);
  });
}

/** An entitled reader whose watchlist has nothing upcoming — a 200 with nothing in it, which
 *  is the empty state and not an error (NEU-1411). */
export function emptyWatchlistCalendarHandler() {
  return watchlistCalendarHandler([], 0);
}

/** The 403 `/me/calendar` answers for an account without a grant (D-39). The page should only
 *  provoke it when a grant lapsed mid-session, so a test installs this either to prove the
 *  request was never made or to drive the re-read that follows it. */
export function lockedWatchlistCalendarHandler() {
  return http.get(`${base}/me/calendar`, () =>
    HttpResponse.json({ detail: "entitlement_required" }, { status: 403 }),
  );
}

/** A failure that is not the entitlement gate — the "unavailable" state, which must never be
 *  confused with the empty one. */
export function failingWatchlistCalendarHandler() {
  return http.get(`${base}/me/calendar`, () =>
    HttpResponse.json({ detail: "server_error" }, { status: 500 }),
  );
}

function countDates(items: CalendarItem[]): number {
  return new Set(items.map((item) => item.release_date)).size;
}
