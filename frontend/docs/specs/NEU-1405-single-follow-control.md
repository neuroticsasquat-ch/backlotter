# NEU-1405 — One follow control on the film page, and a cue that says what it does

**Target repo:** upcoming-movies-frontend

**Linear:** https://linear.app/neuroticsasquatch/issue/NEU-1405
**Story:** NEU-1413 *Follow subsumes the watchlist*
**Milestone:** M8 — Follow subsumes the watchlist (shared contracts live on the milestone)
**Blocked by:** NEU-1414 (backend: coverage on follows, computed watchlist, want/stop endpoints)
**Related:** NEU-1415 (the `/me/watchlist`, `/me/follows` and `/settings` half of the same leg),
NEU-1353 (built today's button pair)
**Decisions:** D-42 to D-45 in `../backend/docs/specs/bl-consumer-pivot-project-spec.md`,
ADR-0018 in `../backend/docs/adr/`

## What to build and why

The ticket was filed as "the film page gives no cue what Follow and Watchlist each do". The
planning session on 2026-09-20 decided the cue was the wrong fix: the two controls were hard to
explain because the split they exposed was not a real one. A title follow already implied a
watchlist item on every path but the film page's own Watchlist button; unfollowing the title
left the watchlist item behind; removing the watchlist item left the follow behind plus a
permanent dismissal; and a hand-watchlisted film never reached the timeline at all. The only
stated reason for two records was the push firehose, which is a question of *which of a
person's films* alert, not a reason for a second list.

So M8 merges them (D-42): every follow feeds the timeline **and** alerts, a person follow
carries a **coverage** that picks which credits alert (D-43), the store preference is one
per-user setting (D-44), and the watchlist becomes the computed set of in-play films the user's
follows cover, minus the films they have **muted** (D-45). The word "watchlist" survives as the
name of that set; the film page never says it.

This ticket is the film page's share of that: **one** control under the title instead of two,
and one static line beneath it that says what following a film does. The cue the ticket asked
for still ships; it now has one thing to explain.

### Ground truth from what shipped

- `FilmHeader.tsx` renders `<WatchlistButton>` then `<FollowButton target={titleTarget(film)}>`
  in a flex row under the title. Both take `useFollowAccess()` and render `SignInToggle`
  (anonymous) or `LockedToggle` (locked) from `follow/access.tsx`. `LockedToggle` hangs
  `LOCKED_COPY` as a native `title` on a wrapper `<span>` plus an `sr-only` `aria-describedby`
  target, because a disabled button takes no pointer events.
- `WatchlistButton` reads `useIsOnWatchlist(film.id)` and calls `useToggleWatchlist()`, which
  optimistically inserts or removes a `WatchlistItem` in the `["me","watchlist"]` cache and
  calls `POST /me/watchlist` / `DELETE /me/watchlist/{film_id}`.
- `FollowButton` for the title reads `useIsFollowing(target)` over `["me","follows"]` and calls
  `POST`/`DELETE /me/follows`, invalidating the timeline on success.
- Person, company and franchise `FollowButton`s elsewhere on the page (`FilmCrew`,
  `FilmCredits`, `ProductionCompanies`, the Collection row) are untouched by this ticket.
- After NEU-1414, `GET /me/watchlist` items carry `covered_by`, `followed` and `muted` and
  include muted films; `POST /me/watchlist {film_id}` means *want* (clear a mute, create a
  manual title follow if nothing else covers the film) and `DELETE /me/watchlist/{film_id}`
  means *stop* (delete a direct title follow, mute if another follow still covers it). Both
  answer the resulting item. `PATCH /me/watchlist/{film_id}` is gone.

## Design

### D-1405.1 — One control, keyed on the watchlist item, not on the title follow

Replace the pair with a single `TitleFollowButton` (`src/components/follow/TitleFollowButton.tsx`;
`WatchlistButton.tsx` is deleted). It answers one question, *will I hear about this film?*, and
reads that from the film's `WatchlistItem` (via a new `useWatchlistItem(filmId)` selector over
`useWatchlist()`, replacing `useIsOnWatchlist`), never from `["me","follows"]`. The title follow
is an implementation detail of *want* that the backend owns.

| watchlist item             | label       | variant     | `aria-pressed` | press sends              |
|----------------------------|-------------|-------------|----------------|--------------------------|
| none                       | `Follow`    | `default`   | `false`        | `POST /me/watchlist`     |
| `muted: true`              | `Muted`     | `outline`   | `false`        | `POST /me/watchlist`     |
| present, `muted: false`    | `Following` | `secondary` | `true`         | `DELETE /me/watchlist/…` |

Accessible names: `Follow {title}`, `Hear about {title} again`, `Stop hearing about {title}`.
The button is `disabled` while its mutation is pending, as today.

`FollowButton` keeps serving people, companies and franchises unchanged. `titleTarget` in
`lib/film-entities.ts` loses its only caller; delete it and its test.

### D-1405.2 — The reason line: "via Christopher Nolan"

When the item is present, not muted, and `followed` is `false`, the film is on the list only
because another follow covers it. Render a sibling `<span>` after the button, muted text, small:

- one covering follow: `via {covered_by[0].name}`
- several: `via {covered_by[0].name} and {n} more`

`covered_by` arrives direct-title-follow-first from the backend, so index 0 is the right name.
A `followed: true` item shows no reason line, even if other follows also cover it: the user
chose this one. The line is not part of the button's accessible name; it is plain text beside
it. Nothing renders in the anonymous or locked states, where there is no item to read.

### D-1405.3 — The cue is a static line, never a tooltip

Under the control row, in every access state, one line of `text-sm text-muted-foreground`:

> Following a film puts its news in your timeline and tells you when it gets a date, moves, or
> turns up to watch at home.

Export it as `FOLLOW_CUE` from `follow/access.tsx` beside `LOCKED_COPY`, so the two pieces of
copy that share this row live together. The cue is ordinary text, so it cannot collide with
the locked tooltip: `LockedToggle` keeps `LOCKED_COPY` on its wrapper `title` and `sr-only`
span exactly as built, and the cue sits below both. In the anonymous state the button is the
sign-in link it is today (`SignInToggle`, label `Follow`, name `Sign in to follow {title}`) and
the cue still reads beneath it, which is the ticket's "someone who has not seen the product can
tell from the film page alone" for a visitor who has not signed in either.

### D-1405.4 — Optimistic want/stop over the M8 item shape

Rework `useToggleWatchlist()` into `useWantFilm()` and `useStopFilm()` (or one hook taking the
current item; either is fine, but the cache edit must be exact):

- **want**, no item: insert `{film: watchlistFilm(film), covered_by: [], followed: true,
  muted: false, created_at: now}`. **want**, muted item: set `muted: false`.
- **stop**, item with `covered_by` naming anything other than the title itself: set
  `muted: true, followed: false`. **stop**, item covered only by the direct title follow:
  remove it.

On settle, invalidate `["me","watchlist"]` and reconcile from the server's answer (both
endpoints return the item). On success, also invalidate the timeline key: a title follow
changes what `/` shows, which the old watchlist toggle never did. A 403 `entitlement_required`
still routes through `isEntitlementError` to a refreshed `me`, not a toast.

### D-1405.5 — Types during the M8 transition

`WatchlistItem` in `api/types.ts` gains `covered_by: CoveringFollow[]` (`{entity_type,
entity_id, name}`), `followed: boolean`, `muted: boolean`, and its `alert_prefs` becomes
**optional** rather than removed. NEU-1415 deletes it with the chips; until then
`MyWatchlist.tsx` passes `item.alert_prefs ?? []` to `AlertPrefChips` so the page still
typechecks and renders against a backend that no longer sends the field. That one-line guard
is the only touch this ticket makes to `MyWatchlist.tsx`. Keep `useUpdateAlertPrefs` compiling;
NEU-1415 removes it.

### What does not change

- `useFollowAccess`, `SignInToggle`, `LockedToggle`, `LockedPanel`, `LOCKED_COPY`.
- Every non-title `FollowButton` on the page and `useToggleFollow()`. Follows created from the
  cast and crew rows take the backend's default coverage (`lead`); the film page offers no
  coverage control, that is the follows page's (NEU-1415).
- `FilmHeader`'s layout apart from the control row: the trailer, poster, arc and spec sheet
  stay where they are.
- The three access states as a set. No fourth state is introduced.

## Acceptance criteria

### `src/components/follow/TitleFollowButton.tsx` (new), `WatchlistButton.tsx` (deleted)

- Renders `SignInToggle` when anonymous, `LockedToggle` when locked, and the three-state
  button above when ready, with the labels, variants, `aria-pressed` and accessible names in
  D-1405.1.
- Renders the reason line per D-1405.2, and nothing when `followed` is true or the item is
  absent or muted.
- Press in each ready state sends the request in D-1405.1 and applies the cache edit in
  D-1405.4; the button is disabled while pending.

### `src/components/film/FilmHeader.tsx`

- Exactly one control under the title: `TitleFollowButton`. No `FollowButton` for the title.
- `FOLLOW_CUE` renders beneath the control row in all three access states, as text, not as a
  `title` or `aria-describedby`. In the locked state the wrapper `title` still equals
  `LOCKED_COPY` and the cue is present as well.
- A film whose payload has no `id` renders neither the control nor the cue (today's
  `watchlistFilm(film) === null` branch).

### `src/api/me.ts`, `src/api/types.ts`, `src/mocks/`

- `WatchlistItem` carries `covered_by`, `followed`, `muted`; `alert_prefs` is optional.
- `useWatchlistItem(filmId)` replaces `useIsOnWatchlist`; want/stop hooks per D-1405.4;
  `useIsFollowing`/`useToggleFollow` untouched.
- MSW handlers for `GET /me/watchlist`, `POST /me/watchlist` and
  `DELETE /me/watchlist/:film_id` answer the M8 shapes, including a muted fixture and a
  covered-only fixture.

### `src/lib/film-entities.ts`

- `titleTarget` removed; `watchlistFilm` kept.

### Tests (update in place; add where marked new)

- **new** `TitleFollowButton.test.tsx`: the three access states; the three ready states and
  their requests; the reason line for one and for several covering follows; no reason line
  when `followed`; optimistic insert, unmute, mute and remove; pending disables.
- `FilmHeader.test.tsx`: one control not two; cue present in anonymous, locked and ready;
  locked wrapper `title` is `LOCKED_COPY`; no control and no cue without a film id.
- `me.test.ts` (or wherever the hooks are covered): want/stop cache edits, timeline
  invalidation on success, entitlement 403 handling.
- `MyWatchlist.test.tsx`: still green with `alert_prefs` absent from a fixture.
- Remove `WatchlistButton.test.tsx` and the `titleTarget` cases in `film-entities.test.ts`.

### Tooling

`task test && task lint && task typecheck` green in the web container.

## Out of scope / deferred

- The backend (NEU-1414). This ticket cannot merge until the M8 endpoints are live; it may be
  built against MSW ahead of that.
- `/me/watchlist`, `/me/follows` and `/settings` (NEU-1415), including deleting `AlertPrefChips`,
  `alert_prefs` and the removal confirm, the per-person coverage control and the store setting.
- A cue for the person, company and franchise follow buttons. They mean what they say.
- Naming the coverage tier on the film page. A cast-row follow takes the default.
- The frontend `CONTEXT.md` note that the watchlist calendar now does reflect a director
  follow: written in this planning session alongside the backend glossary; NEU-1415 owns any
  further wording.
