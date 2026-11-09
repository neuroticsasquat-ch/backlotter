import type { FollowAccess } from "@/components/follow/access";
import { DEFAULT_CALENDAR_ADDRESS, calendarPath } from "@/lib/calendar";
import { SITE_NAME } from "@/lib/seo";

export const WORDMARK = SITE_NAME;

export interface NavItem {
  label: string;
  href: string;
  /** The path whose whole subtree lights the item, when that is wider than `href`'s: the Calendar
   *  item links to one of the four calendar addresses but is the current page on all of them
   *  (NEU-1544). Defaults to `href`. */
  activePath?: string;
}

/**
 * The primary nav, which depends on whether the reader has a timeline to be offered.
 *
 * `/` is the reader's own timeline once they are signed in **and** granted access
 * (NEU-1354, D-12), and the global feed otherwise — which is exactly what `/feed` renders.
 * So for anyone without a grant the two items were the *same destination under two names*,
 * and the second one is dropped.
 *
 * The predicate is `access`, not "is signed in": a signed-in account without a grant sees
 * the global feed on `/` just as an anonymous visitor does, so it gets the same single item.
 * That is the same three-way split `useFollowAccess` already drives for the follow buttons
 * and `TimelineOrFeed`, which is why this takes it rather than inventing its own.
 *
 * The labels for a reader who *does* have both say which feed is which. "Updates" and "All
 * updates" did not: nothing in the pair conveyed that the first was narrowed to the people
 * you follow and the second was everything we track.
 *
 * **Each label is the name of the page it leads to**, not a separate word for it. "All
 * updates" is what `/feed` already calls itself in its heading and its `<title>`; "My feed"
 * is what `/` is renamed to. A nav that says one thing and lands on a page headed another
 * makes the reader check whether they arrived.
 *
 * `hinted` gets the two-item form too: the timeline hint predicts `ready`, and the home page is
 * already showing the "My feed" skeleton for it (NEU-1468, D-1468.5). A hint that turns out wrong
 * collapses the nav with the page when `/me` answers.
 *
 * The Calendar item is the same label for everyone but not the same address: `/calendar` is All
 * releases whoever is looking (NEU-1544, D-1544.1), so a reader with films of their own is sent
 * to `/calendar/my-films`, where the calendar opens on them. A `hinted` reader goes there too;
 * if the hint is wrong, the page replaces itself onto `/calendar` once `/me` answers (D-1544.2).
 */
export function navItemsFor(access: FollowAccess): NavItem[] {
  if (access === "ready" || access === "hinted") {
    return [
      { label: "My feed", href: "/" },
      { label: "All updates", href: "/feed" },
      {
        label: "Calendar",
        href: calendarPath({ tab: "films", kind: "theatrical" }),
        activePath: calendarPath(DEFAULT_CALENDAR_ADDRESS),
      },
    ];
  }
  // `/feed` keeps working and stays in the sitemap; it is just not worth a nav entry when it
  // is a second door onto the page the reader is already looking at.
  return [
    { label: "Updates", href: "/" },
    { label: "Calendar", href: calendarPath(DEFAULT_CALENDAR_ADDRESS) },
  ];
}
