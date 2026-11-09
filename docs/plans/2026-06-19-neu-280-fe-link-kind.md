# NEU-280: Label the `link` ingest kind in the admin runs page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin ingestion-status page render `link` runs (and be type-correct about the new kind).

**Architecture:** The page already renders `run.kind` directly, so the only real change is widening the `IngestRunKind` union to include `"link"`; the new kind then displays automatically. Optional/cosmetic ticket.

**Tech Stack:** React + TypeScript, Vitest + Testing Library + MSW. Runs in the container via `task`.

**Repo:** `upcoming-movies-frontend` · **Branch:** `tom/neu-280-fe-label-the-link-ingest-kind-in-the-admin-runs-page` · **Spec:** `docs/specs/2026-06-19-entity-linking-clustering-design.md`

**Depends on:** NEU-275 (the backend must produce `link` runs for this to matter in practice — but the FE change is independent).

> **Commit/PR convention (frontend):** No per-step commits — implement, run `task test`/`lint`/`typecheck`, then the user commits once (Conventional Commits + trailing `(NEU-280)`; keep the `🤖 Generated with Claude Code` footer, no `Co-Authored-By`) and opens the PR. All commands run in the container via `task`; format only the files you touch.

---

## File Structure

- **Modify** `src/api/types.ts` — add `"link"` to `IngestRunKind`.
- **Modify** `src/pages/AdminIngest.test.tsx` — assert a `link` run renders.

> `src/pages/AdminIngest.tsx` needs no change — it renders `{run.kind}` directly, so widening the union is sufficient.

---

### Task 1: Render the `link` kind

**Files:**
- Modify: `src/api/types.ts:10`
- Modify: `src/pages/AdminIngest.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/pages/AdminIngest.test.tsx`, add this case inside the `describe("AdminIngest", …)` block:

```tsx
  it("renders the link kind", async () => {
    server.use(
      http.get(`${base}/admin/runs`, () =>
        HttpResponse.json([makeRun({ kind: "link", items_processed: 41 })]),
      ),
    );
    renderPage();
    expect(await screen.findByText("link")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `task typecheck`
Expected: FAIL — `Type '"link"' is not assignable to type 'IngestRunKind'` at the `makeRun({ kind: "link" })` override. (The Vitest runtime would pass — esbuild strips types — so the red signal here is `tsc`.)

- [ ] **Step 3: Widen the union**

In `src/api/types.ts`, change line 10:

```ts
export type IngestRunKind = "tmdb" | "feeds" | "link";
```

- [ ] **Step 4: Verify green**

Run: `task typecheck` (clean) and `task test -- src/pages/AdminIngest.test.tsx` (the new case plus the existing ones pass).

---

## Final verification (before handing off to commit)

- [ ] `task format` (only the touched files)
- [ ] `task lint` — clean (ESLint runs at zero warnings)
- [ ] `task typecheck` — clean
- [ ] `task test` — full suite green
- [ ] Hand off: the user commits (e.g. `feat: render the link ingest kind on the admin runs page (NEU-280)`) and opens the PR.

---

## Self-Review

- **Spec coverage:** Surfaces the new `link` run kind in the admin page (the spec's "optional FE tweak labels the new kind"). The page renders `run.kind` directly, so widening `IngestRunKind` is the whole change; the test pins it.
- **Placeholders:** None.
- **Type consistency:** `IngestRunKind` stays the single source of truth for the kind union (mirrors the backend `ingest_run.kind` values `tmdb`/`feeds`/`link`); `IngestRun.kind` and the test's `makeRun` override both key off it.
- **Scope note:** No `KIND_LABELS` mapping introduced — adding one would mean relabeling `tmdb`/`feeds` and churning their existing tests, which is out of scope for "label the link kind."
