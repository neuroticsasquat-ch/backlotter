# NEU-369 — Tighten home feed row density (design)

- **Ticket:** [NEU-369](https://linear.app/neuroticsasquatch/issue/NEU-369) `[frontend]` — Tighten home feed row density for faster scanning
- **Project / milestone:** Movies: Content Quality · MVP Quality Bar
- **Related:** [NEU-370](https://linear.app/neuroticsasquatch/issue/NEU-370) `[backend]` — Order within-day home feed by film popularity (independent; not touched here)
- **Date:** 2026-06-24
- **Repo:** `upcoming-movies-frontend`
- **Branch:** `tom/neu-369-frontend-tighten-home-feed-row-density-for-faster-scanning`
- **Scope:** one frontend PR, no backend / API / type changes.

## Problem

On the public home "Latest Updates" feed (`/`, `src/routes/feed.tsx`), each `FeedDayCard`
(`src/components/feed/FeedDayCard.tsx`) is ~130px tall: a `w-12` poster (~72px), `p-3` padding, a
title line, and a **separate** badge line, with `space-y-3` between bordered cards. The list is
tedious to scan — a screenful shows only a handful of films.

## Desired behaviour

Each (film, day) row becomes a single compact text line (~40px, well under half the current
~130px height) in a hairline-divided list. Title + beat badge + the muted `+N` overflow count sit on
**one line**; the whole row stays a single link to the film page. No poster.

## Decisions (locked with Tom)

| Question | Decision |
| --- | --- |
| Overall layout | **One-line divided list, no poster.** Chosen over "tightened bordered cards" and "divided list with a tiny thumbnail" — Tom picked maximum density, accepting the loss of poster-based at-a-glance recognition. |
| Poster | **Removed entirely** from the card. The `<img>` and the no-poster placeholder both go. `item.poster_path` stays on the `FeedDayItem` type (API response unchanged) — it is simply unused by this component. |
| Beat badge | **Kept** — the existing indigo rounded-full pill. It is now the only color anchor in the row, and the ticket explicitly calls for keeping the beat badge. |
| `+N` overflow | **Kept** — muted `+{event_count - 1}`, shown only when `event_count > 1`, grouped with the badge on the right. |
| Row container | **Divided list, not bordered cards.** Drop the per-row border + rounding; rows are separated by hairline dividers (`divide-y`) and get a full-width `hover:bg-gray-50` band. |
| Whole-row link | **Unchanged** — each row is one `<Link to={/film/${item.film_slug}}>`. |
| Scope | FE-only. No backend, API, DTO, or type change. NEU-370's within-day ordering is independent and out of scope. |

## Design

### `src/components/feed/FeedDayCard.tsx` (rewrite)

- **Remove the poster:** delete the `<img>` / placeholder `<div>` block and the `posterUrl` import
  (and the `poster` local). `item.poster_path` remains a field on the passed `FeedDayItem` — no type
  change, just no longer read here.
- Row is a single whole-row link:

  ```tsx
  <Link
    to={`/film/${item.film_slug}`}
    className="flex items-center justify-between gap-3 px-2 py-2 hover:bg-gray-50"
  >
    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{item.film_title}</h3>
    <div className="flex shrink-0 items-center gap-2 text-xs">
      <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-indigo-800">
        {eventTypeLabel(item.top_event_type)}
      </span>
      {item.event_count > 1 && <span className="text-gray-500">+{item.event_count - 1}</span>}
    </div>
  </Link>
  ```

- Title goes `text-base` → `text-sm` for density and `min-w-0 flex-1 truncate` so it ellipsizes
  before crowding the right-aligned badge group.
- The badge markup itself is unchanged from today (same indigo pill, same `eventTypeLabel`).

### `src/routes/feed.tsx` (page)

- Inner per-day wrapper `mt-3 space-y-3` → **`mt-2 divide-y divide-gray-100`** — a hairline-divided
  list instead of spaced bordered cards.
- Day-section spacing `mt-8` → **`mt-6`** to tighten the gap between day groups.
- Everything else is unchanged: the `loader → meta → FeedPage → ErrorBoundary` shape, the
  `<h1>Latest Updates</h1>`, the `<h2>` `<time>` day headers, `groupByDay`, the empty state, and the
  `ErrorBoundary`.

## Test impact — `src/components/feed/FeedDayCard.test.tsx`

The existing tests are behavior-focused, so most survive; two reference the poster and must change:

- **"links the whole card … shows the poster, title, and beat"** — keep the link-`href`, title, and
  beat-label (`"Release date"`) assertions; **drop** the two poster assertions
  (`getByRole("img", { name: "The Odyssey poster" })` and the `/w154/odyssey.jpg` `src` check).
  Rename to drop "poster".
- **"renders a placeholder and no image when the film has no poster"** — **delete** (no poster
  concept remains). Replace with a guard that the card **never renders an `<img>`**
  (`expect(screen.queryByRole("img")).toBeNull()`), so a future re-add of a poster is a conscious
  choice.
- **"shows no +N suffix for a single-event day"** and **"shows +N … when a film has multiple events
  that day"** — unchanged.

No route-level test exists for `feed.tsx` (only the component test), so no other test files change.

## Acceptance criteria

1. Each home-feed row is a single line (title + beat badge + optional `+N`), visibly well under half
   the previous height (~40px vs ~130px), with tightened inter-row spacing.
2. No poster/thumbnail renders in the feed; no broken-image or placeholder box appears.
3. The whole row remains a single link to `/film/{slug}`.
4. Day grouping, headers, empty state, and error boundary are visually unchanged.
5. `tsc -b`, eslint (no unused `posterUrl` import), and vitest all pass; the updated
   `FeedDayCard.test.tsx` reflects the new markup.

## Scope / non-goals

- **In scope:** `src/components/feed/FeedDayCard.tsx`, `src/routes/feed.tsx`, and
  `src/components/feed/FeedDayCard.test.tsx`.
- **Out of scope:** any backend / API / DTO / `FeedDayItem` type change; NEU-370's within-day
  popularity ordering; the `/film/{slug}` timeline; the `posterUrl` helper (`src/lib/poster.ts`)
  and its other consumers (e.g. the film page), which stay.
