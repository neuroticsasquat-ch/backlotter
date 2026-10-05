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
news" the day a story attaches, without changing day. On the grouped feed and the timeline the
section is laid out by **update type**, not by film; In the news, and the film page's
section, stay laid out by film. On the timeline the pair of sections repeats under every
**follow block** of the day.
_Avoid_: unconfirmed updates (the old heading, retired by NEU-1406 because it borrowed the
badge's word for a different axis), via TMDB (older still), catalog section (the codebase's
word, not the reader's), TMDB-only (fine in code, not on screen).

**Demotion** (of Not yet reported):
How a Not yet reported beat reads as lighter than an In the news beat without being hidden or
cut down. It has exactly two parts: **order** (within a day, In the news leads) and the
**heading** (the section is named). Nothing else differs: the same event text at the same size,
weight and colour, the same confidence badge, the same link. The feed's **update type** layout
is not a third part: it is a different arrangement, not a lighter one, and the beat badge it
drops is redundant with the update-type heading above it rather than withheld.
A section with nothing in it is not rendered at all, so an empty "Not yet reported" is silence,
never a placeholder line. Collapsing, titles-only rows and "None today" were earlier forms of
demotion and are retired (NEU-1467).
_Avoid_: hidden, collapsed, muted (reads as colour, which is not one of the two parts), smaller
(a type-size step was tried and dropped in NEU-1467), titles-only, None today.

**Update type**:
A reader-facing grouping of beats that heads a block of the feed's and timeline's Not yet
reported section. Under the feed, and under the timeline's Films block: Now available, Trailer,
Release date, Production status, Cast, Crew, Studios, Franchise, and a trailing Other updates
for any beat the grouping does not know. Under the timeline's People, Studios and Franchises
blocks, where every card is about the entity joining, leaving or losing a film: **Attached**,
**Detached**, **Canceled**, and the same trailing Other updates. Each update type gathers one
or more `event_type`s (Cast is `casting` + `cast_removed`; Production status is
`production_start` + `production_wrap` + `canceled`; Attached is every `*_attached` type plus
`casting`), runs in that fixed order within a day, and holds one film row (or entity row) per
film (or entity) it touched that day. A film with changes of two types appears under both.
Under an update-type heading an event line carries no beat badge; under Other updates it keeps
one, since that heading names nothing.
_Avoid_: category, event type (that is the beat's own classification, one level finer), beat
(a beat is one development; an update type is a heading over many), section (that is the
provenance split, In the news / Not yet reported, one level coarser), subgroup.

**Poster strip**:
The row of posters under a day heading on the grouped feed and the timeline, and over a day
(or the week) of the digest: one poster per film that has one, at most eight, each linking to
its film. Its order is the day's **reading order**: a film's poster sits where the film first
appears when the day is read top to bottom, follow block by follow block, In the news before
Not yet reported, update type by update type, row by row, and line by line within an entity
row. A film that appears twice has one poster, at its first appearance. The strip has no order
of its own: whatever rearranges the rows rearranges the strip.
_Avoid_: lead posters, day leads (the code's old name for a rule the strip no longer has),
news-first (true on the grouped feed only as a consequence of section order, and not on the
timeline), thumbnail row, carousel (it clips; it does not scroll).

### The timeline

**Follow block**:
One of the four groups a timeline day is laid out in, by the kind of follow that reached its
rows: Films, People, Studios, Franchises, always in that order, each split into In the news
and Not yet reported. The Films block is the feed's own layout over the films the reader
follows by title; the other three hold one **entity row** per followed entity with something
that day. A block with nothing in it is silence, and the Films heading renders even on a day
it is the only block. A card that reached the reader two ways is in both blocks: a cancellation
of a film whose director you follow and which you follow by title is under Films and under
People. The backend glossary owns the term; this entry names what the page shows.
_Avoid_: section (one level finer), group, tab, filter (every block renders; nothing is
hidden), entity section.

**Entity row**:
One followed person, studio or franchise's row under its follow block for a day: the entity's
name, linked to its page, as the headline, then one line per card — the film's title and
parenthetical as one link to the film page, then the summary in the event-line style, source
chips beneath. Rows sort by name; a row's lines sort by film title, then publication order.
An entity the catalog can no longer name renders a type fallback ("a person you follow") with
no link, as the follows page lists it with nulls rather than dropping it.
_Avoid_: entity card (that is the entity page's Recent activity card), via line (retired,
ADR-0019), film row (a Films-block row, headed by the film).

**Confidence badge**:
The `confirmed` / `unconfirmed` pill on every event card. The backend says `rumored`; the
badge says `unconfirmed`, and anything the frontend does not recognise also reads
`unconfirmed`. It is the card's only truth signal and the only place "unconfirmed" means
"we are not sure this is true", together with the "(unconfirmed)" release-date parenthetical.
_Avoid_: veracity heading, section badge, rumored (on screen).

### The home page and access

**Timeline hint**:
A first-party cookie (`timeline_hint=1`) on the site origin that the browser writes for itself
when the account last resolved entitled, and clears when it resolves anonymous or unentitled,
or on logout (NEU-1468, ADR-0001). It predicts that `/` will be the reader's timeline so the
server can render the timeline skeleton, and the nav its two-item form, before `/me` has
answered. It proves nothing and grants nothing: the API never sees it, and a stale one only
costs a skeleton-to-feed swap. The session cookie is a different thing on a different origin.
_Avoid_: session hint, auth cookie, logged-in flag (it is set only for entitled readers and is
not evidence of anything), login cookie.

**Access state**:
What `useFollowAccess()` answers about the viewer: **anonymous** (no account, which is also what
the server render sees), **locked** (signed in, no grant), **ready** (signed in and entitled),
and **hinted** (no account yet, the timeline hint is present, and an account read is in
flight). Hinted is a waiting state, never a resolved one: only the home page and the nav act on
it; every other surface treats it as anonymous until `/me` answers.
_Avoid_: auth state (that is signed in or not; access is the three-way split plus the wait),
pending/loading (hinted is not "still loading" in general, it is loading _with_ a prediction),
entitlement (one of its inputs, not the state).
