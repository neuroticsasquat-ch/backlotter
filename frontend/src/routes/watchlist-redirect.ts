import { redirect } from "react-router";

/**
 * `/me/watchlist` → `/me/follows` (EF-14).
 *
 * The watchlist is gone from the product and the Films chip on the follows page is the list
 * that replaced it, so an old link — a bookmark, a mail, the address someone still types —
 * lands on the page that now holds its contents instead of a 404.
 *
 * It lands on the *whole* list rather than pre-selecting the Films chip, because there is no
 * chip to pre-select from a URL: `MyFollows` keeps the lit chips in `localStorage`
 * (`backlotter:follows-types`) and reads no search parameter at all, so a `?type=films` here
 * would be inert. Seeding the chips from the query string is its own change, and not one this
 * ticket asked for.
 *
 * A server loader rather than a component, so the redirect is a real 3xx: a crawler following
 * a stale link is told where the page went rather than being handed a shell that moves itself.
 *
 * **302, not 301**, even though the address is never coming back. A 301 is cached by the
 * browser indefinitely, which would freeze this target: if the chips ever do learn to read the
 * query string, a returning reader would keep landing on the unfiltered list and never ask us
 * again. The page was signed-in-only and never indexed, so the permanence buys no search
 * ranking to weigh against that.
 *
 * Deliberately outside `RequireAuth`: there is nothing here to protect, and `/me/follows` runs
 * its own guards. Bouncing an anonymous visitor through the login page first would send them
 * on to an address that no longer exists.
 */
export function loader() {
  return redirect("/me/follows");
}
