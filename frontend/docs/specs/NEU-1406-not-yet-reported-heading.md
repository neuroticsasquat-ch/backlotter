# NEU-1406 — "Not yet reported": the section heading names provenance, the badge names truth

**Target repo:** upcoming-movies-frontend (behaviour), plus a docs-only PR in
upcoming-movies-backend (ADR-0014 amendment, glossary, project-spec note), the same shape
NEU-1212 took.

**Linear:** https://linear.app/neuroticsasquatch/issue/NEU-1406
**Milestone:** M2 — Claim ledger and the event/state split
**Related:** NEU-1348 (built the badge), NEU-1208 (chose the heading), NEU-1212 (kept it),
NEU-1405 (separate ticket, separate decision — see Out of scope)

## What to build and why

The word "unconfirmed" does two unrelated jobs on the same screen and they contradict each other.

- **The card badge** (`confidenceLabel`, `src/components/film/labels.ts`) renders the event's
  `confidence`: the backend's `confirmed` | `rumored`, mapped to `confirmed` / `unconfirmed`
  (D-9). This is a **claim-truth** axis: how sure we are the thing is true.
- **The section heading** (`UNCONFIRMED_UPDATES_LABEL`, same file) heads the TMDB-only section
  on the grouped feed (`FeedDayGroups.tsx`) and the film page (`EventTimeline.tsx`). The split
  keys on `news_backed` = `EXISTS(event_story)` (`src/lib/feed-groups.ts`). This is a
  **provenance** axis: whether a trade outlet has covered it.

The axes are independent in both directions. Published events in the dev database on
2026-09-20:

| section        | badge `confirmed` | badge `unconfirmed` |
|----------------|------------------:|--------------------:|
| In the news    |               495 |                  24 |
| TMDB-only      |               342 |                 398 |

So 46% of the catalog section carries a `confirmed` badge under a heading that says
"unconfirmed updates", and amber `unconfirmed` badges already sit under "In the news" too. The
affected catalog beats are release dates and production milestones, the ones a reader most
wants to trust. M6 and M7 widen it: `now_available` (D-28) and `trailer` (D-35) are both
minted `confirmed` and both catalog-sourced.

The collision was deliberate. NEU-1208 renamed "via TMDB" to "unconfirmed updates" precisely
"so the heading signals the *uncertainty* of the updates rather than naming their source", and
two code comments assert the alignment (`labels.ts` says the badge vocabulary "matches"
the heading; `SourceLinks.tsx` calls the heading "the sole veracity signal"). NEU-1348 then
put a real veracity signal on every card, which is what turned a fuzzy heading into a
contradiction. This ticket unwinds NEU-1208's choice of word, not its structure.

**The decision:** the heading gives the word up. It becomes **"Not yet reported"**, a
provenance heading paired with "In the news". The badge keeps D-9's `confirmed` /
`unconfirmed`. A single explainer line, shared by the three surfaces, says what the split
means once per page.

### Ground truth from what shipped

- **D-9** (project spec): every card renders `confidence` as a badge; "the 'unconfirmed
  updates' section heading stays". This spec supersedes the second clause only.
- **NEU-1208** (ADR-0014 amendment 2026-08-29): heading renamed from "via TMDB"; per-card "via
  TMDB" attribution removed; feed catalog section demoted to titles-only and collapsed by
  default; both sections always render on the feed with "None today" for an empty one; the
  film page keeps conditional sub-headings.
- **NEU-1212** (ADR-0014 amendment 2026-09-02): catalog feed rows carry beat badges from
  `event_types`; everything in NEU-1208 stands.
- **NEU-1348**: the badge, `CONFIDENCE_PILL` styles on both `EventCard` and `FeedDayCard`,
  and the fail-safe in `confidenceLabel`.
- The word has a third job that is **not** touched: `src/lib/format.ts` renders a primary
  release date as "<date> (unconfirmed)". That is claim-truth, consistent with the badge.

## Design

### D-1406.1 — The heading is provenance; the badge is truth

"Unconfirmed" means one thing in the product from now on: a claim we are not sure of. That is
the badge (D-9) and the release-date parenthetical (NEU-1215). The section heading answers a
different question, "has a trade outlet covered this?", and must not borrow the truth
vocabulary to do it.

Consequences:

- `confidenceLabel` and its fail-safe are unchanged: anything that is not `confirmed` reads
  `unconfirmed`; an unknown value is never promoted.
- The section split stays keyed on `news_backed`, never `provenance`, so a TMDB-born beat that a
  trade later covers moves section without moving day (`splitByNewsBacked`).
- No card can now contradict its heading, because the heading no longer makes a truth claim.

### D-1406.2 — Heading text: "Not yet reported"

- Exact text: `Not yet reported`. Sentence case, matching "In the news" (the old heading was
  lowercase; that inconsistency goes with it).
- Pairs on both surfaces: feed sections read "In the news (3 movies)" / "Not yet reported
  (35 movies)"; the film page's sub-headings read "In the news" / "Not yet reported".
- The feed's `(N movie(s))` suffix, the collapsed-by-default toggle, the static "None today"
  line for an empty section, and the film page's conditional sub-headings are all unchanged.
- Rejected: "From TMDB" (names the source; fine now, but needs the reader to know TMDB),
  "Catalog updates" (codebase word), "Not in the news" (reads as a judgement on the film).

### D-1406.3 — One constant, renamed, still the only import on both surfaces

- `UNCONFIRMED_UPDATES_LABEL` is renamed to something provenance-shaped (e.g.
  `NOT_YET_REPORTED_LABEL`) and its value becomes `"Not yet reported"`. It stays in
  `src/components/film/labels.ts` and stays the single source both `FeedDayGroups` and
  `EventTimeline` import. No second literal anywhere in production source.
- Internal identifiers that already speak provenance (`tmdbOnly`, `newsBacked`, the section
  `key: "tmdb"`, `TmdbSubSection`, `tmdb_events`) are fine as they are.

### D-1406.4 — One explainer line, one constant, three surfaces

The split is worth one plain sentence per page, never one per day (the feed renders both
headings under every day; a per-day caption is the repeated noise NEU-1208 avoided).

- Copy, built from the heading constant so the two cannot drift:

  > Each day leads with what the trades have covered. Changes TMDB has recorded that no outlet
  > has reported yet sit under “Not yet reported”.

  Exported from `labels.ts` beside the heading constant (e.g. `SECTION_SPLIT_EXPLAINER`).
- **Global feed** (`GlobalFeed.tsx`, serves `/` anonymous and `/feed`): rendered in the
  existing standfirst paragraph after `GLOBAL_FEED_STANDFIRST`, as its second sentence.
  `GLOBAL_FEED_STANDFIRST` itself is unchanged (its doc comment explains it is crawler copy).
- **My feed** (`TimelinePage.tsx`): a new `<p className="mt-1 text-sm text-muted-foreground">`
  directly under the `TimelineHeading` row, rendered in the loaded state and the skeleton
  alike so the swap from SSR feed to timeline does not reflow around it. Not rendered on the
  empty-timeline state, which has its own copy.
- **Film page** (`EventTimeline.tsx`): the first child inside the "Latest updates"
  `CollapsibleSection`, above the day groups, same muted small-text style. Not rendered when
  `dayGroups` is empty (that state shows "No updates yet").
- Rejected: a tooltip on the heading (invisible on touch), a caption under each heading
  (repeats per day), no explainer at all (the user wants the split named once).

### D-1406.5 — The comments that asserted the collision move with it

- `labels.ts` `confidenceLabel` doc: drop "matching UNCONFIRMED_UPDATES_LABEL"; say the badge
  is the card's veracity signal and the section heading is its provenance signal, and that
  the two are independent (a `confirmed` badge under "Not yet reported" is normal).
- `SourceLinks.tsx` header comment: "the 'unconfirmed updates' section heading is the sole
  veracity signal" becomes: a catalog-sourced event with no outlets renders no attribution
  line; the section heading says where the beat came from, and the confidence badge on the
  card is the veracity signal.
- `FeedDayGroups.tsx` doc comments ("news-backed and unconfirmed halves", the `SectionWrapper`
  comment) use the new heading.

### D-1406.6 — Docs amendment in the backend repo (docs only, no code)

Same pattern as NEU-1212. One backend PR touching only:

- `docs/adr/0014-catalog-sourced-events.md`: a dated amendment (2026-09-20, NEU-1406)
  recording that the heading is renamed to "Not yet reported" because "unconfirmed" collided
  with D-9's confidence badge; the heading is a provenance signal and the badge is the veracity
  signal; the NEU-1208 structure (titles-only, collapsed, both-sections-always, "None today",
  no per-card attribution) and the NEU-1212 beat badges stand; NEU-1205's transient-invariant
  argument still holds for the feed's collapsed "Not yet reported" section.
- `CONTEXT.md`: the "Catalog-sourced event" entry (heading text, and "the section heading is
  the sole veracity signal" becomes provenance signal / badge is veracity), and the two other
  mentions of the old heading (under "Credit oscillation" and the NEU-1201 note near line 502).
- `docs/specs/bl-consumer-pivot-project-spec.md` D-9: a dated bracketed note that the heading
  clause is superseded by NEU-1406; the badge clause stands.

The frontend `CONTEXT.md` gains a glossary entry for the section (written during planning).

### What does not change

- The badge vocabulary, colours, and fail-safe (D-9, NEU-1348).
- The release-date "(unconfirmed)" parenthetical (`format.ts`, NEU-1215).
- `splitByNewsBacked` and the `news_backed` key; `dayPosterLeads` ordering.
- The feed's collapsed, titles-only catalog section with beat badges (NEU-1208, NEU-1212).
- Backend code, DTOs, migrations: none.
- "In the news" text.

## Acceptance criteria

### `src/components/film/labels.ts`

- The heading constant is renamed, its value is exactly `Not yet reported`, and it is the only
  place that string exists in production source.
- An explainer constant exists, is built from the heading constant, and reads as in D-1406.4.
- `confidenceLabel` is byte-for-byte the same function; its doc comment no longer claims the
  badge matches the heading.
- The literal "unconfirmed updates" appears in no production source file.

### Grouped feed — `FeedDayGroups.tsx`, `GlobalFeed.tsx`, `TimelinePage.tsx`

- A day with catalog rows renders a collapsed toggle labelled "Not yet reported (N movie(s))";
  a day without renders a static "Not yet reported" heading and "None today". Everything else
  in `SectionWrapper` is unchanged.
- The global feed's standfirst paragraph contains the existing standfirst sentence followed by
  the explainer sentence(s), once per page.
- My feed renders the explainer once under its heading row, in both the loaded state and the
  skeleton, and not on the empty-timeline state.

### Film page — `EventTimeline.tsx`, `SourceLinks.tsx`

- The TMDB sub-section heading reads "Not yet reported"; it still renders only when the day has
  TMDB events, and "In the news" still renders only when the day has news events.
- "Latest updates" opens with the explainer once when there is at least one day group, and not
  when there are none.
- A `confirmed` event under "Not yet reported" renders its `confirmed` badge unchanged; a
  `rumored` event under "In the news" renders `unconfirmed` unchanged.

### Tests (update in place; add where marked new)

- `src/components/film/labels.test.ts`: the "matching the section heading" test is renamed to
  say what it checks (rumored reads unconfirmed); new: the heading constant equals
  "Not yet reported"; new: the explainer contains the heading text.
- `src/components/film/EventTimeline.test.tsx`: three assertions on `/unconfirmed updates/i`
  move to the new heading; new: explainer present with day groups, absent without.
- `src/components/feed/GlobalFeed.test.tsx`: every "unconfirmed updates" lookup (toggle labels
  with counts, the empty heading, the section `describe`) moves to the new heading; new: the
  standfirst paragraph carries the explainer once.
- `src/components/feed/TimelinePage` tests (wherever the timeline is tested): new: explainer
  under the heading; absent on the empty state.
- `src/components/film/EventCard.test.tsx`, `FeedDayCard.test.tsx`: badge tests unchanged and
  still green. New in `EventTimeline.test.tsx`: a `confirmed` event under "Not yet reported"
  shows a `confirmed` badge (the ticket's headline case, pinned).
- `src/routes/feed.test.tsx` comment at line 289 updated.

### Tooling

- Frontend: lint, typecheck, and tests green.
- Backend docs PR: no code, no tests to run beyond the repo's markdown checks if any.

## Out of scope / deferred

- **NEU-1405** (what Follow and Watchlist each do, and whether they should be one thing). Raised
  during this planning session and explicitly parked: it has its own ticket and its own
  decision. Nothing here depends on it.
- Changing the badge's words, colour, or fail-safe; hiding the `confirmed` badge on catalog
  cards; any change to the "(unconfirmed)" release-date parenthetical.
- Un-collapsing the feed's catalog section, restoring per-card "via TMDB" attribution, or any
  change to what the backend ships for `news_backed=false` rows.
- A tooltip on the heading or a per-day caption.
