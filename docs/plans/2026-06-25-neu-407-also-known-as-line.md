**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m05-comprehensive-film-page.md
**Depends on:** NEU-406

# NEU-407 `[frontend]` — "Also known as" line on the film page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **TDD** plan — write the failing test first in every task, watch it fail for the right reason, then implement. The plan is deliberately light on exact signatures: follow the **existing patterns** in the cited files (`FilmHeader.tsx`, `FilmMeta.tsx` if landed, `EventTimeline.tsx`, `film.test.tsx`) rather than copying snippets verbatim.

**Goal:** Render an **"Also known as" line** on `/film/{slug}` listing the notable alternate titles the backend (NEU-406) now exposes on `FilmDetailResponse` as `alternative_titles: list[str]`. It is a single quiet text line — e.g. **"Also known as: The Odyssey, Odysseia, Οδύσσεια"** — rendered only when the list is **non-empty**; an empty list (`[]`) renders **nothing** (no label, no empty shell). **No backend change** (NEU-406 ships the DTO); this is a pure FE read-render ticket.

**Which part of M5 this realizes:** The **frontend half of Story NEU-391** ("Alternate titles improve search and show on the film page") and the final clause of milestone **acceptance #3** — *"the DTO exposes notable `alternative_titles`; `/film/{slug}` shows an 'Also known as' line."* It consumes the `alternative_titles` field that **NEU-406** (the M5 backend ticket) adds to `FilmDetailResponse`; this PR is **blocked by NEU-406** and renders against its merged DTO. The search half of NEU-391 (finding a film by an AKA) is NEU-406's concern, not this ticket's. This ticket is independent of the sibling M5 FE sections — NEU-403 cast/crew, NEU-405 release dates, and the M2 core-info section NEU-397 — which add adjacent content to the same page additively; they may land in any order.

**Tech stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — all driven through `task` inside the container (never run `pnpm`/`vitest`/`eslint`/`tsc` on the host).

**Backend contract (read-only — shipped by NEU-406, do not modify):**
- `GET /films/{slug}` → `FilmDetailResponse` additively gains `alternative_titles: string[]` — a **notable** set of distinct alternate titles, already **deduped, ordered, capped** server-side (≈8), and already **excluding** any title equal (case-insensitive) to the film's `title` / `original_title`. The FE renders the server's list **verbatim** — no client-side sort, slice, dedup, or filter. Empty → `[]`, never `null`. (Per the NEU-406 DTO section: "just the title strings — we don't surface country/type on the page.")

**Pattern precedents already on `main` (mirror these):**
- `src/components/film/FilmHeader.tsx` — the null/empty-guard render style (`{poster && …}`, `{film.release_year && <p>…}`), the `{ film: FilmDetail }` prop shape, and Tailwind-utility styling at the right scale.
- `src/components/film/EventTimeline.tsx` — a presentational section that branches on emptiness (here we **omit** rather than show an empty-state message).
- `src/routes/film.tsx` + `src/routes/film.test.tsx` — the `<main>` body that composes `<FilmHeader/>` + `<EventTimeline/>`, where new sections slot in, and the inline `FilmDetail` fixture + `createRoutesStub` render-test shape this ticket extends.
- `src/api/types.ts` — the `FilmDetail` interface to extend (additively).
- `src/api/public.ts` — `getFilm()` already returns the whole `FilmDetail`, so the new field rides along for free (no fetcher change).

---

## Working agreements (read first)

- **All commands run in the container via `task`.** Never run `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the container up (`task up`). Scope tests with `task test -- <path>`. Gates before done: `task test` (full suite green), `task lint` (`eslint src --max-warnings 0` — **unused imports fail the build**), `task typecheck` (`react-router typegen` + `tsc -b`). Format only what you touch (`task format`).
- **One PR.** NEU-407 ships as a **single frontend PR**; the user commits once at the end (final task). Do **NOT** commit per task. If executing via subagents, strip any commit step from implementer prompts.
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`), Testing Library (`render`, `screen`, role/text queries). The AKA unit is pure/presentational — **no** router/query/auth/network — so render it bare (no `MemoryRouter`/providers, no MSW handler). The route render test reuses the `createRoutesStub` shape from `film.test.tsx`.
- **Blocked by NEU-406.** This ticket consumes NEU-406's merged DTO field (`alternative_titles: list[str]` on `FilmDetailResponse`). Implement against that JSON contract; the FE only needs the shape, mocked in fixtures — it never hits the live backend. If `alternative_titles` is missing from the merged DTO, surface that as a blocker rather than inventing the field.
- **Graceful omission is the contract.** The line renders **only** when `film.alternative_titles.length > 0`. An empty list emits **nothing** — no "Also known as:" label with an empty value, no dangling separator, no empty `<p>`/section. This is the load-bearing behavior (milestone: "Omit when none").
- **Render the server's list verbatim.** The backend already dedupes, orders, caps, and excludes the primary/original title. The FE does **no** client-side sort/slice/dedup/filter — just join and display. (If a defensive display cap is ever wanted it is a non-requirement; the server cap is authoritative.)
- **Determinism / hydration safety.** No `Date.now()`, no locale-dependent output, no client-only branches. The line is a deterministic join of the server-provided strings — identical on server and client (preserves the NEU-310/312 public-loader SSR invariant; the component is provider-free and must never trigger `/me` during SSR).
- **Stay additive on the shared type/page.** `FilmDetail` and `src/routes/film.tsx` are also widened by the sibling M5 FE tickets (NEU-403 cast/crew, NEU-405 release dates) and the M2 core-info ticket (NEU-397 `FilmMeta`). **Add** the `alternative_titles` field (append at the end — don't reorder existing fields) and the one AKA render site; do **not** rename/reorder existing fields or rework `FilmHeader`/`EventTimeline`/a sibling's section. If a sibling has merged first, rebase and overlay cleanly; if not, design so a later merge is additive. This ticket's logical slice is **only** the `alternative_titles` type field, the AKA render, and the fixture updates.
- **No backend change, no new env var, no new dependency.** Pure read-render of NEU-406's DTO.

---

## Architecture & approach

### 1. Extend the `FilmDetail` type (additive)

In `src/api/types.ts`, append one field to the existing `FilmDetail` interface, mirroring the NEU-406 DTO 1:1 so the JSON deserializes without transformation:

| FE field | Type | DTO source (NEU-406) | FE use |
|---|---|---|---|
| `alternative_titles` | `string[]` | `FilmDetailResponse.alternative_titles` | the comma-joined "Also known as" line |

It is a non-nullable array defaulting to `[]` on the wire, so the FE guards it with `.length > 0` (not a null-check), exactly like `genres` / `production_companies` (NEU-397) and `cast` / `directors` (NEU-403).

### 2. Where the AKA line slots — a tiny dedicated component

Per the milestone spec the AKA line lives "in the core-info/credits area of `film.tsx` (or a tiny component)." Ship it as a **small dedicated presentational component** — `src/components/film/AlsoKnownAs.tsx` — rendered from `routes/film.tsx`, mirroring how `FilmCredits` / `ReleaseDates` are sibling sections each owning their own omit-when-empty decision. **Why a standalone component rather than a line inside NEU-397's `FilmMeta`:**

- **Resilience to merge order.** NEU-397 (`FilmMeta`) is a sibling M2 ticket that may or may not have merged when NEU-407 is implemented. A standalone component slots into `film.tsx` the same way regardless, with **zero** dependency on `FilmMeta` existing — keeping this ticket's diff scoped to its own field + component + one render line (the same scoping the sibling M5 FE plans adopt).
- **Cleanly unit-testable** in isolation (a bare `render(<AlsoKnownAs titles={...} />)`), and it owns the empty-list guard so `film.tsx` needs no extra conditional.

**Coordination with NEU-397's `FilmMeta` (non-load-bearing placement):** the AKA line is conceptually part of the core-info band. Render `<AlsoKnownAs .../>` adjacent to that band — **directly below `<FilmMeta/>` when it has merged**, otherwise directly below `<FilmHeader/>` (above `<EventTimeline/>` either way). The exact neighbor is not load-bearing; the contract is "in the core-info area, above the timeline." If a reviewer prefers the line to live *inside* `FilmMeta` as one more guarded row once both have merged, that is an acceptable equivalent — but the standalone component is the resilient default and keeps NEU-407 independent of NEU-397's merge status. Do **not** make this ticket depend on `FilmMeta`; do **not** edit `FilmMeta` here unless folding the line in is the chosen approach, in which case keep the change to a single additive guarded line and still test the omit-when-empty behavior.

**Component shape (representative — Tailwind classes are non-load-bearing; match `FilmHeader`'s muted-text scale):**

- **Prop:** the title slice, e.g. `{ titles: string[] }` (pass `film.alternative_titles` from the route). Taking the array directly (rather than the whole `film`) keeps it trivially testable, matching `FilmCredits`'s `{ cast, directors }` prop shape.
- **Early return / guard:** `if (titles.length === 0) return null;` — the line is omitted entirely when there are no alternate titles.
- **Render:** a single quiet line — a label ("Also known as") plus the **comma-joined** titles (`titles.join(", ")`). Use semantic, accessible markup so a test can target it deterministically: e.g. a `<p>` with the label in a `<span>`/`<dt>`-style emphasis and the joined value as text, or a `<dl>`/`<dt>`/`<dd>` pair. Keep it on one line visually (the server already caps to a notable handful, so overflow is a non-issue; allow it to wrap naturally — **no** truncation/"+N more" affordance is required).
- **Provider-free, deterministic:** no router (no links — alternate titles are plain strings, not navigable), no hooks, no `Date`/locale formatting. Pure function of its prop.

### 3. Slot into the film page

In `src/routes/film.tsx`, import `AlsoKnownAs` and render `<AlsoKnownAs titles={film.alternative_titles} />` in the core-info band (below `FilmMeta` if present, else below `FilmHeader`; above `EventTimeline`). No loader change (`getFilm` already returns the whole DTO; the new field flows through `FilmDetail` automatically). **`meta()`, `loader`, and `ErrorBoundary` are left untouched** — keeping blast radius minimal. The parent passes the slice straight through; the component owns the omit-when-empty decision, so the page needs no extra guard.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/api/types.ts` | modify | Append `alternative_titles: string[]` to the `FilmDetail` interface (mirrors NEU-406's DTO field). |
| `src/components/film/AlsoKnownAs.tsx` | create | Presentational "Also known as" line: label + comma-joined titles; returns `null` when `titles` is empty. |
| `src/components/film/AlsoKnownAs.test.tsx` | create | Renders the joined titles when present; renders **nothing** when the list is empty; single title renders without a stray separator. |
| `src/routes/film.tsx` | modify | Render `<AlsoKnownAs titles={film.alternative_titles} />` in the core-info band, above `<EventTimeline/>`. |
| `src/routes/film.test.tsx` | modify | Extend the `film` fixture with `alternative_titles`; assert the line renders on the page and is **absent** when `alternative_titles: []`. |
| `src/components/film/FilmHeader.test.tsx` | modify | Add `alternative_titles: []` to its local `film` fixture so it still satisfies the widened `FilmDetail` type. |
| `src/api/public.test.ts` | modify | Add `alternative_titles: []` (or sample titles) to its `sample: FilmDetail` literal so it still satisfies the widened type. |

No changes to `routes.ts`, the API client (`src/api/public.ts` already returns `FilmDetail`), env, or dependencies. **Note (typecheck):** widening `FilmDetail` makes **every** `FilmDetail` literal in the suite require the new field — there are three (`src/routes/film.test.tsx`, `src/components/film/FilmHeader.test.tsx`, `src/api/public.test.ts`). All three must gain `alternative_titles` or `task typecheck` fails. (If a sibling M5 FE ticket has already widened these fixtures with its own field, just add `alternative_titles` alongside — additive, don't reorder.)

---

## Task 1: Extend the `FilmDetail` type + satisfy existing fixtures (TDD)

**Files:** modify `src/api/types.ts`; modify the `FilmDetail` literals in `src/components/film/FilmHeader.test.tsx`, `src/api/public.test.ts`, `src/routes/film.test.tsx`.

- [ ] **Step 1 — add the field.** In `src/api/types.ts`, append `alternative_titles: string[];` to the `FilmDetail` interface (at the end — don't reorder existing fields; a sibling M5/M2 ticket may also be appending).
- [ ] **Step 2 — widen the fixtures.** Add `alternative_titles` to the three existing `FilmDetail` literals so they still satisfy the widened type: `[]` is fine for `FilmHeader.test.tsx` and `public.test.ts`; give `film.test.tsx`'s shared fixture a small **non-empty** list (e.g. `["Odysseia", "Οδύσσεια"]`, including a non-Latin string) so Task 3's render assertion has data. Run `task typecheck` → it should now pass for the type change (no compile errors from missing fields).

**Resilience notes:** the type change is additive and won't break existing read-render consumers — TS only flags the three literal fixtures, which Step 2 fixes. There is no helper to add (unlike NEU-397's `formatRuntime` or NEU-403's `profileUrl`) — the AKA line is a plain string join, so no `src/lib/*` change.

## Task 2: The `AlsoKnownAs` component (TDD)

**Files:** create `src/components/film/AlsoKnownAs.tsx` + `src/components/film/AlsoKnownAs.test.tsx`.

- [ ] **Step 1 — failing render test.** Create `src/components/film/AlsoKnownAs.test.tsx`. The component takes the title slice as a prop (e.g. `{ titles: string[] }`) and renders no `<Link>`, so a bare `render(<AlsoKnownAs titles={...} />)` (no router/providers) is fine. Cover:
  - **titles present:** with `["Odysseia", "Οδύσσεια"]`, the line shows an "Also known as" label and **both** titles (e.g. `getByText` on the comma-joined value `"Odysseia, Οδύσσεια"`, or assert each title is present in the rendered line); the non-Latin string renders intact.
  - **single title:** with `["Odysseia"]`, the title shows with **no** stray trailing/leading separator (guards the join).
  - **empty → omitted:** with `titles: []`, the component renders **nothing** — `const { container } = render(<AlsoKnownAs titles={[]} />); expect(container).toBeEmptyDOMElement();` — realizing the "Omit when none" contract.

  Run `task test -- src/components/film/AlsoKnownAs.test.tsx` → **FAIL** (module missing).

- [ ] **Step 2 — implement `AlsoKnownAs`.** Create `src/components/film/AlsoKnownAs.tsx` per §2: the `titles.length === 0 → return null` guard, then a single quiet line with an "Also known as" label and `titles.join(", ")` as the value, in accessible markup (a `<p>`/`<span>` pair or `<dl>`/`<dt>`/`<dd>`). Tailwind-utility styling only, matching `FilmHeader`'s muted scale (e.g. `text-sm text-gray-500`). No client-side sort/slice/dedup/filter — render the server's order verbatim. Run the test → **PASS**.

**Resilience notes:** drive the render off the single `titles.length > 0` guard so the omission test is unambiguous. Build the displayed value with `titles.join(", ")` — never conditional `+ ", " +` concatenation (the classic dangling-separator bug the single-title test guards against). The component is presentational and provider-free (no Auth/Query/router), preserving the public film page's SSR invariant (no `/me` during render). The label text ("Also known as") is non-load-bearing copy — pick clear wording and assert on whatever you ship.

## Task 3: Slot into the film page + extend the route test (TDD)

**Files:** modify `src/routes/film.tsx`, `src/routes/film.test.tsx`.

- [ ] **Step 1 — failing route assertions.** In `src/routes/film.test.tsx` (the shared `film` fixture already gained a non-empty `alternative_titles` in Task 1), add render assertions via the existing `createRoutesStub` page-render path:
  - the page shows the "Also known as" line with the fixture's alternate titles (assert a representative title, e.g. `screen.getByText(/Odysseia/)`), proving `AlsoKnownAs` is mounted in the page body;
  - a separate stub with `alternative_titles: []` (`{ ...film, alternative_titles: [] }`) renders the page **without** the AKA line (assert the "Also known as" label / a known title is **absent**) and without error.

  Keep the existing loader/meta/render assertions intact (they read individual fields; the additive fixture key doesn't disturb them). Run `task test -- src/routes/film.test.tsx` → **FAIL** (line not rendered yet).

- [ ] **Step 2 — render the line.** In `src/routes/film.tsx`, import `AlsoKnownAs` and render `<AlsoKnownAs titles={film.alternative_titles} />` in the core-info band — directly below `<FilmMeta/>` if NEU-397 has merged, else directly below `<FilmHeader/>`, in all cases above `<EventTimeline/>`. Re-run → **PASS**. The empty case passes because `AlsoKnownAs` returns `null`.

**Resilience notes:** assert through role/text on a representative title rather than snapshotting the page (robust to styling/markup choices). Keep the change to one new import + one new JSX line; don't touch the loader, `meta`, or `ErrorBoundary`. The component owns the omit decision, so no guard is needed at the call site.

## Task 4: Full verification + handoff

**Files:** none (verification only).

- [ ] **Step 1 — format touched files:** `task format`. Don't stage unrelated `AuthContext.*` Prettier drift on `main`.
- [ ] **Step 2 — lint:** `task lint` → `eslint src --max-warnings 0` passes (no unused imports — `AlsoKnownAs` is consumed by `film.tsx`).
- [ ] **Step 3 — typecheck:** `task typecheck` → `react-router typegen` + `tsc -b` report 0 errors. The widened `FilmDetail` flows through `getFilm`'s return type automatically (no `+types` churn — no route signature changed); every `FilmDetail` literal in the suite now carries `alternative_titles`.
- [ ] **Step 4 — full suite:** `task test` → the entire Vitest suite is green: the new `AlsoKnownAs` test + the extended `film.test.tsx`, plus all untouched suites (`FilmHeader`/`EventTimeline`/`ArcStepper`/`public.test.ts`/etc.).
- [ ] **Step 5 — hand off for commit (user).** Do **NOT** commit from task execution. Report the green gates. The user commits the whole NEU-407 change as **one PR** off the ticket branch, using `/commit-msg` (Conventional Commits subject, no Linear ID in the subject, no `Co-Authored-By`) and `/pr-desc` (PR **title** carries `(NEU-407)`; body keeps the `🤖 Generated with Claude Code` footer). Pre-commit hooks delegate into the container — commit normally with the container up.

---

## Acceptance criteria (NEU-407 / parent story NEU-391 / milestone §3)

- `/film/{slug}` renders an **"Also known as" line** listing the notable alternate titles from `FilmDetailResponse.alternative_titles`, comma-joined, in the server's order (no client re-sort/slice/dedup/filter — the backend already deduped, ordered, capped, and excluded the primary/original title).
- **Omit when none:** a film whose `alternative_titles` is `[]` shows **no** AKA line — no label, no empty shell, no error; the rest of the page (header, core-info, timeline) renders normally.
- `FilmDetail` additively gains `alternative_titles: string[]` mirroring NEU-406's DTO; all three existing `FilmDetail` fixtures (`film.test.tsx`, `FilmHeader.test.tsx`, `public.test.ts`) are widened so `task typecheck` stays green.
- The line slots into the core-info band (above the timeline), coordinating with NEU-397's `FilmMeta` without depending on it; existing sections (header, timeline, arc stepper) are unchanged.
- **No backend change, no new env var/dependency.** Vitest (+ Testing Library) covers: the line renders the joined titles (incl. a non-Latin string, no stray separator on a single title); the empty list renders nothing; the route mounts the line and omits it when empty. `task test` / `task lint` (zero warnings) / `task typecheck` green; touched files Prettier-clean.

## TDD testing intent (summary)

| Behavior | Where asserted |
|---|---|
| AKA line renders the comma-joined titles when present (incl. non-Latin) | `AlsoKnownAs.test.tsx` |
| Single title renders with no stray separator | `AlsoKnownAs.test.tsx` |
| Empty list → component renders **nothing** (`toBeEmptyDOMElement`) | `AlsoKnownAs.test.tsx` |
| Line mounts on `/film/{slug}` in the core-info band, above the timeline | `film.test.tsx` |
| Empty `alternative_titles` → the page omits the line, no error | `film.test.tsx` |
| Widened `FilmDetail` is satisfied by every fixture | `task typecheck` (FilmHeader/public/film fixtures) |

## Coexistence with sibling M5 / M2 FE tickets

- **NEU-397 (`FilmMeta`, M2 core-info section)** — also adds film-level fields to `FilmDetail` and a section between header and timeline. NEU-407 places its line in the same band but does **not** depend on `FilmMeta` existing (resilient to either merge order). If both have merged, the AKA line may sit just below `FilmMeta` or be folded into it as one guarded row — either is acceptable; the standalone component is the default.
- **NEU-403 (cast/crew) / NEU-405 (release dates)** — each adds a field to the same `FilmDetail` and a section to the same `film.tsx`, additively. **Add, never overwrite:** append `alternative_titles` without reordering existing fields, and insert the `<AlsoKnownAs/>` element without disturbing a sibling's section or `<FilmHeader>`/`<EventTimeline>`. If a sibling has merged first, rebase and overlay cleanly; if not, design so a later merge is additive. This ticket's logical slice is **only** the `alternative_titles` field, the `AlsoKnownAs` component, the one render line in `film.tsx`, and the three fixture updates.

## Risks / notes

- **Dangling separator** is the one bug to guard: build the value with `titles.join(", ")`, never conditional concatenation. The single-title test is the guard.
- **Don't re-process the list.** The backend (NEU-406) is the single source of truth for which titles are notable, their order, the cap, and the primary/original-title exclusion. The FE must not re-sort, re-slice, re-dedup, or re-filter — doing so would drift from the contract and the search half. Render verbatim.
- **SSR / hydration.** The line is a deterministic string join — no `Date.now()`, no locale formatting, no client-only branch; server and client render identical markup. The component is provider-free (no `/me` during SSR).
- **Non-Latin titles** (foreign AKAs) are expected and must render intact — include one in the fixtures/tests (e.g. a Greek title) so encoding regressions are caught.
- **Scope discipline.** One field + one tiny component + one render line + fixture updates. Don't touch `meta()`, the loader, `ErrorBoundary`, the API client, or unrelated sections. No backend/env/dependency change.

## Self-review — spec coverage

- **Render "Also known as" listing notable alternate titles from the DTO** → §2 (`AlsoKnownAs`) + §3 (slot into page); asserted by the component render test + the `film.test.tsx` mount check. ✓
- **Omit when none** → §2 `titles.length === 0 → return null`; asserted by the empty-list `toBeEmptyDOMElement` test (component) and the empty-`alternative_titles` route render. ✓
- **Extend the FE film-detail type for `alternative_titles`** → Task 1 §1 (`alternative_titles: string[]` on `FilmDetail`); type-checked by `tsc -b` and exercised by the fixtures. ✓
- **Where it slots / how many to show / overflow** → §2: a tiny dedicated component in the core-info band coordinating with NEU-397's `FilmMeta` (no dependency on it); render the server-capped list verbatim, comma-joined, no truncation affordance needed. ✓
- **Null/empty omission** → Working agreements ("Graceful omission") + §2 guard + the empty tests. ✓
- **Which part of M5** → "Which part of M5 this realizes": FE half of Story NEU-391, milestone acceptance #3's final clause; blocked by NEU-406. ✓
- **TDD testing intent (renders AKA list, omits when none)** → "TDD testing intent" table + Tasks 2–3 red→green steps. ✓
- **Key files touched** → "File structure" table (4 modified + 1 created component + 1 created test). ✓
- **Resilient / additive to the shared type & page; no backend/env/dep change** → Working agreements + Coexistence + Risks. ✓

**Type/name consistency:** `alternative_titles: string[]` on `FilmDetail` matches NEU-406's `FilmDetailResponse.alternative_titles: list[str]` and is read by `AlsoKnownAs` via the `titles` prop (`film.alternative_titles`). The component's prop (`titles: string[]`) is exactly the field the route passes. The three `FilmDetail` literals (`film.test.tsx`, `FilmHeader.test.tsx`, `public.test.ts`) are all widened so the type stays satisfied. No new `src/lib` helper (the line is a plain join), no fetcher change.

**Placeholder scan:** no "TBD"/"similar to above"/"add tests later" — each task names its files, its test-first assertions, the exact `task` command, and the expected FAIL/PASS. Behavior is described (resilient, light on exact signatures) but every line maps to a concrete test and an existing precedent (`FilmHeader`/`EventTimeline` null-guards, the `FilmCredits`/`ReleaseDates` sibling-component shape, the `film.test.tsx` `createRoutesStub` fixture).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
