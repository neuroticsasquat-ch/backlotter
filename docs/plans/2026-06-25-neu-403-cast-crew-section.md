**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md
**Depends on:** NEU-402

# Cast & Crew Section on the Film Page (NEU-403) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **TDD** plan — write the failing test first in every task, watch it fail, then implement. The plan is deliberately light on exact signatures: follow the **existing patterns** in the cited files (`FilmHeader.tsx`, `EventTimeline.tsx`, `poster.ts`) rather than copying snippets verbatim.

**Goal:** Render a **Cast & crew** section on `/film/{slug}` from the now-widened film-detail DTO — a **director line** plus a **top-billed cast** list (name, character, optional profile image), every field null-guarded, the whole section **omitted cleanly when credits are absent**. Built entirely on the DTO that **NEU-402** adds to `FilmDetailResponse` (`cast` + `directors`) — **no backend change**, no new endpoint, no new dependency.

**Architecture:** A sibling of the already-shipped `FilmHeader` / `EventTimeline` film-page sections. Three additive pieces, all in the frontend repo:

- **Type** (`src/api/types.ts`): extend the existing `FilmDetail` interface with `cast: CastMember[]` and `directors: string[]`, mirroring the NEU-402 DTO (`CastMemberOut{ name, character, profile_path }`). Additive — does not touch the existing fields or the sibling M5 extensions (NEU-405's `release_dates`, NEU-407's `alternative_titles`).
- **Image helper** (`src/lib/poster.ts`): add a `profileUrl(path, size)` sibling to the existing `posterUrl` — the same null-safe `env.tmdbImageBase` builder, defaulting to a profile size (`w185`). A 3-line analog; reuse, don't fork the URL logic.
- **Section component** (`src/components/film/FilmCredits.tsx`): a director line + a horizontal cast list of cards (profile `<img>` when `profile_path` present, else an **initials/placeholder tile** — never a broken image; name; character). Returns `null` when there are no directors **and** no cast, so the film page omits the section entirely. Rendered from `routes/film.tsx` below the core-info section, above the event timeline.

**Tech stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — all driven through `task` inside the container.

**Backend contract (read-only — shipped by NEU-402, do not modify):**
- `GET /films/{slug}` → `FilmDetailResponse` additively gains:
  - `cast`: `{ name: string; character: string | null; profile_path: string | null }[]` — already top-billed and capped (≈12) and ordered server-side (`credit_order asc nulls last`, then name). The FE renders the server's order verbatim — **no** client-side sort or slice.
  - `directors`: `string[]` — director name(s); TMDB can list co-directors. Already ordered server-side.
  - Both are empty-defaulted (`[]`, never `null`) for films with no credits.

**Pattern precedents already on `main` (mirror these):**
- `src/components/film/FilmHeader.tsx` — the `poster = posterUrl(...); poster && <img alt={…} />` render-or-omit pattern, and the `{ film }` prop shape.
- `src/components/film/EventTimeline.tsx` — a section component that branches on emptiness (here we **omit** rather than show an empty-state message).
- `src/lib/poster.ts` + `src/lib/poster.test.ts` — the null-safe TMDB URL builder + its tiny unit test, to clone for `profileUrl`.
- `src/routes/film.tsx` + `src/routes/film.test.tsx` — where sections slot into the page body, and the `createRoutesStub` render-test shape + the `FilmDetail` fixture to extend.

---

## Working agreements (read first)

- **All commands run in the container via `task`.** Never run `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the container up (`task up`). Scope tests with `task test -- <path>`.
- **One PR.** NEU-403 ships as a **single frontend PR**; the user commits once at the end (final task). Do **NOT** commit per task. If executing via subagents, strip any commit step from implementer prompts.
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`), Testing Library. Components that use `<Link>`/router context render inside `MemoryRouter`; `FilmCredits` itself uses no router (no links) so a bare `render(...)` is fine. The route render test uses `createRoutesStub` exactly like `film.test.tsx`.
- **ESLint at zero warnings** — unused imports/vars fail the build. Import only what you use.
- **Typecheck = `react-router typegen` + `tsc -b`.** Type-only imports are erased by Vite, so Vitest can run green before typegen — but `task typecheck` must pass before claiming done.
- **Format only what you touch** (`task format`). `AuthContext.*` has pre-existing Prettier drift on `main` — don't reformat unrelated files.
- **Determinism / hydration safety.** No `Date.now()`, no relative dates, no locale-dependent output in the render tree. Render the server's `cast`/`directors` order **verbatim** — no client re-sort. Initials are derived purely from the name string.
- **Stay additive on the shared type/page.** `FilmDetail` and `routes/film.tsx` are also widened by the sibling M5 FE tickets (NEU-405 release dates, NEU-407 "also known as"). **Add** `cast` + `directors` and the one `<FilmCredits/>` render site; do **not** rename/reorder existing fields or rework `FilmHeader`/`EventTimeline`. If a sibling has merged, rebase and overlay cleanly.
- **Blocked by NEU-402.** This ticket consumes NEU-402's merged DTO (`cast` + `directors` on `FilmDetailResponse`). Implement against that contract; the FE only needs the JSON shape, mocked in tests — it never hits the live backend.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/api/types.ts` | modify | Add a `CastMember` interface and extend `FilmDetail` with `cast: CastMember[]` + `directors: string[]` (mirrors the NEU-402 DTO). |
| `src/lib/poster.ts` | modify | Add `profileUrl(path, size?)` — null-safe `env.tmdbImageBase` builder, profile-size default (`w185`). |
| `src/lib/poster.test.ts` | modify | `profileUrl` tests: builds a URL from path + size; returns `null` for a null path (mirror the `posterUrl` cases). |
| `src/components/film/FilmCredits.tsx` | create | Cast & crew section: director line + cast cards (image-or-initials, name, character); returns `null` when both lists are empty. |
| `src/components/film/FilmCredits.test.tsx` | create | Render: directors present/absent, cast with image, cast without image → initials placeholder, character shown/omitted, empty → renders nothing. |
| `src/routes/film.tsx` | modify | Render `<FilmCredits cast={film.cast} directors={film.directors} />` below the core-info section, above `<EventTimeline/>`. |
| `src/routes/film.test.tsx` | modify | Extend the `FilmDetail` fixture with `cast`/`directors`; assert the section renders on the page; add an empty-credits render assertion. |

No backend changes, no new env vars, no new dependencies.

---

## Task 1: Extend the `FilmDetail` type + `profileUrl` helper

**Files:** modify `src/api/types.ts`, `src/lib/poster.ts`, `src/lib/poster.test.ts`.

- [ ] **Step 1 — extend the type (additive).** In `src/api/types.ts`, add a `CastMember` interface mirroring NEU-402's `CastMemberOut` and add two fields to the existing `FilmDetail` interface — keep all existing fields and ordering intact:

  ```ts
  export interface CastMember {
    name: string;
    character: string | null;
    profile_path: string | null; // raw TMDB path; FE builds the URL via profileUrl()
  }
  ```
  …and on `FilmDetail`: `cast: CastMember[];` and `directors: string[];`.

- [ ] **Step 2 — failing `profileUrl` test.** In `src/lib/poster.test.ts`, add a `describe("profileUrl")` mirroring the `posterUrl` cases: builds `https://image.tmdb.org/t/p/w185/abc.jpg` from `("/abc.jpg", "w185")`; returns `null` when the path is `null`. Run `task test -- src/lib/poster.test.ts` → **FAIL** (`profileUrl` not exported).

- [ ] **Step 3 — implement `profileUrl`.** In `src/lib/poster.ts`, add the sibling builder (same `env.tmdbImageBase` base, profile size default; keep it a 3-line analog of `posterUrl`):

  ```ts
  export function profileUrl(path: string | null, size = "w185"): string | null {
    if (!path) return null;
    return `${env.tmdbImageBase}/${size}${path}`;
  }
  ```

  Run `task test -- src/lib/poster.test.ts` → **PASS**.

**Resilience notes:** keep `profileUrl` defaulting its `size` so call sites can omit it; reuse the existing `env.tmdbImageBase` so dev/prod image hosts stay consistent. The new `FilmDetail` fields are additive — existing `FilmDetail` literals (the `film.test.tsx` fixture) must be widened in Task 3, but the type change alone won't break the build until typecheck (TS surfaces the missing fields then).

---

## Task 2: `FilmCredits` section component

**Files:** create `src/components/film/FilmCredits.tsx` + `src/components/film/FilmCredits.test.tsx`.

- [ ] **Step 1 — failing render test.** Create `src/components/film/FilmCredits.test.tsx`. The component takes the two credit slices as props (e.g. `{ cast, directors }`); it renders no `<Link>`, so a bare `render(<FilmCredits .../>)` (no router) is fine. Assert:
  - **directors present:** a director line shows the name(s) (e.g. "Directed by …" / a "Director(s)" label) — with two directors both names appear;
  - **cast with image:** for a cast member with a non-null `profile_path`, an `<img>` is present with the `profileUrl(profile_path)` `src` and a meaningful `alt` (e.g. the person's name), the name, and the `character`;
  - **image fallback:** for a cast member with `profile_path: null`, **no broken `<img>`** renders — instead a neutral **initials/placeholder** tile is present (assert via a `data-testid` like `cast-avatar-placeholder`, or `queryByRole("img")` filtered to that card being null);
  - **null character:** a cast member with `character: null` renders the name with no stray empty character node;
  - **empty → omitted:** `cast: []` **and** `directors: []` → the component renders **nothing** (e.g. `const { container } = render(...); expect(container).toBeEmptyDOMElement();`), realizing the "graceful when empty" contract.

  Run `task test -- src/components/film/FilmCredits.test.tsx` → **FAIL** (module missing).

- [ ] **Step 2 — implement `FilmCredits`.** Create `src/components/film/FilmCredits.tsx`. Reuse `profileUrl` from `@/lib/poster` and the `CastMember` type from `@/api/types`. Shape (representative — Tailwind utility classes are non-load-bearing; match the `FilmHeader`/`EventTimeline` look):
  - **Early return:** `if (directors.length === 0 && cast.length === 0) return null;` — the whole section is omitted when there are no credits.
  - **Section heading:** a `<section>` with an `<h2>` "Cast & crew" (consistent with `EventTimeline`'s `<h2>` headings).
  - **Director line:** when `directors.length > 0`, a single line — e.g. `Directed by {directors.join(", ")}` (label scales to co-directors naturally). Omit the line when empty.
  - **Cast list:** map `cast` to cards in document/server order (no re-sort). Each card: `const img = profileUrl(member.profile_path);` then `img ? <img src={img} alt={member.name} … /> : <div data-testid="cast-avatar-placeholder">{initials(member.name)}</div>` (a fixed-size avatar box so image and placeholder share one footprint), then `member.name`, then `member.character && <p>{member.character}</p>`.
  - **Initials helper:** a tiny pure local helper (e.g. first letters of the first two name words, uppercased) — keep it deterministic (no locale formatting). It need not be exported.

  Run `task test -- src/components/film/FilmCredits.test.tsx` → **PASS**.

**Resilience notes:** mirror `FilmHeader.tsx`'s `poster && <img/>` null-guard — never emit an `<img>` with an empty/`null` `src`; the placeholder is a styled `<div>`, not an image. Guard **every** field (`character` may be null; a name is always present per the DTO). The component is presentational and provider-free (no Auth/React Query, no router) — preserving the public film page's SSR invariant (no `/me` during render).

---

## Task 3: Slot into the film page + extend the route test

**Files:** modify `src/routes/film.tsx`, `src/routes/film.test.tsx`.

- [ ] **Step 1 — widen the route-test fixture + failing assertions.** In `src/routes/film.test.tsx`, extend the shared `film: FilmDetail` fixture additively with `cast` and `directors` (e.g. one cast member with a `profile_path`, one with `profile_path: null` + a `character`, and one or two `directors`). Add render assertions (via the existing `createRoutesStub` pattern):
  - the page shows a director name and a cast member's name + character;
  - a separate stub with `cast: []` + `directors: []` (`{ ...film, cast: [], directors: [] }`) renders the page **without** the Cast & crew section (assert the heading / a known cast name is **absent**), and without error.

  Run `task test -- src/routes/film.test.tsx` → **FAIL** (section not rendered yet / fixture missing fields).

- [ ] **Step 2 — render the section.** In `src/routes/film.tsx`, import `FilmCredits` and render it in the page body **below the core-info section and above the event timeline**:

  ```tsx
  <FilmHeader film={film} />
  <FilmCredits cast={film.cast} directors={film.directors} />
  <EventTimeline events={film.events} />
  ```

  (If the NEU-397/M2 core-info section has landed between `FilmHeader` and the timeline, place `FilmCredits` directly **below** that core-info block, still above `EventTimeline`. The exact neighbor is non-load-bearing; the contract is "below core-info, above the timeline.")

  Run `task test -- src/routes/film.test.tsx` → **PASS**. The empty-credits case passes because `FilmCredits` returns `null`.

**Resilience notes:** the parent passes the slices straight through; the component owns the omit-when-empty decision, so the page needs no extra guard. Keep the one new import + one new JSX line scoped — don't touch the loader, `meta`, or `ErrorBoundary`.

---

## Task 4: Full verification + handoff

**Files:** none (verification only).

- [ ] **Step 1 — format touched files:** `task format`. Don't stage unrelated `AuthContext.*` drift.
- [ ] **Step 2 — lint:** `task lint` → `eslint src --max-warnings 0` passes (no unused imports; e.g. `CastMember`/`FilmCredits`/`profileUrl` are all used).
- [ ] **Step 3 — typecheck:** `task typecheck` → `react-router typegen` + `tsc -b` report 0 errors (the widened `FilmDetail` is satisfied by every `FilmDetail` literal — the route-test fixture now carries `cast`/`directors`).
- [ ] **Step 4 — full suite:** `task test` → the entire Vitest suite is green (new `profileUrl`/`FilmCredits` tests + the extended `film.test.tsx`, plus all untouched suites — `FilmHeader`/`EventTimeline`/`ArcStepper`/etc. unchanged).
- [ ] **Step 5 — hand off for commit (user).** Do **NOT** commit from task execution. Report the green gates. The user commits the whole NEU-403 change as **one PR** off the ticket branch, using `/commit-msg` (Conventional Commits subject, no Linear ID in the subject, no `Co-Authored-By`) and `/pr-desc` (PR **title** carries `(NEU-403)`; body keeps the `🤖 Generated with Claude Code` footer). Pre-commit hooks delegate into the container — commit normally with the container up.

---

## Acceptance criteria (NEU-403 / parent story NEU-389)

- `/film/{slug}` renders a **Cast & crew** section from the DTO: a **director line** (director name(s), incl. co-directors) and a **top-billed cast** list (name, character, profile image), in the server's order — no client re-sort or slice.
- **Image fallback:** a cast member without a `profile_path` shows a neutral **initials/placeholder** avatar — never a broken `<img>` (mirrors `FilmHeader`'s null-guard).
- **Graceful when empty:** a film with no cast **and** no directors omits the **entire** section (component returns `null`) — no empty heading, no error; the rest of the page (header, timeline) renders normally.
- `FilmDetail` additively gains `cast: CastMember[]` + `directors: string[]` mirroring NEU-402's DTO; a `profileUrl(path, size?)` helper builds profile-image URLs (null-safe, reusing `env.tmdbImageBase`).
- **No backend change.** Tests (Vitest + Testing Library) cover `profileUrl` (URL + null), the `FilmCredits` component (cast with/without image, director(s) present/absent, null character, empty → renders nothing), and the route (section renders; empty credits omit it). `task test` / `task lint` (zero warnings) / `task typecheck` green; touched files prettier-clean.

## Which part of M5 this realizes

The **frontend half of Story NEU-389** ("Film page shows cast & crew") and milestone **acceptance #1**'s final clause — *"`/film/{slug}` renders a cast & crew section that omits cleanly when empty."* It consumes the `cast` + `directors` fields that **NEU-402** (the lead M5 backend ticket) adds to `FilmDetailResponse`; this PR is **blocked by NEU-402** and renders against its merged DTO. It is independent of the sibling M5 FE sections (NEU-405 release dates, NEU-407 "also known as"), which add adjacent sections to the same page in additive, non-conflicting ways — they may land in any order.

---

## Testing intent (TDD summary)

- **`profileUrl`:** builds a TMDB profile URL from path + size; returns `null` for a null path (unit, no network).
- **`FilmCredits`:** director(s) line present/absent; cast card with image (`profileUrl` `src` + name + character); cast card without image → **initials placeholder**, no broken `<img>`; null character omitted; **both lists empty → renders nothing** (graceful omit).
- **Route (`film.test.tsx`):** the section renders on `/film/{slug}` with a populated fixture; an empty-credits fixture renders the page **without** the section and without error; existing detail/meta/timeline assertions stay green.

## Self-review

**Spec coverage** (against NEU-403 + the M5 spec's NEU-403 bullet + acceptance #1):
- Extend `FilmDetail` with `cast: { name, character, profile_path }[]` + `directors: string[]` (mirror NEU-402 DTO) → Task 1; asserted by typecheck + the widened `film.test.tsx` fixture.
- `src/lib/poster.ts` sibling `profileUrl(path, size)` (`w185`, same `env.tmdbImageBase`, 3-line analog) → Task 1; asserted by `poster.test.ts`.
- New `src/components/film/FilmCredits.tsx`, rendered from `film.tsx` below the core-info section: director line + horizontal cast list (profile image when present, else initials/placeholder; name; character), every field null-guarded → Tasks 2 + 3; asserted by the component + route tests.
- Graceful when empty — omit the whole section when no credits → Task 2 (`return null`); asserted by the empty render test (component) and the empty-credits route render.
- Component test cases (cast with/without images, director(s) present/absent, empty omits) + `film.test.tsx` fixture extended → Tasks 2 + 3.
- No backend change; additive to the shared type/page (coexists with NEU-405/NEU-407); gates green → Working agreements + Task 4.

**Type/name consistency:** `CastMember` fields (`name`, `character`, `profile_path`) match NEU-402's `CastMemberOut` and are read by `FilmCredits` (`member.name`/`member.character`/`member.profile_path`). `FilmCredits` props (`cast: CastMember[]`, `directors: string[]`) are exactly the two `FilmDetail` fields the route passes (`film.cast`, `film.directors`). `profileUrl(path, size?)` is exported once from `@/lib/poster` and imported by `FilmCredits`; `posterUrl` is untouched. The widened `FilmDetail` is satisfied by every literal — the only `FilmDetail` literal in the suite (the `film.test.tsx` fixture) gains `cast`/`directors` in Task 3.

**Placeholder scan:** no "TBD"/"similar to Task N"/"add later" — each task has explicit red→green steps, the exact `task` command, and the expected FAIL/PASS outcome. Code is given as the load-bearing snippets (the type fields, `profileUrl`, the empty-guard + render-or-omit contract) and behavioral contracts elsewhere, intentionally resilient to minor naming/markup choices.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
