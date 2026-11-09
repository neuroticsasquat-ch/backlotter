**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md
**Depends on:** NEU-404

# NEU-405 `[frontend]` — Release-dates section on the film page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **TDD** plan — write the failing test first in every task, watch it fail, then implement.

**Goal:** Render a **release-dates section** on `/film/{slug}` from the `release_dates` slice the backend (NEU-404) now exposes on `FilmDetailResponse`. Each entry is a labeled, date-formatted row — e.g. **"Theatrical (limited) — Jun 25, 2026"** — with an optional certification (e.g. `PG-13`) and, when the slice spans more than one country, a country tag so a US and an origin-country date are distinguishable. Dates are formatted in **UTC** (the repo's date-output house rule). When the slice is empty the section is **omitted entirely** — no empty heading, no broken markup. **No backend change** (NEU-404 ships the DTO); this is a pure FE render ticket.

**Architecture:** A sibling of the merged NEU-310 film page (`src/routes/film.tsx`), which today renders `<FilmHeader>` + `<EventTimeline>`. This ticket adds a third presentational section, `<ReleaseDates dates={film.release_dates} />`, slotted between the header and the timeline (the "core-info" band, where the other M5 sections — NEU-403 cast/crew, NEU-407 alt-titles — also land). The component is a pure, provider-free render of the DTO list: a `<section>` with an `<h2>` heading and a list of `<li>` rows (label · `<time>` UTC date · optional certification · optional country), or `null` when the list is empty. The FE `FilmDetail` type gains a `release_dates: ReleaseDate[]` field mirroring the backend `ReleaseDateOut`. The `getFilm` fetcher is unchanged — it already returns the whole `FilmDetail`, so the new field rides along for free. Date formatting reuses the existing **UTC** `Intl.DateTimeFormat` helper in `src/lib/format.ts`.

**Tech stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — all driven through `task` inside the container.

**Design of record:** `docs/specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md` (§"Story NEU-390 → NEU-405", milestone acceptance #2). Upstream DTO contract: `docs/plans/2026-06-25-neu-404-ingest-release-dates.md` (the `release_dates: list[ReleaseDateOut]` field + the integer→label map). Pattern precedents already on `main`:
- `src/routes/film.tsx` + `src/routes/film.test.tsx` — the film-page composition (`FilmHeader` + `EventTimeline`) and the `createRoutesStub` render-test shape; the `film` fixture this ticket extends.
- `src/components/film/EventTimeline.tsx` — the "render-a-section-or-an-empty-fallback" pattern, and the `<time dateTime={iso}>` idiom.
- `src/components/film/EventCard.tsx` — the small-badge/`<time>` row layout and `cn(...)` conditional classes (for the certification chip).
- `src/lib/format.ts` `formatEventDate(iso)` (+ `format.test.ts`) — the **UTC** (`timeZone: "UTC"`) `Intl.DateTimeFormat` date formatter; reuse it (or a thin same-`DATE_FMT` alias) so a late-UTC instant never rolls the day.
- `src/components/film/labels.ts` — where display-label maps live **if** one is ever needed FE-side (it is **not** here — the backend supplies `type_label`).

**Backend contract (read-only, shipped by NEU-404 — do not modify):**
- `GET /films/{slug}` → `FilmDetailResponse` now carries `release_dates: ReleaseDateOut[]`.
- `ReleaseDateOut` = `{ country: str; release_type: int; type_label: str; date: <ISO datetime, timestamptz e.g. "2026-06-25T00:00:00Z">; certification: str | null }`.
- The slice is a **curated home-region (US) + origin-country** set across all six TMDB types, **already ordered** by `date` ascending (then a stable tiebreak). The FE renders the server's order **verbatim** — no client-side re-sort/filter. Empty → `[]`, never `null`. `type_label` is the human label (e.g. `"Premiere"`, `"Theatrical (limited)"`, `"Theatrical"`, `"Digital"`, `"Physical"`, `"TV"`) — render it directly; **do not** re-derive a label from `release_type` on the FE (single source of truth lives in the backend `public/release.py` map).

---

## Working agreements (read first)

- **All commands run in the container via `task`.** Never run `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the container up (`task up`). Scope tests with `task test -- <path>`.
- **One PR.** NEU-405 ships as a **single frontend PR**; the user commits once at the end (final task). Do **NOT** commit per task. If executing via subagents, strip any commit step from implementer prompts.
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`). Component tests use Testing Library; `ReleaseDates` has **no** router/query/auth dependency, so render it bare (no `MemoryRouter`/providers). Route render tests reuse the `createRoutesStub` shape from `film.test.tsx`.
- **ESLint at zero warnings** — unused imports/vars fail the build. Import only what you use.
- **Typecheck = `react-router typegen` + `tsc -b`** via `task typecheck`. Type-only imports are erased by Vite, so Vitest can be green before typegen — but `task typecheck` must pass before claiming done.
- **Format only what you touch** (`task format`). `AuthContext.*` has pre-existing Prettier drift on `main` — don't reformat unrelated files.
- **UTC, determinism, hydration safety.** Format the `date` field with the existing **UTC** formatter (`timeZone: "UTC"`) so server and client render identical strings — never `new Date(iso).toLocaleDateString()` (locale/timezone-dependent → hydration mismatch), never `Date.now()`/relative dates. Render the server's list order as-is. The section is provider-free — it must never trigger `/me` during SSR (preserve the NEU-310/312 public-loader invariant).
- **Resilient to sibling M5 tickets.** NEU-403 (cast/crew) and NEU-407 (alt-titles) also add a field to the **same** `FilmDetail` type and a section to the **same** `film.tsx`, each additively. **Add, never overwrite:** append the `release_dates` field without reordering existing `FilmDetail` fields, and insert the `<ReleaseDates>` element without disturbing `<FilmHeader>`/`<EventTimeline>` or a sibling's section. If a sibling has merged first, rebase and overlay cleanly; if not, design so a later merge is additive. This ticket's logical slice is **only** the `release_dates` type field, the `ReleaseDates` component, and its one render line in `film.tsx`.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/api/types.ts` | modify | Add a `ReleaseDate` interface (mirrors backend `ReleaseDateOut`) + a `release_dates: ReleaseDate[]` field on `FilmDetail`. |
| `src/components/film/ReleaseDates.tsx` | create | Presentational section: heading + labeled UTC-dated rows (label · date · optional cert · optional country); returns `null` when `dates` is empty. |
| `src/components/film/ReleaseDates.test.tsx` | create | Rows render with `type_label` + UTC date + certification; multi-country slice shows a country tag; empty `[]` → nothing renders. |
| `src/lib/format.ts` | modify *(optional)* | If a clearer name is wanted, add `formatReleaseDate(iso)` delegating to the same UTC `DATE_FMT`; otherwise reuse `formatEventDate`. |
| `src/lib/format.test.ts` | modify *(only if a new formatter is added)* | UTC-correctness test for the new formatter (a late-UTC instant keeps its day). |
| `src/routes/film.tsx` | modify | Render `<ReleaseDates dates={film.release_dates} />` between `<FilmHeader>` and `<EventTimeline>`. |
| `src/routes/film.test.tsx` | modify | Extend the `film` fixture with `release_dates`; assert the section renders rows on the page and is absent when `release_dates: []`. |
| `src/components/film/FilmHeader.test.tsx` | modify | Add `release_dates: []` to its local `film` fixture so it still satisfies the widened `FilmDetail` type. |

No backend change, no new env var, no new dependency.

---

## Task 1: Extend the `FilmDetail` type + fixtures

**Files:** modify `src/api/types.ts`; modify the fixtures in `src/routes/film.test.tsx` and `src/components/film/FilmHeader.test.tsx`.

- [ ] **Step 1 — add the `ReleaseDate` type + field.** In `src/api/types.ts`, add an interface mirroring the backend `ReleaseDateOut` and append the field to `FilmDetail` (append at the end — don't reorder existing fields; a sibling M5 ticket may also be appending):

```ts
export interface ReleaseDate {
  country: string; // ISO 3166-1 (e.g. "US")
  release_type: number; // TMDB type 1..6; FE renders type_label, not this
  type_label: string; // human label from the backend (e.g. "Theatrical (limited)")
  date: string; // ISO datetime (timestamptz, e.g. "2026-06-25T00:00:00Z")
  certification: string | null; // e.g. "PG-13"; may be "" → treat as absent
}
```
Then add `release_dates: ReleaseDate[];` to `FilmDetail`. Type it **required** (the backend always returns `[]`, never null/undefined per its determinism contract) — keeping it required forces every fixture to be honest and lets the component assume an array.

- [ ] **Step 2 — fix the now-incomplete fixtures (red→green via the type-checker).** Because `release_dates` is required, the existing `FilmDetail` fixtures no longer satisfy the type. Add `release_dates: []` to the `film` fixture in `src/routes/film.test.tsx` and to the `film` fixture in `src/components/film/FilmHeader.test.tsx`. Run `task typecheck` → 0 errors; run `task test` → still green (no behavior change yet).

**Resilience notes:** `release_type` stays a plain `number` (forward-compatible if TMDB adds a type). The FE never maps `release_type`→label — it renders the backend's `type_label`, so the label vocabulary lives in exactly one place. The fetcher (`getFilm`) is untouched: it returns `FilmDetail`, so `release_dates` flows through automatically.

---

## Task 2: `ReleaseDates` component (TDD)

**Files:** create `src/components/film/ReleaseDates.tsx` + `src/components/film/ReleaseDates.test.tsx`; optionally modify `src/lib/format.ts` (+ `format.test.ts`).

- [ ] **Step 1 — failing render test.** Create `src/components/film/ReleaseDates.test.tsx`. The component is provider-free — render it bare. Build a small `ReleaseDate[]` fixture (two US rows of different types + an origin-country row, dates as full-ISO `…T00:00:00Z`) and assert:
  - each row shows its `type_label` (e.g. `"Theatrical (limited)"`, `"Digital"`);
  - each row shows the **UTC**-formatted date (e.g. `"Jun 25, 2026"`) via a `<time dateTime={iso}>` element — and include a **late-UTC instant** (e.g. `…T23:30:00Z`) asserting the day does **not** roll (the house UTC rule);
  - a row with a non-empty `certification` shows it (e.g. `"PG-13"`); a row with `null`/`""` certification shows no cert chip / no stray separator;
  - when the slice spans **more than one** distinct `country`, a country tag (e.g. `"US"`, `"GB"`) is shown so the two dates are distinguishable; when all rows share one country, the tag may be omitted (assert it's not required in the single-country case);
  - a section heading (e.g. `/release dates/i`) is present;
  - **empty case:** rendering with `dates={[]}` produces **no** heading and no rows (`container.firstChild` is `null`, or `queryByRole("heading", { name: /release dates/i })` is null).

  Run `task test -- src/components/film/ReleaseDates.test.tsx` → **FAIL** (module missing).

- [ ] **Step 2 — implement `ReleaseDates`.** Create `src/components/film/ReleaseDates.tsx`. Contract (markup/Tailwind classes are non-load-bearing — keep them in the EventCard/EventTimeline idiom):
  - Signature `export function ReleaseDates({ dates }: { dates: ReleaseDate[] })`.
  - `if (dates.length === 0) return null;` — omit the whole section when empty (mirrors `EventTimeline`'s empty branch, but here we render nothing rather than a message: a film with no dated releases simply has no section).
  - Otherwise a `<section>` with an `<h2>` (e.g. `"Release dates"`, same muted heading style as the timeline's day headings) and a list (`<ul>`/`<ol>`) of one `<li>` per entry **in the server's order** (no re-sort). Each row renders: the `type_label`; a `<time dateTime={d.date}>` with the UTC-formatted date; a certification chip when `d.certification?.trim()` is truthy; and a country tag when `showCountry` (computed as `new Set(dates.map((d) => d.country)).size > 1`).
  - Key each row by a stable composite (e.g. `${d.country}-${d.release_type}-${d.date}`) — the DTO has no surrogate id on the wire and `(country, type)` isn't unique.
  - Format the date with the **UTC** helper: import `formatEventDate` from `@/lib/format` (or, for a clearer name, add `export const formatReleaseDate = (iso: string) => DATE_FMT.format(new Date(iso));` to `lib/format.ts` reusing the existing UTC `DATE_FMT`, with a matching `format.test.ts` UTC case). **Do not** introduce a non-UTC formatter.

  Run `task test -- src/components/film/ReleaseDates.test.tsx` → **PASS**.

**Resilience notes:** the component trusts the backend's ordering and label — it neither sorts nor maps types. Treat `certification === ""` the same as `null` (TMDB sends empty strings). The country tag is conditional on >1 distinct country so the common single-region case stays uncluttered while a foreign film's US-vs-origin dates remain unambiguous. No `<img>`, no link, no provider — the section is inert and SSR-safe.

---

## Task 3: Slot the section into the film page (TDD)

**Files:** modify `src/routes/film.tsx` + `src/routes/film.test.tsx`.

- [ ] **Step 1 — failing route render test.** In `src/routes/film.test.tsx`, extend the existing `film` fixture (already given `release_dates: []` in Task 1) — either give it a couple of `release_dates` rows or use a per-test override — and add render assertions under the existing `describe("film route render")` (the `createRoutesStub` shape is already there):
  - with a film that has release dates, the page shows a release-dates row (e.g. `screen.getByText("Theatrical (limited)")` and the UTC date `"Jun 25, 2026"`), rendered **between** the header and the event timeline;
  - with `release_dates: []`, the release-dates **heading is absent** (`queryByRole("heading", { name: /release dates/i })` is null) while the rest of the page (arc, timeline) still renders — i.e. graceful omission doesn't disturb the existing sections.
  - Keep the existing render assertions (arc, newest-first timeline, source links, empty-events state, 404 boundary) intact — they must still pass unchanged.

  Run `task test -- src/routes/film.test.tsx` → **FAIL** (section not rendered yet).

- [ ] **Step 2 — render the section.** In `src/routes/film.tsx`, import `ReleaseDates` and render it between `<FilmHeader>` and `<EventTimeline>`:

```tsx
<FilmHeader film={film} />
<ReleaseDates dates={film.release_dates} />
<EventTimeline events={film.events} />
```

  Run `task test -- src/routes/film.test.tsx` → **PASS**.

**Resilience notes:** the insertion is purely additive — it doesn't touch `loader`/`meta`/`ErrorBoundary` or the header/timeline. When `release_dates` is `[]`, `<ReleaseDates>` returns `null`, so the page collapses to today's layout with zero visual change. Sibling M5 sections (cast/crew, alt-titles) insert their own elements in the same band without conflict (additive merge).

---

## Task 4: Full verification + handoff

**Files:** none (verification only).

- [ ] **Step 1 — format touched files:** `task format`. Do not stage unrelated `AuthContext.*` drift.
- [ ] **Step 2 — lint:** `task lint` → `eslint src --max-warnings 0` passes (no unused imports).
- [ ] **Step 3 — typecheck:** `task typecheck` → `react-router typegen` + `tsc -b` report 0 errors (widened `FilmDetail`; all fixtures satisfy it).
- [ ] **Step 4 — full suite:** `task test` → the entire Vitest suite is green (new `ReleaseDates` tests + the extended `film`/`FilmHeader`/`format` suites + all untouched suites).
- [ ] **Step 5 — hand off for commit (user).** Do **NOT** commit from task execution. Report the green gates. The user commits the whole NEU-405 change as **one PR** off the ticket branch, using `/commit-msg` (Conventional Commits subject, no Linear ID, no `Co-Authored-By`) and `/pr-desc` (PR title carries `(NEU-405)`; body keeps the `🤖 Generated with Claude Code` footer). Pre-commit hooks delegate into the container — commit normally with the container up.

---

## Acceptance criteria (NEU-405)

1. `/film/{slug}` renders a **release-dates section** sourced from `film.release_dates`: one labeled row per entry showing the backend `type_label`, the date, and (when present) the certification — e.g. **"Theatrical (limited) — Jun 25, 2026 · PG-13"**. The parent story (NEU-390) acceptance — *film page shows release date(s) with type, at least primary/US* — is met.
2. Dates are formatted in **UTC** (a late-UTC instant does not roll the day), reusing the repo's UTC `Intl.DateTimeFormat` helper; rendered inside a semantic `<time dateTime={iso}>`.
3. Rows render in the **server's order** (no FE re-sort/filter); when the slice spans more than one country, a country tag disambiguates the US vs origin-country dates.
4. **Graceful empty:** when `release_dates` is `[]` the section is omitted entirely (no heading, no empty box) and the rest of the page is unchanged.
5. The FE `FilmDetail` type gains `release_dates: ReleaseDate[]` mirroring the backend `ReleaseDateOut`; no backend change; `getFilm` untouched.
6. `task test` / `task lint` (zero warnings) / `task typecheck` green; touched files prettier-clean. Tests (Vitest + RTL) cover: rows render label + UTC date + certification, multi-country tag, and the empty-state omission.

## Which part of M5 this realizes

This is the **`[frontend]` half of Story NEU-390** ("Film page shows release dates") and realizes the **render** portion of **M5 milestone acceptance #2** — *"`/film/{slug}` renders a release-dates section"* — consuming the labeled home-region/origin slice that **NEU-404** (the blocking backend ticket) exposes on the DTO. It is one of M5's three additive film-page sections (alongside NEU-403 cast/crew and NEU-407 alt-titles); each is an independent, additive FE PR over the same `FilmDetail` type and `film.tsx`. No backend work, no new route, no new dependency — and zero blast radius on the existing header/arc/timeline.

---

## Self-review

**Spec coverage** (`…-m05-comprehensive-film-page.md` §"NEU-405" + milestone acceptance #2; NEU-404 DTO contract):
- `src/api/types.ts` gains `release_dates: { country; release_type; type_label; date; certification }[]` mirroring `ReleaseDateOut` → Task 1; asserted by `task typecheck` + fixture updates.
- New `src/components/film/ReleaseDates.tsx` rendering labeled, date-ordered rows (label · date · cert), grouped/ordered by date → Task 2 (renders the server's pre-ordered slice; optional country tag when multi-country) + Task 3 (slotted into `film.tsx`).
- Omit the section entirely when empty → Task 2 (`dates.length === 0 → null`) + Task 3 (empty-`[]` render test); Acceptance #4.
- UTC date formatting (house rule) → Task 2 reuses the UTC `formatEventDate`/`DATE_FMT`; Acceptance #2; a late-UTC test guards it.
- Where it slots into the film page → Task 3 (between `FilmHeader` and `EventTimeline`).
- Tests: rows render labels + certs; empty state omitted → Task 2 + Task 3; Acceptance #6.

**Type/name consistency:** `ReleaseDate` (Task 1) fields match the NEU-404 `ReleaseDateOut` keys (`country`, `release_type`, `type_label`, `date`, `certification`). `ReleaseDates({ dates }: { dates: ReleaseDate[] })` (Task 2) is called as `<ReleaseDates dates={film.release_dates} />` (Task 3). The date formatter is the existing UTC `formatEventDate` (or a same-`DATE_FMT` `formatReleaseDate`) from `@/lib/format` — never a locale/timezone-dependent formatter. `type_label` is rendered verbatim (no FE label map). `getFilm`/`FilmHeader`/`EventTimeline`/`loader`/`meta`/`ErrorBoundary` are untouched; the only shipped files modified beyond the new component are `types.ts`, `film.tsx`, and three test fixtures.

**Placeholder scan:** no "TBD"/"similar to Task N"/"add later" — each task has explicit red→green steps, the exact `task` command, and the expected FAIL/PASS. Code is given as the load-bearing type + component contract and behavioral assertions; exact Tailwind markup is intentionally left open (resilient), per the resilient-plan brief.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
