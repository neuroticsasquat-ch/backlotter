# NEU-1505 — Imports decline released films (frontend half)

**Ticket:** NEU-1505 "Imports admit long-released films, and admission cards them as attached
for entity followers" (bl: Entity Follows, M5)
**Backend half and decision record:** `backend/docs/specs/NEU-1505-imports-decline-released-films.md`
(D-1505.1 to D-1505.8). One ticket, two PRs; deploy notes there (§5): **this half first, or the
same release**.

## 1. What and why

The other user's Letterboxd import on 2026-09-26 showed a review list dominated by greyed-out,
already-released films, and Tom's call (D-1505.3) is that an import never lists a film it cannot
follow. The backend now declines out-of-window films before fetching them and reports them
under `unmatched` with `kind: "outside_window"`; `import_candidate.skip_reason` is retired and
every candidate is followable (D-1505.4, D-1505.5). This half makes the review list say so.

## 2. Acceptance

- The review list renders `job.candidates` only. No disabled rows: neither for
  `unmatched` entries nor for any candidate. Every row is tickable; the initial tick is
  `c.selected` as before.
- Intro copy (the `font-medium` line keeps its per-source variant; the muted line under it
  changes): "These are the upcoming and recently released films from your watchlist. Nothing is
  followed until you confirm — untick anything you would rather not follow." Wording may be
  tightened; the two facts it must state are *upcoming or recently released* and *nothing
  followed until confirm*.
- A summary line under the intro, only when `job.unmatched.length > 0`, built from
  `unmatched[].kind` counts: "We left out 14 titles released more than a year ago and 2 we could
  not match." Singular/plural handled; either clause alone when the other count is zero;
  for a TMDB-source job the second clause reads "2 that TMDB no longer has". No names.
- "{n} of {rows} selected" counts candidates only (`rows` no longer adds `unmatched.length`).
- The finished report (`SucceededReport`): `UnmatchedList` receives the rows whose kind is not
  `outside_window` and keeps its current copy and behaviour; a separate one-line count for
  `outside_window` rows ("14 titles were released more than a year ago and were not imported.")
  renders beside it when that count is non-zero.
- `ImportCandidate.skip_reason` is removed from `api/types.ts`; `ImportUnmatched.kind` gains
  `"outside_window"`. `pnpm typecheck` passes with no `skip_reason` left in `src/`.
- Tests: `ImportProgress.test.tsx` and any `ImportReview` test drop the `skip_reason` fixture
  and the "Already released more than a year ago" row assertion; new cases cover the summary
  line (both clauses, one clause, none), the candidates-only row count, and the finished
  report's split. MSW fixtures in `test/msw/imports.ts` lose `skip_reason`.

## 3. Design notes

- `ImportReview.tsx`: delete `OUTSIDE_WINDOW`, `UNMATCHED` and `selectable`; the `<label>`
  opacity/disabled branches go; the `job.unmatched.map` block goes; add a small
  `leftOutSummary(job)` helper (pure, exported for its test) that returns the sentence or
  `null`. Keep the `aria-live="off"` wrapper and the Select all / none controls (they now
  operate on every candidate).
- `ImportProgress.tsx`: `SucceededReport` partitions `job.unmatched` by kind once; the
  `UnmatchedList` component is unchanged apart from receiving the filtered rows.
- The component docstring's "the rest are greyed with the reason they cannot be ticked,
  rather than left out, so an import that follows fewer films than the user expected explains
  itself" is replaced: the summary line is now what explains it.
- No new API calls, no router changes, no store changes.

## 4. Out of scope

- Naming the declined titles anywhere on the review list (counts only, D-1505.3).
- Any change to `ImportStep`'s upload copy or the TMDB approve flow.
