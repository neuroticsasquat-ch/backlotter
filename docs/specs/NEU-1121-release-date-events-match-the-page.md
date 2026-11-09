# NEU-1121 — Release-date events must obey the same region/type rules as the film page

**Ticket:** [NEU-1121](https://linear.app/neuroticsasquatch/issue/NEU-1121/backend-release-date-events-must-obey-the-same-regiontype-rules-as-the)
**Project:** backlotter: Undated Film Discovery · **Repo:** `upcoming-movies-backend`
**Date:** 2026-08-11 · **Base:** `main` (v0.3.0 is merged; the project's `release/v0.3.0` line is stale)

## Problem

A catalog-sourced `release_date` event cards a **different quantity** from the one the film page
displays, so a card routinely cites a date that appears nowhere on the page it sits on.

| | Source | Meaning |
|---|---|---|
| Event (`sweep/field_events.py`) | `catalog.film.release_date` via `film_field_change` | TMDB's **primary** date — earliest release in *any* country, of *any* type |
| Film page (`public/service.py:296`) | `catalog.film_release_date` | **US + origin country**, **theatrical only** (types 2/3) |

The primary date is a global minimum over a set the page deliberately filters down. They can
never be reliably equal.

**Observed 2026-08-11**, first sweep with the directors tranche live (77 events carded):

- *Avengers: Secret Wars* — page shows "Wide — Dec 17, 2027" (US); primary is `2027-12-15` (**France**);
  card reads *"moved from 16 December 2027 to 15 September 2027"*. Three dates, none agreeing.
- *Cliffhanger* — `origin_country = {US}`, its only release row is `DE / type 3`. The page can
  display **no release dates at all**, yet it received two cards.
- **21 of 56** release-date events that run were for films with no displayable theatrical date in
  US-or-origin. They would not exist under this spec.

### This corrects the project spec

§5.2's trigger table calls `release_date` events **"free — `film_field_change` trigger already
records it."** That is the defect in one line: the trigger records the primary date, which is not
the subject. §5.2's own conclusion — *"the credit half needs a change-history table"* — applies to
release dates for the same reason. Amend §5.2 as part of this work.

## Decisions

Settled 2026-08-11.

1. **The primary date is header-only and never cards.** `film.release_date` keeps exactly one
   display surface: the year parenthetical after the title (*"avengers: secret wars (2027)"*),
   regardless of region. It is **not** listed among release dates, and changes to it raise no
   event. Consequence: `release_date` leaves `TRACKED_FIELDS` in `field_events.py`; `status` stays.
   The header year may therefore change with nothing carding it — accepted.
2. **Events are scoped to displayable dates**: `iso_3166_1 ∈ {US} ∪ origin`, `release_type ∈ {2, 3}`
   (limited, wide). Identical to the page's own filter.
3. **One event per film per observation**, body naming each date that moved. Not one card per date.
   See "Event grain" below.
4. **Clean up the 77.** Deliberately unlike NEU-446, which was forward-only. See "Cleanup".

## Design

### Where the diff happens — follow `credit_history.py`

`catalog.film_release_date` has no trigger and no history, and `_rebuild_release_dates`
(`ingest/tmdb/upsert.py:218`) is delete-then-reinsert, so a US wide date moving leaves no trace.
This is the same problem NEU-1082 solved for credits, and the solution is settled precedent —
adopt its shape rather than re-deriving one:

- **Diff at the upsert**, the one point where both sides are already in hand.
- **Persist to `catalog.film_release_date_change`**, analogous to `film_credit_change`.
- **A sweep phase cards from that table**, analogous to `credit_events.py`.

### First observation is a baseline, never an event (spec §5.3)

A newly admitted film must not card its whole release slate. Take the precedent's hard-won
detail exactly: the marker is a **durable `film.release_dates_observed_at`**, *not* inferred from
`film_release_date` being empty. `credit_history.py` documents why — a film admitted with an empty
payload would re-baseline on every ingest and swallow the first real change forever.

Add `release_dates_observed_at` to `FILM_FIELD_CHANGE_DENYLIST` (as `credits_observed_at` already
is), or the marker's own write cards a field change.

### Event grain

`uq_event_catalog_change` is `UNIQUE (film_id, event_type, occurred_at) WHERE provenance = 'catalog'`.
Every change found in one refresh shares one observation timestamp, so per-date cards would put two
`release_date` rows on one film at one `occurred_at` and the second would be refused.

`group_attachments` in `credit_events.py` faced this and grouped. Do the same:

- One `Event` per `(film_id, observation timestamp)`, `event_type = "release_date"`.
- Body names each move: *"US wide moved from 17 Dec 2027 to 15 Jan 2028. US limited moved from
  10 Dec 2027 to 8 Jan 2028."*
- `subject_key = ['US:wide', 'US:limited']` — the discriminator, matching how credit events carry
  *who*.
- **`uq_event_catalog_change` is unchanged.**

This is also right on the merits: a distributor shifting a film moves limited and wide together —
one real-world beat — and separate cards would double-card it.

### Region and visibility

Populate `Event.region` so NEU-446's `_region_visible()` finally applies to catalog-sourced events
(today they are all `NULL`, i.e. unconditionally visible). For a group spanning US and origin, set
the region the group is *about*; where a single value cannot represent it, prefer `US` when a US
row is present, else the origin country.

**Pre-existing drift to fix while here:** the display builds `regions = {"US"} ∪ {origin_country[0]}`
(first origin only) while `_region_visible()` tests `Event.region == any_(Film.origin_country)`
(all of them). Factor the region set into one shared helper so the event writer, the display query
and the visibility predicate cannot disagree — the `catalog/seed_grade.py` pattern, for the same
stated reason: *"the two must not drift."*

### Change kinds

- **Set** — a displayable date appears where none existed (`ReleaseDateSet`).
- **Moved** — an existing displayable date changes (`ReleaseDateMoved`).
- **Withdrawn** — a displayable date disappears: **no event**, matching today's
  `classify_field_change` behaviour ("there would be no date to render").

### Clustering

`news/catalog_events.py` is explicit that `link.cluster` must recognise catalog events so a trade
story joins the existing card instead of opening a second one. Region/type-qualified release-date
events must stay matchable there.

## Cleanup of the 2026-08-11 events

Diverges from NEU-446's forward-only precedent by decision. Scope: the 77 events created
`2026-08-11 05:11` with `provenance = 'catalog'`.

- Delete those this spec would never have created — no displayable theatrical date in US-or-origin
  (21 of 56 release-date events), plus any whose subject is the primary date alone.
- `production_start` / `production_wrap` / credit events are **out of scope** — unaffected by this
  change.
- Cascade `news.event_summary` and `news.event_story`; check sitemap `lastmod` derivation for
  events being removed.
- One-off script under `scripts/`, not a migration — it is data repair against prod, and the
  local snapshot is no longer representative.

## Acceptance criteria

- A release-date event exists **only** where the film page would display that date, for that
  region and type.
- Changes to `film.release_date` raise no event; the year parenthetical still renders from it.
- One event per film per observation, body naming each moved date; `subject_key` carries the
  `region:type` list; `uq_event_catalog_change` is unchanged.
- `Event.region` is populated and `_region_visible()` applies.
- A newly admitted film's first observed release slate cards nothing, driven by a durable marker.
- The region set is defined in exactly one place and consumed by writer, display, and visibility.
- The 77 events are re-assessed and the unqualifying ones removed.
- Project spec §5.2 amended: `release_date` is not "free".
- `task test`, `task lint`, `task typecheck` green.

## Out of scope

- **Superseded / flip-flopping events** — [NEU-1122](https://linear.app/neuroticsasquatch/issue/NEU-1122),
  explicitly blocked on this and to be re-measured after. Most of that churn originates in the
  derived primary date and should disappear here.
- **Backlog window sizing** — [NEU-1123](https://linear.app/neuroticsasquatch/issue/NEU-1123).
- **Feed grouping by `created_at`** — settled as correct in
  [NEU-1120](https://linear.app/neuroticsasquatch/issue/NEU-1120). Do not change it.
- Non-theatrical types (premiere/digital/physical/TV) and non-US/origin regions — quiet by
  construction, unchanged.

## Open at implementation time

- Whether the carding phase extends `field_events.py` or lands as its own module beside
  `credit_events.py`. The latter matches the source split (one reads `film_field_change`, one reads
  a rebuilt-table diff) and keeps `sweep_detail()` legible; decide against the code.
- Whether `film_release_date_change` stores whole rows or only the fields the diff needs.
