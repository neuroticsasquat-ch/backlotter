# Tighten Home Feed Row Density (NEU-369) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public home "Latest Updates" feed (`/`) scan faster by collapsing each (film, day) row to a single text line in a hairline-divided list, with the poster removed.

**Architecture:** Frontend-only change to two files plus their test. `FeedDayCard` is rewritten to a one-line, posterless row (title left, beat badge + muted `+N` right); the `feed.tsx` page swaps the spaced bordered-card wrapper for a `divide-y` list and tightens day-section spacing. No API, DTO, or type change — `poster_path` stays on `FeedDayItem`, just unused by the card.

**Tech Stack:** React 19 + react-router v8 (framework mode, SSR), TypeScript, Tailwind, Vitest + @testing-library/react, pnpm.

## Global Constraints

- **Repo:** `upcoming-movies-frontend` (under the `~/projects/upcoming-movies/` umbrella). All paths below are relative to that repo root.
- **Branch:** `tom/neu-369-frontend-tighten-home-feed-row-density-for-faster-scanning`.
- **FE-only:** no backend / API / DTO / `FeedDayItem` type change. Do **not** touch `src/lib/poster.ts` (`posterUrl`) — the film page still uses it.
- **Keep the whole row a single `<Link to={/film/${slug}}>`.**
- **Keep:** the indigo beat-badge pill (`eventTypeLabel`) and the muted `+{event_count - 1}` shown only when `event_count > 1`.
- **CI must pass locally before commit** (per project rule, run the full FE pipeline): `pnpm typecheck` (react-router typegen + `tsc -b`), `pnpm lint` (eslint, `--max-warnings 0`), `pnpm test` (vitest run). Run `pnpm format` (prettier) before committing.
- **Commit style:** Conventional Commits with the Linear ID as a trailing parenthetical; no `Co-Authored-By` trailer.

---

## File Structure

- **Modify** `src/components/feed/FeedDayCard.tsx` — rewrite to a one-line, posterless row.
- **Modify** `src/routes/feed.tsx` — swap the per-day wrapper to a `divide-y` list; tighten section spacing.
- **Modify** `src/components/feed/FeedDayCard.test.tsx` — drop the two poster assertions, replace the placeholder test with a "no `<img>`" guard, keep the link/title/beat/`+N` tests.

There is no route-level test for `feed.tsx` (only the component test), so the page change is covered by `pnpm typecheck`/`pnpm lint` and the manual visual check.

---

## Task 1: One-line, posterless `FeedDayCard` + divided-list feed page

**Files:**
- Modify: `src/components/feed/FeedDayCard.tsx`
- Modify: `src/routes/feed.tsx`
- Test: `src/components/feed/FeedDayCard.test.tsx`

**Interfaces:**
- Consumes (unchanged): `FeedDayItem` from `@/api/types` (`film_slug`, `film_title`, `poster_path`, `day`, `top_event_type`, `event_count`); `eventTypeLabel` from `@/components/film/labels`; `Link` from `react-router`.
- Produces: `FeedDayCard` keeps the same prop shape (`{ item: FeedDayItem }`) and the same default export usage in `feed.tsx` — no signature change for callers.

- [ ] **Step 1: Update the test file to the new contract**

Replace the entire contents of `src/components/feed/FeedDayCard.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import type { FeedDayItem } from "@/api/types";

const item: FeedDayItem = {
  film_slug: "the-odyssey-2026",
  film_title: "The Odyssey",
  poster_path: "/odyssey.jpg",
  day: "2026-06-23",
  top_event_type: "release_date",
  event_count: 1,
};

function renderCard(overrides: Partial<FeedDayItem> = {}) {
  render(
    <MemoryRouter>
      <FeedDayCard item={{ ...item, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("FeedDayCard", () => {
  it("links the whole row to the film page and shows the title and beat", () => {
    renderCard();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("Release date")).toBeInTheDocument();
  });

  it("renders no poster image", () => {
    renderCard();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows no +N suffix for a single-event day", () => {
    renderCard({ event_count: 1 });
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("shows +N (events beyond the headline beat) when a film has multiple events that day", () => {
    renderCard({ event_count: 3 });
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify the new guard fails against the current component**

Run: `pnpm test -- src/components/feed/FeedDayCard.test.tsx`
Expected: FAIL — `"renders no poster image"` fails (the current component renders an `<img>`, so `queryByRole("img")` is not null). The other three tests pass.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `src/components/feed/FeedDayCard.tsx` with:

```tsx
import { Link } from "react-router";
import type { FeedDayItem } from "@/api/types";
import { eventTypeLabel } from "@/components/film/labels";

/** One (film, day) row: title + the day's top beat (with a muted +N when there were more), the whole row linked. */
export function FeedDayCard({ item }: { item: FeedDayItem }) {
  return (
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
  );
}
```

Note: the `posterUrl` import is gone (removing it is required — eslint runs with `--max-warnings 0`, so a stray unused import fails CI).

- [ ] **Step 4: Update the feed page to a divided list**

In `src/routes/feed.tsx`, change the two wrapper classes inside the `groups.map(...)` block. Current:

```tsx
groups.map((group) => (
  <section key={group.dayKey} className="mt-8">
    <h2 className="text-sm font-medium text-gray-500">
      <time dateTime={group.dayKey}>{group.heading}</time>
    </h2>
    <div className="mt-3 space-y-3">
      {group.items.map((item) => (
        <FeedDayCard key={item.film_slug} item={item} />
      ))}
    </div>
  </section>
))
```

Change to:

```tsx
groups.map((group) => (
  <section key={group.dayKey} className="mt-6">
    <h2 className="text-sm font-medium text-gray-500">
      <time dateTime={group.dayKey}>{group.heading}</time>
    </h2>
    <div className="mt-2 divide-y divide-gray-100">
      {group.items.map((item) => (
        <FeedDayCard key={item.film_slug} item={item} />
      ))}
    </div>
  </section>
))
```

Only `mt-8` → `mt-6` (section) and `mt-3 space-y-3` → `mt-2 divide-y divide-gray-100` (inner wrapper) change. Leave the `<h1>`, `meta`, empty state, `ErrorBoundary`, and imports as-is.

- [ ] **Step 5: Run the component test to verify it passes**

Run: `pnpm test -- src/components/feed/FeedDayCard.test.tsx`
Expected: PASS — all four tests green.

- [ ] **Step 6: Run the full FE CI pipeline locally**

Run, in order:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format
```

Expected: `typecheck` clean (no TS errors), `lint` clean (no eslint warnings — confirms no unused `posterUrl` import), `test` all green, `format` reports the two changed files formatted (or no changes).

- [ ] **Step 7: Manual visual check (optional but recommended)**

Run `pnpm dev` and open the home feed (`https://app.upmovies.localhost/` in the localdev setup). Confirm: rows are single-line and noticeably shorter (~40px), separated by hairline dividers with a full-width hover band, no posters, beat badge + `+N` right-aligned, day headers intact, and clicking a row navigates to `/film/{slug}`. Stop `pnpm dev` when done.

- [ ] **Step 8: Commit**

```bash
git add src/components/feed/FeedDayCard.tsx src/components/feed/FeedDayCard.test.tsx src/routes/feed.tsx
git commit -m "feat(feed): tighten home feed row density (NEU-369)"
```

---

## Self-Review

**Spec coverage** (`docs/specs/2026-06-24-neu-369-tighten-home-feed-row-density-design.md`):
- One-line divided list, no poster → Steps 3 (component) + 4 (page). ✅
- Poster removed; `poster_path` stays on type; `posterUrl`/`poster.ts` untouched → Step 3 removes the `<img>` + `posterUrl` import only. ✅
- Beat badge kept; `+N` only when `event_count > 1` → Step 3 markup + Step 1 tests. ✅
- Whole-row link preserved → Step 3 `<Link>` + Step 1 href assertion. ✅
- Divided list (`divide-y`), tightened spacing → Step 4. ✅
- Test impact (drop poster assertions, delete placeholder test, add no-`<img>` guard, keep link/title/beat/`+N`) → Step 1. ✅
- Acceptance criteria 5 (tsc/eslint/vitest pass; no unused import) → Steps 5–6. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete file contents or the exact before/after. ✅

**Type consistency:** `FeedDayCard` prop shape (`{ item: FeedDayItem }`) and `FeedDayItem` field names are unchanged from the current code and used identically in the test, component, and page. ✅
