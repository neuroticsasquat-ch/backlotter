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
