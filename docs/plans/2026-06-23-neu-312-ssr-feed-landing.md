# SSR Feed Landing Page (NEU-312) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public, server-rendered feed landing page at `/` — updates across all films grouped by day (newest first), each linking to its `/film/{slug}` page — and move the authed Home stub to `/app`.

**Architecture:** A sibling of the merged NEU-310 film page. A new public index route (`src/routes/feed.tsx`) under `public-layout` whose loader fetches `GET /feed` (NEU-311) via a new `getFeed` in `src/api/public.ts`, renders `FeedItemCard`s grouped by a pure `groupByDay` helper, and reuses `SourceLinks` / `labels.ts` / `format.ts` untouched. A small routing swap makes `/` the feed and relocates the authed Home to `/app`; the NEU-306 `/preview` placeholder is retired and `PublicLayout` gains a minimal brand header.

**Tech Stack:** React 19, React Router v8 (framework mode, `ssr: true`, Cloudflare Workers), TypeScript, Tailwind v4, Vitest + Testing Library + MSW, pnpm — all driven through `task` in the container.

**Design of record:** `docs/specs/2026-06-23-neu-312-ssr-feed-landing-design.md`. Pattern precedent: the merged NEU-310 film page (`src/routes/film.tsx` + tests) and the NEU-311 feed API plan (`docs/plans/2026-06-22-neu-311-feed-api.md`, the `GET /feed` contract).

---

## Working agreements (read first)

- **All commands run in the container via `task`.** Never run `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the container up (`task up`). Scope tests with `task test -- <path>`.
- **Commits:** Do **NOT** commit per task. NEU-312 ships as **one frontend PR**; the user commits once at the end (Task 6). If executing via subagents, strip any commit step from implementer prompts.
- **TDD, test-first.** Vitest (`import { describe, expect, it } from "vitest"`). MSW runs with `onUnhandledRequest: "error"`; add per-test handlers with `server.use(...)` from `@/test/msw/server`. Backend base URL in tests is `https://api.upmovies.localhost`.
- **ESLint runs at zero warnings — unused imports/vars fail the build.** Import only what you use. Route files that export `loader`/`meta`/`ErrorBoundary` beside the component need the `/* eslint-disable react-refresh/only-export-components ... */` header (see `film.tsx`).
- **Typecheck = `react-router typegen` + `tsc -b`.** A new route module is typed via the generated `./+types/<name>`; it only exists after the route is registered in `routes.ts` and typegen runs (`task typecheck` runs both). Type-only imports are erased by Vite, so Vitest runs green before typegen.
- **Format only what you touch** (`task format`). `AuthContext.*` has pre-existing Prettier drift on `main` — don't reformat unrelated files.
- **Determinism:** all date rendering is `en-US` + `timeZone: "UTC"`. No `Date.now()`, no relative "Today/Yesterday", no locale-dependent output anywhere in the render tree (hydration safety).

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/api/types.ts` | modify | Add `FeedItem` + `FeedResponse` (sources reuse the existing `FilmSource`). |
| `src/api/public.ts` | modify | Add `getFeed(baseUrl, { limit?, offset? })`. |
| `src/api/public.test.ts` | modify | Add `getFeed` tests (200 + query params; 500 throws). |
| `src/lib/format.ts` | modify | Add `dayKey(iso)` + `formatDayHeading(iso)`. |
| `src/lib/format.test.ts` | modify | Add `dayKey` + `formatDayHeading` tests. |
| `src/lib/feed-groups.ts` | create | Pure `groupByDay(items): DayGroup[]`. |
| `src/lib/feed-groups.test.ts` | create | `groupByDay` tests. |
| `src/components/feed/FeedItemCard.tsx` | create | Feed item: film link + beat + confidence + date + summary + `SourceLinks`. |
| `src/components/feed/FeedItemCard.test.tsx` | create | `FeedItemCard` render tests. |
| `src/routes/feed.tsx` | create | Route module: `loader`, `meta`, `FeedPage`, `ErrorBoundary`. |
| `src/routes/feed.test.tsx` | create | Loader, meta, render (day grouping + film links), empty. |
| `src/routes.ts` | modify | Add `index("routes/feed.tsx")`; `index("pages/Home.tsx")` → `route("app", …)`; remove `preview`. |
| `src/routes/preview.tsx`, `src/routes/preview.test.tsx` | delete | Retire the NEU-306 placeholder. |
| `src/routes/public-layout.tsx` | modify | Add a minimal brand header. |
| `src/routes/public-layout.test.tsx` | create | Header renders + links to `/`. |
| `src/pages/Login.tsx` | modify | Post-login default `\|\| "/"` → `\|\| "/app"`. |
| `src/pages/Login.test.tsx` | modify | Default-redirect target → `/app`. |
| `src/pages/Signup.tsx` | modify | `navigate("/")` → `navigate("/app")`. |
| `src/pages/Signup.test.tsx` | modify | Redirect target → `/app`. |
| `src/components/AppLayout.tsx` | modify | Brand `Link to="/"` → `to="/app"`. |
| `src/components/RequireAdmin.tsx` | modify | Non-admin bounce `to="/"` → `to="/app"`. |
| `src/components/RequireAdmin.test.tsx` | modify | Bounce target → `/app`. |

No backend changes, no new env vars, no new dependencies.

---

## Task 1: Feed API client + types

**Files:**
- Modify: `src/api/types.ts`
- Modify: `src/api/public.test.ts`
- Modify: `src/api/public.ts`

- [ ] **Step 1: Add the feed types**

In `src/api/types.ts`, append after the existing `FilmDetail` interface (the file already defines `FilmSource`, reused here):

```ts
export interface FeedItem {
  film_slug: string;
  film_title: string;
  event_type: string;
  confidence: string; // "confirmed" | "rumored" (backend free text; rendered via a map)
  occurred_at: string;
  created_at: string; // the "updated today" axis; the feed is ordered by this, descending
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

- [ ] **Step 2: Write the failing `getFeed` tests**

In `src/api/public.test.ts`, add `getFeed` to the import and append a new `describe`. The full file becomes:

```ts
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { getFeed, getFilm } from "@/api/public";
import type { FeedResponse, FilmDetail } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const sample: FilmDetail = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_date: "2026-07-17",
  release_year: 2026,
  poster_path: "/poster.jpg",
  arc_stage: "trailer",
  events: [],
};

describe("getFilm", () => {
  it("returns the typed film on 200", async () => {
    server.use(http.get(`${BACKEND}/films/the-odyssey-2026`, () => HttpResponse.json(sample)));
    const film = await getFilm(BACKEND, "the-odyssey-2026");
    expect(film?.slug).toBe("the-odyssey-2026");
    expect(film?.arc_stage).toBe("trailer");
  });

  it("returns null on 404", async () => {
    server.use(http.get(`${BACKEND}/films/missing`, () => new HttpResponse(null, { status: 404 })));
    expect(await getFilm(BACKEND, "missing")).toBeNull();
  });

  it("throws on a 500", async () => {
    server.use(http.get(`${BACKEND}/films/boom`, () => new HttpResponse(null, { status: 500 })));
    await expect(getFilm(BACKEND, "boom")).rejects.toThrow(/failed: 500/);
  });
});

const sampleFeed: FeedResponse = {
  items: [
    {
      film_slug: "the-odyssey-2026",
      film_title: "The Odyssey",
      event_type: "casting",
      confidence: "confirmed",
      occurred_at: "2025-03-01T00:00:00Z",
      created_at: "2026-06-23T00:00:00Z",
      summary: "Casting announced.",
      sources: [],
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

describe("getFeed", () => {
  it("returns the typed feed on 200 and sends default limit/offset", async () => {
    let captured: URL | undefined;
    server.use(
      http.get(`${BACKEND}/feed`, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json(sampleFeed);
      }),
    );
    const feed = await getFeed(BACKEND);
    expect(feed.total).toBe(1);
    expect(feed.items[0].film_slug).toBe("the-odyssey-2026");
    expect(captured?.searchParams.get("limit")).toBe("50");
    expect(captured?.searchParams.get("offset")).toBe("0");
  });

  it("throws on a 500", async () => {
    server.use(http.get(`${BACKEND}/feed`, () => new HttpResponse(null, { status: 500 })));
    await expect(getFeed(BACKEND)).rejects.toThrow(/failed: 500/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `task test -- src/api/public.test.ts`
Expected: FAIL — `getFeed` is not exported from `@/api/public`.

- [ ] **Step 4: Implement `getFeed`**

In `src/api/public.ts`, add the import for `FeedResponse` and append the function. The import line becomes:

```ts
import type { FeedResponse, FilmDetail } from "./types";
```

Append:

```ts
/**
 * Fetch the global "updated today" feed from the no-auth backend. The base URL is injected by
 * the caller (the SSR loader reads it from the Worker env), so this stays pure and runs in the
 * Workers runtime and under test. The feed always responds 200 (no 404 branch); throws on any
 * non-OK response.
 */
export async function getFeed(
  baseUrl: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<FeedResponse> {
  const url = new URL("/feed", baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET /feed failed: ${res.status}`);
  return (await res.json()) as FeedResponse;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- src/api/public.test.ts`
Expected: PASS (the existing `getFilm` tests plus the two new `getFeed` tests).

---

## Task 2: Date helpers + day grouping

**Files:**
- Modify: `src/lib/format.ts`
- Modify: `src/lib/format.test.ts`
- Create: `src/lib/feed-groups.ts`
- Create: `src/lib/feed-groups.test.ts`

- [ ] **Step 1: Write the failing date-helper tests**

In `src/lib/format.test.ts`, extend the imports and append two `describe` blocks. The import line becomes:

```ts
import { dayKey, formatDayHeading, formatEventDate, truncate } from "@/lib/format";
```

Append at the end of the file:

```ts
describe("dayKey", () => {
  it("returns the UTC calendar date as YYYY-MM-DD", () => {
    expect(dayKey("2026-06-23T10:00:00Z")).toBe("2026-06-23");
  });

  it("uses UTC so a late-UTC time does not roll into the next day", () => {
    expect(dayKey("2026-06-23T23:59:00Z")).toBe("2026-06-23");
  });
});

describe("formatDayHeading", () => {
  it("formats a UTC day as a long weekday + date", () => {
    expect(formatDayHeading("2025-03-14T00:00:00Z")).toContain("March 14, 2025");
  });

  it("uses UTC so a late-UTC time keeps the same day", () => {
    expect(formatDayHeading("2025-03-14T23:30:00Z")).toContain("March 14, 2025");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- src/lib/format.test.ts`
Expected: FAIL — `dayKey` / `formatDayHeading` are not exported.

- [ ] **Step 3: Implement the date helpers**

In `src/lib/format.ts`, append after the existing `DATE_FMT` / `formatEventDate`:

```ts
const DAY_HEADING_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** The UTC calendar date of an ISO instant, as "YYYY-MM-DD". Used for day bucketing + keys. */
export function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** A human day heading in UTC, e.g. "Monday, June 23, 2026". */
export function formatDayHeading(iso: string): string {
  return DAY_HEADING_FMT.format(new Date(iso));
}
```

- [ ] **Step 4: Run the date-helper tests to verify they pass**

Run: `task test -- src/lib/format.test.ts`
Expected: PASS (existing `formatEventDate` / `truncate` tests plus the four new ones).

- [ ] **Step 5: Write the failing `groupByDay` tests**

Create `src/lib/feed-groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupByDay } from "@/lib/feed-groups";
import type { FeedItem } from "@/api/types";

function item(created_at: string, summary: string): FeedItem {
  return {
    film_slug: "f",
    film_title: "F",
    event_type: "casting",
    confidence: "confirmed",
    occurred_at: created_at,
    created_at,
    summary,
    sources: [],
  };
}

describe("groupByDay", () => {
  it("returns an empty array for no items", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("buckets same-UTC-day items into one group, preserving input order", () => {
    const groups = groupByDay([
      item("2026-06-23T10:00:00Z", "newest"),
      item("2026-06-23T01:00:00Z", "same day, older"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].dayKey).toBe("2026-06-23");
    expect(groups[0].items.map((i) => i.summary)).toEqual(["newest", "same day, older"]);
  });

  it("opens a new group on a day boundary, keeping groups newest-first", () => {
    const groups = groupByDay([
      item("2026-06-23T10:00:00Z", "today a"),
      item("2026-06-23T01:00:00Z", "today b"),
      item("2026-06-22T23:00:00Z", "yesterday"),
    ]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-06-23", "2026-06-22"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items.map((i) => i.summary)).toEqual(["yesterday"]);
    expect(groups[1].heading).toContain("June 22, 2026");
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `task test -- src/lib/feed-groups.test.ts`
Expected: FAIL — `@/lib/feed-groups` does not exist.

- [ ] **Step 7: Implement `groupByDay`**

Create `src/lib/feed-groups.ts`:

```ts
import type { FeedItem } from "@/api/types";
import { dayKey, formatDayHeading } from "@/lib/format";

export interface DayGroup {
  /** UTC "YYYY-MM-DD" — a stable React key for the day section. */
  dayKey: string;
  /** Human heading, e.g. "Monday, June 23, 2026". */
  heading: string;
  items: FeedItem[];
}

/**
 * Bucket a `created_at`-descending feed into per-UTC-day groups. The input order is preserved,
 * so groups come out newest-day-first and items stay newest-first within a day — no sorting and
 * no `Date.now()`, keeping SSR and client output identical.
 */
export function groupByDay(items: FeedItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const key = dayKey(item.created_at);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === key) {
      last.items.push(item);
    } else {
      groups.push({ dayKey: key, heading: formatDayHeading(item.created_at), items: [item] });
    }
  }
  return groups;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `task test -- src/lib/feed-groups.test.ts`
Expected: PASS (3 tests).

---

## Task 3: FeedItemCard

**Files:**
- Create: `src/components/feed/FeedItemCard.tsx`
- Create: `src/components/feed/FeedItemCard.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/components/feed/FeedItemCard.test.tsx` (the card uses `<Link>`, so it renders inside a `MemoryRouter`):

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeedItemCard } from "@/components/feed/FeedItemCard";
import type { FeedItem } from "@/api/types";

const item: FeedItem = {
  film_slug: "the-odyssey-2026",
  film_title: "The Odyssey",
  event_type: "release_date",
  confidence: "confirmed",
  occurred_at: "2025-03-01T00:00:00Z",
  created_at: "2026-06-23T00:00:00Z",
  summary: "Studio sets a July 17 theatrical release.",
  sources: [{ url: "https://thr.com/a", source: "THR", title: "Dated", published_at: null }],
};

function renderCard(overrides: Partial<FeedItem> = {}) {
  render(
    <MemoryRouter>
      <FeedItemCard item={{ ...item, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("FeedItemCard", () => {
  it("links the film title to its film page and shows beat, confidence, date, summary, sources", () => {
    renderCard();
    const filmLink = screen.getByRole("link", { name: "The Odyssey" });
    expect(filmLink).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("Release date")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Jun 23, 2026")).toBeInTheDocument();
    expect(screen.getByText(/July 17 theatrical release/)).toBeInTheDocument();
    const source = screen.getByRole("link", { name: "THR" });
    expect(source).toHaveAttribute("href", "https://thr.com/a");
    expect(source).toHaveAttribute("target", "_blank");
    expect(source.getAttribute("rel")).toContain("noopener");
  });

  it("renders rumored confidence", () => {
    renderCard({ confidence: "rumored" });
    expect(screen.getByText("Rumored")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- src/components/feed/FeedItemCard.test.tsx`
Expected: FAIL — `@/components/feed/FeedItemCard` does not exist.

- [ ] **Step 3: Implement `FeedItemCard`**

Create `src/components/feed/FeedItemCard.tsx`. It reuses `SourceLinks`, `eventTypeLabel`, `formatEventDate`, and `cn`; the beat + confidence badge markup is intentionally duplicated from `EventCard` (whose `ConfidenceBadge` is module-local) so the shipped film code is untouched:

```tsx
import { Link } from "react-router";
import type { FeedItem } from "@/api/types";
import { cn } from "@/lib/cn";
import { formatEventDate } from "@/lib/format";
import { eventTypeLabel } from "@/components/film/labels";
import { SourceLinks } from "@/components/film/SourceLinks";

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const known = confidence === "confirmed" || confidence === "rumored";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        confidence === "confirmed" && "bg-green-100 text-green-800",
        confidence === "rumored" && "bg-amber-100 text-amber-800",
        !known && "bg-gray-100 text-gray-700",
      )}
    >
      {confidence === "confirmed" ? "Confirmed" : confidence === "rumored" ? "Rumored" : confidence}
    </span>
  );
}

/** One feed item: the film (linked to its page), its beat, confidence, date, summary, sources. */
export function FeedItemCard({ item }: { item: FeedItem }) {
  return (
    <article className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-indigo-800">
          {eventTypeLabel(item.event_type)}
        </span>
        <ConfidenceBadge confidence={item.confidence} />
        <time dateTime={item.created_at} className="ml-auto text-gray-400">
          {formatEventDate(item.created_at)}
        </time>
      </div>
      <h3 className="mt-2 text-base font-semibold">
        <Link to={`/film/${item.film_slug}`} className="hover:underline">
          {item.film_title}
        </Link>
      </h3>
      <p className="mt-1 text-sm leading-relaxed">{item.summary}</p>
      <SourceLinks sources={item.sources} />
    </article>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- src/components/feed/FeedItemCard.test.tsx`
Expected: PASS (2 tests).

---

## Task 4: Feed route + wire `/` as the public index

**Files:**
- Create: `src/routes/feed.tsx`
- Create: `src/routes/feed.test.tsx`
- Modify: `src/routes.ts`
- Delete: `src/routes/preview.tsx`, `src/routes/preview.test.tsx`

- [ ] **Step 1: Write the failing feed-route tests**

Create `src/routes/feed.test.tsx` (mirrors `film.test.tsx`: direct loader/meta calls with a `cloudflareContext` stub, and a `createRoutesStub` render):

```tsx
import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import FeedPage, { loader, meta } from "@/routes/feed";
import type { FeedResponse } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const feed: FeedResponse = {
  items: [
    {
      film_slug: "the-odyssey-2026",
      film_title: "The Odyssey",
      event_type: "trailer",
      confidence: "confirmed",
      occurred_at: "2026-06-01T00:00:00Z",
      created_at: "2026-06-23T10:00:00Z",
      summary: "Trailer dropped.",
      sources: [
        { url: "https://deadline.com/a", source: "Deadline", title: "Trailer", published_at: null },
      ],
    },
    {
      film_slug: "dune-3-2026",
      film_title: "Dune Part Three",
      event_type: "casting",
      confidence: "rumored",
      occurred_at: "2025-03-01T00:00:00Z",
      created_at: "2026-06-22T09:00:00Z",
      summary: "New cast rumored.",
      sources: [],
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
  it("fetches the feed from the backend", async () => {
    server.use(http.get(`${BACKEND}/feed`, () => HttpResponse.json(feed)));
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
  it("groups items by day (newest first) and links each to its film page", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: FeedPage, loader: () => ({ feed }) }]);
    render(<Stub initialEntries={["/"]} />);

    expect(await screen.findByRole("heading", { name: "Latest Updates" })).toBeInTheDocument();
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/June 22, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Trailer dropped.")).toBeInTheDocument();
    expect(screen.getByText("New cast rumored.")).toBeInTheDocument();
    const filmLink = screen.getByRole("link", { name: "The Odyssey" });
    expect(filmLink).toHaveAttribute("href", "/film/the-odyssey-2026");
  });

  it("shows the empty state when there are no updates", async () => {
    const Stub = createRoutesStub([
      { path: "/", Component: FeedPage, loader: () => ({ feed: { ...feed, items: [], total: 0 } }) },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(await screen.findByText(/no updates yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- src/routes/feed.test.tsx`
Expected: FAIL — `@/routes/feed` does not exist.

- [ ] **Step 3: Implement the feed route module**

Create `src/routes/feed.tsx`:

```tsx
/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { Link } from "react-router";
import type { Route } from "./+types/feed";
import { getFeed } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { buildMeta } from "@/lib/seo";
import { groupByDay } from "@/lib/feed-groups";
import { FeedItemCard } from "@/components/feed/FeedItemCard";

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const feed = await getFeed(env.API_BASE_URL);
  return { feed };
}

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Latest Updates",
    description:
      "The latest casting, trailers, release dates, and production updates across every movie we track.",
    pathname: location.pathname,
    type: "website",
  });
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { feed } = loaderData;
  const groups = groupByDay(feed.items);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Latest Updates</h1>
      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">No updates yet — check back soon.</p>
      ) : (
        groups.map((group) => (
          <section key={group.dayKey} className="mt-8">
            <h2 className="text-sm font-medium text-gray-500">
              <time dateTime={group.dayKey}>{group.heading}</time>
            </h2>
            <div className="mt-3 space-y-4">
              {group.items.map((item, i) => (
                <FeedItemCard key={`${item.film_slug}-${item.created_at}-${i}`} item={item} />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-gray-500">
        We couldn&apos;t load the latest updates. Please try again in a moment.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Reload
      </Link>
    </main>
  );
}
```

- [ ] **Step 4: Wire the route + retire `/preview` in `routes.ts`**

In `src/routes.ts`, edit the two `layout(...)` blocks. Replace:

```ts
  layout("routes/public-layout.tsx", [
    route("preview", "routes/preview.tsx"),
    route("film/:slug", "routes/film.tsx"),
  ]),

  layout("routes/spa-layout.tsx", [
    route("login", "pages/Login.tsx"),
    route("signup", "pages/Signup.tsx"),
    layout("components/RequireAuth.tsx", [
      layout("components/AppLayout.tsx", [
        index("pages/Home.tsx"),
        layout("components/RequireAdmin.tsx", [route("admin/ingest", "pages/AdminIngest.tsx")]),
      ]),
    ]),
  ]),
```

with:

```ts
  layout("routes/public-layout.tsx", [
    index("routes/feed.tsx"),
    route("film/:slug", "routes/film.tsx"),
  ]),

  layout("routes/spa-layout.tsx", [
    route("login", "pages/Login.tsx"),
    route("signup", "pages/Signup.tsx"),
    layout("components/RequireAuth.tsx", [
      layout("components/AppLayout.tsx", [
        route("app", "pages/Home.tsx"),
        layout("components/RequireAdmin.tsx", [route("admin/ingest", "pages/AdminIngest.tsx")]),
      ]),
    ]),
  ]),
```

(`index`, `route`, and `layout` are already imported at the top of `routes.ts`.)

- [ ] **Step 5: Delete the retired placeholder + confirm nothing else references it**

Run:

```bash
rm src/routes/preview.tsx src/routes/preview.test.tsx
grep -rn "preview" src || echo "no remaining preview references"
```

Expected: the `grep` prints `no remaining preview references` (the only references were the deleted files and the now-removed `routes.ts` line).

- [ ] **Step 6: Run the feed tests + typecheck to verify green**

Run: `task test -- src/routes/feed.test.tsx`
Expected: PASS (loader, meta, render, empty).

Run: `task typecheck`
Expected: `react-router typegen` regenerates route types (incl. `./+types/feed`, drops `./+types/preview`), then `tsc -b` reports 0 errors.

---

## Task 5: `/app` redirect retargets + public header

**Files:**
- Modify: `src/pages/Login.tsx`, `src/pages/Login.test.tsx`
- Modify: `src/pages/Signup.tsx`, `src/pages/Signup.test.tsx`
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/components/RequireAdmin.tsx`, `src/components/RequireAdmin.test.tsx`
- Modify: `src/routes/public-layout.tsx`
- Create: `src/routes/public-layout.test.tsx`

- [ ] **Step 1: Update the redirect-target tests (fail first)**

In `src/pages/Login.test.tsx`, in the `renderAt` helper change the catch route and update the first test. Replace:

```tsx
            <Route path="/" element={<div>home page</div>} />
```

(inside `renderAt`) with:

```tsx
            <Route path="/app" element={<div>app home</div>} />
```

Then rename the first test and its assertion — replace:

```tsx
  it("logs in and redirects to /", async () => {
```

with:

```tsx
  it("logs in and redirects to /app", async () => {
```

and, in that same test, replace:

```tsx
    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
```

with:

```tsx
    await waitFor(() => expect(screen.getByText("app home")).toBeInTheDocument());
```

Leave the `"honours the ?next= redirect parameter"` test untouched — it sets `next=%2F` and asserts navigation to its own `/` route, which still proves `next` wins over the default.

In `src/pages/Signup.test.tsx`, in `renderAt` replace:

```tsx
            <Route path="/" element={<div>home page</div>} />
```

with:

```tsx
            <Route path="/app" element={<div>app home</div>} />
```

Rename the first test — replace:

```tsx
  it("creates an account and redirects to /", async () => {
```

with:

```tsx
  it("creates an account and redirects to /app", async () => {
```

and its assertion — replace:

```tsx
    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
```

with:

```tsx
    await waitFor(() => expect(screen.getByText("app home")).toBeInTheDocument());
```

and the negative assertion in `"blocks submit when invite code is empty"` — replace:

```tsx
    expect(screen.queryByText("home page")).not.toBeInTheDocument();
```

with:

```tsx
    expect(screen.queryByText("app home")).not.toBeInTheDocument();
```

In `src/components/RequireAdmin.test.tsx`, in `renderAtAdmin` replace:

```tsx
            <Route path="/" element={<div>home page</div>} />
```

with:

```tsx
            <Route path="/app" element={<div>app home</div>} />
```

Rename the redirect test — replace:

```tsx
  it("redirects a non-admin to /", async () => {
```

with:

```tsx
  it("redirects a non-admin to /app", async () => {
```

and its assertion — replace:

```tsx
    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
```

with:

```tsx
    await waitFor(() => expect(screen.getByText("app home")).toBeInTheDocument());
```

- [ ] **Step 2: Run the updated tests to verify they fail**

Run: `task test -- src/pages/Login.test.tsx src/pages/Signup.test.tsx src/components/RequireAdmin.test.tsx`
Expected: FAIL — the redirects still land on `/`, so `"app home"` is never rendered (the first Login/Signup tests and the RequireAdmin non-admin test fail).

- [ ] **Step 3: Retarget the redirects to `/app`**

In `src/pages/Login.tsx`, replace:

```tsx
      const next = params.get("next") || "/";
```

with:

```tsx
      const next = params.get("next") || "/app";
```

In `src/pages/Signup.tsx`, replace:

```tsx
      navigate("/");
```

with:

```tsx
      navigate("/app");
```

In `src/components/AppLayout.tsx`, replace:

```tsx
          <Link to="/" className="font-semibold">
```

with:

```tsx
          <Link to="/app" className="font-semibold">
```

In `src/components/RequireAdmin.tsx`, replace:

```tsx
  if (!user?.is_admin) return <Navigate to="/" replace />;
```

with:

```tsx
  if (!user?.is_admin) return <Navigate to="/app" replace />;
```

- [ ] **Step 4: Run the redirect tests to verify they pass**

Run: `task test -- src/pages/Login.test.tsx src/pages/Signup.test.tsx src/components/RequireAdmin.test.tsx`
Expected: PASS. (`AppLayout.test.tsx` does not assert the brand `href`, so it is unaffected — no edit needed there.)

- [ ] **Step 5: Write the failing public-header test**

Create `src/routes/public-layout.test.tsx` (uses the `AppLayout.test` layout-with-index pattern so `<Outlet/>` resolves):

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import PublicLayout from "@/routes/public-layout";

describe("PublicLayout", () => {
  it("renders a brand wordmark linking to the feed root and the routed child", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<p>page body</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const brand = screen.getByRole("link", { name: /upcoming movies tracker/i });
    expect(brand).toHaveAttribute("href", "/");
    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `task test -- src/routes/public-layout.test.tsx`
Expected: FAIL — there is no brand link in `PublicLayout` yet.

- [ ] **Step 7: Add the minimal public header**

Replace the entire contents of `src/routes/public-layout.tsx` with:

```tsx
import { Link, Outlet } from "react-router";

/** Unauthenticated, server-rendered public shell: a minimal brand header + the routed page. */
export default function PublicLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto max-w-4xl p-4">
          <Link to="/" className="font-semibold">
            Upcoming Movies Tracker
          </Link>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `task test -- src/routes/public-layout.test.tsx`
Expected: PASS.

---

## Task 6: Full verification + handoff

**Files:** none (verification only).

- [ ] **Step 1: Format touched files**

Run: `task format`
Expected: Prettier rewrites/leaves the touched files clean. Do not stage unrelated `AuthContext.*` drift.

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: `eslint src --max-warnings 0` passes with no warnings (no unused imports).

- [ ] **Step 3: Typecheck**

Run: `task typecheck`
Expected: `react-router typegen` + `tsc -b` report 0 errors.

- [ ] **Step 4: Full test suite**

Run: `task test`
Expected: the entire Vitest suite passes — the new feed/grouping/card/route/header tests plus the updated Login/Signup/RequireAdmin redirect tests and all untouched suites.

- [ ] **Step 5: Hand off for commit (user)**

Do **not** commit from within task execution. Report the green gates to the user. The user commits the whole NEU-312 change as **one PR** off the ticket branch `tom/neu-312-frontend-ssr-feed-landing-page`, using `/commit-msg` (Conventional Commits subject, no Linear ID, no Claude `Co-Authored-By`) and `/pr-desc` (PR title carries `(NEU-312)`). Pre-commit hooks delegate into the container — commit normally with the container up.

---

## Self-review

**Spec coverage** (`docs/specs/2026-06-23-neu-312-ssr-feed-landing-design.md`):
- SSR public landing at `/` on the public layout; loader fetches `GET /feed` → Task 4 (`feed.tsx` `loader` + `routes.ts` `index("routes/feed.tsx")`); asserted by `feed.test.tsx` loader test.
- Public root becomes the feed; authed Home moves aside to `/app` → Task 4 (`routes.ts` `index("pages/Home.tsx")` → `route("app", …)`) + Task 5 (redirect retargets + tests).
- Updates grouped by day, newest first → Task 2 (`groupByDay`) + Task 4 (`FeedPage` day sections); asserted by `feed-groups.test.ts` + `feed.test.tsx` render test.
- Each item shows film, neutral summary, beat + confidence, links to `/film/{slug}` → Task 3 (`FeedItemCard`); asserted by `FeedItemCard.test.tsx` + the render test's film-link assertion.
- `<title>`/meta/OG → Task 4 (`meta` via `buildMeta`, `type: "website"`); asserted by the meta test.
- Pagination (or recent window) → recent window: `getFeed` defaults (limit 50, offset 0), no pagination UI (Task 1 + Task 4 loader).
- Empty state → Task 4 (`FeedPage` `groups.length === 0`); asserted by the empty render test.
- API client + types for the feed endpoint → Task 1 (`getFeed` + `FeedItem`/`FeedResponse`).
- Retire `/preview` → Task 4 Step 4–5. Minimal public header → Task 5 Step 5–8.
- Tests: Vitest + MSW cover loader + render (day grouping, film links, empty); `tsc -b` + eslint green → Tasks 1–5 per-task; Task 6 gates.

**Placeholder scan:** none — every code/test step contains complete code and exact `task` commands with expected output. No "TBD"/"add error handling"/"similar to Task N".

**Type/name consistency:** `getFeed(baseUrl, { limit?, offset? })` (Task 1) is called as `getFeed(env.API_BASE_URL)` in the loader (Task 4). `FeedResponse`/`FeedItem` (Task 1) are constructed in tests and consumed by `groupByDay` (Task 2), `FeedItemCard` (Task 3), and `feed.tsx` (Task 4) with matching field names (`film_slug`, `film_title`, `event_type`, `confidence`, `occurred_at`, `created_at`, `summary`, `sources`). `DayGroup` fields `dayKey`/`heading`/`items` (Task 2) are read identically in `FeedPage` (Task 4). `dayKey`/`formatDayHeading` (Task 2) are imported by `feed-groups.ts` (Task 2) and tested by name. `FeedItemCard` (Task 3) is imported by `feed.tsx` (Task 4). The `routes.ts` swap (Task 4) and the redirect code (Task 5, `/app`) agree with the updated tests' `/app` / `app home` strings. `SourceLinks` / `eventTypeLabel` / `formatEventDate` / `cn` are reused from their existing shipped modules; no shipped file is modified except the four `/app`-swap files and `public-layout.tsx`.
