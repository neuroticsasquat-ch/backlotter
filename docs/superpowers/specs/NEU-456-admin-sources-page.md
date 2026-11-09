# NEU-456 — Admin Sources page (design)

**Ticket:** [NEU-456 — Admin lever to blacklist / trust news source domains (frontend)](https://linear.app/neuroticsasquatch/issue/NEU-456/admin-lever-to-blacklist-trust-news-source-domains-frontend)
**Repo:** `upcoming-movies-frontend`
**Status:** design approved 2026-07-01

## Problem

The source-quality gate ([NEU-454](https://linear.app/neuroticsasquatch/issue/NEU-454/bug-google-news-searches-pull-in-low-quality-sources), backend, **merged** in PR #98) maintains a `news.source_domain` table with an LLM-assigned trust tier (`trusted` / `acceptable` / `low`) per resolved publisher domain, plus a per-domain `admin_override`. Admin overrides always win over the LLM verdict; `block` drops a domain from ingestion entirely. There is currently **no UI** to see those verdicts or set the overrides — this ticket is that admin lever.

## Fixed backend contract (already shipped)

`src/upmovies/routers/sources_admin.py`, session-admin (`require_current_admin`) + CSRF, same human-facing auth mode as `/admin/runs`:

- `GET /admin/sources` → `SourceDomainOut[]`
  ```
  { domain: string,
    llm_tier: "trusted" | "acceptable" | "low" | null,
    llm_reason: string | null,
    admin_override: "none" | "block" | "allow" | "trust",
    updated_at: string /* ISO-8601 */ }
  ```
  Returns **all** rows (no server-side pagination or filtering).
- `POST /admin/sources/{domain}/override` — body `{ override: "none" | "block" | "allow" | "trust" }` → returns the updated `SourceDomainOut` row.

No backend change is in scope; the frontend wires against this contract as-is.

## Frontend context

React 19 + React Router 7 (framework/file-route mode via `src/routes.ts`) + TanStack Query + Tailwind v4; `sonner` toasts are already mounted in `spa-layout.tsx`. Conventions this design follows:

- **HTTP** through `apiFetch<T>(path, init?)` (`src/api/client.ts`) — sends `credentials: "include"`, attaches the CSRF header on mutations, throws `ApiError` (with `.status` / `.message`) on non-2xx. Never call `fetch` directly.
- **Server state = TanStack Query.** One `api/*.ts` module per domain exporting typed fetchers + hooks (template: `src/api/runs.ts`).
- **Admin routing:** admin pages nest under `RequireAuth → RequireAdmin` in `routes.ts`. Existing admin page: `pages/AdminIngest.tsx` at `admin/ingest`. The header "Admin" link (`components/layout/HeaderAccount.tsx`) points at `/admin/ingest` and renders only for `user.is_admin`.
- **Tests:** TDD with Vitest + RTL + MSW (`onUnhandledRequest: "error"`; `meHandler({ is_admin })` helper).

## Approach

Add a second admin page (`/admin/sources`) and a **shared admin layout** that provides sub-navigation between the two admin pages (approach A — chosen over a second header link or an admin index page because it scales cleanly as more admin surfaces are added and keeps the account menu uncluttered).

## Components

### 1. Routing & navigation — shared admin layout

Introduce an `AdminLayout` route component nested between `RequireAdmin` and the admin pages. In `src/routes.ts`:

```
layout("routes/spa-layout.tsx", [
  route("login",  "pages/Login.tsx"),
  route("signup", "pages/Signup.tsx"),
  layout("components/RequireAuth.tsx", [
    layout("components/RequireAdmin.tsx", [
      layout("components/layout/AdminLayout.tsx", [   // new
        route("admin/ingest",  "pages/AdminIngest.tsx"),
        route("admin/sources", "pages/AdminSources.tsx"),   // new
      ]),
    ]),
  ]),
])
```

- **`components/layout/AdminLayout.tsx`** — renders an admin sub-nav tab strip above an `<Outlet/>`. Tabs come from a small `ADMIN_NAV_ITEMS = [{ label: "Ingestion", href: "/admin/ingest" }, { label: "Sources", href: "/admin/sources" }]` list, rendered with react-router `NavLink` and active-state styling matching `PrimaryNav.tsx`.
- The header "Admin" link stays `/admin/ingest`. `AdminIngest` is unchanged except that it now renders inside `AdminLayout` (gains the tabs for free; no edits to its body required).

### 2. API module — `src/api/sources.ts` (mirrors `runs.ts`)

Types (added here or in `api/types.ts`, following how `IngestRun` mirrors the backend shape):

```ts
export type SourceTier = "trusted" | "acceptable" | "low";
export type SourceOverride = "none" | "block" | "allow" | "trust";
export interface SourceDomain {
  domain: string;
  llm_tier: SourceTier | null;
  llm_reason: string | null;
  admin_override: SourceOverride;
  updated_at: string;
}
```

Fetchers + hooks:

- `fetchSources() => apiFetch<SourceDomain[]>("/admin/sources")`
- `setSourceOverride(domain, override) => apiFetch<SourceDomain>(\`/admin/sources/${encodeURIComponent(domain)}/override\`, { method: "POST", body: JSON.stringify({ override }) })`
- `useSources()` → `useQuery({ queryKey: ["admin-sources"], queryFn: fetchSources })`. **No polling** (unlike `useRuns`) — the data is near-static and only changes via this page's own mutations.
- `useSetSourceOverride()` → `useMutation` with **optimistic update**:
  - `onMutate`: cancel in-flight `["admin-sources"]` queries, snapshot current cache, optimistically patch the target row's `admin_override` in the cached list.
  - `onError`: roll back to the snapshot, show an error toast (`toast.error(err.message)`).
  - `onSuccess`: reconcile the cached row with the authoritative row returned by the POST (picks up the server's new `updated_at`), show a success toast.
  - Row identity is `domain` (the table PK).

### 3. Effective-tier helper (pure)

The backend returns the raw `llm_tier` + `admin_override` but not the resolved verdict the gate consumes. A pure helper makes the *consequence* of an override visible:

```
effectiveTier(row):
  admin_override === "block" -> "blocked"
  admin_override === "trust" -> "trusted"
  admin_override === "allow" -> "acceptable"
  admin_override === "none"  -> row.llm_tier   // may be null (unjudged)
```

Lives alongside the page (or in `api/sources.ts`), unit-tested independently.

### 4. Page — `src/pages/AdminSources.tsx`

**Controls row** (all client-side over the full fetched list):
- **Domain search** — case-insensitive substring filter on `domain`.
- **Tier filter** — `all` / `trusted` / `acceptable` / `low` / `unjudged` (`unjudged` = `llm_tier === null`), filtering on `llm_tier`.
- **Overridden-only toggle** — when on, show only rows where `admin_override !== "none"`.

Filters compose (AND) and are applied before sorting.

**Table columns:**
| Column | Content | Sortable |
|---|---|---|
| Domain | `domain` | yes |
| LLM tier | tier badge (`trusted`/`acceptable`/`low`) or "unjudged" when null | yes |
| Effective tier | badge from `effectiveTier(row)` (`blocked`/`trusted`/`acceptable`/`low`/"unjudged") | no |
| Reason | `llm_reason` (truncated with title/full-text affordance; "—" when null) | no |
| Override | 4-option `<select>` dropdown bound to `admin_override` | no |
| Updated | `updated_at` rendered via `toLocaleString()` | yes |

- **Default sort:** attention-first — `low` LLM tier at top, then `updated_at` descending. Tier sort order for comparison: `low < acceptable < trusted < unjudged(null)`. Clicking a sortable header switches to that column (toggling asc/desc) and overrides the default.
- **Override dropdown:** the four `SourceOverride` values; `disabled` while its own mutation is in flight (keyed by domain) to prevent double-submits.

**States:**
- Loading → "Loading sources…"
- Error → red message using `ApiError.message` (mirrors `AdminIngest`).
- Empty (`rows.length === 0`) → "No source domains yet."
- Filtered-empty (rows exist but filters exclude all) → "No domains match your filters."

**Layout:** `AdminIngest`-style container (`mx-auto max-w-4xl p-8`, or wider if the column count warrants), page heading "Sources".

## Data flow

```
useSources() ──GET /admin/sources──▶ ["admin-sources"] cache ──▶ client filter+sort ──▶ table rows
                                            ▲                                                  │
                                            │ optimistic patch / reconcile                     │ change dropdown
                                            └────── useSetSourceOverride() ◀──POST override─────┘
                                                       (rollback + error toast on failure)
```

## Testing (TDD — Vitest + RTL + MSW)

- **`api/sources.test.ts`** — `fetchSources` returns typed rows; `setSourceOverride` hits the correctly `encodeURIComponent`-ed URL with the right JSON body and method.
- **`effectiveTier` unit test** — each override branch, plus `none` + null `llm_tier` → null.
- **`AdminSources.test.tsx`** —
  - renders a row per domain with tier + effective-tier badges;
  - domain search filters rows; tier filter filters rows; overridden-only toggle filters rows; combined filters AND correctly;
  - clicking a sortable header reorders rows;
  - changing an override dropdown fires the POST, optimistically updates the row, and shows a success toast;
  - a failing POST reverts the row and shows an error toast;
  - loading / error / empty / filtered-empty states render.
- **`AdminLayout.test.tsx`** — both tabs render with correct `href`s and the active tab reflects the current route.
- Admin gating is inherited from the existing `RequireAdmin` nesting (already tested); no new gating test required.

Run the full local CI (`task typecheck` + `task lint` + `task test`, all in-container, zero ESLint warnings) before opening the PR. Format only touched files.

## Acceptance criteria

- An admin can reach a **Sources** page from the admin sub-nav and view all known source domains with their LLM tier, reason, effective tier, and current override.
- The admin can set/clear a per-domain override via the dropdown; the change persists (POST) and the row reflects the new override and effective tier immediately (optimistic), with a success/error toast.
- Domain search, tier/override filtering, and column sorting all work client-side over the full list.
- New/changed files pass `task typecheck`, `task lint` (zero warnings), and `task test`.

## Out of scope

- Any backend change — the `GET`/`POST` contract is fixed and merged (NEU-454, PR #98).
- Server-side pagination/search — the list is small and returned whole; everything is client-side. Revisit only if the domain count makes client-side handling unwieldy.
- Bulk override actions and manually adding domains (domains appear lazily via ingestion).
- Surfacing per-domain event counts / impact metrics (not in the endpoint; add later if useful).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
