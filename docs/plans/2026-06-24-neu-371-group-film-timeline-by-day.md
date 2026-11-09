# NEU-371: Group film-page event timeline by day, newest first — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/film/{slug}`, render the event timeline grouped by day with the newest day first and newest event first within each day (instead of today's flat, oldest-first list).

**Architecture:** Frontend-only, no backend change. The backend already returns a film's `events` ascending by `occurred_at`. A new pure helper `groupEventsByDay` reverses that ascending list (deterministic — no `Date.now()`, so SSR and client output match) and buckets adjacent events by their UTC day key. `EventTimeline` renders each day as a `<section>` with the same heading treatment the home feed uses, keeping the existing rich `EventCard`. The `film.tsx` meta's "latest summary" is changed to pick the newest event order-independently rather than relying on the implicit ascending `.at(-1)` contract.

**Tech Stack:** React 19 + TypeScript, react-router (framework mode, SSR), Tailwind v4, Vitest + Testing Library. Everything runs in the container via `task` (no host pnpm/vitest/tsc).

## Global Constraints

- **Frontend-only.** No backend, schema, DTO, or API change. Repo: `upcoming-movies-frontend`.
- **Branch:** `tom/neu-371-frontend-group-film-page-event-timeline-by-day-newest-first`.
- **Run everything in the container via `task`** — never `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the `upmovies-frontend` container up.
- **Green before done:** `task test`, `task lint`, `task typecheck` must all pass; ESLint runs at **zero warnings** (an unused import fails the build); run `task format` on touched files.
- **Determinism:** the render path must be pure — no `Date.now()` / argless `new Date()`. Reuse `dayKey()` / `formatDayHeading()` from `src/lib/format.ts`, which force UTC. Day keys are UTC `YYYY-MM-DD`.
- **Precondition (existing backend contract):** `film.events` arrive ascending by `occurred_at` (`backend public/service.py:101`). `groupEventsByDay` relies on this, exactly as the existing `groupByDay` relies on the backend's grouped-feed ordering.
- **Don't reformat unrelated files** (some files have pre-existing Prettier drift on `main`). Format only what you touch.
- **Commits:** do NOT commit per task. Implement all tasks, get the full local CI green, then a **single** commit + one PR for the whole ticket (Task 4). Conventional-commit subject with the Linear ID parenthetical; keep the `🤖 Generated with Claude Code` footer in the **PR body only** (never in the commit message); no `Co-Authored-By` trailer.

---

## File Structure

- **Modify** `src/lib/feed-groups.ts` — add `EventDayGroup` interface + `groupEventsByDay(events)` alongside the untouched `groupByDay`.
- **Modify** `src/lib/feed-groups.test.ts` — add a `groupEventsByDay` describe block; leave the `groupByDay` tests untouched.
- **Modify** `src/components/film/EventTimeline.tsx` — render day sections via `groupEventsByDay`, keep the empty state and the rich `EventCard`.
- **Modify** `src/components/film/EventTimeline.test.tsx` — update the ordering test to expect newest-first grouping; add a day-heading test and a within-day ordering test; keep the empty-state test.
- **Modify** `src/routes/film.tsx` — change the meta's "latest summary" pick to be order-independent.
- **Modify** `src/routes/film.test.tsx` — add a meta test proving the description uses the newest event regardless of array order; update the render test that asserts ascending order.

---

## Task 1: `groupEventsByDay` day-grouping helper

**Files:**
- Modify: `src/lib/feed-groups.ts`
- Test: `src/lib/feed-groups.test.ts`

**Interfaces:**
- Consumes: `FilmEvent` (from `@/api/types`), `dayKey` + `formatDayHeading` (from `@/lib/format`).
- Produces: `interface EventDayGroup { dayKey: string; heading: string; events: FilmEvent[] }` and `function groupEventsByDay(events: FilmEvent[]): EventDayGroup[]` — groups newest-day-first, events newest-first within each day. Empty input → `[]`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/feed-groups.test.ts`, update the import line and append a new describe block. Change the top imports to:

```ts
import { describe, expect, it } from "vitest";
import { groupByDay, groupEventsByDay } from "@/lib/feed-groups";
import type { FeedDayItem, FilmEvent } from "@/api/types";
```

Append after the existing `groupByDay` describe block:

```ts
function event(occurred_at: string, summary: string): FilmEvent {
  return { event_type: "casting", confidence: "confirmed", occurred_at, summary, sources: [] };
}

describe("groupEventsByDay", () => {
  it("returns an empty array for no events", () => {
    expect(groupEventsByDay([])).toEqual([]);
  });

  it("orders days newest-first and events newest-first within a day", () => {
    // Input is ascending by occurred_at, as the backend returns it.
    const groups = groupEventsByDay([
      event("2026-06-22T08:00:00Z", "older day"),
      event("2026-06-23T08:00:00Z", "same day, earlier"),
      event("2026-06-23T20:00:00Z", "same day, later"),
    ]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-06-23", "2026-06-22"]);
    expect(groups[0].events.map((e) => e.summary)).toEqual([
      "same day, later",
      "same day, earlier",
    ]);
    expect(groups[1].events.map((e) => e.summary)).toEqual(["older day"]);
  });

  it("derives the UTC day key and human heading from occurred_at", () => {
    const groups = groupEventsByDay([event("2026-06-23T23:30:00Z", "late evening UTC")]);
    expect(groups[0].dayKey).toBe("2026-06-23");
    expect(groups[0].heading).toContain("June 23, 2026");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- src/lib/feed-groups.test.ts`
Expected: FAIL — `groupEventsByDay is not a function` (the export does not exist yet). The existing `groupByDay` tests still pass.

- [ ] **Step 3: Implement `groupEventsByDay`**

In `src/lib/feed-groups.ts`, change the two top imports to add `FilmEvent` and `dayKey`:

```ts
import type { FeedDayItem, FilmEvent } from "@/api/types";
import { dayKey, formatDayHeading } from "@/lib/format";
```

Then append below the existing `groupByDay` function (leave `groupByDay` and `FeedDayGroup` exactly as they are):

```ts
export interface EventDayGroup {
  /** UTC "YYYY-MM-DD" — a stable React key for the day section. */
  dayKey: string;
  /** Human heading, e.g. "Monday, June 23, 2026". */
  heading: string;
  /** The day's events, newest-first. */
  events: FilmEvent[];
}

/**
 * Bucket a film's events into per-day sections, newest day first and newest event first within a
 * day. Input must be ascending by `occurred_at` (the order `GET /films/{slug}` returns); we reverse
 * a copy — deterministic, no `Date.now()`, so SSR and client output match — then bucket adjacent
 * events sharing a UTC day key derived from `occurred_at`.
 */
export function groupEventsByDay(events: FilmEvent[]): EventDayGroup[] {
  const groups: EventDayGroup[] = [];
  for (const event of [...events].reverse()) {
    const key = dayKey(event.occurred_at);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === key) {
      last.events.push(event);
    } else {
      groups.push({ dayKey: key, heading: formatDayHeading(key), events: [event] });
    }
  }
  return groups;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- src/lib/feed-groups.test.ts`
Expected: PASS — all `groupEventsByDay` and `groupByDay` tests green.

---

## Task 2: Render the timeline grouped by day

**Files:**
- Modify: `src/components/film/EventTimeline.tsx`
- Test: `src/components/film/EventTimeline.test.tsx`

**Interfaces:**
- Consumes: `groupEventsByDay` + `EventDayGroup` (Task 1), `EventCard` (`./EventCard`), `FilmEvent` (`@/api/types`).
- Produces: unchanged component signature `EventTimeline({ events }: { events: FilmEvent[] })`. Renders one `<section>` per day with an `<h2><time dateTime={dayKey}>{heading}</time></h2>` heading (mirroring `src/routes/feed.tsx`) and an `<ol>` of the existing `EventCard`s; preserves the empty state.

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/components/film/EventTimeline.test.tsx` with (keeps `makeEvent` and the empty-state test, rewrites the ordering test, adds heading + within-day tests):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventTimeline } from "@/components/film/EventTimeline";
import type { FilmEvent } from "@/api/types";

function makeEvent(overrides: Partial<FilmEvent>): FilmEvent {
  return {
    event_type: "casting",
    confidence: "confirmed",
    occurred_at: "2025-01-01T00:00:00Z",
    summary: "Summary.",
    sources: [],
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/no updates yet/i)).toBeInTheDocument();
  });

  it("groups events by day, newest day first", () => {
    // Ascending input (as the backend returns); the timeline flips it to newest-first.
    render(
      <EventTimeline
        events={[
          makeEvent({ summary: "Casting announced.", occurred_at: "2025-01-01T00:00:00Z" }),
          makeEvent({
            summary: "Trailer dropped.",
            event_type: "trailer",
            occurred_at: "2026-06-01T00:00:00Z",
          }),
        ]}
      />,
    );
    const summaries = screen.getAllByText(/announced|dropped/).map((el) => el.textContent);
    expect(summaries).toEqual(["Trailer dropped.", "Casting announced."]);
  });

  it("renders a day heading for each day", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ summary: "Casting announced.", occurred_at: "2025-01-01T00:00:00Z" }),
          makeEvent({
            summary: "Trailer dropped.",
            event_type: "trailer",
            occurred_at: "2026-06-01T00:00:00Z",
          }),
        ]}
      />,
    );
    expect(screen.getByText(/January 1, 2025/)).toBeInTheDocument();
    expect(screen.getByText(/June 1, 2026/)).toBeInTheDocument();
  });

  it("orders events within a day newest-first", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ summary: "Earlier today.", occurred_at: "2026-06-01T08:00:00Z" }),
          makeEvent({ summary: "Later today.", occurred_at: "2026-06-01T20:00:00Z" }),
        ]}
      />,
    );
    const summaries = screen.getAllByText(/today/).map((el) => el.textContent);
    expect(summaries).toEqual(["Later today.", "Earlier today."]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- src/components/film/EventTimeline.test.tsx`
Expected: FAIL — the flat component still renders ascending order (`["Casting announced.", "Trailer dropped."]`) and renders no day headings, so the new ordering/heading assertions fail.

- [ ] **Step 3: Implement grouped rendering**

Replace the whole of `src/components/film/EventTimeline.tsx` with:

```tsx
import type { FilmEvent } from "@/api/types";
import { groupEventsByDay } from "@/lib/feed-groups";
import { EventCard } from "./EventCard";

/** Summarized events grouped by day (newest day first), or an empty-state message. */
export function EventTimeline({ events }: { events: FilmEvent[] }) {
  if (events.length === 0) {
    return <p className="mt-8 text-sm text-gray-500">No updates yet — check back soon.</p>;
  }
  const groups = groupEventsByDay(events);
  return (
    <div className="mt-8 space-y-8">
      {groups.map((group) => (
        <section key={group.dayKey}>
          <h2 className="text-sm font-medium text-gray-500">
            <time dateTime={group.dayKey}>{group.heading}</time>
          </h2>
          <ol className="mt-2 space-y-4">
            {group.events.map((event, i) => (
              <li key={`${event.event_type}-${event.occurred_at}-${i}`}>
                <EventCard event={event} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- src/components/film/EventTimeline.test.tsx`
Expected: PASS — all four tests green.

---

## Task 3: Order-independent "latest summary" in film meta

**Files:**
- Modify: `src/routes/film.tsx`
- Test: `src/routes/film.test.tsx`

**Interfaces:**
- Consumes: `film.events: FilmEvent[]` from the loader.
- Produces: the meta `description` uses the summary of the event with the maximum `occurred_at`, independent of array order (ISO-8601 strings compare chronologically). No new imports.

- [ ] **Step 1: Write the failing test**

In `src/routes/film.test.tsx`, inside the existing `describe("film route meta", ...)` block, add:

```ts
  it("uses the newest event's summary for the description, regardless of array order", () => {
    const outOfOrder: FilmDetail = {
      ...film,
      events: [
        {
          event_type: "trailer",
          confidence: "confirmed",
          occurred_at: "2026-06-01T00:00:00Z",
          summary: "Newest: trailer dropped.",
          sources: [],
        },
        {
          event_type: "casting",
          confidence: "confirmed",
          occurred_at: "2025-01-01T00:00:00Z",
          summary: "Oldest: casting announced.",
          sources: [],
        },
      ],
    };
    const tags = meta({
      loaderData: { film: outOfOrder },
      location: { pathname: "/film/the-odyssey-2026" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ name: "description", content: "Newest: trailer dropped." });
  });
```

This fixture lists the newest event **first**, so the old `.at(-1)` picks the oldest summary. `FilmDetail` is already imported at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- src/routes/film.test.tsx`
Expected: FAIL — the description is `"Oldest: casting announced."` (`.at(-1)` on the out-of-order array) instead of the expected newest summary.

- [ ] **Step 3: Implement the order-independent pick**

In `src/routes/film.tsx`, replace this line inside `meta()`:

```ts
  const latest = film.events.at(-1)?.summary; // events are ascending by occurred_at; last = most recent
```

with:

```ts
  // Pick the newest event by occurred_at, independent of array order (ISO-8601 sorts chronologically).
  const latest = [...film.events].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))[0]
    ?.summary;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- src/routes/film.test.tsx`
Expected: FAIL on the **render** test `"renders the arc, ascending timeline, and outbound source links"`, which still asserts ascending order. That is fixed in the next step — the new meta test passes.

- [ ] **Step 5: Update the render test to expect newest-first**

In `src/routes/film.test.tsx`, in the `describe("film route render", ...)` block, update the render assertion. Rename the test and flip the expected order:

```ts
  it("renders the arc, the timeline newest-first, and outbound source links", async () => {
    const Stub = createRoutesStub([
      { path: "/film/:slug", Component: FilmPage, loader: () => ({ film }) },
    ]);
    render(<Stub initialEntries={["/film/the-odyssey-2026"]} />);

    expect(await screen.findByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.getByText("Released")).toBeInTheDocument(); // ArcStepper renders all 7 labels; "Released" is always present
    const summaries = screen.getAllByText(/announced|dropped/).map((el) => el.textContent);
    expect(summaries).toEqual(["Trailer dropped.", "Casting announced."]);
    const link = screen.getByRole("link", { name: "Deadline" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
```

(The `film` fixture's two events are on different days — 2025-01-01 and 2026-06-01 — so newest-first renders `["Trailer dropped.", "Casting announced."]`.)

- [ ] **Step 6: Run the test file to verify it passes**

Run: `task test -- src/routes/film.test.tsx`
Expected: PASS — loader, meta (incl. the new order-independence test), and render tests all green.

---

## Task 4: Full verification + ship

**Files:** none (verification + git only).

- [ ] **Step 1: Run the full CI suite locally**

Run each and confirm green (per the repo's "green before done" rule):

```bash
task test
task lint
task typecheck
```

Expected: all pass; ESLint at zero warnings (confirm no unused imports — e.g. `dayKey`/`FilmEvent` added in Task 1 are used; `truncate` in `film.tsx` is still used).

- [ ] **Step 2: Format touched files**

Run: `task format`
Then confirm only the files this ticket touched changed (`git status`); do not stage unrelated Prettier drift.

- [ ] **Step 3: Manual smoke check (optional but recommended)**

With the stack up, open `https://app.upmovies.localhost/film/{slug}` for a film with multiple events across days and confirm: day headings appear, newest day is on top, newest event is first within a day, and each `EventCard` still shows summary + sources.

- [ ] **Step 4: Single commit + PR for the ticket**

Create/checkout the branch, commit once, push, open the PR:

```bash
git checkout -b tom/neu-371-frontend-group-film-page-event-timeline-by-day-newest-first
git add src/lib/feed-groups.ts src/lib/feed-groups.test.ts \
        src/components/film/EventTimeline.tsx src/components/film/EventTimeline.test.tsx \
        src/routes/film.tsx src/routes/film.test.tsx
git commit -m "feat: group film-page event timeline by day, newest first (NEU-371)"
git push -u origin tom/neu-371-frontend-group-film-page-event-timeline-by-day-newest-first
```

PR title: `feat: group film-page event timeline by day, newest first (NEU-371)`. PR body ends with the footer:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Self-Review

**Spec coverage** (against the ticket):
- "Group events by UTC date of `occurred_at`, day headings via `formatDayHeading`, days newest-first, events within a day newest-first" → Task 1 (`groupEventsByDay`) + Task 2 (rendering). ✓
- "Mirror the home feed's day-section visual treatment" → Task 2 reuses `feed.tsx`'s `<section>` + `<h2><time>{heading}</time></h2>` structure. ✓
- "Update the film loader's `.at(-1)` latest-summary meta" → Task 3. ✓
- "Generalize the helper or add a small event-specific grouping" → chose the focused sibling `groupEventsByDay` (decided in brainstorming). ✓
- "Can be done FE-only; no backend change" → Global Constraints; all tasks are FE. ✓

**Placeholder scan:** none — every step has the actual code/command.

**Type consistency:** `EventDayGroup`/`groupEventsByDay` defined in Task 1 are consumed with the same names/shapes in Task 2; `FilmEvent` used consistently; `groupByDay`/`FeedDayGroup` left untouched. Meta change uses no new identifiers.

**Decision note (refinement during planning):** the meta uses an order-independent max-by-`occurred_at` pick rather than reusing `groupEventsByDay`, because that helper assumes ascending input (it reverses) — the very assumption the ticket flags. Max-by-`occurred_at` is genuinely order-independent and yields a real TDD red→green.
