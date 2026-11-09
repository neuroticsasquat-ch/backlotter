# NEU-362 — Group home feed by film per day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the public home feed (`/`) from one card per event to **one card per film per day**, rendered from the new backend `GET /feed/grouped` endpoint, each card linking to `/film/{slug}`.

**Architecture:** Keep the merged NEU-312 feed page's `loader → meta → FeedPage → ErrorBoundary` shape. Add the new data layer (types + `getFeedGrouped`) and a new `FeedDayCard` additively, swap `feed.tsx` + rewrite the day-grouping helper to the one-row-per-(film,day) shape, then delete the now-dead per-event code (`getFeed`, `FeedItem`/`FeedResponse`, `FeedItemCard`). Additive-first / delete-last keeps the build green after every task.

**Tech Stack:** React 19, react-router (framework mode, SSR on Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW. All tooling runs in the container via `task`.

## Global Constraints

- **Everything runs in the container via `task`** — never run `pnpm`/`vitest`/`eslint`/`tsc`/`prettier` on the host. `task test` (scope with `task test -- <path>`), `task lint`, `task typecheck`, `task format`. Container must be up: `task up`.
- **ESLint runs at zero warnings** (`eslint src --max-warnings 0`) — unused imports/vars fail the build. This is the safety net for the delete task.
- **TDD** — write the failing test first, watch it fail, then implement. MSW intercepts all HTTP (`onUnhandledRequest: "error"`); register per-test handlers with `server.use(...)`.
- **Determinism (SSR):** no `Date.now()`, no relative date labels, no locale-dependent formatting. Day headings come from the backend `day` string formatted in UTC; list order comes from the backend.
- **Backend base URL** in dev is `https://api.upmovies.localhost`; in tests it is the `BACKEND` constant and the fetch is mocked.
- **Branch:** `tom/neu-362-frontend-group-home-feed-by-film-per-day`. **Commits:** no per-task commits — a single commit + PR at the end (see Wrap-up). One PR for the whole ticket.
- **Dependency:** blocked by NEU-364 (`GET /feed/grouped`), spec'd but not yet merged. This plan is fully executable now (tests mock the endpoint); only the live end-to-end check waits on NEU-364.

**Repo:** `upcoming-movies-frontend`. Backend contract (NEU-364):

```ts
// GET /feed/grouped?limit=50&offset=0  → 200
FeedDayItem  { film_slug: string; film_title: string; poster_path: string | null;
               day: string /* "YYYY-MM-DD" UTC */; top_event_type: string; event_count: number }
FeedDayResponse { items: FeedDayItem[]; total: number; limit: number; offset: number }
// Ordered day DESC, last_created_at DESC, slug ASC. One row per (film, day). Always 200.
```

---

## Pre-flight

- [ ] **Ensure the container is up and you're on the ticket branch**

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-frontend
git checkout -b tom/neu-362-frontend-group-home-feed-by-film-per-day   # or: git checkout <existing>
task up
task test    # baseline: full suite green before changes
```
Expected: the suite passes (the per-event feed is currently live).

---

## Task 1: Data layer — `FeedDayItem`/`FeedDayResponse` types + `getFeedGrouped`

Add the grouped-feed types and fetcher **alongside** the existing per-event ones (deleted in Task 4). Independently testable: only `public.test.ts` exercises this.

**Files:**
- Modify: `src/api/types.ts` (append the two interfaces)
- Modify: `src/api/public.ts` (add `getFeedGrouped`; extend the type import)
- Test: `src/api/public.test.ts` (append a `getFeedGrouped` suite)

**Interfaces:**
- Consumes: nothing new.
- Produces: `FeedDayItem`, `FeedDayResponse` (from `@/api/types`); `getFeedGrouped(baseUrl: string, opts?: { limit?: number; offset?: number }): Promise<FeedDayResponse>` (from `@/api/public`).

- [ ] **Step 1: Write the failing test** — append to `src/api/public.test.ts`:

```ts
const sampleGrouped: FeedDayResponse = {
  items: [
    {
      film_slug: "the-odyssey-2026",
      film_title: "The Odyssey",
      poster_path: "/poster.jpg",
      day: "2026-06-23",
      top_event_type: "casting",
      event_count: 2,
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

describe("getFeedGrouped", () => {
  it("returns the typed grouped feed on 200 and sends default limit/offset", async () => {
    let captured: URL | undefined;
    server.use(
      http.get(`${BACKEND}/feed/grouped`, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json(sampleGrouped);
      }),
    );
    const feed = await getFeedGrouped(BACKEND);
    expect(feed.total).toBe(1);
    expect(feed.items[0].film_slug).toBe("the-odyssey-2026");
    expect(feed.items[0].event_count).toBe(2);
    expect(captured?.searchParams.get("limit")).toBe("50");
    expect(captured?.searchParams.get("offset")).toBe("0");
  });

  it("throws on a 500", async () => {
    server.use(http.get(`${BACKEND}/feed/grouped`, () => new HttpResponse(null, { status: 500 })));
    await expect(getFeedGrouped(BACKEND)).rejects.toThrow(/failed: 500/);
  });
});
```

Also extend the imports at the top of `src/api/public.test.ts`:

```ts
import { getFeed, getFeedGrouped, getFilm } from "@/api/public";
import type { FeedResponse, FeedDayResponse, FilmDetail } from "@/api/types";
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `task test -- src/api/public.test.ts`
Expected: FAIL — `getFeedGrouped` is not exported (and `FeedDayResponse` is not a type yet).

- [ ] **Step 3: Add the types** — append to `src/api/types.ts`:

```ts
export interface FeedDayItem {
  film_slug: string;
  film_title: string;
  poster_path: string | null;
  day: string; // "YYYY-MM-DD" (UTC); one row per film per day
  top_event_type: string; // raw event_type, rendered via eventTypeLabel
  event_count: number;
}

export interface FeedDayResponse {
  items: FeedDayItem[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] **Step 4: Add the fetcher** — in `src/api/public.ts`, extend the import and add the function:

```ts
import type { FeedResponse, FeedDayResponse, FilmDetail } from "./types";
```

```ts
/**
 * Fetch the per-(film, day) grouped public feed from the no-auth backend (NEU-364). The base URL is
 * injected by the caller (the SSR loader reads it from the Worker env), so this stays pure and runs
 * in the Workers runtime and under test. Always responds 200 (no 404 branch); throws on any non-OK.
 */
export async function getFeedGrouped(
  baseUrl: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<FeedDayResponse> {
  const url = new URL("/feed/grouped", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET /feed/grouped failed: ${res.status}`);
  return (await res.json()) as FeedDayResponse;
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `task test -- src/api/public.test.ts`
Expected: PASS — both `getFeed` and `getFeedGrouped` suites green.

---

## Task 2: `FeedDayCard` component

The new per-(film, day) card: horizontal row, poster + title + beat/`+N`, whole card is one `<Link>`.

**Files:**
- Create: `src/components/feed/FeedDayCard.tsx`
- Test: `src/components/feed/FeedDayCard.test.tsx`

**Interfaces:**
- Consumes: `FeedDayItem` (`@/api/types`); `posterUrl` (`@/lib/poster`); `eventTypeLabel` (`@/components/film/labels`); `Link` (`react-router`).
- Produces: `FeedDayCard({ item }: { item: FeedDayItem })` (named export from `@/components/feed/FeedDayCard`).

- [ ] **Step 1: Write the failing test** — create `src/components/feed/FeedDayCard.test.tsx`:

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
  it("links the whole card to the film page and shows the poster, title, and beat", () => {
    renderCard();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("Release date")).toBeInTheDocument();
    const poster = screen.getByRole("img", { name: "The Odyssey poster" });
    expect(poster.getAttribute("src")).toContain("/w154/odyssey.jpg");
  });

  it("shows no +N suffix for a single-event day", () => {
    renderCard({ event_count: 1 });
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("shows +N (events beyond the headline beat) when a film has multiple events that day", () => {
    renderCard({ event_count: 3 });
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("renders a placeholder and no image when the film has no poster", () => {
    renderCard({ poster_path: null });
    expect(screen.queryByRole("img")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `task test -- src/components/feed/FeedDayCard.test.tsx`
Expected: FAIL — `FeedDayCard` module not found.

- [ ] **Step 3: Implement the component** — create `src/components/feed/FeedDayCard.tsx`:

```tsx
import { Link } from "react-router";
import type { FeedDayItem } from "@/api/types";
import { posterUrl } from "@/lib/poster";
import { eventTypeLabel } from "@/components/film/labels";

/** One (film, day) row: poster + title + the day's top beat (with a muted +N when there were more). */
export function FeedDayCard({ item }: { item: FeedDayItem }) {
  const poster = posterUrl(item.poster_path, "w154");
  return (
    <Link
      to={`/film/${item.film_slug}`}
      className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50"
    >
      {poster ? (
        <img
          src={poster}
          alt={`${item.film_title} poster`}
          loading="lazy"
          className="aspect-[2/3] w-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="aspect-[2/3] w-12 shrink-0 rounded bg-gray-100" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold">{item.film_title}</h3>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-indigo-800">
            {eventTypeLabel(item.top_event_type)}
          </span>
          {item.event_count > 1 && <span className="text-gray-500">+{item.event_count - 1}</span>}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `task test -- src/components/feed/FeedDayCard.test.tsx`
Expected: PASS (all four cases).

---

## Task 3: Swap the feed page to the grouped stack

Rewrite `groupByDay` for the one-row-per-(film, day) shape, swap `feed.tsx`'s loader/render to `getFeedGrouped` + `FeedDayCard` + the new grouping, and rewrite both affected tests. All three files move together so the build stays consistent within the task.

**Files:**
- Rewrite: `src/lib/feed-groups.ts`
- Rewrite: `src/lib/feed-groups.test.ts`
- Modify: `src/routes/feed.tsx`
- Rewrite: `src/routes/feed.test.tsx`

**Interfaces:**
- Consumes: `FeedDayItem`/`FeedDayResponse` (Task 1); `getFeedGrouped` (Task 1); `FeedDayCard` (Task 2); `formatDayHeading` (`@/lib/format`).
- Produces: `groupByDay(items: FeedDayItem[]): FeedDayGroup[]` and `FeedDayGroup { dayKey: string; heading: string; items: FeedDayItem[] }` (from `@/lib/feed-groups`).

- [ ] **Step 1: Write the failing grouping test** — replace the entire contents of `src/lib/feed-groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupByDay } from "@/lib/feed-groups";
import type { FeedDayItem } from "@/api/types";

function item(day: string, film_slug: string, event_count = 1): FeedDayItem {
  return {
    film_slug,
    film_title: film_slug.toUpperCase(),
    poster_path: null,
    day,
    top_event_type: "casting",
    event_count,
  };
}

describe("groupByDay", () => {
  it("returns an empty array for no items", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("buckets same-day items into one group, preserving input order", () => {
    const groups = groupByDay([item("2026-06-23", "a"), item("2026-06-23", "b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].dayKey).toBe("2026-06-23");
    expect(groups[0].items.map((i) => i.film_slug)).toEqual(["a", "b"]);
  });

  it("opens a new group on a day boundary, keeping groups newest-first", () => {
    const groups = groupByDay([
      item("2026-06-23", "a"),
      item("2026-06-23", "b"),
      item("2026-06-22", "c"),
    ]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-06-23", "2026-06-22"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items.map((i) => i.film_slug)).toEqual(["c"]);
    expect(groups[1].heading).toContain("June 22, 2026");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `task test -- src/lib/feed-groups.test.ts`
Expected: FAIL — `groupByDay` still expects `FeedItem` (type error / wrong shape).

- [ ] **Step 3: Rewrite the grouping helper** — replace the entire contents of `src/lib/feed-groups.ts`:

```ts
import type { FeedDayItem } from "@/api/types";
import { formatDayHeading } from "@/lib/format";

export interface FeedDayGroup {
  /** UTC "YYYY-MM-DD" — a stable React key for the day section. */
  dayKey: string;
  /** Human heading, e.g. "Monday, June 23, 2026". */
  heading: string;
  items: FeedDayItem[];
}

/**
 * Bucket a backend-ordered grouped feed (`day DESC, last_created_at DESC, slug ASC`) into per-day
 * sections. Each item is already one (film, day) row carrying a "YYYY-MM-DD" `day`, so we bucket on
 * that string directly. Preserving the backend order means groups come out newest-day-first with a
 * deterministic within-day order — no sorting, no `Date.now()`, so SSR and client output match.
 */
export function groupByDay(items: FeedDayItem[]): FeedDayGroup[] {
  const groups: FeedDayGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.dayKey === item.day) {
      last.items.push(item);
    } else {
      groups.push({ dayKey: item.day, heading: formatDayHeading(item.day), items: [item] });
    }
  }
  return groups;
}
```

(Note: the old `dayKey` import is dropped — `item.day` is already the key. `formatDayHeading("2026-06-23")` is UTC-correct: a date-only string parses as UTC midnight and the formatter is `timeZone: "UTC"`.)

- [ ] **Step 4: Run the grouping test, verify it passes**

Run: `task test -- src/lib/feed-groups.test.ts`
Expected: PASS. (`feed.tsx` and `feed.test.tsx` are now broken — fixed in the next steps before re-running the full suite.)

- [ ] **Step 5: Swap the route component** — in `src/routes/feed.tsx`, change the two imports and the loader + card usage. Replace these lines:

```tsx
import { getFeed } from "@/api/public";
// ...
import { FeedItemCard } from "@/components/feed/FeedItemCard";
```

with:

```tsx
import { getFeedGrouped } from "@/api/public";
// ...
import { FeedDayCard } from "@/components/feed/FeedDayCard";
```

Replace the loader body line `const feed = await getFeed(env.API_BASE_URL);` with:

```tsx
  const feed = await getFeedGrouped(env.API_BASE_URL);
```

Replace the inner `group.items.map(...)` block with:

```tsx
            <div className="mt-3 space-y-3">
              {group.items.map((item) => (
                <FeedDayCard key={item.film_slug} item={item} />
              ))}
            </div>
```

(The `<h1>`, `meta`, empty state, day `<section>`/`<time>` heading, and `ErrorBoundary` are unchanged. `item.film_slug` is unique within a day, so it is a valid React key.)

- [ ] **Step 6: Rewrite the route test** — replace the entire contents of `src/routes/feed.test.tsx`:

```tsx
import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import FeedPage, { loader, meta } from "@/routes/feed";
import type { FeedDayResponse } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const feed: FeedDayResponse = {
  items: [
    {
      film_slug: "the-odyssey-2026",
      film_title: "The Odyssey",
      poster_path: "/odyssey.jpg",
      day: "2026-06-23",
      top_event_type: "trailer",
      event_count: 1,
    },
    {
      film_slug: "dune-3-2026",
      film_title: "Dune Part Three",
      poster_path: null,
      day: "2026-06-22",
      top_event_type: "casting",
      event_count: 3,
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
};

function contextWithEnv() {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } });
  return context;
}

function callLoader() {
  return loader({
    request: new Request("https://upmovies.example/"),
    context: contextWithEnv(),
    params: {},
  } as unknown as Parameters<typeof loader>[0]);
}

describe("feed route loader", () => {
  it("fetches the grouped feed from the backend", async () => {
    server.use(http.get(`${BACKEND}/feed/grouped`, () => HttpResponse.json(feed)));
    const data = await callLoader();
    expect(data.feed.total).toBe(2);
    expect(data.feed.items[0].film_slug).toBe("the-odyssey-2026");
  });
});

describe("feed route meta", () => {
  it("builds the landing head with the templated title and canonical link", () => {
    const tags = meta({
      location: { pathname: "/" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "Latest Updates · Upcoming Movies Tracker" });
    expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});

describe("feed route render", () => {
  it("groups films by day (newest first) and links each card to its film page", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: FeedPage, loader: () => ({ feed }) }]);
    render(<Stub initialEntries={["/"]} />);

    expect(await screen.findByRole("heading", { name: "Latest Updates" })).toBeInTheDocument();
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/June 22, 2026/)).toBeInTheDocument();

    const odyssey = screen.getByRole("link", { name: /The Odyssey/ });
    expect(odyssey).toHaveAttribute("href", "/film/the-odyssey-2026");
    const dune = screen.getByRole("link", { name: /Dune Part Three/ });
    expect(dune).toHaveAttribute("href", "/film/dune-3-2026");
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("shows the empty state when there are no updates", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: FeedPage,
        loader: () => ({ feed: { ...feed, items: [], total: 0 } }),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(await screen.findByText(/no updates yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the swapped feed + grouping tests, verify they pass**

Run: `task test -- src/routes/feed.test.tsx src/lib/feed-groups.test.ts`
Expected: PASS. (`FeedItemCard` and `getFeed` are now unused but still present — removed in Task 4. The project still typechecks because the old code remains valid.)

- [ ] **Step 8: Run the full suite + typecheck, verify green**

Run: `task test && task typecheck`
Expected: PASS — the new stack is live; the old per-event code is dead but valid.

---

## Task 4: Remove the dead per-event feed code

Delete the now-unused per-event fetcher, types, card, and their tests. ESLint at zero warnings + the full suite prove nothing references them.

**Files:**
- Modify: `src/api/types.ts` (remove `FeedItem` + `FeedResponse`)
- Modify: `src/api/public.ts` (remove `getFeed`; drop `FeedResponse` from the import)
- Modify: `src/api/public.test.ts` (remove the `getFeed` suite, `sampleFeed`, and stale imports)
- Delete: `src/components/feed/FeedItemCard.tsx`
- Delete: `src/components/feed/FeedItemCard.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (removal only). After this task, `FeedItem`, `FeedResponse`, `getFeed`, and `FeedItemCard` no longer exist.

- [ ] **Step 1: Confirm the only consumers are the ones being removed**

Run: `grep -rnE "FeedItem|FeedResponse|\bgetFeed\b" upcoming-movies-frontend/src`
Expected: matches only in `api/types.ts`, `api/public.ts`, `api/public.test.ts`, and the two `FeedItemCard.*` files. (`getFeedGrouped` / `FeedDayItem` / `FeedDayResponse` / `FeedDayCard` / `FeedDayGroup` must NOT appear — the `\b…\b` and exact names exclude them.) If anything else matches, stop and update that consumer first.

- [ ] **Step 2: Delete the per-event card + its test**

```bash
git rm upcoming-movies-frontend/src/components/feed/FeedItemCard.tsx \
       upcoming-movies-frontend/src/components/feed/FeedItemCard.test.tsx
```

- [ ] **Step 3: Remove the per-event types** — in `src/api/types.ts`, delete the `FeedItem` and `FeedResponse` interfaces (the final block, currently lines 60–76):

```ts
export interface FeedItem {
  film_slug: string;
  film_title: string;
  event_type: string;
  confidence: string;
  occurred_at: string;
  created_at: string;
  summary: string;
  sources: FilmSource[];
}

export interface FeedResponse {
  items: FeedItem[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] **Step 4: Remove the per-event fetcher** — in `src/api/public.ts`, delete the `getFeed` function (keep `getFeedGrouped` and `getFilm`) and drop `FeedResponse` from the import so it reads:

```ts
import type { FeedDayResponse, FilmDetail } from "./types";
```

- [ ] **Step 5: Trim the API test** — in `src/api/public.test.ts`, remove the `getFeed` `describe` block and the `sampleFeed` const, and fix the imports:

```ts
import { getFeedGrouped, getFilm } from "@/api/public";
import type { FeedDayResponse, FilmDetail } from "@/api/types";
```

(Keep the `getFilm` and `getFeedGrouped` suites.)

- [ ] **Step 6: Re-grep to confirm the dead names are gone**

Run: `grep -rnE "FeedItem|FeedResponse|\bgetFeed\b" upcoming-movies-frontend/src`
Expected: **no matches.**

- [ ] **Step 7: Run the full gate, verify green**

Run: `task test && task lint && task typecheck`
Expected: PASS — full suite green, ESLint zero warnings (no unused imports), `tsc -b` clean.

---

## Wrap-up — format, single commit, PR

- [ ] **Format only the touched files**

Run: `task format` (or scope to touched files). Don't reformat unrelated files (`AuthContext.*` has known drift on `main`).

- [ ] **Final full gate**

Run: `task test && task lint && task typecheck`
Expected: all green.

- [ ] **One commit + PR for the whole ticket** (no per-task commits, per the project workflow)

```bash
git add -A
git commit -m "feat: group home feed by film per day (NEU-362)"
git push -u origin tom/neu-362-frontend-group-home-feed-by-film-per-day
gh pr create --fill --title "feat: group home feed by film per day (NEU-362)"
```

PR description: summarize the swap (per-event → per-(film,day) via `GET /feed/grouped`), note the `FeedDayCard`/`getFeedGrouped`/`groupByDay` rewrite and the per-event-code deletion, and call out the NEU-364 backend dependency for the live end-to-end check. Append the footer:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Self-review notes (coverage check)

| Spec item | Task |
|---|---|
| `FeedDayItem`/`FeedDayResponse` types | Task 1 |
| `getFeedGrouped` → `GET /feed/grouped` | Task 1 |
| `FeedDayCard` (poster + title + beat + `+{count-1}`, whole-card `<Link>`, null-poster placeholder) | Task 2 |
| `groupByDay` rewritten for the `day`-string shape; `formatDayHeading` reused | Task 3 |
| `feed.tsx` loader/render swap (h1/meta/empty/error unchanged) | Task 3 |
| Tests: API, grouping, card, route loader/render/empty/meta | Tasks 1–3 |
| Delete `getFeed`/`FeedItem`/`FeedResponse`/`FeedItemCard` (+ tests) | Task 4 |
| Gates green, zero ESLint warnings, format touched files | Task 4 + Wrap-up |
| One PR, single commit, footer, Linear ID | Wrap-up |
| NEU-364 dependency called out | Global Constraints + Wrap-up |
