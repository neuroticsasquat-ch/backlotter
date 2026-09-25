# backlotter web — Domain Context

The frontend renders the tracker's public surfaces (feed, film pages, calendar) for everyone and
the subscriber surfaces (timeline, follows, settings) for entitled readers. The
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

**My films calendar**:
The all-releases calendar narrowed to the films the reader follows (EF-14). Following a
director, a studio or a franchise puts nothing on it: an entity follow delivers that entity's
attachments and detachments, not its films. The backend glossary defines the set and the date
rule; on the web it is the first tab an entitled reader lands on, and it never exists for
anyone else. Its subscribed form is the **iCal feed**, which holds the same films and dates.
_Avoid_: watchlist calendar (the old name, retired with the watchlist), my calendar (the nav
item is "Calendar"; the tab is "My films"), follow calendar, personal calendar, subscription
calendar (that is the iCal feed).

**Calendar tab**:
One of the two views an **entitled** reader can switch between under the Calendar heading:
"My films" and "All releases". A reader without a grant has no tabs at all: not a locked
tab, not a disabled one, just the all-releases calendar. The tab is a view on the page, not a
place; it is never a URL.
_Avoid_: mode, filter (the my-films calendar is a different set, not the same set filtered
on the client), locked tab.

### The feed and the film page

**Not yet reported** (section):
The heading over the beats only TMDB has recorded, on the grouped feed, the timeline and the
film page. It answers one question, whether a trade outlet has covered the beat, and pairs
with **In the news**, which holds the beats an outlet has. It says nothing about whether the
beat is true: that is the **confidence badge** on the card, which renders `confirmed` or
`unconfirmed` and is independent of the section. A `confirmed` release date under "Not yet
reported" is the normal case, not a contradiction. A beat moves from this section to "In the
news" the day a story attaches, without changing day.
_Avoid_: unconfirmed updates (the old heading, retired by NEU-1406 because it borrowed the
badge's word for a different axis), via TMDB (older still), catalog section (the codebase's
word, not the reader's), TMDB-only (fine in code, not on screen).

**Demotion** (of Not yet reported):
How a Not yet reported beat reads as lighter than an In the news beat without being hidden or
cut down. It has exactly two parts: **order** (within a day, In the news leads) and the
**heading** (the section is named). Nothing else differs: the same event line at the same size,
weight and colour, the same beat and confidence badges, the same link.
A section with nothing in it is not rendered at all, so an empty "Not yet reported" is silence,
never a placeholder line. Collapsing, titles-only rows and "None today" were earlier forms of
demotion and are retired (NEU-1467).
_Avoid_: hidden, collapsed, muted (reads as colour, which is not one of the two parts), smaller
(a type-size step was tried and dropped in NEU-1467), titles-only, None today.

**Confidence badge**:
The `confirmed` / `unconfirmed` pill on every event card. The backend says `rumored`; the
badge says `unconfirmed`, and anything the frontend does not recognise also reads
`unconfirmed`. It is the card's only truth signal and the only place "unconfirmed" means
"we are not sure this is true", together with the "(unconfirmed)" release-date parenthetical.
_Avoid_: veracity heading, section badge, rumored (on screen).
