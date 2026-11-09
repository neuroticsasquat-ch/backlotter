# NEU-376 — Show Per-Run LLM Cost in Admin Runs View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the per-stage LLM token usage and dollar cost that backend ticket NEU-375 now returns on each ingest run. Extend the frontend `IngestRun` type with the new `llm_usage` field, add a small `formatUsd` helper, and render — inside the existing admin runs table (`pages/AdminIngest.tsx`) — a compact per-stage breakdown (stage, model, the four token counts, and `cost_usd` formatted as USD) plus a per-run total cost. Runs whose `llm_usage` is empty (older runs that predate telemetry) must render gracefully.

**Architecture:** Pure display change in the frontend repo. The backend already persists and exposes the data (NEU-375): `GET /admin/runs` and `GET /admin/runs/{id}` now return each run with an `llm_usage` array. There is no new HTTP call, no new query, and no new route — the existing `useRuns()` hook (`api/runs.ts`) already fetches `/admin/runs?limit=…` and the `AdminIngest` page already maps over the rows. The work is: (1) widen the `IngestRun` interface in `api/types.ts` to include `llm_usage`; (2) add a `formatUsd` currency formatter to `lib/format.ts` (the repo's formatting home, which already has a colocated `format.test.ts`); (3) render an expandable per-run cost panel in `AdminIngest.tsx`; (4) extend the existing vitest suites (`api/runs.test.ts` for shape, `pages/AdminIngest.test.tsx` for rendering + empty state, `lib/format.test.ts` for the formatter). No migration, no new dependency, no new component file required.

**Tech Stack:** React 19 + TypeScript, react-router 8, TanStack Query v5 (server state), Tailwind v4, Vitest 4 + Testing Library + MSW 2, jsdom. pnpm (`pnpm@9.15.0`). **Everything runs in the `upmovies-frontend` container via `task` targets** — never run `pnpm`/`vitest`/`eslint`/`tsc`/`prettier` on the host.

## Global Constraints

- **One frontend PR**, on branch `tom/neu-376-frontend-show-per-run-token-cost-in-admin-runs-view`.
- **Container-only tooling:** use `task test`, `task lint`, `task typecheck`, `task format` (they `docker compose exec -T` into `upmovies-frontend`). Keep the container up (`task up`). Source is bind-mounted (Vite HMR is live); this ticket adds **no** dependencies, so no `task build` is needed.
- **CI must be green before done — run the FULL set locally before pushing:** `task typecheck` (which runs `react-router typegen && tsc -b`), `task lint` (`eslint src --max-warnings 0` — **zero warnings**; an unused import or variable fails the build), and `task test` (`vitest run`). Apply `task format` to every file you touch.
- **TDD:** write the failing test first, then the implementation, per the repo convention. MSW intercepts all HTTP with `onUnhandledRequest: "error"`; override per-test with `server.use(...)`.
- **jsdom quirk:** jsdom keeps a `Range` selection between `fireEvent.click` calls. This plan's interaction is a `<details>` toggle driven via `userEvent.click` / `fireEvent.click`; if a future guard depends on `window.getSelection()`, clear it with `window.getSelection()?.removeAllRanges()` between clicks. Not expected to bite here (we use the native `<details>`/`<summary>` open state, which does not read the selection), but follow the repo pattern if it does.
- **Prettier config (must match):** `printWidth: 100`, double quotes, `trailingComma: "all"`, `tabWidth: 2`, `arrowParens: "always"`, `semi: true`. Do **not** reformat unrelated files — format only what you touch (`AuthContext.*` has pre-existing drift on `main`; leave it).
- **Types mirror the backend.** The new `LlmStageUsage` shape and `llm_usage` field must match the NEU-375 `RunOut` response exactly (see the contract below). Keep `api/types.ts` in sync with the backend.
- **Commit message:** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-376.` in the body), **no** `🤖 Generated with Claude Code` footer in the commit, **no** `Co-Authored-By`. (The `🤖` footer belongs only in the PR body.)

### The contract this ticket consumes (already built by NEU-375 — treat as given)

`GET /admin/runs` and `GET /admin/runs/{id}` now return each run with an additional field:

```ts
llm_usage: Array<{
  stage: "link" | "cluster" | "summarize";
  model: string;
  batched: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}>;
```

One element per stage that ran in that run. Older runs (predating telemetry) return `llm_usage: []`. The per-run total cost is the sum of each element's `cost_usd`.

---

### Task 1: Add the `LlmStageUsage` type and extend `IngestRun`

**Files:**
- Modify: `src/api/types.ts` (add `LlmStage` + `LlmStageUsage`; add `llm_usage` to `IngestRun`)
- Modify: `src/api/runs.test.ts` (assert the new field parses)

**Interfaces:**
- Consumes: the NEU-375 contract above (external, given).
- Produces:
  - `export type LlmStage = "link" | "cluster" | "summarize";`
  - `export interface LlmStageUsage { stage: LlmStage; model: string; batched: boolean; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; cost_usd: number; }`
  - `IngestRun` gains `llm_usage: LlmStageUsage[];`
- All existing `IngestRun` fields are unchanged.

- [ ] **Step 1: Create the work branch**

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-frontend
git checkout main && git pull
git checkout -b tom/neu-376-frontend-show-per-run-token-cost-in-admin-runs-view
```

- [ ] **Step 2: Confirm the container is up**

```bash
task up
```

Expected: `upmovies-frontend` container running (needed for every `task` target below). If `task ps` shows it is not up, run `task up` again; if a dependency error appears, the shared infra must be up first (`task infra:up` per the umbrella Taskfile).

- [ ] **Step 3: Write the failing shape test in `src/api/runs.test.ts`**

Add a new test inside `describe("runs api", …)` that returns a run carrying `llm_usage` and asserts it parses through the typed fetcher. Place it after the existing `fetchRun` test:

```ts
  it("fetchRuns surfaces the llm_usage breakdown on a run", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([
          {
            id: "r2",
            kind: "feeds",
            status: "succeeded",
            started_at: "2026-06-13T09:00:00Z",
            finished_at: "2026-06-13T09:05:00Z",
            items_processed: 12,
            items_failed: 0,
            last_progress_at: null,
            detail: null,
            error: null,
            llm_usage: [
              {
                stage: "link",
                model: "claude-haiku-4-5",
                batched: true,
                input_tokens: 12000,
                output_tokens: 800,
                cache_read_input_tokens: 4000,
                cache_creation_input_tokens: 1000,
                cost_usd: 0.0123,
              },
            ],
          },
        ]),
      ),
    );
    const runs = await fetchRuns();
    expect(runs[0].llm_usage).toHaveLength(1);
    expect(runs[0].llm_usage[0].stage).toBe("link");
    expect(runs[0].llm_usage[0].cost_usd).toBeCloseTo(0.0123);
  });
```

- [ ] **Step 4: Run the new test to verify it fails to type-check / fails**

Run: `task test -- src/api/runs.test.ts`

Expected: the test run reports a TypeScript error such as `Property 'llm_usage' does not exist on type 'IngestRun'` (the field is not yet on the interface). This is the expected red state. (If vitest's esbuild transpile lets it run without the type, the assertion still passes vacuously only once the type exists — `task typecheck` in Step 6 is the firm gate.)

- [ ] **Step 5: Add the types to `src/api/types.ts`**

Insert the new stage type and usage interface immediately above the existing `IngestRun` interface, then add the `llm_usage` field to `IngestRun`. The relevant region currently reads:

```ts
export type IngestRunKind = "tmdb" | "feeds";
export type IngestRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface IngestRun {
  id: string;
  kind: IngestRunKind;
  status: IngestRunStatus;
  started_at: string;
  finished_at: string | null;
  items_processed: number;
  items_failed: number;
  last_progress_at: string | null;
  detail: string | null;
  error: string | null;
}
```

Replace it with:

```ts
export type IngestRunKind = "tmdb" | "feeds";
export type IngestRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type LlmStage = "link" | "cluster" | "summarize";

/** Per-stage LLM token usage + estimated dollar cost for one ingest run. Mirrors the
 * backend `RunOut.llm_usage` element (NEU-375). Older runs predate telemetry and return []. */
export interface LlmStageUsage {
  stage: LlmStage;
  model: string;
  batched: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}

export interface IngestRun {
  id: string;
  kind: IngestRunKind;
  status: IngestRunStatus;
  started_at: string;
  finished_at: string | null;
  items_processed: number;
  items_failed: number;
  last_progress_at: string | null;
  detail: string | null;
  error: string | null;
  llm_usage: LlmStageUsage[];
}
```

- [ ] **Step 6: Run the shape test + typecheck to verify green**

```bash
task test -- src/api/runs.test.ts
task typecheck
```

Expected: `task test` passes the new `llm_usage` test **and** the two pre-existing `runs api` tests. `task typecheck` (`react-router typegen && tsc -b`) reports no errors — note the pre-existing `runs.test.ts` mock objects (the `r1`/`r9` literals) do **not** yet include `llm_usage` and may now be flagged. If `tsc -b` reports a missing `llm_usage` on those literals, add `llm_usage: []` to each (the `r1` object in the `fetchRuns` test and the `r9` object in the `fetchRun` test) so the mocks satisfy `IngestRun`. Re-run both commands until clean.

---

### Task 2: Add a `formatUsd` currency formatter

**Files:**
- Modify: `src/lib/format.ts` (add `formatUsd`)
- Modify: `src/lib/format.test.ts` (cover the formatter)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function formatUsd(amount: number): string;` — formats a dollar amount with up to 4 fractional digits (LLM costs are sub-cent), e.g. `0.0123` → `"$0.0123"`, `0` → `"$0.00"`, `1.5` → `"$1.50"`.

- [ ] **Step 7: Write the failing formatter test in `src/lib/format.test.ts`**

Add the import and a new `describe` block. Update the existing import line at the top of the file from:

```ts
import { dayKey, formatDayHeading, formatEventDate, truncate } from "@/lib/format";
```

to:

```ts
import { dayKey, formatDayHeading, formatEventDate, formatUsd, truncate } from "@/lib/format";
```

Then append this block at the end of the file:

```ts
describe("formatUsd", () => {
  it("formats whole and 2-decimal amounts with a dollar sign", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1.5)).toBe("$1.50");
  });

  it("keeps sub-cent precision up to 4 fractional digits", () => {
    expect(formatUsd(0.0123)).toBe("$0.0123");
  });

  it("rounds to at most 4 fractional digits", () => {
    expect(formatUsd(0.012345)).toBe("$0.0123");
  });
});
```

- [ ] **Step 8: Run the formatter test to verify it fails**

Run: `task test -- src/lib/format.test.ts`

Expected: FAIL — `formatUsd` is not exported (`No "formatUsd" export is defined …` / `formatUsd is not a function`).

- [ ] **Step 9: Implement `formatUsd` in `src/lib/format.ts`**

Add a shared `Intl.NumberFormat` and the function. Append to the end of `src/lib/format.ts`:

```ts
const USD_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Format a dollar amount as USD with 2–4 fractional digits (LLM costs are sub-cent). */
export function formatUsd(amount: number): string {
  return USD_FMT.format(amount);
}
```

- [ ] **Step 10: Run the formatter test to verify green**

Run: `task test -- src/lib/format.test.ts`

Expected: PASS — all four `formatUsd` assertions green, and the pre-existing `formatEventDate` / `truncate` / `dayKey` / `formatDayHeading` blocks stay green. (`Intl.NumberFormat` with `style: "currency"` renders `0.0123` as `$0.0123` and `0.012345` rounded to `$0.0123`; `1.5` → `$1.50`, `0` → `$0.00`.)

---

### Task 3: Render the per-run cost breakdown in `AdminIngest.tsx`

**Files:**
- Modify: `src/pages/AdminIngest.tsx` (add a `Cost` column + an expandable per-stage panel; helpers for totals + token formatting)

**Interfaces:**
- Consumes: `IngestRun.llm_usage` (Task 1), `LlmStageUsage` (Task 1), `formatUsd` (Task 2).
- Produces: no new exported symbols — internal helpers (`runTotalCost`, `formatTokens`) and JSX only. `AdminIngest` (and its default export) keep their existing signatures.

**Design notes:**
- The current page renders one `<tr>` per run in a flat table. Add a **"Cost"** column to the header and body whose cell shows the per-run **total** cost via `formatUsd(runTotalCost(run))`. When `run.llm_usage` is non-empty, wrap that cell's content (or add an adjacent `<details>` element) so the four-token-per-stage breakdown is reachable; when empty, render a muted `—` and **no** disclosure.
- Use a native `<details><summary>` disclosure (no Radix needed, no extra dep, no pointer/ResizeObserver polyfills, and it does not read the text selection — sidestepping the jsdom Range quirk). Inside `<details>`, render a nested mini-table: one row per `LlmStageUsage` with `stage`, `model`, the four token counts (formatted with thousands separators via `formatTokens`), and `formatUsd(u.cost_usd)`.
- Keep the existing Tailwind classes / table styling consistent (`text-sm`, `border-b`, `py-2 pr-4`, `text-muted-foreground`).
- A `<details>` placed inside a `<td>` is valid HTML; rendering the breakdown in the same `Cost` cell keeps the column count stable and avoids a fragile spanning second `<tr>`.

- [ ] **Step 11: Write the failing render tests in `src/pages/AdminIngest.test.tsx`**

First extend the `makeRun` factory so existing rows satisfy the widened `IngestRun` type by default. Change the factory's return object from:

```ts
function makeRun(overrides: Partial<IngestRun> = {}): IngestRun {
  return {
    id: crypto.randomUUID(),
    kind: "tmdb",
    status: "succeeded",
    started_at: "2026-06-13T09:00:00Z",
    finished_at: "2026-06-13T09:05:00Z",
    items_processed: 42,
    items_failed: 0,
    last_progress_at: "2026-06-13T09:05:00Z",
    detail: null,
    error: null,
    ...overrides,
  };
}
```

to (add `llm_usage: []` as the default so older tests keep passing, plus import the new type):

```ts
function makeRun(overrides: Partial<IngestRun> = {}): IngestRun {
  return {
    id: crypto.randomUUID(),
    kind: "tmdb",
    status: "succeeded",
    started_at: "2026-06-13T09:00:00Z",
    finished_at: "2026-06-13T09:05:00Z",
    items_processed: 42,
    items_failed: 0,
    last_progress_at: "2026-06-13T09:05:00Z",
    detail: null,
    error: null,
    llm_usage: [],
    ...overrides,
  };
}
```

Update the top imports of the test file. Change:

```ts
import type { IngestRun } from "@/api/types";
```

to:

```ts
import type { IngestRun, LlmStageUsage } from "@/api/types";
```

and add `userEvent` to the Testing Library imports — change:

```ts
import { render, screen } from "@testing-library/react";
```

to:

```ts
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

Add a small usage factory just below `makeRun`:

```ts
function makeUsage(overrides: Partial<LlmStageUsage> = {}): LlmStageUsage {
  return {
    stage: "link",
    model: "claude-haiku-4-5",
    batched: true,
    input_tokens: 12000,
    output_tokens: 800,
    cache_read_input_tokens: 4000,
    cache_creation_input_tokens: 1000,
    cost_usd: 0.0123,
    ...overrides,
  };
}
```

Then add three tests inside `describe("AdminIngest", …)`:

```ts
  it("shows the per-run total cost", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([
          makeRun({
            kind: "tmdb",
            llm_usage: [
              makeUsage({ stage: "link", cost_usd: 0.02 }),
              makeUsage({ stage: "summarize", cost_usd: 0.03 }),
            ],
          }),
        ]),
      ),
    );
    renderPage();
    // total = 0.02 + 0.03 = 0.05 -> "$0.05"
    expect(await screen.findByText("$0.05")).toBeInTheDocument();
  });

  it("reveals per-stage tokens and cost when the breakdown is expanded", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([
          makeRun({
            kind: "tmdb",
            llm_usage: [
              makeUsage({
                stage: "link",
                model: "claude-haiku-4-5",
                input_tokens: 12000,
                output_tokens: 800,
                cache_read_input_tokens: 4000,
                cache_creation_input_tokens: 1000,
                cost_usd: 0.0123,
              }),
            ],
          }),
        ]),
      ),
    );
    renderPage();
    const toggle = await screen.findByText(/breakdown/i);
    await userEvent.click(toggle);
    expect(screen.getByText("link")).toBeInTheDocument();
    expect(screen.getByText("claude-haiku-4-5")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("4,000")).toBeInTheDocument();
    expect(screen.getByText("$0.0123")).toBeInTheDocument();
  });

  it("renders runs with empty llm_usage without a breakdown", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([makeRun({ kind: "tmdb", llm_usage: [] })]),
      ),
    );
    renderPage();
    expect(await screen.findByText("tmdb")).toBeInTheDocument();
    // empty usage -> no disclosure control, muted dash for cost
    expect(screen.queryByText(/breakdown/i)).not.toBeInTheDocument();
  });
```

Note: the breakdown content inside `<details>` is present in the DOM even when collapsed (jsdom does not hide closed `<details>` content from queries), so the expand test would pass without the click. Keep the `userEvent.click(toggle)` anyway — it documents the intended interaction and guards against a future change to a JS-gated panel. If you later switch to a JS-gated (conditionally mounted) panel, the click becomes load-bearing; if the breakdown stays a native `<details>`, querying works either way.

- [ ] **Step 12: Run the new render tests to verify they fail**

Run: `task test -- src/pages/AdminIngest.test.tsx`

Expected: the three new tests FAIL — `$0.05`, the `/breakdown/i` toggle, `12,000`, `4,000`, and `$0.0123` are not yet rendered (the page has no Cost column or breakdown). The four pre-existing `AdminIngest` tests stay green (the `makeRun` default `llm_usage: []` keeps them rendering as before).

- [ ] **Step 13: Implement the Cost column + breakdown in `src/pages/AdminIngest.tsx`**

Replace the entire file with the version below. It adds: the `formatUsd` import, the `LlmStageUsage` type import, `runTotalCost` + `formatTokens` helpers, a `CostCell` sub-component using `<details>`, the new `Cost` `<th>`, and the new `<td>` per row.

```tsx
import { useRuns } from "@/api/runs";
import type { IngestRunStatus, LlmStageUsage } from "@/api/types";
import { formatUsd } from "@/lib/format";

const STATUS_STYLES: Record<IngestRunStatus, string> = {
  running: "bg-blue-100 text-blue-800",
  succeeded: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
};

const TOKEN_FMT = new Intl.NumberFormat("en-US");

function formatTokens(n: number): string {
  return TOKEN_FMT.format(n);
}

function runTotalCost(usage: LlmStageUsage[]): number {
  return usage.reduce((sum, u) => sum + u.cost_usd, 0);
}

function StatusBadge({ status }: { status: IngestRunStatus }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function CostCell({ usage }: { usage: LlmStageUsage[] }) {
  if (usage.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <details className="group">
      <summary className="cursor-pointer list-none font-medium">
        {formatUsd(runTotalCost(usage))}
        <span className="ml-1 text-xs text-muted-foreground">(breakdown)</span>
      </summary>
      <table className="mt-2 w-full text-left text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Stage</th>
            <th className="py-1 pr-3 font-medium">Model</th>
            <th className="py-1 pr-3 font-medium">Input</th>
            <th className="py-1 pr-3 font-medium">Output</th>
            <th className="py-1 pr-3 font-medium">Cache read</th>
            <th className="py-1 pr-3 font-medium">Cache write</th>
            <th className="py-1 font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.stage} className="border-b last:border-0">
              <td className="py-1 pr-3">{u.stage}</td>
              <td className="py-1 pr-3">{u.model}</td>
              <td className="py-1 pr-3">{formatTokens(u.input_tokens)}</td>
              <td className="py-1 pr-3">{formatTokens(u.output_tokens)}</td>
              <td className="py-1 pr-3">{formatTokens(u.cache_read_input_tokens)}</td>
              <td className="py-1 pr-3">{formatTokens(u.cache_creation_input_tokens)}</td>
              <td className="py-1">{formatUsd(u.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function AdminIngest() {
  const { data: runs, isLoading, isError, error } = useRuns();

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Ingestion status</h1>

      {isLoading && <p className="mt-4 text-muted-foreground">Loading runs…</p>}

      {isError && (
        <p className="mt-4 text-red-600">
          Failed to load runs{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {runs && runs.length === 0 && (
        <p className="mt-4 text-muted-foreground">No ingestion runs yet.</p>
      )}

      {runs && runs.length > 0 && (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4 font-medium">Kind</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Processed</th>
              <th className="py-2 pr-4 font-medium">Failed</th>
              <th className="py-2 pr-4 font-medium">Started</th>
              <th className="py-2 pr-4 font-medium">Finished</th>
              <th className="py-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b align-top">
                <td className="py-2 pr-4">{run.kind}</td>
                <td className="py-2 pr-4">
                  <StatusBadge status={run.status} />
                </td>
                <td className="py-2 pr-4">{run.items_processed}</td>
                <td className="py-2 pr-4">{run.items_failed}</td>
                <td className="py-2 pr-4">{formatTime(run.started_at)}</td>
                <td className="py-2 pr-4">{formatTime(run.finished_at)}</td>
                <td className="py-2">
                  <CostCell usage={run.llm_usage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default AdminIngest;
```

- [ ] **Step 14: Run the page tests to verify green**

Run: `task test -- src/pages/AdminIngest.test.tsx`

Expected: PASS — all seven tests green (the four pre-existing ones plus the three new cost tests). In particular: `$0.05` total renders; expanding the disclosure shows `link`, `claude-haiku-4-5`, `12,000`, `4,000`, `$0.0123`; the empty-`llm_usage` run renders `tmdb` with no `(breakdown)` control.

---

### Task 4: Full CI sweep + commit

**Files:** none new — verification + commit only.

- [ ] **Step 15: Run the complete suite, lint, and typecheck**

```bash
task test
task lint
task typecheck
task format
```

Expected:
- `task test` (`vitest run`) — all suites green across `src/**/*.test.{ts,tsx}`, including `api/runs.test.ts`, `lib/format.test.ts`, `pages/AdminIngest.test.tsx`.
- `task lint` (`eslint src --max-warnings 0`) — **zero** warnings/errors. Watch for unused imports: confirm `LlmStageUsage` is used in `AdminIngest.tsx` (it is, in `runTotalCost`/`CostCell` props) and in the test file, and that `userEvent` is used.
- `task typecheck` (`react-router typegen && tsc -b`) — no type errors; the mock literals in `runs.test.ts` all carry `llm_usage`, and `makeRun` in the page test defaults it.
- `task format` (`prettier --write`) — formats only the files you changed; re-run `task lint` if it rewrote anything. If `task format` touches files you did **not** edit (pre-existing drift), `git checkout --` those back so the PR diff stays scoped.

- [ ] **Step 16: Stage only the touched files and commit**

```bash
git add \
  src/api/types.ts \
  src/api/runs.test.ts \
  src/lib/format.ts \
  src/lib/format.test.ts \
  src/pages/AdminIngest.tsx \
  src/pages/AdminIngest.test.tsx
git status   # verify nothing unrelated is staged
git commit -m "feat: show per-run LLM token usage and cost in admin runs view

Extend the IngestRun type with the per-stage llm_usage breakdown returned
by the runs API, add a formatUsd currency helper, and render a per-run
total cost plus an expandable per-stage token/cost table in the admin
ingest page. Runs with empty llm_usage (predating telemetry) render a
muted dash with no disclosure.

Refs NEU-376."
git push -u origin tom/neu-376-frontend-show-per-run-token-cost-in-admin-runs-view
```

(No `🤖` footer and no `Co-Authored-By` in the commit — the footer belongs only in the PR body, via `/pr-desc`. Note: this repo's CLAUDE.md asks for the Linear ID as a trailing parenthetical in commit subjects, but the milestone's house rule for these plans overrides that — keep NEU-376 out of the subject and use `Refs NEU-376.` in the body. The PR **title** carries the Linear ID parenthetical.)

---

## Self-review

- **Spec coverage (T2 acceptance):** "admin runs view shows per-stage tokens + dollar cost for each run" → Task 3 (`CostCell` renders stage, model, the four token counts, and per-stage `cost_usd`, plus a per-run total). "empty llm_usage renders gracefully (older runs predate telemetry)" → `CostCell` returns a muted `—` with no disclosure when `usage.length === 0`; covered by the Step 11 empty-state test and the `makeRun` default `llm_usage: []`. "`tsc -b` + eslint + vitest all green" → Task 4 runs `task typecheck` (`react-router typegen && tsc -b`), `task lint`, `task test`.
- **Contract fidelity:** `LlmStageUsage` (Task 1) matches the NEU-375 element field-for-field — `stage`, `model`, `batched`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `cost_usd`. `IngestRun.llm_usage` is a non-optional array (older runs send `[]`, not `undefined`), matching the backend contract.
- **Type consistency across tasks:** Task 1 produces `LlmStageUsage` + `llm_usage`; Task 2 produces `formatUsd`; Task 3 consumes both with the exact signatures stated. No symbol is referenced before it is defined.
- **Test/build/lint commands verified against the repo:** `task test` → `pnpm test` → `vitest run`; `task lint` → `eslint src --max-warnings 0`; `task typecheck` → `react-router typegen && tsc -b`; `task format` → `prettier --write`. All exec into the `upmovies-frontend` container (`docker compose exec -T`). Confirmed from `Taskfile.yml` + `package.json`.
- **Where the type lives:** `IngestRun` is defined in `src/api/types.ts` (not `runs.ts`); `runs.ts` only imports it. The plan edits `types.ts` for the type and leaves `runs.ts` untouched (the fetchers are already generically typed `apiFetch<IngestRun[]>`).
- **jsdom quirk handling:** The breakdown uses a native `<details>`/`<summary>` toggle, which does not read `window.getSelection()`, so the documented "Range selection persists between clicks" quirk does not apply. The expand test clicks the summary anyway to document intent; closed-`<details>` content is still queryable in jsdom, so the assertion is robust either way. Noted in Step 11.
- **No new dependency:** uses native `<details>`, `Intl.NumberFormat`, and existing `@testing-library/user-event` (already a devDependency) — so no `task build` / `task deps:add` step is needed.
- **Placeholder scan:** none. Every code step contains real TSX/TS; token values, expected strings (`$0.05`, `$0.0123`, `12,000`, `4,000`), and commands are concrete.
- **Diff scope:** exactly six files touched (`api/types.ts`, `api/runs.test.ts`, `lib/format.ts`, `lib/format.test.ts`, `pages/AdminIngest.tsx`, `pages/AdminIngest.test.tsx`); Step 16 stages them explicitly and Step 15 guards against reformatting pre-existing drift.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
