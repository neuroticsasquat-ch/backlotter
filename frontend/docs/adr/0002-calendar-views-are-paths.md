# ADR-0002 — Each calendar tab × kind combo is a path

**Status:** Accepted 2026-10-09 (NEU-1544) · **Amends:** D-1412.1 (`../specs/NEU-1412-tabbed-calendar.md`)
and D-1542.3 (`../specs/NEU-1542-calendar-split-and-initial-release-only.md`) · **Spec:**
`../specs/NEU-1544-calendar-views-are-paths.md`

## Context

NEU-1412 gave `/calendar` two tabs for an entitled reader (My films / All releases) and decided the
tab is component state: `/calendar` stays one indexable address, the nav lands an entitled reader
on their own films, and the server-rendered document never depends on who is looking. It rejected
`?tab=all` by name. NEU-1542 added the kind control (In theaters / At home) for every reader and
extended the same rule to it.

Both decisions reasoned about the document and the nav and not about history. With four views on
one address the browser cannot name the one the reader was on: Back from a film page, or Back
after a switch, lands on the front view every time. Tom filed that as a bug (NEU-1544).

## Decision

Each combination of tab and kind is a path under `/calendar`, spelled as the controls are on
screen, with the default tab and kind carrying no segment:

| Path | View |
|---|---|
| `/calendar` | All releases · In theaters |
| `/calendar/at-home` | All releases · At home |
| `/calendar/my-films` | My films · In theaters |
| `/calendar/my-films/at-home` | My films · At home |

- **One meaning per URL, whoever looks.** `/calendar` is All releases for everyone; the nav's
  Calendar item sends `ready`/`hinted` readers to `/calendar/my-films` instead.
- **The controls are links**, so a switch is a pushed navigation and Back retraces it.
- **A locked reader on a My films address is `replace`d onto its public twin** once the account
  read has settled; the URL never names a view the reader cannot see.
- **One route module (`calendar/*`) serves all four**, so the view stays mounted across them and
  NEU-1412's mounted-`hidden` panels keep their "View more" progress; `shouldRevalidate` is
  `false` between calendar addresses, so a click costs no loader round trip.
- The server still never resolves auth: a My films address server-renders its public twin's
  document and canonicalises to it. `/calendar/at-home` is a real public page with its own title
  and sitemap entry.

What survives from the amended decisions: the kind is still never a *remembered* preference, and
the tab strip still does not exist for a reader without a grant.

## Consequences

- Back works on and off the page. Links to a specific view can be shared and bookmarked.
- The site gains one indexable page (`/calendar/at-home`) and two canonicalised duplicates.
- An entitled reader's full load of `/calendar/my-films` paints the public calendar first, then
  the tab strip and the My films skeleton — the flash `/calendar` already had. ADR-0001's hint
  could remove it later without touching this decision.
- A redirect that fires before `/me` settles would bounce entitled readers without the hint
  cookie off their own calendar; the settled check (`resolving === false`) is what prevents it.
- The `CONTEXT.md` entries **Calendar tab** and **Calendar kind** no longer say "never a URL".
