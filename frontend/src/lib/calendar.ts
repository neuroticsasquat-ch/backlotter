// How many release dates a calendar page shows. "View more" fetches the next page of dates
// (manual — never auto-loads — so the footer stays reachable). Shared by the route's loader,
// the all-releases panel and the My films panel, so "View more" means the same span of dates
// on all three — the counterpart of `DAYS_PER_PAGE` in `lib/global-feed.ts`.
//
// It lives here rather than in the route module because both panels import it and neither
// should reach into a route to page itself; `lib/calendar-groups.ts` is left alone because it
// is about shaping a response, not about asking for one.
export const DATES_PER_PAGE = 20;

/**
 * Which of the two calendars a reader is looking at (NEU-1542, D-1542.2): **In theaters** — the
 * US theatrical arc, wide and limited — or **At home**, the US digital date. The backend's
 * `kind` query parameter on `GET /calendar` and `GET /me/calendar`, so the API layer and the
 * view share one spelling.
 */
export type CalendarKind = "theatrical" | "home";

/** The two tabs an entitled reader sees (NEU-1412): their own **My films**, and **All releases**,
 *  the public calendar everyone else sees alone. */
export type CalendarTab = "films" | "all";

/** One of the four views `/calendar` has an address for (NEU-1544, D-1544.1). */
export interface CalendarAddress {
  tab: CalendarTab;
  kind: CalendarKind;
}

/** What `/calendar` itself names, for everyone: All releases, In theaters. The defaults carry no
 *  segment, so the most-linked address never moved when the others gained theirs. */
export const DEFAULT_CALENDAR_ADDRESS: CalendarAddress = { tab: "all", kind: "theatrical" };

// The segments, spelled as the controls are on screen (EF-19).
const MY_FILMS_SEGMENT = "my-films";
const AT_HOME_SEGMENT = "at-home";

/** `/calendar` + the segments for an address: nothing for the default tab or kind, `my-films`
 *  and `at-home` otherwise, tab before kind. */
export function calendarPath({ tab, kind }: CalendarAddress): string {
  const segments = [
    ...(tab === "films" ? [MY_FILMS_SEGMENT] : []),
    ...(kind === "home" ? [AT_HOME_SEGMENT] : []),
  ];
  return ["/calendar", ...segments].join("/");
}

/** The inverse, over the route's splat (`""`, `"at-home"`, `"my-films"`, `"my-films/at-home"`;
 *  a trailing slash is tolerated). `null` for anything else — the loader turns that into a 404.
 *  Strict about order and spelling, so each view has exactly one address. */
export function parseCalendarPath(splat: string | undefined): CalendarAddress | null {
  const trimmed = (splat ?? "").replace(/\/$/, "");
  const segments = trimmed === "" ? [] : trimmed.split("/");
  const tab: CalendarTab = segments[0] === MY_FILMS_SEGMENT ? "films" : "all";
  const rest = tab === "films" ? segments.slice(1) : segments;
  if (rest.length === 0) return { tab, kind: "theatrical" };
  if (rest.length === 1 && rest[0] === AT_HOME_SEGMENT) return { tab, kind: "home" };
  return null;
}
