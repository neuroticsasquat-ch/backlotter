# NEU-540 — Inline admin edit + reset-to-AI for event summaries (frontend)

## Context

Admins can already delink sources and remove events inline on the public film page. NEU-538 adds the ability to **edit an event's AI-generated summary** and **reset it back to AI**. The backend half (NEU-539, PR #123) is **merged and live**:

- `PATCH /admin/events/{event_id}/summary` — body `{ "summary": str }`; strips + validates non-empty and ≤500 chars (422 otherwise), 404 if no summary row. Returns `{ "summary": str, "edited": true, "edited_at": ISO }`.
- `DELETE /admin/events/{event_id}/summary` — **204 No Content**; deletes the summary row so the next synthesize run regenerates it. 404 if the row isn't currently edited (`summary_not_edited`).
- Public film DTO `EventOut` now exposes **`summary_edited: bool`** (`edited_at IS NOT NULL`).
- Auth: both routes require session cookie + admin + CSRF `X-CSRF-Token` header — all already handled transparently by the frontend `apiFetch` helper.

This ticket wires the frontend: an **Edit** affordance (small modal, per user choice), a **Reset to AI** confirm shown only for edited summaries, and a subtle **"edited"** indicator — all admin-only, on `EventCard`.

## Approach

Follow the existing `EventCard` moderation idiom exactly: mutate via `api/moderation.ts` fetchers, then `revalidator.revalidate()` to refetch the react-router loader. Add a small optimistic override so the new text shows instantly after save. Reuse `ConfirmDialog` for Reset; add one new `EditSummaryDialog` (Radix Dialog) for the edit modal, mirroring `ConfirmDialog`'s structure.

## Changes

### 1. `src/api/types.ts`
- Add `summary_edited: boolean;` to the `FilmEvent` interface (mirrors backend `EventOut.summary_edited`).
- Add a response type for the edit endpoint:
  ```ts
  export interface EditSummaryResponse {
    summary: string;
    edited: boolean;
    edited_at: string | null;
  }
  ```

### 2. `src/api/moderation.ts`
Add two fetchers next to `delinkSource` / `deleteEvent`, using `apiFetch` (carries session cookie + CSRF automatically):
```ts
export function editSummary(eventId: string, summary: string): Promise<EditSummaryResponse> {
  return apiFetch<EditSummaryResponse>(
    `/admin/events/${encodeURIComponent(eventId)}/summary`,
    { method: "PATCH", body: JSON.stringify({ summary }) },
  );
}

export function resetSummary(eventId: string): Promise<void> {
  return apiFetch<void>(
    `/admin/events/${encodeURIComponent(eventId)}/summary`,
    { method: "DELETE" },
  );
}
```
`apiFetch` already returns `undefined` for 204 and throws `ApiError` (with `.message` from `detail`) on non-2xx, which `run(...)` / the dialog surface via `toast.error`.

### 3. New `src/components/film/EditSummaryDialog.tsx`
Small Radix `Dialog` modeled on `ui/confirm-dialog.tsx` (same overlay/content classes), but with a textarea + char counter instead of a description. Props:
```ts
{ trigger: ReactNode; initialValue: string; maxLength?: number; // default 500
  onSave: (summary: string) => Promise<void>; }
```
Behavior:
- Controlled `open` state; seed `value` from `initialValue` when it opens.
- Inline `<textarea>` styled to match `ui/input.tsx` (`min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm`), plus a `value.trim().length/{maxLength}` counter (muted; red when over).
- **Save** disabled while `saving`, when trimmed value is empty, or when trimmed length > `maxLength` (mirrors backend validation → avoids a 422 round-trip).
- On Save: `setSaving(true)`; `await onSave(value)`; on success close the dialog; on throw keep it open and `toast.error(message)`; `finally setSaving(false)`. (Keeping the modal open on error is the reason edit does **not** route through `EventCard`'s error-swallowing `run(...)`.)
- No new `ui/textarea` primitive — inline the textarea here (YAGNI).

### 4. `src/components/film/EventCard.tsx`
- Derive display + edited state:
  ```ts
  const [summaryOverride, setSummaryOverride] = useState<string | null>(null);
  const displaySummary = summaryOverride ?? event.summary;
  const isEdited = event.summary_edited || summaryOverride !== null;
  ```
  Render `{displaySummary}` in the summary `<p>` instead of `{event.summary}`.
- **"edited" indicator**: when `isEdited`, render a subtle badge near the summary reusing the beat-label badge classes (`inline-block rounded bg-muted px-1.5 py-0.5 ... text-[11px] ... text-muted-foreground`) reading `edited`.
- Edit save handler (throws on error so the dialog can stay open):
  ```ts
  async function handleEditSave(text: string) {
    await editSummary(event.event_id, text);
    toast.success("Summary updated");
    setSummaryOverride(text);
    revalidator.revalidate();
  }
  ```
- In the existing `{isAdmin ? (...) : null}` controls block, lay controls in a `flex items-center gap-3` row:
  - `EditSummaryDialog` — trigger is a small text button (`text-xs text-muted-foreground hover:text-blue-500 disabled:opacity-50`, `disabled={busy}`), `initialValue={displaySummary}`, `onSave={handleEditSave}`.
  - **Reset to AI** — only when `isEdited`, a `ConfirmDialog`:
    - `title="Reset to AI summary?"`
    - `description="This deletes the current edited summary and re-queues it for AI regeneration on the next synthesize run. The event drops off the page until it's regenerated."` (surfaces the backend inner-join caveat)
    - `confirmLabel="Reset to AI"`
    - `onConfirm={() => run(() => resetSummary(event.event_id), "Reset queued — will regenerate on the next run")}` — `run`'s `revalidate()` refetch drops the event from the page (public query inner-joins `event_summary`), which is the intended result.
    - trigger: small destructive text button (`hover:text-red-500`).
  - Keep the existing **Remove event** `ConfirmDialog` in the same row.

### 5. Tests — `src/components/film/EventCard.test.tsx` (+ `src/api/moderation.test.ts`)
Update the shared `event` fixture to include `summary_edited: false` (new required field). Add cases mirroring the existing MSW patterns (`meHandler({ is_admin })`, `http.patch`/`http.delete` on `${env.apiBaseUrl}/admin/events/evt-1/summary`, `createMemoryRouter` for `useRevalidator`):
- **Edit**: admin opens the Edit modal, edits the textarea, Save → PATCH called with `{ summary }` body; new text renders (via override) and the `edited` badge appears.
- **Reset visibility**: with `summary_edited: true`, a "Reset to AI" control shows; with `summary_edited: false` it's absent.
- **Reset**: click Reset → confirm → DELETE called (204).
- **Non-admin**: Edit and Reset controls absent (`queryByRole(...).toBeNull()`).
- **Edited badge**: `summary_edited: true` fixture renders the `edited` indicator.
- `moderation.test.ts`: `editSummary` issues PATCH to the right URL with body; `resetSummary` issues DELETE (assert method + URL against `env.apiBaseUrl`).

Also update any other fixtures that construct a `FilmEvent`/`FilmDetail` (e.g. film loader/page tests) to include `summary_edited` so `tsc -b` stays green.

## Verification

All via `task` (runs in the `upmovies-frontend` container — no host pnpm/node):
- `task test` (vitest), `task lint` (eslint, zero warnings), `task typecheck` (`react-router typegen && tsc -b`), and `task format` on touched files — all green before commit (per repo golden rule + `feedback_run_all_ci_checks_locally`).
- Manual smoke against dev (`https://api.upmovies.localhost`): log in as admin, open a film page →
  1. Click **Edit** on an event summary → modal opens seeded with current text → edit → Save → text updates immediately, `edited` badge shows, toast success.
  2. Confirm the char counter blocks Save past 500 chars.
  3. **Reset to AI** now visible → confirm → toast "Reset queued…", event drops off the page (expected until next synthesize run).
  4. Verify a **non-admin** (or logged-out) session sees the summary but none of the controls.

## Notes
- Branch: `tom/neu-540-frontend-inline-admin-edit-reset-to-ai-for-event-summaries`. One ticket → one PR. Conventional-commit subject with `(NEU-540)`; `🤖 Generated with Claude Code` footer in the PR body only.
- Format touched files only — `AuthContext.*` has pre-existing Prettier drift on `main`; don't reformat unrelated files.
