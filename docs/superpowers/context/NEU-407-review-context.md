# NEU-407 review context

## Linear ticket

- **ID / title:** NEU-407 — [frontend] "Also known as" line on the film page
- **State:** In Review
- **Assignee:** Tom Boone
- **Description:** Render an "Also known as" line on `/film/{slug}` listing notable alternate titles from the DTO (`FilmDetailResponse.alternative_titles: list[str]`). Omit when none. Pure FE read-render ticket — no backend change.
- **Plan:** `docs/plans/2026-06-25-neu-407-also-known-as-line.md`
- **Milestone spec:** `docs/specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md`

## Linear hierarchy & relations

- **Project:** Movies: MVP Launch Polish
- **Milestone:** Comprehensive film page
- **Parent:** NEU-391 — "Alternate titles improve search and show on the film page" (In Progress). Acceptance: search finds films by alt titles (NEU-406's concern); film page shows an "Also known as" line where alternate titles exist (this ticket).
- **Blocked by:** NEU-406 — [backend] Ingest alternative_titles + wire into search + DTO (ships the `alternative_titles` field; FE renders verbatim).
- **Blocks / related:** none.

## Backend contract (read-only, from NEU-406)

`GET /films/{slug}` → `FilmDetailResponse` additively gains `alternative_titles: string[]` — a **notable** set already **deduped, ordered, capped (~8), and excluding** any title equal (case-insensitive) to `title`/`original_title`, server-side. FE renders verbatim — **no** client sort/slice/dedup/filter. Empty → `[]`, never `null`.

## Key requirements / acceptance criteria

1. `/film/{slug}` renders an "Also known as" line listing the alt titles, comma-joined, in server order (verbatim).
2. **Omit when none:** `alternative_titles: []` → no AKA line (no label, no empty shell, no error); rest of page renders normally.
3. `FilmDetail` additively gains `alternative_titles: string[]`; all three existing `FilmDetail` fixtures widened so `task typecheck` stays green.
4. Line slots into the core-info band (above the timeline), coordinating with NEU-397's `FilmMeta` without depending on it; existing sections unchanged.
5. No backend change, no new env var/dependency. Tests cover: joined render incl. non-Latin string + no stray separator on single title; empty → renders nothing; route mounts + omits when empty. Gates green; touched files Prettier-clean.

## Design notes from the plan (review yardsticks)

- Standalone presentational component `src/components/film/AlsoKnownAs.tsx` taking `{ titles: string[] }`; early `return null` when empty; value built with `titles.join(", ")` (never conditional concatenation — dangling-separator is the one bug to guard).
- Provider-free, deterministic, SSR-safe: no router/hooks/`Date`/locale; identical server/client markup; never triggers `/me` during render.
- Additive to shared type/page: append `alternative_titles` at end of `FilmDetail`; insert one render line in `film.tsx` above `<EventTimeline/>`; don't reorder existing fields or rework siblings.
- Scope: one field + one tiny component + one render line + three fixture updates. Don't touch `meta()`, loader, `ErrorBoundary`, API client, or unrelated sections.
- Label copy ("Also known as") is non-load-bearing — assert on whatever ships.
