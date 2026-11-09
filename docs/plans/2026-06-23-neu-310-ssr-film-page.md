# SSR Film Update-Log Page (NEU-310) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public, crawlable per-movie update-log page at `/film/{slug}` — a status-arc indicator over a chronological event timeline with outbound source links, server-rendered on the existing React Router + Cloudflare Workers stack.

**Architecture:** A server `loader` reads the backend base URL from the Worker env (`cloudflareContext`) and fetches `GET /films/{slug}` via a new typed `getFilm` helper. The route module renders a `FilmHeader` (poster + title + `ArcStepper`) and an `EventTimeline` of `EventCard`s; 404s throw a `Response` handled by a route-level `ErrorBoundary`. Per-film `<title>`/meta/OG come from the existing `buildMeta` helper.

**Tech Stack:** React 19, React Router v8 (framework mode, `ssr: true`), TypeScript, Tailwind v4, Vitest + Testing Library + MSW. Everything runs in the container via `task` (no host Node/pnpm).

**Design of record:** `docs/specs/2026-06-23-neu-310-ssr-film-page-design.md`.

---

## Working agreements (read first)

- **All commands run in the container via `task`.** Never run `pnpm`/`vitest`/`eslint`/`tsc` on the host. Keep the container up (`task up`). Scope a test run with `task test -- <path>`.
- **Commits:** Do **NOT** commit per task. NEU-310 ships as **one PR** (in the `upcoming-movies-frontend` git repo). The user commits once at the end (Task 6). If executing via subagents, strip any commit step from implementer prompts.
- **TDD, test-first.** Write the failing test, watch it fail, implement the minimum, watch it pass.
- **Type-only imports must use `import type { … }`** — `@typescript-eslint/consistent-type-imports` is an error.
- **Route modules** (`film.tsx`) export `loader`/`meta`/`ErrorBoundary` alongside the component, which trips `react-refresh/only-export-components`. Start the file with the same disable comment `preview.tsx` uses (shown in Task 5).
- **ESLint runs at zero warnings** (`--max-warnings 0`); unused imports fail. `src/components/ui/**` is lint-ignored, but nothing here lives there.
- **MSW** intercepts HTTP with `onUnhandledRequest: "error"`; every test that fetches must register a handler with `server.use(...)`. The backend base in tests is `https://api.upmovies.localhost` (the `@/env` default), which is also what the loader's injected `API_BASE_URL` is set to in tests.
- **Render tests** use `createRoutesStub` (see `preview.test.tsx`); **loader tests** build a context with `RouterContextProvider` + `cloudflareContext` (see `sitemap.test.ts`).

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/env.ts` | modify | Add `tmdbImageBase` (`VITE_TMDB_IMAGE_BASE`). |
| `.env.example` | modify | Document `VITE_TMDB_IMAGE_BASE`. |
| `src/lib/poster.ts` (+ `poster.test.ts`) | create | `posterUrl(path, size)` → TMDB CDN URL or `null`. |
| `src/lib/format.ts` (+ `format.test.ts`) | create | `formatEventDate(iso)` (UTC/`en-US`); `truncate(text, max)`. |
| `src/api/types.ts` | modify | Add `ArcStage`, `FilmSource`, `FilmEvent`, `FilmDetail`. |
| `src/api/public.ts` (+ `public.test.ts`) | create | `getFilm(baseUrl, slug)` typed fetcher. |
| `src/components/film/labels.ts` | create | `ARC_STAGES`, `ARC_STAGE_LABELS`, `eventTypeLabel`. |
| `src/components/film/ArcStepper.tsx` (+ test) | create | The dotted-stepper status arc. |
| `src/components/film/FilmHeader.tsx` (+ test) | create | Poster + title + year + `ArcStepper`. |
| `src/components/film/SourceLinks.tsx` (+ test) | create | Outbound source anchors. |
| `src/components/film/EventCard.tsx` (+ test) | create | One event: beat + confidence + date + summary + sources. |
| `src/components/film/EventTimeline.tsx` (+ test) | create | Event list (ascending) + empty state. |
| `src/routes/film.tsx` (+ `film.test.tsx`) | create | Route module: `loader`, `meta`, `FilmPage`, `ErrorBoundary`. |
| `src/routes.ts` | modify | Register `route("film/:slug", "routes/film.tsx")` under `public-layout`. |

---

## Task 1: TMDB config + leaf helpers (`posterUrl`, `formatEventDate`, `truncate`)

**Files:**
- Modify: `src/env.ts`
- Modify: `.env.example`
- Create: `src/lib/poster.ts`
- Test: `src/lib/poster.test.ts`
- Create: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

- [ ] **Step 1: Add the TMDB image base to config**

Replace the contents of `src/env.ts` with:

```ts
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "https://api.upmovies.localhost",
  publicSiteUrl: import.meta.env.VITE_PUBLIC_SITE_URL ?? "https://app.upmovies.localhost",
  tmdbImageBase: import.meta.env.VITE_TMDB_IMAGE_BASE ?? "https://image.tmdb.org/t/p",
} as const;
```

In `.env.example`, add after the `VITE_PUBLIC_SITE_URL` line:

```
VITE_TMDB_IMAGE_BASE=https://image.tmdb.org/t/p
```

- [ ] **Step 2: Write the failing poster test**

Create `src/lib/poster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { posterUrl } from "@/lib/poster";

describe("posterUrl", () => {
  it("builds a TMDB URL from a path and size", () => {
    expect(posterUrl("/abc.jpg", "w342")).toBe("https://image.tmdb.org/t/p/w342/abc.jpg");
  });

  it("returns null when the path is null", () => {
    expect(posterUrl(null, "w342")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `task test -- src/lib/poster.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/poster"` (module does not exist).

- [ ] **Step 4: Implement `posterUrl`**

Create `src/lib/poster.ts`:

```ts
import { env } from "@/env";

/** Build a TMDB image URL from a stored poster path (e.g. "/abc.jpg"). Null path → null. */
export function posterUrl(path: string | null, size: string): string | null {
  if (!path) return null;
  return `${env.tmdbImageBase}/${size}${path}`;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `task test -- src/lib/poster.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Write the failing format test**

Create `src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatEventDate, truncate } from "@/lib/format";

describe("formatEventDate", () => {
  it("formats an ISO timestamp as 'Mon D, YYYY'", () => {
    expect(formatEventDate("2025-03-14T00:00:00Z")).toBe("Mar 14, 2025");
  });

  it("uses UTC so a late-UTC time does not roll the day", () => {
    expect(formatEventDate("2025-03-14T23:30:00Z")).toBe("Mar 14, 2025");
  });
});

describe("truncate", () => {
  it("leaves short text unchanged", () => {
    expect(truncate("short enough", 155)).toBe("short enough");
  });

  it("cuts long text on a word boundary and appends an ellipsis", () => {
    const long = `${"a".repeat(10)} ${"b".repeat(200)}`;
    const out = truncate(long, 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `task test -- src/lib/format.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/format"`.

- [ ] **Step 8: Implement the formatters**

Create `src/lib/format.ts`:

```ts
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Format an ISO timestamp as e.g. "Mar 14, 2025". Fixed locale + UTC so SSR and client agree. */
export function formatEventDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}

/** Truncate to `max` chars on a word boundary, appending an ellipsis when cut. */
export function truncate(text: string, max = 155): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `task test -- src/lib/format.test.ts`
Expected: PASS (4 passed).

---

## Task 2: DTO types + public API fetcher (`getFilm`)

**Files:**
- Modify: `src/api/types.ts`
- Create: `src/api/public.ts`
- Test: `src/api/public.test.ts`

- [ ] **Step 1: Write the failing fetcher test**

Create `src/api/public.test.ts`:

```ts
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { getFilm } from "@/api/public";
import type { FilmDetail } from "@/api/types";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `task test -- src/api/public.test.ts`
Expected: FAIL — `Failed to resolve import "@/api/public"`, and `FilmDetail` is not exported from `@/api/types`.

- [ ] **Step 3: Add the DTO types**

Append to `src/api/types.ts`:

```ts
export type ArcStage =
  | "announced"
  | "cast"
  | "shooting"
  | "wrapped"
  | "dated"
  | "trailer"
  | "released";

export interface FilmSource {
  url: string;
  source: string;
  title: string;
  published_at: string | null;
}

export interface FilmEvent {
  event_type: string;
  confidence: string; // "confirmed" | "rumored" (backend free text; rendered via a map)
  occurred_at: string;
  summary: string;
  sources: FilmSource[];
}

export interface FilmDetail {
  slug: string;
  title: string;
  release_date: string | null;
  release_year: number | null;
  poster_path: string | null;
  arc_stage: ArcStage;
  events: FilmEvent[];
}
```

- [ ] **Step 4: Implement `getFilm`**

Create `src/api/public.ts`:

```ts
import type { FilmDetail } from "./types";

/**
 * Fetch a film's public detail from the no-auth backend. The base URL is injected by the
 * caller (the SSR loader reads it from the Worker env), so this stays pure and runs in the
 * Workers runtime and under test. No credentials/CSRF — the public API is unauthenticated.
 * Returns null on 404; throws on any other non-OK response.
 */
export async function getFilm(baseUrl: string, slug: string): Promise<FilmDetail | null> {
  const res = await fetch(new URL(`/films/${encodeURIComponent(slug)}`, baseUrl), {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /films/${slug} failed: ${res.status}`);
  return (await res.json()) as FilmDetail;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `task test -- src/api/public.test.ts`
Expected: PASS (3 passed).

---

## Task 3: Labels, `ArcStepper`, and `FilmHeader`

**Files:**
- Create: `src/components/film/labels.ts`
- Create: `src/components/film/ArcStepper.tsx`
- Test: `src/components/film/ArcStepper.test.tsx`
- Create: `src/components/film/FilmHeader.tsx`
- Test: `src/components/film/FilmHeader.test.tsx`

- [ ] **Step 1: Create the labels module**

Create `src/components/film/labels.ts`:

```ts
import type { ArcStage } from "@/api/types";

/** The canonical arc, ascending — mirrors the backend's derivation order. */
export const ARC_STAGES: readonly ArcStage[] = [
  "announced",
  "cast",
  "shooting",
  "wrapped",
  "dated",
  "trailer",
  "released",
];

/** Display label for each arc stage. */
export const ARC_STAGE_LABELS: Record<ArcStage, string> = {
  announced: "Announced",
  cast: "Cast",
  shooting: "Shooting",
  wrapped: "Wrapped",
  dated: "Dated",
  trailer: "Trailer",
  released: "Released",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  announced: "Announced",
  casting: "Casting",
  production_start: "Production start",
  production_wrap: "Production wrap",
  release_date: "Release date",
  trailer: "Trailer",
  other: "Update",
};

/** Display label for an event's beat (event_type). Unknown types fall back to title case. */
export function eventTypeLabel(eventType: string): string {
  return (
    EVENT_TYPE_LABELS[eventType] ??
    eventType
      .split(/[_\s]+/)
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
      .join(" ")
  );
}
```

- [ ] **Step 2: Write the failing `ArcStepper` test**

Create `src/components/film/ArcStepper.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArcStepper } from "@/components/film/ArcStepper";

describe("ArcStepper", () => {
  it("renders all seven named stages", () => {
    render(<ArcStepper current="trailer" />);
    for (const label of [
      "Announced",
      "Cast",
      "Shooting",
      "Wrapped",
      "Dated",
      "Trailer",
      "Released",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("highlights exactly the current stage", () => {
    render(<ArcStepper current="trailer" />);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(screen.getByText("Trailer")).toHaveClass("text-blue-600");
    expect(screen.getByText("Cast")).not.toHaveClass("text-blue-600");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `task test -- src/components/film/ArcStepper.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/film/ArcStepper"`.

- [ ] **Step 4: Implement `ArcStepper`**

Create `src/components/film/ArcStepper.tsx`:

```tsx
import type { ArcStage } from "@/api/types";
import { cn } from "@/lib/cn";
import { ARC_STAGES, ARC_STAGE_LABELS } from "./labels";

/** The 7-stage status arc as a dotted stepper, with the current stage highlighted. */
export function ArcStepper({ current }: { current: ArcStage }) {
  const currentIndex = ARC_STAGES.indexOf(current);
  return (
    <ol className="flex items-start gap-1 overflow-x-auto py-2" aria-label="Production status">
      {ARC_STAGES.map((stage, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          <li key={stage} className="flex min-w-14 flex-1 flex-col items-center gap-1">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "h-3 w-3 rounded-full",
                state === "done" && "bg-gray-500",
                state === "current" && "bg-blue-600 ring-4 ring-blue-600/25",
                state === "upcoming" && "bg-gray-300",
              )}
            />
            <span
              className={cn(
                "text-[10px]",
                state === "current" ? "font-semibold text-blue-600" : "text-gray-500",
              )}
            >
              {ARC_STAGE_LABELS[stage]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `task test -- src/components/film/ArcStepper.test.tsx`
Expected: PASS (2 passed).

- [ ] **Step 6: Write the failing `FilmHeader` test**

Create `src/components/film/FilmHeader.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilmHeader } from "@/components/film/FilmHeader";
import type { FilmDetail } from "@/api/types";

const film: FilmDetail = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_date: "2026-07-17",
  release_year: 2026,
  poster_path: "/poster.jpg",
  arc_stage: "shooting",
  events: [],
};

describe("FilmHeader", () => {
  it("renders the title, year, poster, and arc", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /the odyssey poster/i })).toHaveAttribute(
      "src",
      "https://image.tmdb.org/t/p/w342/poster.jpg",
    );
    expect(screen.getByLabelText("Production status")).toBeInTheDocument();
  });

  it("omits the poster when none is set", () => {
    render(<FilmHeader film={{ ...film, poster_path: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `task test -- src/components/film/FilmHeader.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/film/FilmHeader"`.

- [ ] **Step 8: Implement `FilmHeader`**

Create `src/components/film/FilmHeader.tsx`:

```tsx
import type { FilmDetail } from "@/api/types";
import { posterUrl } from "@/lib/poster";
import { ArcStepper } from "./ArcStepper";

/** Poster + title + year + the status arc. */
export function FilmHeader({ film }: { film: FilmDetail }) {
  const poster = posterUrl(film.poster_path, "w342");
  return (
    <header>
      <div className="flex items-start gap-4">
        {poster && (
          <img
            src={poster}
            alt={`${film.title} poster`}
            width={92}
            height={138}
            className="rounded-md"
          />
        )}
        <div>
          <h1 className="text-2xl font-bold">{film.title}</h1>
          {film.release_year && <p className="text-gray-500">{film.release_year}</p>}
        </div>
      </div>
      <ArcStepper current={film.arc_stage} />
    </header>
  );
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `task test -- src/components/film/FilmHeader.test.tsx`
Expected: PASS (2 passed).

---

## Task 4: `SourceLinks`, `EventCard`, and `EventTimeline`

**Files:**
- Create: `src/components/film/SourceLinks.tsx`
- Test: `src/components/film/SourceLinks.test.tsx`
- Create: `src/components/film/EventCard.tsx`
- Test: `src/components/film/EventCard.test.tsx`
- Create: `src/components/film/EventTimeline.tsx`
- Test: `src/components/film/EventTimeline.test.tsx`

- [ ] **Step 1: Write the failing `SourceLinks` test**

Create `src/components/film/SourceLinks.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceLinks } from "@/components/film/SourceLinks";

describe("SourceLinks", () => {
  it("renders outbound source links", () => {
    render(
      <SourceLinks
        sources={[
          { url: "https://deadline.com/a", source: "Deadline", title: "Cast", published_at: null },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "Deadline" });
    expect(link).toHaveAttribute("href", "https://deadline.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders nothing when there are no sources", () => {
    const { container } = render(<SourceLinks sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `task test -- src/components/film/SourceLinks.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/film/SourceLinks"`.

- [ ] **Step 3: Implement `SourceLinks`**

Create `src/components/film/SourceLinks.tsx`:

```tsx
import type { FilmSource } from "@/api/types";

/** Outbound links to the stories an event's summary was based on. */
export function SourceLinks({ sources }: { sources: FilmSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      <span className="text-gray-400">Sources:</span>
      {sources.map((source, i) => (
        <a
          key={`${source.url}-${i}`}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={source.title}
          className="text-blue-600 underline"
        >
          {source.source}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `task test -- src/components/film/SourceLinks.test.tsx`
Expected: PASS (2 passed).

- [ ] **Step 5: Write the failing `EventCard` test**

Create `src/components/film/EventCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventCard } from "@/components/film/EventCard";
import type { FilmEvent } from "@/api/types";

const event: FilmEvent = {
  event_type: "release_date",
  confidence: "confirmed",
  occurred_at: "2026-03-14T00:00:00Z",
  summary: "Studio sets a July 17 theatrical release.",
  sources: [{ url: "https://thr.com/a", source: "THR", title: "Dated", published_at: null }],
};

describe("EventCard", () => {
  it("shows the beat, confidence, date, summary, and sources", () => {
    render(<EventCard event={event} />);
    expect(screen.getByText("Release date")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Mar 14, 2026")).toBeInTheDocument();
    expect(screen.getByText(/July 17 theatrical release/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "THR" })).toHaveAttribute("href", "https://thr.com/a");
  });

  it("renders rumored confidence", () => {
    render(<EventCard event={{ ...event, confidence: "rumored" }} />);
    expect(screen.getByText("Rumored")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `task test -- src/components/film/EventCard.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/film/EventCard"`.

- [ ] **Step 7: Implement `EventCard`**

Create `src/components/film/EventCard.tsx`:

```tsx
import type { FilmEvent } from "@/api/types";
import { cn } from "@/lib/cn";
import { formatEventDate } from "@/lib/format";
import { eventTypeLabel } from "./labels";
import { SourceLinks } from "./SourceLinks";

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

/** One event in the timeline: beat, confidence, date, summary, and source links. */
export function EventCard({ event }: { event: FilmEvent }) {
  return (
    <article className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-indigo-800">
          {eventTypeLabel(event.event_type)}
        </span>
        <ConfidenceBadge confidence={event.confidence} />
        <time dateTime={event.occurred_at} className="ml-auto text-gray-400">
          {formatEventDate(event.occurred_at)}
        </time>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{event.summary}</p>
      <SourceLinks sources={event.sources} />
    </article>
  );
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `task test -- src/components/film/EventCard.test.tsx`
Expected: PASS (2 passed).

- [ ] **Step 9: Write the failing `EventTimeline` test**

Create `src/components/film/EventTimeline.test.tsx`:

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

  it("renders events in the given (ascending) order", () => {
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
    expect(summaries).toEqual(["Casting announced.", "Trailer dropped."]);
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `task test -- src/components/film/EventTimeline.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/film/EventTimeline"`.

- [ ] **Step 11: Implement `EventTimeline`**

Create `src/components/film/EventTimeline.tsx`:

```tsx
import type { FilmEvent } from "@/api/types";
import { EventCard } from "./EventCard";

/** The chronological (ascending) list of summarized events, or an empty-state message. */
export function EventTimeline({ events }: { events: FilmEvent[] }) {
  if (events.length === 0) {
    return <p className="mt-8 text-sm text-gray-500">No updates yet — check back soon.</p>;
  }
  return (
    <ol className="mt-8 space-y-4">
      {events.map((event, i) => (
        <li key={`${event.event_type}-${event.occurred_at}-${i}`}>
          <EventCard event={event} />
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 12: Run it to verify it passes**

Run: `task test -- src/components/film/EventTimeline.test.tsx`
Expected: PASS (2 passed).

---

## Task 5: The `/film/:slug` route module

**Files:**
- Create: `src/routes/film.tsx`
- Test: `src/routes/film.test.tsx`
- Modify: `src/routes.ts`

- [ ] **Step 1: Register the route**

In `src/routes.ts`, change the public-layout block from:

```ts
  layout("routes/public-layout.tsx", [route("preview", "routes/preview.tsx")]),
```

to:

```ts
  layout("routes/public-layout.tsx", [
    route("preview", "routes/preview.tsx"),
    route("film/:slug", "routes/film.tsx"),
  ]),
```

- [ ] **Step 2: Write the failing route test**

Create `src/routes/film.test.tsx`:

```tsx
import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import FilmPage, { ErrorBoundary, loader, meta } from "@/routes/film";
import type { FilmDetail } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const film: FilmDetail = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_date: "2026-07-17",
  release_year: 2026,
  poster_path: "/poster.jpg",
  arc_stage: "trailer",
  events: [
    {
      event_type: "casting",
      confidence: "confirmed",
      occurred_at: "2025-01-01T00:00:00Z",
      summary: "Casting announced.",
      sources: [{ url: "https://deadline.com/a", source: "Deadline", title: "Cast", published_at: null }],
    },
    {
      event_type: "trailer",
      confidence: "rumored",
      occurred_at: "2026-06-01T00:00:00Z",
      summary: "Trailer dropped.",
      sources: [],
    },
  ],
};

function contextWithEnv() {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } });
  return context;
}

function callLoader(slug: string) {
  return loader({
    request: new Request(`https://upmovies.example/film/${slug}`),
    context: contextWithEnv(),
    params: { slug },
  } as unknown as Parameters<typeof loader>[0]);
}

describe("film route loader", () => {
  it("fetches the film detail by slug", async () => {
    server.use(http.get(`${BACKEND}/films/the-odyssey-2026`, () => HttpResponse.json(film)));
    const data = await callLoader("the-odyssey-2026");
    expect(data.film.slug).toBe("the-odyssey-2026");
  });

  it("throws a 404 Response for an unknown slug", async () => {
    server.use(http.get(`${BACKEND}/films/missing`, () => new HttpResponse(null, { status: 404 })));
    await expect(callLoader("missing")).rejects.toMatchObject({ status: 404 });
  });
});

describe("film route meta", () => {
  it("builds the head from film data including the poster OG image", () => {
    const tags = meta({
      data: { film },
      location: { pathname: "/film/the-odyssey-2026" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "The Odyssey (2026) · Upcoming Movies Tracker" });
    expect(tags.some((t) => "property" in t && t.property === "og:image")).toBe(true);
    expect(
      tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical"),
    ).toBe(true);
  });

  it("returns a noindex head when the film is missing", () => {
    const tags = meta({
      data: undefined,
      location: { pathname: "/film/missing" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
  });
});

describe("film route render", () => {
  it("renders the arc, ascending timeline, and outbound source links", async () => {
    const Stub = createRoutesStub([
      { path: "/film/:slug", Component: FilmPage, loader: () => ({ film }) },
    ]);
    render(<Stub initialEntries={["/film/the-odyssey-2026"]} />);

    expect(await screen.findByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.getByText("Released")).toBeInTheDocument(); // arc stage label
    const summaries = screen.getAllByText(/announced|dropped/).map((el) => el.textContent);
    expect(summaries).toEqual(["Casting announced.", "Trailer dropped."]);
    const link = screen.getByRole("link", { name: "Deadline" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the empty state when there are no events", async () => {
    const Stub = createRoutesStub([
      { path: "/film/:slug", Component: FilmPage, loader: () => ({ film: { ...film, events: [] } }) },
    ]);
    render(<Stub initialEntries={["/film/the-odyssey-2026"]} />);
    expect(await screen.findByText(/no updates yet/i)).toBeInTheDocument();
  });

  it("renders the not-found error boundary on a 404", async () => {
    const Stub = createRoutesStub([
      {
        path: "/film/:slug",
        Component: FilmPage,
        ErrorBoundary,
        loader: () => {
          throw new Response(null, { status: 404 });
        },
      },
    ]);
    render(<Stub initialEntries={["/film/missing"]} />);
    expect(await screen.findByText(/film not found/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `task test -- src/routes/film.test.tsx`
Expected: FAIL — `Failed to resolve import "@/routes/film"`.

- [ ] **Step 4: Implement the route module**

Create `src/routes/film.tsx`:

```tsx
/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { isRouteErrorResponse, Link } from "react-router";
import type { Route } from "./+types/film";
import { getFilm } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { buildMeta } from "@/lib/seo";
import { posterUrl } from "@/lib/poster";
import { truncate } from "@/lib/format";
import { FilmHeader } from "@/components/film/FilmHeader";
import { EventTimeline } from "@/components/film/EventTimeline";

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const film = await getFilm(env.API_BASE_URL, params.slug);
  if (!film) {
    throw new Response(null, { status: 404, statusText: "Film not found" });
  }
  return { film };
}

export function meta({ data, location }: Route.MetaArgs): Route.MetaDescriptors {
  if (!data?.film) {
    return [
      ...buildMeta({ title: "Film not found", pathname: location.pathname }),
      { name: "robots", content: "noindex" },
    ];
  }
  const { film } = data;
  const title = film.release_year ? `${film.title} (${film.release_year})` : film.title;
  const latest = film.events.at(-1)?.summary;
  const description = latest
    ? truncate(latest)
    : `Release dates, casting, trailers, and the full update timeline for ${title}.`;
  return buildMeta({
    title,
    description,
    pathname: location.pathname,
    image: posterUrl(film.poster_path, "w780") ?? undefined,
    type: "article",
  });
}

export default function FilmPage({ loaderData }: Route.ComponentProps) {
  const { film } = loaderData;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <FilmHeader film={film} />
      <EventTimeline events={film.events} />
    </main>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">
        {isNotFound ? "Film not found" : "Something went wrong"}
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        {isNotFound
          ? "We couldn't find that film. It may have moved or never existed."
          : "Please try again in a moment."}
      </p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Back to home
      </Link>
    </main>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `task test -- src/routes/film.test.tsx`
Expected: PASS (7 passed across loader/meta/render describes).

> Note: the test casts loader/meta args with `Parameters<typeof …>[0]` (matching `preview.test.tsx`), so it does not import the generated `./+types/film`. Vitest erases the `import type { Route }` in `film.tsx`; the generated types are materialized by `react-router typegen` in Task 6's typecheck.

---

## Task 6: Full verification + handoff

**Files:** none (verification only).

- [ ] **Step 1: Type-check (runs typegen first)**

Run: `task typecheck`
Expected: `react-router typegen` regenerates route types (incl. `./+types/film`), then `tsc -b` reports 0 errors.

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: ESLint passes with zero warnings (the `react-refresh` disable comment in `film.tsx` keeps the multi-export route module clean).

- [ ] **Step 3: Full test suite**

Run: `task test`
Expected: the entire suite passes, including the new `poster`, `format`, `public`, `ArcStepper`, `FilmHeader`, `SourceLinks`, `EventCard`, `EventTimeline`, and `film` tests, with all pre-existing tests still green.

- [ ] **Step 4: Format only the touched files**

The repo has pre-existing Prettier drift on `AuthContext.*` — do **not** restage it. Format only this ticket's files:

```bash
docker compose exec -T upmovies-frontend pnpm exec prettier --write \
  src/env.ts \
  src/lib/poster.ts src/lib/poster.test.ts src/lib/format.ts src/lib/format.test.ts \
  src/api/types.ts src/api/public.ts src/api/public.test.ts \
  src/components/film/labels.ts \
  src/components/film/ArcStepper.tsx src/components/film/ArcStepper.test.tsx \
  src/components/film/FilmHeader.tsx src/components/film/FilmHeader.test.tsx \
  src/components/film/SourceLinks.tsx src/components/film/SourceLinks.test.tsx \
  src/components/film/EventCard.tsx src/components/film/EventCard.test.tsx \
  src/components/film/EventTimeline.tsx src/components/film/EventTimeline.test.tsx \
  src/routes/film.tsx src/routes/film.test.tsx src/routes.ts
```

(`.env.example` is outside the prettier glob — leave it as edited.)

- [ ] **Step 5: Hand off for commit (user)**

Do **not** commit from within task execution. Report green gates to the user. The user commits the whole NEU-310 change as **one PR** in the `upcoming-movies-frontend` repo, off the ticket branch `tom/neu-310-frontend-ssr-film-update-log-page`, using `/commit-msg` (Conventional Commits subject, no Linear ID, no Co-Authored-By) and `/pr-desc` (PR title carries `(NEU-310)`; keep the "Generated with Claude Code" footer in the PR body). Confirm `git status` shows only this ticket's files staged before pushing.

---

## Self-review

**Spec coverage** (`docs/specs/2026-06-23-neu-310-ssr-film-page-design.md`):
- SSR route `/film/{slug}` under the public layout; loader fetches `GET /films/{slug}` → Task 5 (`routes.ts` + `film.tsx` loader via `getFilm` + `cloudflareContext`).
- Status-arc indicator, 7 named stages, current highlighted → Task 3 (`ArcStepper` + `labels.ts`), asserted in `ArcStepper.test.tsx` and `film.test.tsx`.
- Chronological (ascending) timeline; summary, beat, confidence, date, outbound source links → Task 4 (`EventTimeline`/`EventCard`/`SourceLinks`) + Task 1 (`formatEventDate`), asserted in component + route tests.
- Per-film `<title>`/meta/OG via the SEO helper; poster OG image → Task 5 `meta()` using `buildMeta` + `posterUrl(_, "w780")`.
- Empty + 404 states → Task 4 empty state in `EventTimeline`; Task 5 loader 404 throw + route `ErrorBoundary`; both asserted in `film.test.tsx`.
- API client + types → Task 2 (`getFilm` + `FilmDetail`/`FilmEvent`/`FilmSource`/`ArcStage`).
- TMDB poster config → Task 1 (`VITE_TMDB_IMAGE_BASE`, `posterUrl`).
- Hydration-safe date formatting (UTC/`en-US`) → Task 1 (`formatEventDate`), asserted by the late-UTC case.
- Tests: Vitest + MSW cover loader + render (timeline, arc, source links, 404); `tsc -b` + eslint green → Tasks 1–6.

**Placeholder scan:** none — every code/test step contains complete code and exact `task` commands with expected output.

**Type/name consistency:** `posterUrl(path, size)` (Task 1) is called identically in `FilmHeader` (Task 3) and `film.tsx` (Task 5). `getFilm(baseUrl, slug)` (Task 2) is called in `film.tsx`'s loader (Task 5). `FilmDetail`/`FilmEvent`/`FilmSource`/`ArcStage` (Task 2) are imported and used with matching field names across Tasks 3–5. `ARC_STAGES`/`ARC_STAGE_LABELS`/`eventTypeLabel` (Task 3 `labels.ts`) are consumed by `ArcStepper` (Task 3) and `EventCard` (Task 4). `formatEventDate`/`truncate` (Task 1) are used by `EventCard` (Task 4) and `film.tsx` `meta` (Task 5). The loader returns `{ film }`; `meta` reads `data.film`; `FilmPage` reads `loaderData.film` — consistent. The loader-context construction (`RouterContextProvider` + `cloudflareContext`) mirrors the merged `sitemap.test.ts`.
