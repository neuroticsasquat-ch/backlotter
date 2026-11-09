# NEU-1533 — The poster strip follows the day's reading order

**Ticket:** [NEU-1533](https://linear.app/neuroticsasquatch/issue/NEU-1533/poster-strip-in-my-feed-and-all-updates-are-now-out-of-order)
**Project:** bl: Maintenance (no milestone) · **Related:** NEU-1519 (Not yet reported laid out
by update type — the regrouping the ticket names), NEU-1527 (the timeline laid out by follow
block), NEU-1528 / NEU-1529 (the daily and weekly digest reproduce the timeline, strip
included), NEU-1203 (the last strip ticket: de-duplication), NEU-1467 (the silence rule for
empty sections)
**Target repos:** upcoming-movies-frontend (the two pages) and upcoming-movies-backend (the
digest's strip). Nothing crosses the API; either order deploys safely. **Base branch:** `main`
in both (no `origin/release/*` is open in either repo).
**Blocked by:** nothing · **Blocks:** nothing

## What to build and why

The strip of posters under a day heading is meant to be the day's films in the order the reader
meets them below. It stopped being that twice, silently:

- **NEU-1519** laid Not yet reported out by update type: heading → film row → that film's
  events of that type. A film under *Release date* now renders above a film under *Cast*
  whatever their titles, and a film with two kinds of change renders twice.
- **NEU-1527** laid a timeline day out in follow blocks — Films, People, Studios, Franchises —
  each with both sections, and People/Studios/Franchises hold entity rows sorted by entity
  name, with a line per film.

Both project specs explicitly left the strip alone (`bl-not-yet-reported-by-type` §2 and NR-2;
`bl-feed-by-followed-entity` FB-7: "orders news-backed first, and nothing about that changes").
So the strip still runs its own rule from before either project — news-backed films first, then
TMDB-only, each in natural title order, de-duplicated by film, capped at eight — and that rule
no longer describes what is under it. On **All updates** the Not yet reported half of the strip
is in title order while the rows are in update-type order. On **My feed** the whole strip is
wrong whenever a day has more than one block, because "news-backed first across the day" and
"Films block first" cannot both hold.

The digest has the same drift: `day_posters` in `digest_sender.py` is a hand-copy of the
strip's old rule laid over blocks that order differently, and the Digest Content project
promises the daily *is* the timeline day reproduced in mail (FB-18) and the weekly the same
blocks read by entry (FB-19).

The fix is not a third sort rule. It is to stop giving the strip a rule of its own: the strip
reads the same layout the sections render, and a film's poster sits where the film first
appears. Whatever reorders the sections reorders the strip, forever.

### Ground truth from what shipped

**Frontend.** `src/lib/feed-groups.ts` holds every grouping helper, all pure and
SSR-deterministic: `groupByDay`, `splitByNewsBacked` (natural-title sort, then the
`news_backed` split), `groupByUpdateType(items, map?)` (one `UpdateTypeRow` per film per
heading, films keeping their incoming order), `groupByFollowBlock` (keyed on
`via?.entity_type`, `via` null → Films), `groupByEntity` (one `EntityRow` per entity, rows by
entity name, lines by film title then event order) and `dayPosterLeads(items, limit)` (the old
rule). The two renderers compose those helpers inline:

- `FeedDayGroups` (All updates, `/feed`): per day, `FeedDayPosters` over the whole day, then
  `splitByNewsBacked` → In the news as `FeedDayCard` rows → Not yet reported as
  `UpdateTypeGroups(groupByUpdateType(tmdbOnly))`, h3 sections, h4 update types.
- `TimelineDayGroups` (My feed, `/`): per day, `FeedDayPosters` over the whole day, then
  `groupByFollowBlock` → per block (h3) `splitByNewsBacked` → sections (h4) → Films block
  renders `FeedDayCard` rows and `UpdateTypeGroups(groupByUpdateType(tmdbOnly))`; entity
  blocks render `groupByEntity(newsBacked)` and
  `UpdateTypeGroups(groupByUpdateType(tmdbOnly, ENTITY_UPDATE_TYPE_MAP))` with
  `groupByEntity(group.rows)` under each heading (h5).
- `FeedDayPosters({ items })` calls `dayPosterLeads(items)` and renders a fixed-width, clipped,
  masked row, first poster eager and the rest `loading="lazy"`.

`UpdateTypeGroups` and `EntityRow` render exactly the order of the data they are handed; no
component re-sorts. So the rendered order *is* the composition order of those helpers, and a
pure function that composes them the same way is the rendered order.

**Backend.** `digest_sender.py` already builds the layout as data: `group_blocks(lines, order)`
→ `DigestBlock(key, label, sections)` → `DigestSection(news_backed, rows, update_types)` →
`DigestUpdateType(key, label, rows)` → `DigestRow(reach, beats)` → `DigestBeat.film`. A news
section carries `rows`; a Not yet reported section carries `update_types`. Rows are already
sorted (`film_row_key` / `entity_row_key`, per `LineOrder`), and the Jinja template
(`mail/templates/digest/body.html`, `poster_strip` macro and the block loops) renders tuples in
order. `group_days` and `group_week` compute `posters=day_posters(lines)` from the flat lines,
beside — not from — the blocks they build in the same call. `day_posters` sorts by
`(not news_backed, film.sort_key)` and de-duplicates with `setdefault`.

## Decisions

**D-1533.1 — A poster's position is its film's first appearance in reading order.** Read the
day top to bottom exactly as rendered — block by block, within a block In the news then Not
yet reported, within Not yet reported update type by update type, within a heading row by row,
and within an entity row line by line — and the strip is the distinct films met, in that order.
De-duplication is a consequence of the rule, not a step beside it: a film under two update
types, or reached by a title follow and an entity follow, has one poster, at its first
appearance. Films without a poster are skipped, as today. The cap stays `MAX_DAY_POSTERS = 8`.

Consequences worth naming. On All updates, news-backed films still lead — because In the news
precedes Not yet reported in the single block, not because the strip says so. On My feed they
no longer do across the day: a Films-block Not yet reported film sits ahead of a People-block
In the news film, because that is the order the page reads in. That is the intended change,
not a regression. The eager-loaded first poster is simply the first film the reader meets.

**D-1533.2 — One layout tree per day, which the renderer renders and the strip walks.** The
renderers stop composing grouping helpers inline. A pure function in `feed-groups.ts` builds
the day's layout as data, the renderer renders that data, and the strip is a walk over the same
data. Agreement is structural: there is no second place that could drift. The existing helpers
(`splitByNewsBacked`, `groupByUpdateType`, `groupByFollowBlock`, `groupByEntity`) stay exported
and tested as they are; the layout functions compose them.

**D-1533.3 — One tree type: a day is a list of follow blocks.** All updates lays out as a
single Films block whose heading the renderer does not draw. The renderers stay separate as
FB-8 decided (`FeedDayGroups` for the feed, `TimelineDayGroups` for the timeline); only the
data they render is shared. Shape, names indicative:

```ts
interface DayLayout {
  blocks: BlockLayout[]; // only blocks with rows (FB-1); the feed's is exactly one, `films`
}
interface BlockLayout {
  key: FollowBlock;
  label: string;
  sections: SectionLayout[]; // only sections with rows (NEU-1467); In the news before Not yet reported
}
type SectionLayout =
  | { section: "news"; kind: "films"; rows: FeedDayItem[] } // Films block: FeedDayCard rows
  | { section: "news"; kind: "entities"; rows: EntityRow[] } // entity block: EntityRow rows
  | { section: "not_yet_reported"; kind: "films"; groups: UpdateTypeGroup<UpdateType>[] }
  | {
      section: "not_yet_reported";
      kind: "entities";
      groups: { key: EntityUpdateType; label: string; rows: EntityRow[] }[];
    };

export function layoutFeedDay(items: FeedDayItem[]): DayLayout; // one Films block over every item, `via` ignored
export function layoutTimelineDay(items: FeedDayItem[]): DayLayout; // groupByFollowBlock, then per block as today
export function filmsInReadingOrder(day: DayLayout): FeedDayItem[]; // every row's / line's item, in order, duplicates included
export function dayPosterLeads(day: DayLayout, limit = MAX_DAY_POSTERS): FeedDayItem[]; // filter poster → first appearance → cap
```

The entity-block Not yet reported body holds `EntityRow[]` per heading — the output of
`groupByEntity(group.rows)` — so the walk sees lines in the order `EntityRow` renders them. The
tree holds only what renders: no empty blocks, no empty sections, no empty headings.
`SectionWrapper` may keep its `empty` prop for its other callers, but neither renderer needs it
for a tree section.

`FeedDayPosters` takes the layout (`{ day: DayLayout }`), not the flat items, so a caller
cannot hand it anything but what it renders itself. Each renderer builds the layout once per
day and passes it to both the strip and the sections.

**D-1533.4 — The digest's strip walks its own tree, in this ticket.** `day_posters` takes the
blocks (`Iterable[DigestBlock]`) instead of the flat lines and walks block → section →
(`rows`, else `update_types` → `rows`) → `beats` → `film`, keeping the first appearance of
each `film_id` with a `poster_url`, capped at `MAX_DAY_POSTERS`. `group_days` and `group_week`
build the blocks first and derive `posters` from them. The weekly's strip is one walk over the
week's blocks, so a film with cards on two days is one poster at its first entry. The template
is untouched; its `poster_strip` macro already renders the tuple in order.

**D-1533.5 — No ADR.** The decision is reversible and reads as obvious once the two project
specs' "unchanged" lines are amended; the spec is the record.

## Acceptance criteria

Frontend, All updates (`/feed`) and My feed (`/`):

1. For every rendered day, the strip's poster links are, in order, the distinct film links
   that appear in the day's sections below it in document order, skipping films without a
   poster, cut at eight. A test renders each page's day with a fixture that exercises the
   trap cases and asserts exactly this by reading the DOM, strip links versus body links.
2. Trap cases covered by that fixture: a Not yet reported film whose title sorts first but
   whose update type is not first; a film under two update types; on My feed, a Films-block
   Not yet reported film and a People-block In the news film (the Films one leads); an
   entity row with two lines (line order, by film title); a film reached by title and by an
   entity follow (one poster, at the Films position); an entity-only day (still has a strip,
   FB-7).
3. No poster is repeated within a day; a film without `poster_path` has no poster and leaves
   no gap; at most eight posters render; the first is eager and the rest lazy; the row still
   clips and fades (the existing `FeedDayPosters` tests, rewritten to take a layout).
4. The pages render nothing differently below the strip. Headings, heading levels, section
   order, update-type order, entity-row order and row contents are byte-for-byte what they
   are today, and the existing renderer tests pass unchanged or with only the layout-input
   change.
5. `layoutFeedDay`, `layoutTimelineDay`, `filmsInReadingOrder` and `dayPosterLeads` are pure
   (no `Date.now()`, no locale-dependent sort beyond what the helpers already do), so server
   and client markup match.

Backend, digest:

6. `group_days(...)[i].posters` equals the first-appearance walk of
   `group_days(...)[i].blocks`; `group_week(...).posters` the same over `.blocks`. The
   existing `day_posters` test (news-first order) is replaced by a reading-order assertion
   with the My-feed trap case (a Films-block Not yet reported film ahead of a People-block
   news film) and the weekly case (a film on two days, one poster at its first entry). The
   entity-only-day test stays.
7. An `/admin/digest` preview of a day with two blocks shows the mail strip in the same order
   as the timeline's strip for that day.

Docs:

8. `bl-feed-by-followed-entity-project-spec.md` FB-7 and `bl-not-yet-reported-by-type-project-spec.md`
   NR-2 / §2 each gain a revision line: the strip's order is the day's reading order
   (NEU-1533), superseding "news-backed first, nothing about that changes".
9. The frontend `CONTEXT.md` carries the **Poster strip** glossary term (written with this
   spec). The backend `CONTEXT.md` digest entry ("its poster strip") needs no change.
10. Docblocks stop describing the old rule: `FeedDayPosters`, `dayPosterLeads` ("news-backed
    films first", "by popularity", "desktop column") and `day_posters` ("news-backed first,
    each by natural title"). `groupByDay`'s "`last_created_at DESC`" aside is the NR spec §7's
    optional fix; take it since the file is open (backend order is day → significance →
    natural title).

## Key technical notes and constraints

- **`layoutFeedDay` ignores `via`.** The global feed's rows carry `via: null` (or no `via`
  against an older backend); every row is a film row in one Films block. Do not route it
  through `groupByFollowBlock` — a global-feed backend that one day shipped a non-null `via`
  would otherwise silently sprout entity blocks on a page that has no follows.
- **`layoutTimelineDay` is exactly today's composition.** `groupByFollowBlock(items)`, then
  per block `splitByNewsBacked(block.items)`, then for Films `groupByUpdateType(tmdbOnly)`
  and for entity blocks `groupByEntity(newsBacked)` and
  `groupByUpdateType(tmdbOnly, ENTITY_UPDATE_TYPE_MAP)` with `groupByEntity(group.rows)` per
  heading. Entity blocks keep `rowKey` / `EntityRow.key` as React keys (FB-9).
- **The walk yields duplicates; `dayPosterLeads` de-duplicates.** Keep `filmsInReadingOrder`
  honest (every appearance) so a test can assert it against the DOM one-to-one; the strip is
  the only consumer that wants distinct films.
- **Keys.** De-duplicate by `film_ref` on the frontend (one film can arrive as several
  `FeedDayItem` objects: two sections, two reaches) and by `film_id` on the backend, as today.
- **The backend walk follows the section's populated side.** `DigestSection.rows` for In the
  news, `DigestSection.update_types[*].rows` for Not yet reported; a section never has both.
  An entity row's `beats` name several films; walk the beats, not `row.film`.
- **Deploy order.** Independent. The frontend change is client-only rendering; the backend
  change is mail rendering. Neither reads anything new from the other.

## Out of scope / deferred

- Any change to the order *within* a section, update type or entity row. In the news keeps
  natural title order (the NR spec §2 "order In the news by significance" idea stays parked).
- The cap (eight), the poster size, the mask, lazy loading, the mail's 52px posters.
- The slate (my-films calendar) section of the digest and its per-film posters; it has no
  strip.
- A strip on the film page or the entity pages; neither has one.
- An ADR (D-1533.5).

## Owed around merge

- An eyeball of both pages on a day with two or more follow blocks, and of a backfill-tall
  day, on a phone: the strip's first poster should be the first film under the first heading.
- A digest test-send from `/admin/digest` for the same day, to see the mail strip agree with
  the page.
