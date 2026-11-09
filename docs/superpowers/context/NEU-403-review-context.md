# NEU-403 review context

## Linear ticket

- **ID / title:** NEU-403 — [frontend] Cast & crew section on the film page
- **State:** In Review
- **Branch:** tom/neu-403-frontend-cast-crew-section-on-the-film-page
- **PR:** #23 — feat(film): add cast & crew section to film detail page (NEU-403)
- **Description:** Render a cast & crew section on `/film/{slug}` from the DTO — top-billed cast (name, character, optional profile image) + director(s). Graceful when empty. FE repo.

## Linear hierarchy & relations

- **Project:** Movies: MVP Launch Polish
- **Milestone:** Comprehensive film page (M5)
- **Parent:** NEU-389 — Film page shows cast & crew (story)
- **Blocked by:** NEU-402 — [backend] Ingest TMDB credits (people/credits schema + DTO) — provides the `cast` + `directors` fields on `FilmDetailResponse`
- **Blocks / related:** none
- **Sibling M5 FE tickets (additive, same type/page):** NEU-405 release dates, NEU-407 "also known as"

## Spec & plan

- **Plan:** `docs/plans/2026-06-25-neu-403-cast-crew-section.md`
- **Milestone spec:** `docs/specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md`

### Acceptance criteria (from plan / spec)

- `/film/{slug}` renders a **Cast & crew** section from the DTO: a **director line** (director name(s), incl. co-directors) and a **top-billed cast** list (name, character, profile image), in the **server's order** — no client re-sort or slice.
- **Image fallback:** a cast member without a `profile_path` shows a neutral **initials/placeholder** avatar — never a broken `<img>` (mirrors `FilmHeader`'s null-guard).
- **Graceful when empty:** a film with no cast **and** no directors omits the **entire** section (component returns `null`) — no empty heading, no error; rest of page renders normally.
- `FilmDetail` additively gains `cast: CastMember[]` + `directors: string[]` mirroring NEU-402's DTO (`CastMember{ name, character, profile_path }`); a `profileUrl(path, size?)` helper builds profile-image URLs (null-safe, reusing `env.tmdbImageBase`, default size `w185`).
- **No backend change.** Additive to the shared type/page (coexists with NEU-405/NEU-407); do not rename/reorder existing fields or rework `FilmHeader`/`EventTimeline`.
- **Determinism / SSR safety:** no `Date.now()`, no locale-dependent output; render server `cast`/`directors` order verbatim. Component is presentational, provider-free (no Auth/Query/router — preserves the public film page's SSR invariant).
- Tests cover `profileUrl` (URL + null), `FilmCredits` (cast with/without image, director(s) present/absent, null character, empty → renders nothing), and the route (section renders; empty credits omit it).
- Gates: `task test` / `task lint` (zero warnings) / `task typecheck` green; touched files prettier-clean.

### Files (per plan)

| File | Action |
|---|---|
| `src/api/types.ts` | add `CastMember`, extend `FilmDetail` with `cast` + `directors` |
| `src/lib/poster.ts` (+ test) | add `profileUrl(path, size?)` |
| `src/components/film/FilmCredits.tsx` (+ test) | new section component |
| `src/routes/film.tsx` (+ test) | render `<FilmCredits>` below core-info, above `EventTimeline` |
