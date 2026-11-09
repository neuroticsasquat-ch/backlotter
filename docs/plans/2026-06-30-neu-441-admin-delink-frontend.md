# NEU-441 — Frontend: admin delink controls on the film page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin is logged in, add inline controls to the film page to delink a single source from an event or remove a whole bogus event; everyone else sees the page unchanged.

**Architecture:** Admin-only UI gated by `useAuth().user?.is_admin`. Mutations call the NEU-440 endpoints via `apiFetch`. **The film page is a React Router framework-mode loader route (SSR), not TanStack Query — refresh after a mutation via `useRevalidator().revalidate()`** (re-runs the film loader). Feedback via `sonner` toasts (Toaster already mounted in `spa-layout.tsx`); destructive whole-event delete behind a Radix dialog confirm (`@radix-ui/react-dialog` is installed).

**Tech Stack:** React 19, react-router 8 (framework mode), TypeScript, Tailwind v4, `@radix-ui/react-dialog`, `sonner`, Vitest + RTL + MSW.

## Global Constraints

- Everything runs in the container via `task` — never run `pnpm`/`vitest`/`eslint`/`tsc` on the host. Add deps with `task deps:add` (none needed here — all deps already installed).
- `task test`, `task lint` (**zero warnings** — unused imports fail), `task typecheck` green before done; touched files prettier-formatted (`task format`). Don't reformat unrelated files.
- HTTP only through `apiFetch<T>(path, init?)` (sends `credentials: "include"`, attaches CSRF on mutations, throws `ApiError` with `.status`). Don't call `fetch` directly.
- Types mirror backend shapes; keep `api/types.ts` in sync.
- TDD: failing test first. MSW intercepts all HTTP (`onUnhandledRequest: "error"`); override per-test with `server.use(...)`. `meHandler({ is_admin })` (`test/msw/me.ts`) builds the `/me` response. Auth resolves asynchronously — use `findBy*` for auth-gated content.
- Commits: Conventional Commits with trailing Linear parenthetical (`feat: ... (NEU-441)`); keep the `🤖 Generated with Claude Code` footer in the PR body; no `Co-Authored-By`.
- Branch: `tom/neu-441-frontend-admin-delink-controls-on-the-film-page`.

## Key existing facts (verified)

- `routes/film.tsx` is a framework-mode route with `loader()` returning `{ film }`; `FilmPage` reads `loaderData.film`. Data is **not** in TanStack Query → use `useRevalidator()` to refresh.
- `components/film/EventCard.tsx` renders an event summary + `<SourceLinks sources={event.sources} />`. `SourceLinks` maps `sources` to outbound chip `<a>`s.
- `useAuth()` returns `{ user: AuthedUser | null, ... }`; `user.is_admin` exists.
- `apiFetch` returns `undefined` for empty/204 bodies and parsed JSON otherwise; throws `ApiError` on non-2xx.

---

### Task 1: Types + moderation API client

**Files:**
- Modify: `src/api/types.ts` (add `event_id` to `FilmEvent`; add `DelinkResponse`)
- Create: `src/api/moderation.ts`
- Test: `src/api/moderation.test.ts`

**Interfaces:**
- Produces: `delinkSource(eventId: string, url: string): Promise<DelinkResponse>` and
  `deleteEvent(eventId: string): Promise<DelinkResponse>`.

- [ ] **Step 1: Add the types.** In `src/api/types.ts`, add `event_id` as the first field of
`FilmEvent`:

```ts
export interface FilmEvent {
  event_id: string;
  event_type: string;
  confidence: string; // "confirmed" | "rumored" (backend free text; rendered via a map)
  created_at: string;
  summary: string;
  sources: FilmSource[];
}
```

and add near the other response types:

```ts
export interface DelinkResponse {
  delinked: number;
  event_removed: boolean;
  resummarize_queued: boolean;
}
```

- [ ] **Step 2: Write the failing test.** Create `src/api/moderation.test.ts`:

```ts
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { deleteEvent, delinkSource } from "./moderation";

const BACKEND = env.apiBaseUrl;

describe("moderation api", () => {
  it("POSTs the source url to the event delink endpoint", async () => {
    let received: unknown = null;
    server.use(
      http.post(`${BACKEND}/admin/events/evt-1/delink`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ delinked: 1, event_removed: true, resummarize_queued: false });
      }),
    );
    const res = await delinkSource("evt-1", "https://x.test/a");
    expect(received).toEqual({ url: "https://x.test/a" });
    expect(res.event_removed).toBe(true);
  });

  it("DELETEs the event", async () => {
    server.use(
      http.delete(`${BACKEND}/admin/events/evt-9`, () =>
        HttpResponse.json({ delinked: 2, event_removed: true, resummarize_queued: false }),
      ),
    );
    const res = await deleteEvent("evt-9");
    expect(res.delinked).toBe(2);
  });
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `task test -- src/api/moderation.test.ts`
Expected: FAIL — cannot resolve `./moderation`.

- [ ] **Step 4: Implement.** Create `src/api/moderation.ts`:

```ts
import { apiFetch } from "./client";
import type { DelinkResponse } from "./types";

/** Delink one source story from an event (admin only). The story is rejected and detached;
 *  if that empties the event, the event is removed. Identified by the story's unique url. */
export function delinkSource(eventId: string, url: string): Promise<DelinkResponse> {
  return apiFetch<DelinkResponse>(`/admin/events/${encodeURIComponent(eventId)}/delink`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

/** Remove a whole event (admin only): reject all its source stories and delete the event. */
export function deleteEvent(eventId: string): Promise<DelinkResponse> {
  return apiFetch<DelinkResponse>(`/admin/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}
```

- [ ] **Step 5: Run — verify pass**

Run: `task test -- src/api/moderation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/types.ts src/api/moderation.ts src/api/moderation.test.ts
git commit -m "feat: add moderation api client and event_id type (NEU-441)"
```

---

### Task 2: Per-source delink control in `SourceLinks`

**Files:**
- Modify: `src/components/film/SourceLinks.tsx` (optional admin props + `×` button)
- Test: `src/components/film/SourceLinks.test.tsx`

**Interfaces:**
- Produces: `SourceLinks` accepts optional `admin?: boolean`, `busy?: boolean`,
  `onDelink?: (url: string) => void`. When `admin` and `onDelink` are set, each chip gets a
  delink `×` button. Default (no props) renders exactly as before.

- [ ] **Step 1: Write the failing test.** Add to `src/components/film/SourceLinks.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SourceLinks } from "./SourceLinks";

const sources = [
  { url: "https://x.test/a", source: "ScreenRant", title: "t", published_at: null },
];

it("shows no delink control without admin props", () => {
  render(<SourceLinks sources={sources} />);
  expect(screen.queryByRole("button", { name: /delink/i })).toBeNull();
});

it("calls onDelink with the source url when admin", () => {
  const onDelink = vi.fn();
  render(<SourceLinks sources={sources} admin onDelink={onDelink} />);
  fireEvent.click(screen.getByRole("button", { name: /delink ScreenRant/i }));
  expect(onDelink).toHaveBeenCalledWith("https://x.test/a");
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `task test -- src/components/film/SourceLinks.test.tsx`
Expected: FAIL — no delink button rendered.

- [ ] **Step 3: Implement.** Update `src/components/film/SourceLinks.tsx` — add the props and a
`×` button per chip (the existing `<a>` chip is unchanged):

```tsx
import type { FilmSource } from "@/api/types";

export function SourceLinks({
  sources,
  admin = false,
  busy = false,
  onDelink,
}: {
  sources: FilmSource[];
  admin?: boolean;
  busy?: boolean;
  onDelink?: (url: string) => void;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Sources</span>
      {sources.map((source, i) => (
        <span key={`${source.url}-${i}`} className="inline-flex items-center">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={source.title}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-foreground transition-colors hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-400"
          >
            {source.source}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 17 17 7" />
              <path d="M9 7h8v8" />
            </svg>
          </a>
          {admin && onDelink ? (
            <button
              type="button"
              disabled={busy}
              aria-label={`delink ${source.source}`}
              onClick={() => onDelink(source.url)}
              className="ml-0.5 rounded-full px-1 text-muted-foreground hover:text-red-500 disabled:opacity-50"
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run — verify pass**

Run: `task test -- src/components/film/SourceLinks.test.tsx`
Expected: PASS (including the existing chip tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/film/SourceLinks.tsx src/components/film/SourceLinks.test.tsx
git commit -m "feat: add admin delink control to source chips (NEU-441)"
```

---

### Task 3: Wire admin controls + refresh into `EventCard`

**Files:**
- Create: `src/components/ui/confirm-dialog.tsx` (minimal Radix confirm)
- Modify: `src/components/film/EventCard.tsx`
- Test: `src/components/film/EventCard.test.tsx`

**Interfaces:**
- Consumes: `delinkSource`/`deleteEvent` (Task 1), `SourceLinks` admin props (Task 2),
  `useAuth`, `useRevalidator`, `toast`.
- Produces: admin-only `×` per source + a "Remove event" button (confirm-gated) on each event;
  both refresh the film loader and toast on completion.

- [ ] **Step 1: Add the confirm dialog primitive.** Create
`src/components/ui/confirm-dialog.tsx`:

```tsx
import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

/** A minimal confirm built on Radix Dialog: renders `trigger`; opening shows `title` +
 *  `description` with Cancel / Confirm. `onConfirm` fires on Confirm and the dialog closes. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 shadow-lg">
          <Dialog.Title className="text-sm font-semibold text-foreground">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            {description}
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close className="rounded border border-border px-3 py-1 text-xs">
              Cancel
            </Dialog.Close>
            <Dialog.Close
              onClick={onConfirm}
              className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              {confirmLabel}
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Write the failing test.** Replace/extend `src/components/film/EventCard.test.tsx`
so it renders inside the providers `useAuth` and `useRevalidator` need (QueryClientProvider +
AuthProvider + a **data** router via `createMemoryRouter`/`RouterProvider`), with MSW driving
`/me` and the delink endpoint:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { env } from "@/env";
import { EventCard } from "./EventCard";
import type { FilmEvent } from "@/api/types";

const event: FilmEvent = {
  event_id: "evt-1",
  event_type: "casting",
  confidence: "confirmed",
  created_at: "2026-06-30T00:00:00Z",
  summary: "Bogus recast.",
  sources: [{ url: "https://x.test/a", source: "ScreenRant", title: "t", published_at: null }],
};

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/", element: <EventCard event={event} /> }]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

it("hides admin controls for non-admins", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard();
  // wait for auth to resolve, then assert no delink control
  await waitFor(() => expect(screen.getByText("Bogus recast.")).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /delink/i })).toBeNull();
});

it("delinks a source and revalidates for an admin", async () => {
  server.use(meHandler({ is_admin: true }));
  let called = false;
  server.use(
    http.post(`${env.apiBaseUrl}/admin/events/evt-1/delink`, () => {
      called = true;
      return HttpResponse.json({ delinked: 1, event_removed: true, resummarize_queued: false });
    }),
  );
  renderCard();
  const btn = await screen.findByRole("button", { name: /delink ScreenRant/i });
  await userEvent.click(btn);
  await waitFor(() => expect(called).toBe(true));
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `task test -- src/components/film/EventCard.test.tsx`
Expected: FAIL — admin delink button not found.

- [ ] **Step 4: Implement.** Update `src/components/film/EventCard.tsx`:

```tsx
import { useState } from "react";
import { useRevalidator } from "react-router";
import { toast } from "sonner";
import type { FilmEvent } from "@/api/types";
import { useAuth } from "@/components/AuthContext";
import { deleteEvent, delinkSource } from "@/api/moderation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { eventTypeLabel } from "./labels";
import { SourceLinks } from "./SourceLinks";

export function EventCard({ event }: { event: FilmEvent }) {
  const { user } = useAuth();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const isAdmin = Boolean(user?.is_admin);

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await action();
      toast.success(ok);
      revalidator.revalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article>
      <p className="text-[15px] leading-relaxed text-foreground">
        <span className="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[11px] font-medium uppercase leading-none tracking-wide text-muted-foreground">
          {eventTypeLabel(event.event_type)}
        </span>
        {event.summary}
      </p>
      <SourceLinks
        sources={event.sources}
        admin={isAdmin}
        busy={busy}
        onDelink={
          isAdmin
            ? (url) => run(() => delinkSource(event.event_id, url), "Source delinked")
            : undefined
        }
      />
      {isAdmin ? (
        <div className="mt-1">
          <ConfirmDialog
            title="Remove this event?"
            description={`This rejects all ${event.sources.length} source(s) and deletes the event.`}
            confirmLabel="Remove event"
            onConfirm={() => run(() => deleteEvent(event.event_id), "Event removed")}
            trigger={
              <button
                type="button"
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-red-500 disabled:opacity-50"
              >
                Remove event
              </button>
            }
          />
        </div>
      ) : null}
    </article>
  );
}
```

- [ ] **Step 5: Run — verify pass**

Run: `task test -- src/components/film/EventCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full CI locally**

Run: `task test && task lint && task typecheck`
Expected: all green, zero eslint warnings. Run `task format` if prettier flags touched files.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/confirm-dialog.tsx src/components/film/EventCard.tsx src/components/film/EventCard.test.tsx
git commit -m "feat: admin delink + remove-event controls on the film page (NEU-441)"
```

---

## Self-Review

- **Spec coverage:** `event_id` type (Task 1) ✓; per-source delink (Task 2) ✓; whole-event
  delete behind confirm + admin gating + toast + refresh (Task 3) ✓. Refresh corrected from
  "invalidate query" to `useRevalidator()` because the film page is a loader route.
- **Placeholders:** none — every component, client, and test has complete code.
- **Consistency:** `delinkSource(eventId, url)` / `deleteEvent(eventId)` signatures match between
  `api/moderation.ts`, `EventCard`, and tests; `SourceLinks` props (`admin`, `busy`, `onDelink`)
  match between definition, `EventCard` usage, and its test; endpoint paths match NEU-440
  (`POST /admin/events/{id}/delink`, `DELETE /admin/events/{id}`).
- **Note:** controls are client-only (SSR renders `user=null`, hydration reveals them for
  admins) — acceptable for an admin affordance.

## Execution Handoff

Recommend **subagent-driven** (3 TDD tasks, clean gates). Depends on NEU-440 being merged (needs
`event_id` in the film payload + live endpoints) before the EventCard test's MSW handlers mirror
real behavior — but the FE work itself can proceed against MSW in parallel.
