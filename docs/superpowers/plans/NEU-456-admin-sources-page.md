# Admin Sources Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend admin "Sources" page that lists resolved publisher domains with their LLM trust tier + reason and lets an admin set a per-domain override (`none`/`block`/`allow`/`trust`) against the already-merged backend (NEU-454, PR #98).

**Architecture:** A new `/admin/sources` route renders a client-side-filterable/sortable table backed by TanStack Query. A new shared `AdminLayout` route provides a secondary tab strip between `/admin/ingest` and `/admin/sources`. Override changes go through an optimistic TanStack `useMutation` with `sonner` toasts.

**Tech Stack:** React 19, React Router 7 (framework/file-route mode via `src/routes.ts`), TanStack Query v5, Tailwind v4, `sonner`, `apiFetch` HTTP wrapper. Tests: Vitest + React Testing Library + MSW.

## Global Constraints

- **Repo:** `upcoming-movies-frontend`. All tooling runs **in-container via `task`** — never run `pnpm`/`vitest`/`eslint`/`tsc` on the host.
- **Verification gate (every task):** `task typecheck`, `task lint` (ESLint **zero warnings** — unused imports fail), and `task test` must be green. Prettier-format only touched files.
- **HTTP:** always go through `apiFetch<T>(path, init?)` from `@/api/client` (sends `credentials: "include"`, attaches CSRF on mutations, throws `ApiError`). Never call `fetch` directly.
- **Server state = TanStack Query.** Typed fetchers + hooks live in `src/api/*.ts`. Stable `queryKey`s.
- **Types** mirror backend response shapes and live in `src/api/types.ts` (as `IngestRun` does).
- **TDD:** write the failing test first. MSW runs with `onUnhandledRequest: "error"`; override per-test with `server.use(...)`.
- **Backend contract is fixed (do not change backend):**
  - `GET /admin/sources` → `SourceDomain[]` (all rows, no pagination).
  - `POST /admin/sources/{domain}/override` — body `{ override }` → updated `SourceDomain`.
  - Both are session-admin + CSRF; MSW does not enforce either, so tests need no CSRF setup.
- **Commit style:** Conventional Commits with a trailing Linear ID parenthetical, e.g. `feat: add X (NEU-456)`. Keep the `🤖 Generated with Claude Code` footer out of commit messages. (During subagent-driven execution the user commits at the end per their workflow — treat the per-task commit steps below as checkpoints.)

## File Structure

| File | Responsibility |
|---|---|
| `src/api/types.ts` (modify) | Add `SourceTier`, `SourceOverride`, `SourceDomain`. |
| `src/api/sources.ts` (create) | Fetchers (`fetchSources`, `setSourceOverride`), `effectiveTier` helper + `EffectiveTier` type, query hook `useSources`, mutation hook `useSetSourceOverride`. |
| `src/api/sources.test.ts` (create) | Unit tests for fetchers + `effectiveTier`. |
| `src/components/layout/admin-nav-items.ts` (create) | `ADMIN_NAV_ITEMS` list. |
| `src/components/layout/AdminLayout.tsx` (create) | Admin secondary tab strip + `<Outlet/>`. |
| `src/components/layout/AdminLayout.test.tsx` (create) | Tab hrefs + active-state tests. |
| `src/routes.ts` (modify) | Nest `AdminLayout` around `admin/ingest` + new `admin/sources`. |
| `src/pages/AdminSources.tsx` (create) | The Sources page: controls + table + override dropdown. |
| `src/pages/AdminSources.test.tsx` (create) | Page tests (rows, states, filters, sort, mutation). |

`src/pages/AdminIngest.tsx` is **not** edited — it keeps its own container and simply renders inside `AdminLayout`, gaining the tabs.

---

### Task 1: Types + API module (fetchers + `effectiveTier`)

**Files:**
- Modify: `src/api/types.ts`
- Create: `src/api/sources.ts`
- Test: `src/api/sources.test.ts`

**Interfaces:**
- Consumes: `apiFetch` from `@/api/client`.
- Produces:
  - Types `SourceTier = "trusted" | "acceptable" | "low"`, `SourceOverride = "none" | "block" | "allow" | "trust"`, `SourceDomain = { domain: string; llm_tier: SourceTier | null; llm_reason: string | null; admin_override: SourceOverride; updated_at: string }`.
  - `fetchSources(): Promise<SourceDomain[]>`
  - `setSourceOverride(domain: string, override: SourceOverride): Promise<SourceDomain>`
  - `type EffectiveTier = "blocked" | SourceTier | null`
  - `effectiveTier(row: SourceDomain): EffectiveTier`

- [ ] **Step 1: Add the types to `src/api/types.ts`**

Append to `src/api/types.ts`:

```ts
export type SourceTier = "trusted" | "acceptable" | "low";
export type SourceOverride = "none" | "block" | "allow" | "trust";

/** One resolved publisher domain in the source-quality gate (NEU-454). `llm_tier` is the
 *  cached LLM verdict (null until judged); `admin_override` is the human lever that wins
 *  over it. Mirrors the backend `SourceDomainOut`. */
export interface SourceDomain {
  domain: string;
  llm_tier: SourceTier | null;
  llm_reason: string | null;
  admin_override: SourceOverride;
  updated_at: string;
}
```

- [ ] **Step 2: Write the failing test** (`src/api/sources.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import type { SourceDomain } from "@/api/types";
import { effectiveTier, fetchSources, setSourceOverride } from "./sources";

const base = env.apiBaseUrl;

function makeSource(overrides: Partial<SourceDomain> = {}): SourceDomain {
  return {
    domain: "example.com",
    llm_tier: "acceptable",
    llm_reason: "Regional outlet.",
    admin_override: "none",
    updated_at: "2026-07-01T12:00:00Z",
    ...overrides,
  };
}

describe("sources api", () => {
  it("fetchSources returns the typed list", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "variety.com", llm_tier: "trusted" })]),
      ),
    );
    const rows = await fetchSources();
    expect(rows).toHaveLength(1);
    expect(rows[0].domain).toBe("variety.com");
    expect(rows[0].llm_tier).toBe("trusted");
  });

  it("setSourceOverride POSTs the override to the domain-scoped path", async () => {
    let seenUrl = "";
    let seenBody: unknown = null;
    server.use(
      http.post(`${base}/admin/sources/mshale.com/override`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json(makeSource({ domain: "mshale.com", admin_override: "block" }));
      }),
    );
    const row = await setSourceOverride("mshale.com", "block");
    expect(new URL(seenUrl).pathname).toBe("/admin/sources/mshale.com/override");
    expect(seenBody).toEqual({ override: "block" });
    expect(row.admin_override).toBe("block");
  });

  describe("effectiveTier", () => {
    it("returns 'blocked' when admin_override is block", () => {
      expect(effectiveTier(makeSource({ admin_override: "block", llm_tier: "trusted" }))).toBe(
        "blocked",
      );
    });
    it("maps trust -> trusted and allow -> acceptable", () => {
      expect(effectiveTier(makeSource({ admin_override: "trust", llm_tier: "low" }))).toBe("trusted");
      expect(effectiveTier(makeSource({ admin_override: "allow", llm_tier: "low" }))).toBe(
        "acceptable",
      );
    });
    it("falls back to the llm_tier when there is no override", () => {
      expect(effectiveTier(makeSource({ admin_override: "none", llm_tier: "low" }))).toBe("low");
      expect(effectiveTier(makeSource({ admin_override: "none", llm_tier: null }))).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- src/api/sources.test.ts`
Expected: FAIL — `./sources` module not found.

- [ ] **Step 4: Create `src/api/sources.ts`**

```ts
import { apiFetch } from "./client";
import type { SourceDomain, SourceOverride, SourceTier } from "./types";

export const fetchSources = () => apiFetch<SourceDomain[]>("/admin/sources");

export const setSourceOverride = (domain: string, override: SourceOverride) =>
  apiFetch<SourceDomain>(`/admin/sources/${encodeURIComponent(domain)}/override`, {
    method: "POST",
    body: JSON.stringify({ override }),
  });

/** The resolved trust verdict the ingestion gate consumes: an admin override always wins
 *  over the LLM tier. `null` = unjudged (no override and no LLM tier yet). */
export type EffectiveTier = "blocked" | SourceTier | null;

export function effectiveTier(row: SourceDomain): EffectiveTier {
  switch (row.admin_override) {
    case "block":
      return "blocked";
    case "trust":
      return "trusted";
    case "allow":
      return "acceptable";
    case "none":
      return row.llm_tier;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test -- src/api/sources.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Verify types/lint, then commit**

Run: `task typecheck && task lint`
Expected: no errors, zero warnings.

```bash
git add src/api/types.ts src/api/sources.ts src/api/sources.test.ts
git commit -m "feat: add source-domain types and admin API client (NEU-456)"
```

---

### Task 2: Admin layout + navigation + wired routes + core Sources page

Delivers the reachable page: the `AdminLayout` tab strip, the route wiring, and `AdminSources` rendering the full table (all columns, tier + effective-tier badges, reason truncation, a value-bound but not-yet-interactive override `<select>`) with loading / error / empty states.

**Files:**
- Create: `src/components/layout/admin-nav-items.ts`
- Create: `src/components/layout/AdminLayout.tsx`
- Test: `src/components/layout/AdminLayout.test.tsx`
- Modify: `src/routes.ts`
- Create: `src/pages/AdminSources.tsx`
- Test: `src/pages/AdminSources.test.tsx`

**Interfaces:**
- Consumes: `useSources` (added here to `src/api/sources.ts`), `effectiveTier`/`EffectiveTier` (Task 1), `SourceDomain`/`SourceOverride` (Task 1).
- Produces:
  - `ADMIN_NAV_ITEMS: readonly { label: string; href: string }[]`
  - `AdminLayout` (default + named export)
  - `useSources(): UseQueryResult<SourceDomain[]>` in `src/api/sources.ts`
  - `AdminSources` (default + named export)

- [ ] **Step 1: Add the `useSources` query hook to `src/api/sources.ts`**

Add these imports at the top of `src/api/sources.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
```

Append to `src/api/sources.ts`:

```ts
/** All known source domains for the admin Sources page. Near-static data — no polling
 *  (unlike useRuns); it only changes via this page's own override mutations. */
export function useSources() {
  return useQuery({ queryKey: ["admin-sources"], queryFn: fetchSources });
}
```

- [ ] **Step 2: Write the failing AdminLayout test** (`src/components/layout/AdminLayout.test.tsx`)

```tsx
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { AdminLayout } from "./AdminLayout";

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { path: "ingest", element: <div>Ingestion page</div> },
          { path: "sources", element: <div>Sources page</div> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

it("renders both admin tabs with correct hrefs", () => {
  renderAt("/admin/ingest");
  expect(screen.getByRole("link", { name: "Ingestion" })).toHaveAttribute("href", "/admin/ingest");
  expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("href", "/admin/sources");
});

it("marks the active tab based on the current route", () => {
  renderAt("/admin/sources");
  expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Ingestion" })).not.toHaveAttribute("aria-current");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `task test -- src/components/layout/AdminLayout.test.tsx`
Expected: FAIL — `./AdminLayout` not found.

- [ ] **Step 4: Create `src/components/layout/admin-nav-items.ts`**

```ts
/** Secondary navigation shown on every admin page (rendered by AdminLayout). Add a line
 *  here when a new admin page is introduced. */
export const ADMIN_NAV_ITEMS = [
  { label: "Ingestion", href: "/admin/ingest" },
  { label: "Sources", href: "/admin/sources" },
] as const;
```

- [ ] **Step 5: Create `src/components/layout/AdminLayout.tsx`**

```tsx
import { NavLink, Outlet } from "react-router";
import { ADMIN_NAV_ITEMS } from "@/components/layout/admin-nav-items";

/** Chrome shared by all admin pages: a secondary tab strip above the routed page. Rendered
 *  inside RequireAdmin, so every child route is already admin-gated. Full-width so each page
 *  keeps its own content container. */
export function AdminLayout() {
  return (
    <>
      <nav aria-label="Admin navigation" className="border-b">
        <ul className="mx-auto flex max-w-5xl items-center gap-4 px-8">
          {ADMIN_NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <NavLink
                to={item.href}
                className={({ isActive }) =>
                  isActive
                    ? "inline-block border-b-2 border-foreground py-3 text-sm font-medium text-foreground"
                    : "inline-block border-b-2 border-transparent py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}

export default AdminLayout;
```

- [ ] **Step 6: Run the AdminLayout test to verify it passes**

Run: `task test -- src/components/layout/AdminLayout.test.tsx`
Expected: PASS.

- [ ] **Step 7: Write the failing AdminSources page test** (`src/pages/AdminSources.test.tsx`)

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import type { SourceDomain } from "@/api/types";
import { AdminSources } from "./AdminSources";

const base = env.apiBaseUrl;

function makeSource(overrides: Partial<SourceDomain> = {}): SourceDomain {
  return {
    domain: "example.com",
    llm_tier: "acceptable",
    llm_reason: "Regional outlet.",
    admin_override: "none",
    updated_at: "2026-07-01T12:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminSources />
    </QueryClientProvider>,
  );
}

describe("AdminSources", () => {
  it("renders a row per domain with the effective-tier badge applied", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "variety.com", llm_tier: "trusted", admin_override: "none" }),
          makeSource({ domain: "mshale.com", llm_tier: "low", admin_override: "block" }),
        ]),
      ),
    );
    renderPage();
    expect(await screen.findByText("variety.com")).toBeInTheDocument();
    expect(screen.getByText("mshale.com")).toBeInTheDocument();
    // mshale: admin-blocked -> effective badge "blocked" (unique to the effective column)
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });

  it("renders 'unjudged' in both tier columns for an unjudged domain", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "new.test", llm_tier: null, admin_override: "none" })]),
      ),
    );
    renderPage();
    await screen.findByText("new.test");
    expect(screen.getAllByText("unjudged")).toHaveLength(2);
  });

  it("exposes the full reason via a title attribute", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "x.test", llm_reason: "Aggregator of wire copy." })]),
      ),
    );
    renderPage();
    const cell = await screen.findByText("Aggregator of wire copy.");
    expect(cell).toHaveAttribute("title", "Aggregator of wire copy.");
  });

  it("shows the current override value in the row's select", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "x.test", admin_override: "trust" })]),
      ),
    );
    renderPage();
    expect(await screen.findByLabelText("Override for x.test")).toHaveValue("trust");
  });

  it("shows an empty state when there are no domains", async () => {
    server.use(http.get(`${base}/admin/sources`, () => HttpResponse.json([])));
    renderPage();
    expect(await screen.findByText(/no source domains yet/i)).toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json({ detail: "admin_required" }, { status: 403 }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/failed to load sources/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `task test -- src/pages/AdminSources.test.tsx`
Expected: FAIL — `./AdminSources` not found.

- [ ] **Step 9: Create `src/pages/AdminSources.tsx`**

```tsx
import { effectiveTier, useSources, type EffectiveTier } from "@/api/sources";
import type { SourceDomain, SourceOverride } from "@/api/types";

const TIER_LABELS: Record<string, string> = {
  trusted: "trusted",
  acceptable: "acceptable",
  low: "low",
  blocked: "blocked",
};

const TIER_STYLES: Record<string, string> = {
  trusted: "bg-green-100 text-green-800",
  acceptable: "bg-gray-100 text-gray-800",
  low: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-800",
};

function TierBadge({ tier }: { tier: EffectiveTier }) {
  if (tier === null) {
    return <span className="text-muted-foreground">unjudged</span>;
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TIER_STYLES[tier]}`}>
      {TIER_LABELS[tier]}
    </span>
  );
}

const OVERRIDE_OPTIONS: SourceOverride[] = ["none", "block", "allow", "trust"];

function OverrideSelect({ row }: { row: SourceDomain }) {
  // Interactivity is wired in Task 3; for now this reflects the current value only.
  return (
    <select
      aria-label={`Override for ${row.domain}`}
      value={row.admin_override}
      disabled
      className="rounded border px-2 py-1 text-sm disabled:opacity-70"
    >
      {OVERRIDE_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function AdminSources() {
  const { data: sources, isLoading, isError, error } = useSources();

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Sources</h1>

      {isLoading && <p className="mt-4 text-muted-foreground">Loading sources…</p>}

      {isError && (
        <p className="mt-4 text-red-600">
          Failed to load sources{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {sources && sources.length === 0 && (
        <p className="mt-4 text-muted-foreground">No source domains yet.</p>
      )}

      {sources && sources.length > 0 && (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4 font-medium">Domain</th>
              <th className="py-2 pr-4 font-medium">LLM tier</th>
              <th className="py-2 pr-4 font-medium">Effective</th>
              <th className="py-2 pr-4 font-medium">Reason</th>
              <th className="py-2 pr-4 font-medium">Override</th>
              <th className="py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((row) => (
              <tr key={row.domain} className="border-b align-top">
                <td className="py-2 pr-4 font-medium">{row.domain}</td>
                <td className="py-2 pr-4">
                  <TierBadge tier={row.llm_tier} />
                </td>
                <td className="py-2 pr-4">
                  <TierBadge tier={effectiveTier(row)} />
                </td>
                <td className="max-w-xs truncate py-2 pr-4" title={row.llm_reason ?? undefined}>
                  {row.llm_reason ?? "—"}
                </td>
                <td className="py-2 pr-4">
                  <OverrideSelect row={row} />
                </td>
                <td className="py-2">{formatTime(row.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default AdminSources;
```

- [ ] **Step 10: Run the page test to verify it passes**

Run: `task test -- src/pages/AdminSources.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 11: Wire the routes** — replace the `spa-layout` block in `src/routes.ts`

Replace the existing `layout("routes/spa-layout.tsx", [...])` block with:

```ts
  layout("routes/spa-layout.tsx", [
    route("login", "pages/Login.tsx"),
    route("signup", "pages/Signup.tsx"),
    layout("components/RequireAuth.tsx", [
      layout("components/RequireAdmin.tsx", [
        layout("components/layout/AdminLayout.tsx", [
          route("admin/ingest", "pages/AdminIngest.tsx"),
          route("admin/sources", "pages/AdminSources.tsx"),
        ]),
      ]),
    ]),
  ]),
```

- [ ] **Step 12: Full verify, then commit**

Run: `task typecheck && task lint && task test`
Expected: green, zero warnings. (The route file has no unit test; `typecheck` proves the module paths resolve.)

```bash
git add src/api/sources.ts src/components/layout/admin-nav-items.ts \
  src/components/layout/AdminLayout.tsx src/components/layout/AdminLayout.test.tsx \
  src/routes.ts src/pages/AdminSources.tsx src/pages/AdminSources.test.tsx
git commit -m "feat: add admin Sources page with layout tabs (NEU-456)"
```

---

### Task 3: Live override dropdown with optimistic mutation + toasts

Makes `OverrideSelect` interactive: changing it fires `POST .../override`, optimistically patches the cached row (so the value + effective badge update immediately), reconciles with the server row on success, and rolls back + shows an error toast on failure.

**Files:**
- Modify: `src/api/sources.ts` (add `useSetSourceOverride`)
- Modify: `src/pages/AdminSources.tsx` (wire `OverrideSelect`)
- Test: `src/pages/AdminSources.test.tsx` (add mutation cases)

**Interfaces:**
- Consumes: `setSourceOverride`, `SourceDomain`, `SourceOverride`.
- Produces: `useSetSourceOverride()` — a TanStack mutation whose `mutate({ domain, override })` optimistically updates the `["admin-sources"]` cache.

- [ ] **Step 1: Add the failing mutation tests** — append inside the `describe("AdminSources", …)` block in `src/pages/AdminSources.test.tsx`

Add `userEvent` and `waitFor` to the existing imports at the top of the file:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

Append these cases inside the `describe`:

```tsx
  it("sets an override optimistically and persists it via POST", async () => {
    let body: unknown = null;
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "mshale.com", llm_tier: "low", admin_override: "none" })]),
      ),
      http.post(`${base}/admin/sources/mshale.com/override`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          makeSource({
            domain: "mshale.com",
            llm_tier: "low",
            admin_override: "block",
            updated_at: "2026-07-02T00:00:00Z",
          }),
        );
      }),
    );
    renderPage();
    const select = await screen.findByLabelText("Override for mshale.com");
    await userEvent.selectOptions(select, "block");
    await waitFor(() => expect(select).toHaveValue("block"));
    expect(body).toEqual({ override: "block" });
    // effective tier recomputes to blocked
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });

  it("reverts the override when the POST fails", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "mshale.com", llm_tier: "low", admin_override: "none" })]),
      ),
      http.post(`${base}/admin/sources/mshale.com/override`, () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    );
    renderPage();
    const select = await screen.findByLabelText("Override for mshale.com");
    await userEvent.selectOptions(select, "block");
    // optimistic flip to block, then rollback to none after the error
    await waitFor(() => expect(select).toHaveValue("none"));
  });
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `task test -- src/pages/AdminSources.test.tsx`
Expected: FAIL — the `<select>` is disabled/inert, so selecting an option does nothing (value stays `none`, no POST).

- [ ] **Step 3: Add `useSetSourceOverride` to `src/api/sources.ts`**

Extend the React Query import and add `sonner`/types at the top of `src/api/sources.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SourceDomain, SourceOverride, SourceTier } from "./types";
```

(Replace the existing `useQuery`-only import line and the existing `import type … from "./types"` line with the three lines above — this widens the React Query import and adds the `sonner` import.)

Append to `src/api/sources.ts`:

```ts
/** Set a domain's admin override with an optimistic cache update. Patches the cached
 *  ["admin-sources"] row immediately, reconciles with the server row on success, and rolls
 *  back + toasts on error. */
export function useSetSourceOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ domain, override }: { domain: string; override: SourceOverride }) =>
      setSourceOverride(domain, override),
    onMutate: async ({ domain, override }) => {
      await qc.cancelQueries({ queryKey: ["admin-sources"] });
      const previous = qc.getQueryData<SourceDomain[]>(["admin-sources"]);
      qc.setQueryData<SourceDomain[]>(["admin-sources"], (old) =>
        old?.map((r) => (r.domain === domain ? { ...r, admin_override: override } : r)),
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["admin-sources"], context.previous);
      toast.error(err instanceof Error ? err.message : "Failed to update override");
    },
    onSuccess: (updated) => {
      qc.setQueryData<SourceDomain[]>(["admin-sources"], (old) =>
        old?.map((r) => (r.domain === updated.domain ? updated : r)),
      );
      toast.success(`Override updated for ${updated.domain}`);
    },
  });
}
```

- [ ] **Step 4: Wire `OverrideSelect` in `src/pages/AdminSources.tsx`**

Update the import from `@/api/sources`:

```tsx
import { effectiveTier, useSetSourceOverride, useSources, type EffectiveTier } from "@/api/sources";
```

Replace the entire `OverrideSelect` function with:

```tsx
function OverrideSelect({ row }: { row: SourceDomain }) {
  const mutation = useSetSourceOverride();
  return (
    <select
      aria-label={`Override for ${row.domain}`}
      value={row.admin_override}
      disabled={mutation.isPending}
      onChange={(e) =>
        mutation.mutate({ domain: row.domain, override: e.target.value as SourceOverride })
      }
      className="rounded border px-2 py-1 text-sm disabled:opacity-50"
    >
      {OVERRIDE_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 5: Run the page tests to verify they pass**

Run: `task test -- src/pages/AdminSources.test.tsx`
Expected: PASS (optimistic-set and revert cases green; earlier cases still green).

> Note: no `<Toaster/>` is mounted in the test tree, so `toast.*` calls are harmless no-ops and are not asserted — tests assert the observable cache/DOM effect, matching the existing `EventCard` convention.

- [ ] **Step 6: Full verify, then commit**

Run: `task typecheck && task lint && task test`
Expected: green, zero warnings.

```bash
git add src/api/sources.ts src/pages/AdminSources.tsx src/pages/AdminSources.test.tsx
git commit -m "feat: wire optimistic source override mutation (NEU-456)"
```

---

### Task 4: Filters — domain search, tier filter, overridden-only

Adds a controls row and derives the visible rows client-side, plus a filtered-empty state.

**Files:**
- Modify: `src/pages/AdminSources.tsx`
- Test: `src/pages/AdminSources.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: no new exported symbols; internal filter state on `AdminSources`.

- [ ] **Step 1: Add failing filter tests** — append inside the `describe` in `src/pages/AdminSources.test.tsx`

```tsx
  it("filters rows by the domain search box", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "variety.com" }),
          makeSource({ domain: "mshale.com" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("variety.com");
    await userEvent.type(screen.getByLabelText("Search domains"), "msh");
    expect(screen.getByText("mshale.com")).toBeInTheDocument();
    expect(screen.queryByText("variety.com")).not.toBeInTheDocument();
  });

  it("filters rows by tier", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "variety.com", llm_tier: "trusted" }),
          makeSource({ domain: "mshale.com", llm_tier: "low" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("variety.com");
    await userEvent.selectOptions(screen.getByLabelText("Filter by tier"), "low");
    expect(screen.getByText("mshale.com")).toBeInTheDocument();
    expect(screen.queryByText("variety.com")).not.toBeInTheDocument();
  });

  it("filters to overridden domains only", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "variety.com", admin_override: "none" }),
          makeSource({ domain: "mshale.com", admin_override: "block" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("variety.com");
    await userEvent.click(screen.getByLabelText("Overridden only"));
    expect(screen.getByText("mshale.com")).toBeInTheDocument();
    expect(screen.queryByText("variety.com")).not.toBeInTheDocument();
  });

  it("shows a filtered-empty message when filters exclude every row", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "variety.com" })]),
      ),
    );
    renderPage();
    await screen.findByText("variety.com");
    await userEvent.type(screen.getByLabelText("Search domains"), "zzz");
    expect(screen.getByText(/no domains match your filters/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `task test -- src/pages/AdminSources.test.tsx`
Expected: FAIL — no "Search domains"/"Filter by tier"/"Overridden only" controls exist.

- [ ] **Step 3: Add filter state, controls, and derived rows to `src/pages/AdminSources.tsx`**

Update the React import at the top of the file (add it if absent):

```tsx
import { useMemo, useState } from "react";
```

Add this constant near the other module constants (below `OVERRIDE_OPTIONS`):

```tsx
type TierFilter = "all" | "trusted" | "acceptable" | "low" | "unjudged";
const TIER_FILTERS: TierFilter[] = ["all", "trusted", "acceptable", "low", "unjudged"];
```

Replace the body of `AdminSources` (from `const { data: sources … }` down to the final `return`) so it computes `visible` and renders controls. The full function becomes:

```tsx
export function AdminSources() {
  const { data: sources, isLoading, isError, error } = useSources();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [overriddenOnly, setOverriddenOnly] = useState(false);

  const visible = useMemo(() => {
    if (!sources) return [];
    const q = search.trim().toLowerCase();
    return sources.filter((r) => {
      if (q && !r.domain.toLowerCase().includes(q)) return false;
      if (tierFilter !== "all") {
        if (tierFilter === "unjudged" ? r.llm_tier !== null : r.llm_tier !== tierFilter) return false;
      }
      if (overriddenOnly && r.admin_override === "none") return false;
      return true;
    });
  }, [sources, search, tierFilter, overriddenOnly]);

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Sources</h1>

      {isLoading && <p className="mt-4 text-muted-foreground">Loading sources…</p>}

      {isError && (
        <p className="mt-4 text-red-600">
          Failed to load sources{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {sources && sources.length === 0 && (
        <p className="mt-4 text-muted-foreground">No source domains yet.</p>
      )}

      {sources && sources.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <input
              type="search"
              aria-label="Search domains"
              placeholder="Search domains…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-2 py-1 text-sm"
            />
            <select
              aria-label="Filter by tier"
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as TierFilter)}
              className="rounded border px-2 py-1 text-sm"
            >
              {TIER_FILTERS.map((t) => (
                <option key={t} value={t}>
                  {t === "all" ? "All tiers" : t}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={overriddenOnly}
                onChange={(e) => setOverriddenOnly(e.target.checked)}
              />
              Overridden only
            </label>
          </div>

          {visible.length === 0 ? (
            <p className="mt-4 text-muted-foreground">No domains match your filters.</p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">Domain</th>
                  <th className="py-2 pr-4 font-medium">LLM tier</th>
                  <th className="py-2 pr-4 font-medium">Effective</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Override</th>
                  <th className="py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.domain} className="border-b align-top">
                    <td className="py-2 pr-4 font-medium">{row.domain}</td>
                    <td className="py-2 pr-4">
                      <TierBadge tier={row.llm_tier} />
                    </td>
                    <td className="py-2 pr-4">
                      <TierBadge tier={effectiveTier(row)} />
                    </td>
                    <td className="max-w-xs truncate py-2 pr-4" title={row.llm_reason ?? undefined}>
                      {row.llm_reason ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <OverrideSelect row={row} />
                    </td>
                    <td className="py-2">{formatTime(row.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the page tests to verify they pass**

Run: `task test -- src/pages/AdminSources.test.tsx`
Expected: PASS (filter cases green; existing cases still green).

- [ ] **Step 5: Full verify, then commit**

Run: `task typecheck && task lint && task test`
Expected: green, zero warnings.

```bash
git add src/pages/AdminSources.tsx src/pages/AdminSources.test.tsx
git commit -m "feat: add search and tier/override filters to Sources page (NEU-456)"
```

---

### Task 5: Sorting — attention-first default + sortable headers

Adds a default "attention-first" sort (`low` tier first, then newest `updated_at`) and clickable Domain / LLM tier / Updated headers that override it.

**Files:**
- Modify: `src/pages/AdminSources.tsx`
- Test: `src/pages/AdminSources.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: no new exported symbols; internal sort state on `AdminSources`.

- [ ] **Step 1: Add failing sort tests** — append inside the `describe` in `src/pages/AdminSources.test.tsx`

```tsx
  it("sorts low-tier domains first by default", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "trusted.test", llm_tier: "trusted", updated_at: "2026-07-01T00:00:00Z" }),
          makeSource({ domain: "low.test", llm_tier: "low", updated_at: "2026-06-01T00:00:00Z" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("low.test");
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows[0]).toHaveTextContent("low.test");
  });

  it("sorts alphabetically by domain when the Domain header is clicked", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([
          makeSource({ domain: "zeta.test", llm_tier: "low" }),
          makeSource({ domain: "alpha.test", llm_tier: "trusted" }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText("alpha.test");
    await userEvent.click(screen.getByRole("button", { name: /^domain/i }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("alpha.test");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `task test -- src/pages/AdminSources.test.tsx`
Expected: FAIL — default order is currently API order (trusted.test first); headers are plain text, so there is no `button` named "Domain".

- [ ] **Step 3: Add the tier-rank helper and sort state to `src/pages/AdminSources.tsx`**

Add these module-level helpers near the other constants:

```tsx
type SortColumn = "domain" | "llm_tier" | "updated_at";
type SortState = { column: SortColumn; dir: "asc" | "desc" };

const TIER_RANK: Record<string, number> = { low: 0, acceptable: 1, trusted: 2 };
function tierRank(tier: SourceTier | null): number {
  return tier === null ? 3 : TIER_RANK[tier];
}
```

Add the import of `SourceTier` to the types import line in the page:

```tsx
import type { SourceDomain, SourceOverride, SourceTier } from "@/api/types";
```

- [ ] **Step 4: Add sort state + derived sorting inside `AdminSources`**

Immediately after the `visible` `useMemo`, add:

```tsx
  const [sort, setSort] = useState<SortState | null>(null);

  const sorted = useMemo(() => {
    const rows = [...visible];
    if (!sort) {
      // attention-first: low tier first, then newest updated_at
      rows.sort(
        (a, b) => tierRank(a.llm_tier) - tierRank(b.llm_tier) || b.updated_at.localeCompare(a.updated_at),
      );
      return rows;
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      if (sort.column === "domain") cmp = a.domain.localeCompare(b.domain);
      else if (sort.column === "llm_tier") cmp = tierRank(a.llm_tier) - tierRank(b.llm_tier);
      else cmp = a.updated_at.localeCompare(b.updated_at);
      return cmp * dir;
    });
    return rows;
  }, [visible, sort]);

  function toggleSort(column: SortColumn) {
    setSort((prev) =>
      prev?.column === column
        ? { column, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { column, dir: "asc" },
    );
  }
```

- [ ] **Step 5: Render sortable headers and map over `sorted`**

In the same file, replace the `<thead>…</thead>` block with sortable header buttons:

```tsx
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">
                    <button type="button" className="font-medium" onClick={() => toggleSort("domain")}>
                      Domain
                    </button>
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    <button type="button" className="font-medium" onClick={() => toggleSort("llm_tier")}>
                      LLM tier
                    </button>
                  </th>
                  <th className="py-2 pr-4 font-medium">Effective</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Override</th>
                  <th className="py-2 font-medium">
                    <button type="button" className="font-medium" onClick={() => toggleSort("updated_at")}>
                      Updated
                    </button>
                  </th>
                </tr>
              </thead>
```

Then change the row map from `visible.map(...)` to `sorted.map(...)` (the `<tbody>` block — only the mapped collection changes; the row markup is unchanged).

- [ ] **Step 6: Run the page tests to verify they pass**

Run: `task test -- src/pages/AdminSources.test.tsx`
Expected: PASS (default-order and domain-sort cases green; all earlier cases still green).

- [ ] **Step 7: Full verify, then commit**

Run: `task typecheck && task lint && task test`
Expected: green, zero warnings.

```bash
git add src/pages/AdminSources.tsx src/pages/AdminSources.test.tsx
git commit -m "feat: add default and column sorting to Sources page (NEU-456)"
```

---

## Final verification

- [ ] Run the full suite once more: `task typecheck && task lint && task test` — all green, zero ESLint warnings.
- [ ] Manually sanity-check in the running app (`task up`): as an admin, open the header **Admin** menu → land on Ingestion → click the **Sources** tab → confirm the table loads, search/tier/overridden filters narrow rows, headers re-sort, and changing an override shows an immediate update + toast.

## Spec coverage check

- Admin reaches the page → Task 2 (AdminLayout tabs + route).
- View all domains with tier + reason + effective tier → Task 2.
- Set/clear per-domain override, persists, precedence visible → Tasks 1 (endpoint), 3 (mutation + optimistic effective-tier update).
- Search / tier+override filter / sortable columns → Tasks 4, 5.
- Optimistic + toast mutation strategy → Task 3.
- States (loading/error/empty/filtered-empty) → Tasks 2, 4.
- Effective-tier helper → Task 1.
- No backend change; client-side-only list handling → honored throughout.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
