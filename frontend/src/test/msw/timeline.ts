import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { FeedDayItem, FeedDayResponse } from "@/api/types";

const base = env.apiBaseUrl;

/** A `/me/timeline` handler that pages over a fixed list of day items, so a test can click
 *  "View more" and get the next slice back rather than the same one twice. `total` is a count
 *  of *days*, matching the backend's grouped contract (NEU-1351) and what the page compares
 *  its group count against. */
export function timelineHandler(items: FeedDayItem[], total = countDays(items)) {
  return http.get(`${base}/me/timeline`, ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 10);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const days = [...new Set(items.map((item) => item.day))].slice(offset, offset + limit);
    const page = items.filter((item) => days.includes(item.day));
    return HttpResponse.json({ items: page, total, limit, offset } satisfies FeedDayResponse);
  });
}

/** An entitled account with nothing followed yet — the empty state, not an error. */
export function emptyTimelineHandler() {
  return timelineHandler([], 0);
}

/** The 403 `/me/timeline` answers for an account without a grant (D-39). The home page should
 *  never provoke it — the island only mounts the timeline once `entitled` is true — so a test
 *  installs this to prove the request was not made. */
export function lockedTimelineHandler() {
  return http.get(`${base}/me/timeline`, () =>
    HttpResponse.json({ detail: "entitlement_required" }, { status: 403 }),
  );
}

function countDays(items: FeedDayItem[]): number {
  return new Set(items.map((item) => item.day)).size;
}
