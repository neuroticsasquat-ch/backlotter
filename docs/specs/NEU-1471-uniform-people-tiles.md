# NEU-1471 — Uniform tiles in the onboarding people grid

**Ticket:** [NEU-1471](https://linear.app/neuroticsasquatch/issue/NEU-1471/photos-in-people-step-of-onboarding-are-all-different-sizes)
**Project:** bl: Maintenance (no milestone) · **Related:** NEU-1358 (built the grid and
`PersonTile`), NEU-1469 (last touched `PeopleStep`)
**Target repo:** frontend only. **Base branch:** `release/v1.1.1` (the current release branch;
the skills resolve it from the checkout). **Blocked by:** nothing · **Blocks:** nothing

## What to build and why

Step 2 of `/welcome` (`components/onboarding/PeopleStep.tsx`) lays thirty faces out in a CSS
grid — three columns on a phone, four at `sm`, six at `md`. Each face is a `PersonTile`: one
`<button>` that is the follow control, holding a `w185` TMDB profile image over a name, a
department line and a "Follow"/"Following" label. The photos render at visibly different sizes,
and tiles overlap their neighbours. While here, the label goes: thirty cards each saying
"Follow" repeat what a tappable card already says (Tom, this spec).

**Root cause (reproduced in Chrome on the dev stack at 1905px and 390px).** The image's own
sizing is right: `aspect-[2/3] w-full object-cover` gives every photo a 2:3 box, and TMDB serves
these profiles at a near-identical 185×278 anyway. What varies is the *tile*. A `<button>`
keeps a form control's shrink-to-fit width even with `display: flex`, so nothing pins it to the
`<li>`'s grid track; its width becomes `max(track, min-content of its children)`. The name span
is `truncate` (`white-space: nowrap`), so its min-content is the full name width — the button
grows to fit the name instead of the name truncating. Measured on the popular list at the
six-column width: tiles of 107, 109, 116, 123, 130, 137 and 144px in the same grid, the photo
scaling with each (`w-full`), and "Jason Statham" never actually ellipsised. Short names sit at
the 107px track, so the bug hides whenever the sample has short names — which is why a
placeholder repro with "Person 1" tiles is uniform.

The fix is to make the tile own its size from the grid track and let the name yield instead.

## Decisions in detail

### D-1471.1 — The button fills its grid cell

Add `w-full h-full` to the `PersonTile` `<button>`. `width: 100%` is a definite width, which
ends shrink-to-fit; `height: 100%` lets the button follow the `<li>`, which the grid already
stretches to its row (`align-items: stretch`), so every card in a row is the same height
whatever its text does. No change to the `<ul>`'s column counts or gap.

Verified live by forcing these two properties on the rendered page: all thirty tiles went to one
width (107px at six columns, 101px at three), every photo to one size, every row to one height.

### D-1471.2 — Names wrap to two lines rather than ellipsise

Once the tile is pinned to its track, 16 of the 30 popular names no longer fit on one line at
six columns. Chosen (Tom, this spec): the name may take a second line. Replace `truncate` on
the **name** span with `line-clamp-2 break-words` (Tailwind v4 core utilities; first use in this
repo). Two lines cover every name in the current popular set and every search result tried
("Millie Bobby Brown", "Hannah Waddingham"); a third line is clamped with an ellipsis, and the
full name is still in the button's `aria-label`.

The **department** line (`person.secondary`) keeps `truncate`: it is one short word.

Rejected: keeping the single-line ellipsis ("Jason Stath…" on more than half the grid), and
dropping to fewer desktop columns (a longer page for a step that wants a glance).

### D-1471.3 — No "Follow" label; a check badge marks a picked face

Remove the "Follow"/"Following" `<span>` from the tile entirely. The card is the control
(D-17, "tap to follow"); a label on every card saying so is noise, and thirty of them read as
a column of identical text under the faces. Its accessible job is already done elsewhere:
`aria-pressed` carries the state and the `aria-label` says "Follow X" / "Unfollow X".

A picked face is marked by a **check badge on the photo**, not by text: a small circle
(`size-5`, `rounded-full bg-primary text-primary-foreground`, `shadow-sm`) holding
lucide-react's `Check` at `size-3`, positioned `absolute top-1 right-1` over the photo's corner.
The badge renders only when `following` is true and is `aria-hidden` — the state is already
spoken by `aria-pressed`, and a second announcement would be a repeat. It sits alongside the
existing picked-state cues (primary border, tinted background, no grayscale), which stay.

To place the badge the `<button>` gains `relative`. No wrapper around the image: the photo is
the button's first child and starts at its top edge, so `top-1 right-1` on the button lands on
the photo's corner, and the button's `overflow-hidden rounded-lg` clips nothing of it. No new
icon convention: `lucide-react` is already a dependency (`Loader2` in the spinner); `Check` is
its second use.

Rejected: showing "Following" only on picked cards (text that appears and disappears shifts
the card's layout, and the check says it faster), and relying on the border and dim alone
(the tinted border is subtle on a dark theme; one glance at thirty faces should find the two
picked).

The text block is now name plus department only. With `h-full` on the button (D-1471.1) the
cards in a row are already equal; nothing inside needs bottom-aligning any more. The footer's
aggregate — "Following 2 people" in `PeopleStep` — stays: it is the one place that count is
said.

### D-1471.4 — The image markup is already right and does not change

`aspect-[2/3] w-full object-cover` on the `<img>`, the identical placeholder `<div>`, the
`grayscale(0.4)` dim on unfollowed faces, `loading="lazy"`, the `w185` size — all unchanged.
Do not wrap the image in a ratio box or switch to fixed pixel sizes; the ratio was never the
problem, and a fixed width would break the three/four/six-column fluid grid. The badge
(D-1471.3) overlays the photo from the button, not from inside the image markup.

### D-1471.5 — Both grid sources are covered by the one tile

The popular list and the person search (`useEntitySearch("person", …)`) both render
`PersonTile`, so the search path is fixed by the same change. No change to `PeopleStep`'s
data flow, debounce, or empty/error states.

## Acceptance criteria

1. **Uniform tiles.** On `/welcome` step 2 in Chrome at a desktop width (six columns) and at
   390px (three columns), every tile in the grid has the same rendered width, every photo the
   same rendered size, and every card in a row the same height. Measure with DevTools
   (`getBoundingClientRect` over `ul button[aria-pressed]`): one distinct width, one distinct
   image size, one distinct height per row. No horizontal page overflow at 390px.
2. **Names readable.** No name in the popular set is ellipsised at six columns; a name may
   take two lines; a name longer than two lines ends in an ellipsis. The department line stays
   on one line.
3. **No label, one badge.** No tile shows the word "Follow" or "Following". A picked card
   shows the check badge in the photo's top-right corner; an unpicked card shows no badge.
   Tapping toggles the badge with the border and dim, in the same paint as `aria-pressed`.
   The footer's "Following N people" count still appears once a face is picked.
4. **Behaviour unchanged.** Tap-to-follow, `aria-pressed`, the aria-label, the grayscale dim on
   unfollowed faces, and the search/popular swap all work as before; `Welcome.test.tsx`'s
   existing grid tests still pass unmodified.
5. **Regression guard.** jsdom does not lay out, so the guard is structural: in
   `Welcome.test.tsx` (or a new `PersonTile.test.tsx`), assert the rendered tile button carries
   `w-full` and `h-full`, that its name span carries `line-clamp-2` and not `truncate`, that
   the tile contains no "Follow" text, and that the badge (give it `data-testid="picked"`)
   is absent before the tap and present after. Comment the class assertions with the one-line
   reason (a `<button>` shrink-fits; these classes are what pin it to the track) so they are
   not "cleaned up" later.
6. `task test`, `task lint`, `task typecheck` green; changed files prettier-formatted.
   Commit as `fix(onboarding): …  (NEU-1471)`.
7. **Owed after merge:** one look on a real iPhone at 390px (the same device pass NEU-1404
   owes); the Chrome check is the gate, the device look is the confirmation.

## Out of scope

- The other person thumbnails (`FollowEntitySearch`, `MyFollows`, `SearchResultItem`,
  `routes/person.tsx`): they size their images with fixed `h-10 w-10` or a fixed-width column
  and are not affected.
- Any change to the grid's column counts, gap, or the `w185` image size.
- Card heights across *different* rows: rows are independent, as in any grid.
- The film page's `FollowButton` and the follows page's controls: they are separate controls
  with their own labels and are not part of this grid.
- Two dev-environment issues found while reproducing, neither part of this ticket: the web
  container's Vite dev server holds a stale module graph after a dependency bump until the
  service is restarted (`docker compose restart web`), and local signup answers 503 because the
  dev API has no `TURNSTILE_SECRET` (`dev-bypass` is the documented local value).
