**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m02-polish-existing-pages.md
**Depends on:** NEU-396

# NEU-397 `[frontend]` — Render the core film-info section on `/film/{slug}` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. **This project uses TDD: write the failing test first, watch it fail, then implement.** Steps use checkbox (`- [ ]`) syntax for tracking. One ticket = one PR = one `/implementit` run; **do not commit per task** — the user commits the whole NEU-397 change once at the end.

**Goal:** The film page is information-thin. NEU-396 has widened the `/films/{slug}` DTO with the already-captured TMDB basics (overview, tagline, runtime, genres, rating, original language, backdrop, production companies, collection). This ticket mirrors those fields onto the FE `FilmDetail` type and renders a clean, additive **core-info section** on `/film/{slug}` between the header and the timeline — each field individually **null-/empty-omitted** so a sparse film (early announcement with only a title) still renders cleanly. No redesign: a typographic info block, not a new hero treatment.

**Which part of M2 this realizes:** Story **NEU-387** ("Film page shows all known basic info"), frontend half — the render side of milestone acceptance #2 (the BE half, NEU-396, supplies the DTO this consumes). It does **not** touch the timeline/grouping (NEU-371, shipped), the arc stepper, SSR determinism, or the event field rename (NEU-394/NEU-395 — independent story; see Coexistence).

**Tech stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — **all driven through `task` inside the container** (never run `pnpm`/`vitest`/`eslint`/`tsc` on the host).

**Pattern precedent (read before coding):**
- `src/components/film/FilmHeader.tsx` — the null-guard render style (`{poster && …}`, `{film.release_year && <p>…}`), Tailwind-utility styling, and the `{ film: FilmDetail }` prop shape the new section mirrors.
- `src/routes/film.tsx` — the `<main>` body that renders `<FilmHeader/>` then `<EventTimeline/>`; the new section slots between them.
- `src/lib/format.ts` — existing formatters (`formatEventDate`, `formatDayHeading`, `truncate`, `formatUsd`) and the `Intl.*` style; the new `formatRuntime` (and optional `formatLanguage`) land here.
- `src/lib/poster.ts` — `posterUrl(path, size)` over `env.tmdbImageBase`; the new `backdropUrl` mirrors it.
- `src/api/types.ts` — the `FilmDetail` interface to extend.
- `src/routes/film.test.tsx` + `src/components/film/EventTimeline.test.tsx` — the inline-`FilmDetail` fixture and the `makeEvent(overrides)` factory pattern the new tests mirror.
- `src/components/film/EventCard.tsx` — the badge/"chip" Tailwind pattern (`cn()` from `@/lib/utils`, `bg-*-100 text-*-800` pills) to match genre chips against.

---

## Working agreements (read first)

- **Everything runs in the container via `task`.** Keep it up. Scope tests with `task test -- <path>`. Gates before done: `task test` (full suite green), `task lint` (`eslint src --max-warnings 0` — **unused imports fail the build**), `task typecheck` (`react-router typegen` + `tsc -b`). Format only what you touch (`task format`).
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`), Testing Library (`render`, `screen`, role/text queries). These are pure component/unit tests — no network, so **no MSW handler is needed** for the `FilmMeta` and helper tests (they render with an in-memory fixture). The existing `film.test.tsx` loader test keeps its `server.use(http.get(...))` override.
- **Additive only.** Add fields to `FilmDetail`; do not rename or reorder the existing ones (`slug/title/release_date/release_year/poster_path/arc_stage/events` stay as-is). Add a new sibling component + new helpers; don't rewrite `FilmHeader`, `EventTimeline`, `EventCard`, or the timeline grouping.
- **Graceful omission is the contract.** Every new field is nullable (scalars/`collection` → `null`) or empty-list (`genres`/`production_companies` → `[]`) on the DTO. The FE omits each independently: a missing field renders **nothing** — no empty label, no `null`, no dangling separator. The whole section collapses to nothing when a film has none of the metadata (guard the section so it doesn't emit an empty shell).
- **Rating gate.** Show `vote_average` **only when `vote_count != null && vote_count > 0`** — TMDB returns `0.0 / 0` for unrated upcoming films, so gate on `vote_count`, never on `vote_average` alone.
- **SSR / hydration determinism.** No `Date.now()`, no relative dates, no locale-dependent drift between server and client. Formatters use fixed `Intl.*` locale/timezone (the `format.ts` precedent). No client-only branches in the section.
- **No backend changes, no new env vars, no new dependencies.** Pure read-render of NEU-396's DTO; reuse `env.tmdbImageBase`, `cn()`, and the existing `Intl` style.
- **One PR.** If executing via subagents, strip any commit step from implementer prompts; the user commits once at the end off the NEU-397 ticket branch.

---

## Architecture & approach

### 1. Extend the `FilmDetail` type to mirror NEU-396's DTO

In `src/api/types.ts`, add the ten fields to `FilmDetail` (names/types exactly mirror the BE DTO so the JSON deserializes 1:1) and a small nested collection type:

| FE field | Type | DTO source (NEU-396) | FE use |
|---|---|---|---|
| `overview` | `string \| null` | `Film.overview` | synopsis paragraph |
| `tagline` | `string \| null` | `Film.tagline` | italic line under the title |
| `runtime` | `number \| null` | `Film.runtime` (minutes) | formatted `2h 15m` |
| `genres` | `string[]` | `Genre.name` list (name-asc) | chips |
| `vote_average` | `number \| null` | `Film.vote_average` (0–10) | rating value |
| `vote_count` | `number \| null` | `Film.vote_count` | **gates** rating display |
| `original_language` | `string \| null` | `Film.original_language` (ISO-639-1) | language label |
| `backdrop_path` | `string \| null` | `Film.backdrop_path` | optional backdrop image |
| `production_companies` | `string[]` | `ProductionCompany.name` list (name-asc) | companies line |
| `collection` | `FilmCollection \| null` | `CollectionOut` `{ name }` | franchise label |

Add `interface FilmCollection { name: string }` (mirror the BE `CollectionOut`; the BE may additionally expose an optional `poster_path`, but the FE consumes only `name` per the milestone spec — keep the FE type minimal). List fields are non-nullable arrays defaulting to `[]` on the wire, so the FE guards them with `.length > 0`, not null-checks.

### 2. New helpers (small, unit-tested)

- **`formatRuntime(minutes: number): string`** in `src/lib/format.ts` — minutes → `"Xh Ym"`. Cases: `135 → "2h 15m"`, `60 → "1h"` (no `0m`), `45 → "45m"` (no `0h`), `0`/negative → caller omits (the field is null-guarded before formatting, but the helper should still return a sane value or the section should treat `runtime <= 0` as absent). Keep it a plain string builder (no `Intl` needed).
- **`backdropUrl(path: string \| null, size: string): string \| null`** in `src/lib/poster.ts` — mirror `posterUrl`: `null` in → `null` out; otherwise `` `${env.tmdbImageBase}/${size}${path}` ``. Backdrop sizes are wide (`"w780"` / `"w1280"`); pick one and pass it explicitly at the call site (mirrors `posterUrl(…, "w342")`).
- **Optional `formatLanguage(code: string): string`** in `src/lib/format.ts` — map an ISO-639-1 code to a display name via a fixed-locale `Intl.DisplayNames(["en"], { type: "language" })` (SSR-stable: same locale server and client), e.g. `"en" → "English"`, falling back to the upper-cased code if `DisplayNames` returns undefined. If you'd rather avoid `Intl.DisplayNames` for v1, render the code upper-cased (`"EN"`) — but a real language name reads better and is deterministic. Decide and test whichever you ship.

### 3. The `FilmMeta` section component

Add a focused sibling **`src/components/film/FilmMeta.tsx`** with prop `{ film: FilmDetail }` (don't bloat `FilmHeader`; a separate component is cleanly unit-testable). Rendered from `film.tsx` **between `<FilmHeader/>` and `<EventTimeline/>`**. Visual order, each line wrapped in its own null/empty guard so it disappears independently:

1. **Tagline** — `{film.tagline && <p className="italic …">{film.tagline}</p>}` (renders directly under the header → satisfies "italic, under the title").
2. **Optional backdrop** — `{backdropUrl(film.backdrop_path, "w780") && <img …/>}` with `alt={`${film.title} backdrop`}`, `loading="lazy"`, rounded. Keep it modest (not a full-bleed hero — the milestone forbids a redesign); skip entirely if you judge it adds clutter (the milestone lists backdrop as a "reasonable extra", not a requirement). If shown, guard on the helper's truthy return.
3. **Meta line** — a single row joining the present items with a `·` separator, **built by filtering an array of truthy pieces then joining** (so absent fields leave no dangling separator): release date (`formatEventDate(film.release_date)` when set), runtime (`formatRuntime(film.runtime)` when `> 0`), original language (`formatLanguage(film.original_language)` when set). Genres render as their own chip row (below), not in this text line, since they're a list.
4. **Rating** — `{film.vote_count != null && film.vote_count > 0 && (<span>{film.vote_average?.toFixed(1)} <small>/10</small></span>)}` (optionally a star glyph). Gated on `vote_count`, never `vote_average` alone.
5. **Genres** — `{film.genres.length > 0 && (<ul>…chips…</ul>)}`: each genre a muted pill (`<li>` with `cn()` Tailwind classes matching the `EventCard` badge style, e.g. `rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700`). Use a stable `key={genre}` (names are unique + name-ascending from the BE).
6. **Production companies** — `{film.production_companies.length > 0 && <p className="text-sm text-gray-500">{film.production_companies.join(", ")}</p>}` (comma-joined text line, optionally prefixed with a quiet label).
7. **Collection** — `{film.collection && <p>Part of <span>{film.collection.name}</span></p>}`. Render the franchise name as **plain text, not a link** — the milestone's out-of-scope explicitly forbids new collection/franchise navigation, and no `/collection` route exists. (The ticket's "collection link" phrasing is superseded by the milestone's no-navigation constraint; if a collection route ever lands, swapping the span for a `Link` is a one-line follow-up.)
8. **Overview** — `{film.overview && <p className="…leading-relaxed">{film.overview}</p>}` rendered last, as the body synopsis paragraph.

**Whole-section guard:** compute a `hasAnyMeta` boolean (any scalar present, any list non-empty, collection present) and `return null` when false, so a title-only film doesn't emit an empty `<section>`. Keep styling Tailwind-utility only, matching `FilmHeader`'s scale (e.g. wrap in `<section className="mt-6 space-y-3">`).

### 4. Slot into the film page

In `src/routes/film.tsx`, import `FilmMeta` and render `<FilmMeta film={film} />` between `<FilmHeader film={film} />` and `<EventTimeline events={film.events} />`. No loader change (`getFilm` already returns the whole DTO; the new fields flow through `FilmDetail` automatically). **`meta()` is left unchanged** — keeping blast radius minimal; using `film.overview` as a richer meta-description fallback is a deliberate non-goal here (note in Risks as an optional future tweak).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/api/types.ts` | modify | Add the ten fields to `FilmDetail` + `interface FilmCollection { name: string }`. |
| `src/lib/format.ts` | modify | Add `formatRuntime` (and optional `formatLanguage`). |
| `src/lib/format.test.ts` | create/modify | Unit-test `formatRuntime` cases (+ `formatLanguage` if shipped). (Create if no `format.test.ts` exists yet.) |
| `src/lib/poster.ts` | modify | Add `backdropUrl` mirroring `posterUrl`. |
| `src/lib/poster.test.ts` | create/modify | Unit-test `backdropUrl` (null → null; path → full URL). (Create if absent.) |
| `src/components/film/FilmMeta.tsx` | create | The null-omitting core-info section. |
| `src/components/film/FilmMeta.test.tsx` | create | All-present, sparse-omit, rating-gate, runtime-format, genre-chips, collection-text coverage. |
| `src/routes/film.tsx` | modify | Render `<FilmMeta/>` between header and timeline. |
| `src/routes/film.test.tsx` | modify | Extend the `FilmDetail` fixture with the new fields; assert the section renders through the page. |

No changes to `routes.ts`, the API client (`src/api/public.ts` already returns `FilmDetail`), env, or dependencies.

---

## Task 1: Extend the `FilmDetail` type + add helpers (TDD)

**Files:** modify `src/api/types.ts`, `src/lib/format.ts`, `src/lib/poster.ts`; create/modify `src/lib/format.test.ts`, `src/lib/poster.test.ts`.

- [ ] **Test first (helpers).** Write `formatRuntime` cases in `src/lib/format.test.ts`: `135 → "2h 15m"`, `60 → "1h"`, `45 → "45m"`, and the `0`/negative behavior you choose (treated-as-absent at call sites). If shipping `formatLanguage`, test `"en" → "English"` and an unknown code → its upper-cased fallback. Write `backdropUrl` cases in `src/lib/poster.test.ts`: `null → null`; `("/b.jpg", "w780")` → `` `${env.tmdbImageBase}/w780/b.jpg` `` (mirror however `posterUrl` is tested, if it is). Run `task test -- src/lib/format.test.ts src/lib/poster.test.ts` → **FAIL** (helpers missing).
- [ ] **Implement.** Add the ten fields to `FilmDetail` + `FilmCollection` in `types.ts` (mirroring the table in §1). Add `formatRuntime` (+ optional `formatLanguage`) to `format.ts` and `backdropUrl` to `poster.ts`. Re-run → **PASS**.

**Resilience notes:** the type change is additive and won't compile-break existing consumers (the new fields are read-only renders). `formatRuntime` is a pure string builder — no `Intl`, no timezone, fully deterministic. `formatLanguage` (if used) pins locale `["en"]` so SSR and client agree.

## Task 2: The `FilmMeta` section component (TDD)

**Files:** create `src/components/film/FilmMeta.tsx`, `src/components/film/FilmMeta.test.tsx`.

- [ ] **Test first.** Write `FilmMeta.test.tsx` with a local `makeFilm(overrides?: Partial<FilmDetail>): FilmDetail` factory (mirror `makeEvent` in `EventTimeline.test.tsx`) that returns a fully-populated `FilmDetail` and lets each test null/empty specific fields. Cover:
  1. **All fields present** — renders the tagline, the overview text, the runtime formatted as `"2h 15m"` (assert the formatted string, proving `formatRuntime` is wired), each genre as a chip (`getByText("Action")`, `getByText("Drama")`), the rating value, the production-companies text, and the collection name.
  2. **Sparse film omits each field** — with all optional fields null / `[]` / collection null, assert **none** of the labels/values appear (`queryByText(...)` is null for tagline, overview, a genre, the collection name) and there are no dangling `·` separators in the meta line; the component renders nothing (or an empty fragment) — assert via `container` that no stray empty section/labels are emitted.
  3. **Rating gate** — `vote_count === 0` (with a non-null `vote_average` like `0.0`) → the rating is **absent** (`queryByText(/\/10/)` null); `vote_count > 0` → the rating value shows. Also cover `vote_count == null` → absent.
  4. **Runtime edge** — `runtime: 60 → "1h"`, `runtime: 45 → "45m"` render correctly (or assert the `45m`/`1h` strings).
  5. **Collection renders as text, not a link** — `queryByRole("link", { name: /collection name/i })` is null while `getByText(collectionName)` is present (guards the no-navigation constraint).
  Run `task test -- src/components/film/FilmMeta.test.tsx` → **FAIL** (component missing).
- [ ] **Implement.** Create `FilmMeta.tsx` per §3: the eight guarded lines, the filter-then-join meta line, the `vote_count`-gated rating, genre chips with `key={genre}`, plain-text collection, the `hasAnyMeta` whole-section guard, Tailwind-only styling matching `FilmHeader`. Re-run → **PASS**.

**Resilience notes:** drive each line off its own field guard (no shared conditional that hides several at once), so the omission tests stay independent and adding/removing a future field is localized. Build the `·` meta line by filtering an array of present pieces then `.join(" · ")` — never string-concatenate with conditional separators (the classic dangling-separator bug the sparse test guards against). Match the chip classes to `EventCard`'s badge style so the section reads as part of the existing design, not a new one.

## Task 3: Slot the section into the film page (TDD)

**Files:** modify `src/routes/film.tsx`, `src/routes/film.test.tsx`.

- [ ] **Test first.** Extend the existing `FilmDetail` fixture in `film.test.tsx` with the new fields (overview, tagline, runtime, a couple of genres, vote fields, language, backdrop, companies, a collection). Add/extend a render assertion (via the existing `createRoutesStub`/page-render path) that one of the new fields — e.g. the tagline or a genre chip — appears on the page, proving `FilmMeta` is mounted between header and timeline. Keep the existing loader/meta assertions intact (they read individual fields; additive fixture keys don't disturb them). Run `task test -- src/routes/film.test.tsx` → **FAIL** (section not yet rendered).
- [ ] **Implement.** Import `FilmMeta` in `film.tsx` and render `<FilmMeta film={film} />` between `<FilmHeader/>` and `<EventTimeline/>`. Re-run → **PASS**.

**Resilience notes:** assert through role/text on a single representative new field rather than snapshotting the whole page (keeps the test robust to styling). `meta()` is untouched, so its tests don't move.

## Task 4: Full verification + handoff

**Files:** none (verification only).

- [ ] `task format` — Prettier-clean only the touched files.
- [ ] `task lint` — `eslint src --max-warnings 0`, zero warnings (no unused imports — `backdropUrl`/`formatRuntime`/`formatLanguage`/`FilmMeta` are all consumed).
- [ ] `task typecheck` — `react-router typegen` + `tsc -b`, 0 errors. The widened `FilmDetail` flows through `getFilm`'s return type automatically (no `+types` churn — no route signature changed).
- [ ] `task test` — full suite green: the new `format`/`poster`/`FilmMeta` tests, the extended `film.test.tsx`, and every untouched suite (NEU-371 timeline grouping + SSR determinism tests still pass — this ticket doesn't touch them).
- [ ] **Hand off for commit (user).** Do **not** commit from task execution. Report the green gates. The user commits the whole NEU-397 change as **one PR** off the ticket branch: Conventional Commits subject (no Linear ID in the commit subject; PR **title** carries `(NEU-397)`), the `🤖 Generated with Claude Code` footer in the **PR body only**, no `Co-Authored-By`. Pre-commit hooks delegate into the container — commit normally with the container up.

---

## Acceptance criteria (from milestone §2 / story NEU-387)

- `/film/{slug}` renders a clean core-info section surfacing the NEU-396 basics where present: overview, tagline, runtime (formatted `Xh Ym`), genres (as chips), rating (`vote_average`), original language, optional backdrop, production companies, and collection (franchise name).
- **Every field is individually omitted when absent** — a film missing a field shows no label, no `null`, and no dangling separator; a title-only film renders cleanly (the section collapses to nothing).
- The **rating is shown only when `vote_count > 0`** (unrated upcoming films with `0.0 / 0` show no rating).
- The collection renders as **plain text** (no new franchise navigation — milestone out-of-scope honored).
- The `FilmDetail` type mirrors the NEU-396 DTO (ten new fields + nested collection); the section slots between `FilmHeader` and `EventTimeline`; the timeline, arc stepper, grouping, and SSR determinism are unchanged.
- Vitest covers: all-fields-present rendering, per-field null/empty omission, the `vote_count` rating gate, and runtime/rating formatting. `task test` / `task lint` (zero warnings) / `task typecheck` green; touched files Prettier-clean.

## TDD testing intent (summary)

| Behavior | Where asserted |
|---|---|
| `formatRuntime` minutes → `Xh Ym` (+ `1h` / `45m` edges) | `format.test.ts` |
| `formatLanguage` code → display name (if shipped) | `format.test.ts` |
| `backdropUrl` null→null, path→full URL | `poster.test.ts` |
| Each metadata line renders when present | `FilmMeta.test.tsx` |
| Each line omitted when its field is null/empty; no dangling separators | `FilmMeta.test.tsx` |
| Rating shown iff `vote_count > 0`; hidden for `0`/`null` | `FilmMeta.test.tsx` |
| Genres render as chips; collection renders as text (not a link) | `FilmMeta.test.tsx` |
| Section mounts on the page between header and timeline | `film.test.tsx` |

## Coexistence with NEU-394 / NEU-395 (the other M2 story)

NEU-395 (the sibling FE ticket in story NEU-386) renames `FilmEvent.occurred_at → created_at` and edits `types.ts`, `film.tsx` (`meta()`), `EventTimeline`, `EventCard`, and `feed-groups`. **NEU-397 touches none of those event paths** — it only adds **film-level** fields to `FilmDetail` and a new sibling component. The two stories are logically independent and can land in either order. If NEU-395 has already merged, leave its `created_at` event field/sort as-is (don't reintroduce `occurred_at`); if not, NEU-397's additive `FilmDetail` fields overlay cleanly on top of NEU-395's later event-field rename (different fields, same interface). Do **not** touch `meta()`'s event-sort line here.

## Risks / notes

- **Dangling separators** are the classic bug for a `·`-joined meta line — build it by filtering present pieces then joining, never conditional `+ " · " +` concatenation. The sparse-film test is the guard.
- **Rating semantics.** Gate strictly on `vote_count` (`!= null && > 0`); `vote_average` alone is unsafe (`0.0` is falsy *and* a legitimate-looking value). The BE passes both raw (NEU-396) — the gate is the FE's job.
- **SSR/hydration.** `formatRuntime` is `Intl`-free and deterministic. If you ship `formatLanguage`, pin `Intl.DisplayNames(["en"], …)` so server and client agree (no system-locale drift). No `Date.now()`/relative dates anywhere in the section.
- **Backdrop is optional, not a hero.** The milestone forbids a redesign — if shown, keep it a modest rounded image; it's acceptable to omit it in v1 (it's a "reasonable extra"). Whatever you choose, guard on `backdropUrl(...)` being truthy.
- **`meta()` is intentionally untouched.** Using `film.overview` as a richer fallback description is a tempting one-liner but out of scope here (it would churn `film.test.tsx`'s meta assertions). Note as a possible follow-up, don't do it in this PR.
- **Collection navigation is out of scope** — render the name as text. Don't add a `/collection` link or route.
- **Don't regress shipped work.** NEU-369 (feed density) and NEU-371 (timeline grouping) are live; this is purely additive to the film page body. Run the full local gate before handing off.

## Self-review — spec coverage

- **Mirror NEU-396's DTO onto `FilmDetail`** (ten fields + nested collection) → Task 1 §1 table; type-checked by `tsc -b` and exercised by the fixtures.
- **Clean core-info section between header and timeline** → Task 2 (`FilmMeta`) + Task 3 (slotting); asserted by `FilmMeta.test.tsx` + the `film.test.tsx` mount check.
- **Per-field null/empty omission; section collapses on a sparse film** → §3 guards + `hasAnyMeta`; asserted by the sparse-omit + no-dangling-separator tests.
- **Runtime as `Xh Ym`, genres as chips, rating gated on `vote_count`, collection as text** → §2 + §3; asserted by the runtime, chips, rating-gate, and collection-not-a-link tests.
- **Backdrop / original language / production companies as reasonable extras** → §3 lines 2/3/6; backdrop optional, language via `formatLanguage`, companies comma-joined.
- **No redesign, no new navigation, no BE/env/dep change, no event-field/timeline touch** → Working agreements + Coexistence + Risks; out-of-scope items (collection nav, hero treatment, `meta()` overview) explicitly deferred.
- **Gates + one PR, user commits** → Task 4.

**Placeholder scan:** no "TBD"/"similar to above"/"add tests later" — each task names its files, its test-first assertions, and its `task` command. Behavior is described (resilient, light on exact signatures) but every line maps to a concrete test and an existing precedent (`FilmHeader`, `format.ts`, `poster.ts`, `EventCard` chips, the `makeEvent` factory).
