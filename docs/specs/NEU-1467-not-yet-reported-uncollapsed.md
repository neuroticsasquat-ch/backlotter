# NEU-1467 — "Not yet reported" is uncollapsed, carries its events, and renders only when it has them

**Ticket:** [NEU-1467](https://linear.app/neuroticsasquatch/issue/NEU-1467/redesign-in-the-news-vs-not-yet-reported-display)
**Project:** bl: Maintenance (no milestone) · **Related:** NEU-1208 (the demotion this reverses),
NEU-1212 (beat badges, now a fallback), NEU-1406 (the heading and explainer, unchanged),
NEU-1207 (film-page label-only demotion, superseded by a size step), NEU-1205 (the flap-hold
argument that leaned on the collapse)
**Target repos:** upcoming-movies-backend (one service line, one test, ADR-0014 amendment,
CONTEXT.md) and upcoming-movies-frontend (the behaviour). Either order deploys safely — see
D-1467.7. **Base branch:** `release/v1.1.1` in both (the current head; frontend AGENTS.md's
`loop_base` is stale, pass `--base` explicitly).
**Blocked by:** nothing · **Blocks:** nothing

## What to build and why

Three bullets on the ticket, one design behind them: the grouped feed's "Not yet reported"
section stops hiding its content.

Today (NEU-1208 → NEU-1212 → NEU-1406) a catalog-only film-day on `/feed` and `/me/timeline` is
a collapsed toggle labelled "Not yet reported (N movies)"; opened, each row is a film title with
one inline badge per beat and no summaries, because the backend deliberately ships `events: []`
for `news_backed=false` rows. Both sections render on every day, with a static "None today" for
an empty one. The film page never collapsed and never shipped empty sections, so bullet three is
already true there.

The demotion arc (NEU-1201 hide → NEU-1207 label-only on the film page → NEU-1208 collapsed
titles-only on the feed → NEU-1212 badges back) has ended up hiding the beats a reader most
wants to scan: release dates, production milestones, `now_available`, trailers. The ticket
reverses the *visibility* demotion. What remains of the demotion is defined precisely in
D-1467.4 and recorded as the frontend glossary term **Demotion**.

### Ground truth from what shipped

- **Backend** (`src/upmovies/public/service.py`, `get_feed_grouped`): catalog events are already
  fetched, summarised and built into `EventOut` rows, then dropped by
  `_make_item(..., ship_events=False)`. `/me/timeline` calls the same function. Re-shipping them
  costs zero queries.
- **Frontend** `FeedDayCard` already has two row shapes keyed on `item.events.length`: event
  lines (beat pill, confidence badge, summary, source chips) when events arrive; inline beat
  badges after the title when they do not. Catalog events have no sources, so `FeedEventSources`
  renders nothing for them.
- **Frontend** `FeedDayGroups.SectionWrapper` owns the toggle (`useState(section.key !== "tmdb")`),
  the "(N movies)" suffix and the "None today" line.
- **Film page** `EventTimeline` renders "In the news" only when `news_events` is non-empty and
  `TmdbSubSection` only when `tmdb_events` is. `EventCard` summary text is 15px; feed event lines
  are 12px (`text-xs`); pills are 11px on the film page and 10px on the feed.
- **Docs** that assert the collapse: ADR-0014 amendments NEU-1208/1212/1406, backend
  `CONTEXT.md` "Credit oscillation" and "Day-grouped events", `dto.py`'s `events` comment,
  and the `FeedDayCard` docblock.

## Design

### D-1467.1 — Catalog rows ship their events again (backend)

`_make_item` loses the `ship_events` parameter; a `news_backed=false` row carries its catalog
events exactly as a news row carries its news events: `EventOut` with summary, confidence,
provenance, status, `superseded_by`, `video_key` and an empty `sources` list. `event_count`,
`top_event_type` and `event_types` are unchanged (they were always computed from the real
events). A film-day with both kinds still produces two rows (NEU-1199), each shipping only its
own kind's events.

### D-1467.2 — A "Not yet reported" feed row is an event-line row

`FeedDayCard` renders a catalog row through the same path as a news row: title link with
parenthetical, then one `FeedEvent` line per event (beat pill, confidence badge, summary,
edited marker, retraction marker). No source chips, because there are no sources. The
NEU-1212 inline beat badges are **not** rendered when events are present (the existing
`events.length === 0` guard already does this).

The inline-badge shape stays in the code as a **fallback** for a row that arrives with no
events, so an older backend deploy still renders a triageable row (D-1467.7). Its docblock and
tests say "fallback", not "catalog row".

JustWatch attribution on a `now_available` row stays keyed on `event_types` (once per row).

### D-1467.3 — The section is a static heading; a section renders only when it has items

`SectionWrapper` collapses to one shape for both sections: an `<h3>` reading
`<label> (N movie(s))` followed by the rows, always expanded. The toggle button, the chevron
and the `useState` go. A section with zero items renders **nothing** — no heading, no
"None today". `SECTION_BREAK` still separates the two sections when both render; a day with one
section renders that section with its heading (the heading is what the explainer points at).

So a day reads one of three ways:

- news + catalog: "In the news (2 movies)" rows, rule, "Not yet reported (12 movies)" rows;
- news only: "In the news (2 movies)" rows;
- catalog only: "Not yet reported (12 movies)" rows.

Applies to `/feed` (both routes) and `/me/timeline`, since both render `FeedDayGroups`. The
film page already behaves this way; the spec pins it with a test and changes nothing there for
this bullet.

### D-1467.4 — What the demotion is now: order and heading

A "Not yet reported" beat is demoted in exactly two ways, on **both** surfaces:

1. **Order** — within a day, "In the news" leads (`splitByNewsBacked` order, unchanged;
   `dayPosterLeads` unchanged).
2. **Heading** — the section is named "Not yet reported" (NEU-1406 text and explainer, unchanged).

Nothing else differs: same event line, same size, weight, colour and contrast, same badges.
Muting, opacity, a smaller type size, collapsing, titles-only and "None today" are all retired
or rejected forms.

> **Revised 2026-09-25, before merge.** This decision first had a third part, **type size**:
> event text under "Not yet reported" one step smaller (feed 12px → 11px, film page
> 15px → 13px), threaded as a `demoted` prop set by the section. It was implemented and then
> dropped at review, at Tom's call: a "Not yet reported" event description reads exactly like an
> "In the news" one. The `demoted` prop went with it, since nothing else would read it.

### D-1467.5 — The explainer and the heading text are unchanged

`NOT_YET_REPORTED_LABEL` and `SECTION_SPLIT_EXPLAINER` (NEU-1406) stand as written; the
explainer still describes the split accurately. Its placement (global feed standfirst, timeline
under the heading row, film page once above the day groups) is unchanged.

### D-1467.6 — The NEU-1205 flap-hold argument is restated, not lost

ADR-0014's NEU-1205/1208/1212/1406 amendments say the ≤N-day credit-flap hold is "confined to
the collapsed section". After this ticket that sentence is false. The amendment for NEU-1467
restates the argument: the hold window's cost (a briefly stale "attached" card) is bounded,
self-correcting, sits under a heading that names it as unreported, carries a `rumored` →
`unconfirmed` badge on every such card, and is ordered after trade news. That is the demotion;
hiding is no longer part of it.

### D-1467.7 — Deploy order: none required

- New backend + old frontend: catalog rows arrive with events; the old `FeedDayCard` already
  renders event lines for any row with events, inside the old collapsed toggle. Correct, just
  still collapsed.
- Old backend + new frontend: catalog rows arrive with `events: []`; the fallback badge shape
  (D-1467.2) renders inside an uncollapsed, static section. Correct, just summary-less.

Merge backend first anyway so the frontend PR's manual check can see real events.

## Acceptance criteria

### Backend — `src/upmovies/public/service.py`

- `_make_item` has no `ship_events` parameter; catalog rows pass their events like news rows.
- `GET /feed/grouped`: a `news_backed=false` item ships `events` with one `EventOut` per
  catalog event, each with `sources == []`, and `event_count == len(events)`.
- `GET /me/timeline`: a catalog row scoped in by a followed person ships that event's body, and
  only the scoped events (the NEU-1365 scope still applies to the event fetch).
- A film-day with both kinds still yields two rows, each with only its own kind's events
  (NEU-1199 unchanged).
- `dto.py` `events` comment no longer says catalog rows ship empty.

### Backend tests — `tests/integration/routers/`

- `test_public_feed_grouped.py`: `test_grouped_catalog_item_ships_empty_events` becomes
  `test_grouped_catalog_item_ships_its_events` (asserts two events, both `sources == []`,
  `event_count == 2`, `news_backed is False`); the NEU-1208 section comment is rewritten. The
  earlier `assert catalog_item["events"] == []` near line 697 flips to assert the trailer event
  is present. The `test_a_title_follower_sees_both` docstring (line ~1040) drops the "only kind
  that ships event bodies" clause; its assertions stand.
- `test_timeline.py` line ~184: the comment about `event_types` vs `events` is replaced; add
  an assertion that the row's single event is the `crew_attached` one.
- Full suite green (pre-commit runs it, ~2 min; background the commit).

### Frontend — `src/components/feed/FeedDayGroups.tsx`

- `SectionWrapper` renders `null` for an empty section; otherwise an `<h3>` with
  `"<label> (N movie(s))"` and the rows. No `<button>`, no `useState`, no "None today", no
  static count-less heading.
- Both sections still render through `SectionWrapper` with `SECTION_BREAK`.
- The `sections` array comment no longer says both sections always render.

### Frontend — `src/components/feed/FeedDayCard.tsx`

- The inline-badge shape survives as the no-events fallback; the docblock says so and no longer
  says "a catalog row (which ships no events since NEU-1208)".

### Frontend — `src/components/film/EventCard.tsx`, `EventTimeline.tsx`

- No change to either component: conditional sub-headings are already true (pinned below), and
  both sections render the same card.

### Frontend tests

- `GlobalFeed.test.tsx`: every `userEvent.click(... "Not yet reported (N movie…)")` is removed
  (rows are visible without a click). Rewrite: "collapsed by default" → "renders Not yet
  reported expanded with movie count and its rows visible"; "toggles … open on click" → "renders
  no toggle button in a day's sections"; "empty section shows None today" → "renders no Not yet
  reported heading and no None today on a news-only day"; add "renders no In the news heading on
  a catalog-only day"; "renders movie titles with beat labels but no event cards" → "renders a
  catalog row's event lines with summary and badges" using a fixture that ships one catalog
  event with `sources: []`, asserting the summary text, the beat pill and the `confirmed`
  badge are present and no source chip renders. The static-vs-toggle heading assertion
  (`tagName === "H3"`) extends to "Not yet reported (N movies)". Tests at lines ~133–150 and
  ~257–259 that assert "None today" or an empty heading flip to `queryByText(...)` being null.
- `FeedDayCard.test.tsx`: the badge tests stay green; rename "renders beat labels when events
  are empty" to say it is the fallback.
- `EventCard.test.tsx`: unchanged.
- `EventTimeline.test.tsx`: new "renders no In the news heading on a TMDB-only day and no Not
  yet reported heading on a news-only day" (pins bullet three); existing "confirmed badge under
  Not yet reported" test stays and additionally asserts both sections' summaries share one
  class list.
- `src/routes/feed.test.tsx` comment at ~306 updated (no longer "collapsed").
- `labels.test.ts` unchanged.

### Docs

- Backend `docs/adr/0014-catalog-sourced-events.md`: dated amendment (2026-09-25, NEU-1467)
  recording that NEU-1208's visibility demotion on the feed is reversed — catalog rows ship
  events again, the section is uncollapsed and static, empty sections are not rendered, "None
  today" is retired — and that the demotion is now order + heading on both surfaces (the
  film page's NEU-1207 label-only demotion now describes the feed too); restates the NEU-1205
  argument per D-1467.6; notes NEU-1212's badges are now a no-events fallback and NEU-1406's
  heading and explainer stand.
- Backend `CONTEXT.md`: "Credit oscillation" (the "confined to the collapsed … section" sentence)
  and "Day-grouped events" (the collapsed-by-default and no-events clauses) rewritten to the new
  shape.
- Frontend `CONTEXT.md`: **Demotion** term (written during planning, already in place).

### Tooling

- Frontend: lint, typecheck, tests green.
- Backend: ruff, pyright, full pytest green.

## Out of scope / deferred

- Changing the heading text, the explainer copy or their placement (NEU-1406 stands).
- Any change to `news_backed`, `_has_story()`, `splitByNewsBacked`, `dayPosterLeads`, day
  pagination or the NEU-1199 two-rows-per-film-day contract.
- The digest mail and the entity activity cards (`/person`, `/company`, `/collection` pages):
  they have their own rendering and are not sectioned this way.
- A per-row "via TMDB" attribution (removed by NEU-1208, stays removed).
- Payload size on a backfill day (70+ catalog rows × events): accepted; gzip level 6 is
  app-wide (NEU-1451) and the events were already being fetched server-side. Revisit only if
  a real page proves heavy.
- Colour or opacity changes to demoted rows (considered, rejected: the confidence badge's amber
  must keep its contrast, and colour would be a third demotion axis). A smaller type size was
  also dropped (see D-1467.4's revision note).
