# backlotter web — Domain Context

The frontend renders the tracker's public surfaces (feed, film pages, calendar) for everyone and
the subscriber surfaces (timeline, follows, watchlist, settings) for entitled readers. The
backend's `../backend/CONTEXT.md` owns the domain; this file names only what the web app
adds or presents differently. When a term appears in both, the backend's definition governs.

## Language

### The calendar

**All-releases calendar**:
The public release calendar: every tracked film reaching a US release date, upcoming-only,
paged by date. It is the calendar an anonymous visitor sees, the one the server renders, and
the one an entitled reader reaches from the second tab.
_Avoid_: public calendar (true, but it is also what the entitled reader sees on that tab),
global calendar, full calendar, release calendar (the old page heading).

**Watchlist calendar**:
The all-releases calendar narrowed to the reader's own **watchlist items**, derived ones
included. Drawn from the watchlist, never the follow graph: following a director puts nothing
on it. The backend glossary defines the set and the date rule; on the web it is the first tab
an entitled reader lands on, and it never exists for anyone else. Its subscribed form is the
**iCal feed**, which holds the same films and dates.
_Avoid_: my calendar (the nav item is "Calendar"; the tab is "My watchlist"), follow calendar,
personal calendar, subscription calendar (that is the iCal feed).

**Calendar tab**:
One of the two views an **entitled** reader can switch between under the Calendar heading:
"My watchlist" and "All releases". A reader without a grant has no tabs at all: not a locked
tab, not a disabled one, just the all-releases calendar. The tab is a view on the page, not a
place; it is never a URL.
_Avoid_: mode, filter (the watchlist calendar is a different set, not the same set filtered
on the client), locked tab.
