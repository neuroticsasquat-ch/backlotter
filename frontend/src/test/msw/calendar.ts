import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { CalendarItem, CalendarResponse } from "@/api/types";

const base = env.apiBaseUrl;

/** A `/me/calendar` handler that pages over a fixed list of items, so a test can click "View
 *  more" and get the next slice back rather than the same one twice. `limit`/`offset` count
 *  *distinct release dates*, matching NEU-1411's contract and what the panel compares its date
 *  count against — a film with two dates is two rows on two of them.
 *
 *  It answers the requested **calendar kind** (NEU-1542) from the one fixture, as the backend
 *  does: `theatrical` the wide and limited rows, `home` the digital ones, and both when the
 *  kind is omitted. `total` is that kind's date count unless the test pins one. */
export function myFilmsCalendarHandler(items: CalendarItem[], total?: number) {
  return pagedCalendarHandler(`${base}/me/calendar`, items, total);
}

/** `/calendar`'s counterpart of {@link myFilmsCalendarHandler}, for the panels the browser
 *  fetches itself — the loader's In theaters page is handed in, not requested. */
export function publicCalendarHandler(items: CalendarItem[], total?: number) {
  return pagedCalendarHandler(`${base}/calendar`, items, total);
}

function pagedCalendarHandler(path: string, items: CalendarItem[], total?: number) {
  return http.get(path, ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const ofKind = itemsOfKind(items, url.searchParams.get("kind"));
    const dates = [...new Set(ofKind.map((item) => item.release_date))].slice(
      offset,
      offset + limit,
    );
    const page = ofKind.filter((item) => dates.includes(item.release_date));
    return HttpResponse.json({
      items: page,
      total: total ?? countDates(ofKind),
      limit,
      offset,
    } satisfies CalendarResponse);
  });
}

const KIND_BUCKETS: Record<string, readonly string[]> = {
  theatrical: ["wide", "limited"],
  home: ["digital"],
};

function itemsOfKind(items: CalendarItem[], kind: string | null): CalendarItem[] {
  const buckets = kind === null ? undefined : KIND_BUCKETS[kind];
  return buckets ? items.filter((item) => buckets.includes(item.release_type)) : items;
}

/** An entitled reader with nothing upcoming among the films they follow — a 200 with nothing
 *  in it, which is the empty state and not an error (NEU-1411). */
export function emptyMyFilmsCalendarHandler() {
  return myFilmsCalendarHandler([], 0);
}

/** The 403 `/me/calendar` answers for an account without a grant (D-39). The page should only
 *  provoke it when a grant lapsed mid-session, so a test installs this either to prove the
 *  request was never made or to drive the re-read that follows it. */
export function lockedMyFilmsCalendarHandler() {
  return http.get(`${base}/me/calendar`, () =>
    HttpResponse.json({ detail: "entitlement_required" }, { status: 403 }),
  );
}

/** A failure that is not the entitlement gate — the "unavailable" state, which must never be
 *  confused with the empty one. */
export function failingMyFilmsCalendarHandler() {
  return http.get(`${base}/me/calendar`, () =>
    HttpResponse.json({ detail: "server_error" }, { status: 500 }),
  );
}

function countDates(items: CalendarItem[]): number {
  return new Set(items.map((item) => item.release_date)).size;
}
