# NEU-458 — Shorten arc-stage stepper to TMDB-reachable stages

- **Ticket:** [NEU-458](https://linear.app/neuroticsasquatch/issue/NEU-458/shorten-arc-stage-stepper-to-tmdb-reachable-stages-frontend) `[frontend]`
- **Project / milestone:** backlotter: Maintenance
- **Blocked by:** [NEU-452](https://linear.app/neuroticsasquatch/issue/NEU-452) (backend — production status derives solely from TMDB). NEU-452's spec explicitly defers this visual cleanup here.
- **Shape:** single frontend PR on `tom/neu-458-…`. No API/DTO change, no new deps, no runtime-behaviour change — cosmetic + type-narrowing only.

## Problem

After NEU-452, the backend `arc_stage` can only ever be one of the four TMDB-mapped values: `announced` (TMDB `Rumored`/`Planned`), `shooting` (`In Production`), `wrapped` (`Post Production`), `released` (`Released`). The `cast`, `dated`, and `trailer` stages are now unreachable — no film will ever report them.

`ArcStepper` (`components/film/ArcStepper.tsx`) renders all seven `ARC_STAGES` as a fixed lifecycle, so those three steps display as inert positions the bar can never land on. This is cosmetic-only; NEU-452 is functionally complete without it.

## Chosen approach

Shorten the rendered lifecycle to the four reachable stages, in order, and **narrow the `ArcStage` type to those four values** (decided during planning — see below).

### Design decision — narrow `ArcStage` to four

`ArcStage` narrows to `"announced" | "shooting" | "wrapped" | "released"`.

Rationale (chosen over keeping it seven-valued for forward-compat):
- **Type-clean.** `ARC_STAGE_LABELS` stays `Record<ArcStage, string>` with exactly its keys. Keeping seven values would force loosening it to `Partial<Record<ArcStage, string>>` (or a labels-keyed type) to drop the three entries.
- **Compiler-enforced correctness.** Every test mock using `arc_stage: "trailer"` fails `tsc` until updated to a reachable value, so nothing is silently left referencing a dead stage.
- **Aligns with the locked design.** NEU-452 deliberately severed news → status ("Status = TMDB only"); the three stages are intentionally unreachable, so preserving them as valid types is YAGNI.

## The change (files)

**`src/api/types.ts`** — narrow the union:
```ts
export type ArcStage = "announced" | "shooting" | "wrapped" | "released";
```
(Both `arc_stage: ArcStage` fields — the film-detail DTO ~`:105` and the search-result DTO ~`:145` — follow automatically. The `// mirrors the backend` comment on the search field stays accurate: the backend now emits only these four.)

**`src/components/film/labels.ts`** — drop `cast`, `dated`, `trailer` from both `ARC_STAGES` and `ARC_STAGE_LABELS`:
```ts
export const ARC_STAGES: readonly ArcStage[] = [
  "announced",
  "shooting",
  "wrapped",
  "released",
];

export const ARC_STAGE_LABELS: Record<ArcStage, string> = {
  announced: "Announced",
  shooting: "Shooting",
  wrapped: "Wrapped",
  released: "Released",
};
```
Leave `EVENT_TYPE_LABELS` / `eventTypeLabel` untouched — those are event-beat labels (`casting`, `trailer`, `first_look`, …), a separate concern from arc stages, and `trailer` there is still a real event type.

**`src/components/film/ArcStepper.tsx`** — no logic change (it derives everything from `ARC_STAGES`/`ARC_STAGE_LABELS`). Update the stale "7-stage" wording in the component's doc comment to reflect the four-stage lifecycle.

## Test / mock updates

`tsc` (via `task typecheck`, zero-warnings) will flag each stale reference; all must move to a reachable value.

- **`src/components/film/ArcStepper.test.tsx`** — rewrite. It currently renders `current="trailer"` and asserts all seven labels, and asserts `"Cast"` is not-current. Change to a reachable current stage (e.g. `current="wrapped"`), assert exactly the four labels `Announced / Shooting / Wrapped / Released` render, assert exactly one `[aria-current="step"]`, and assert the current stage carries `text-blue-400` while a different reachable stage does not.
- **`src/api/public.test.ts`** — mock `arc_stage: "trailer"` (~`:15`) and assertion `toBe("trailer")` (~`:40`) → a reachable value (e.g. `"wrapped"`), keeping the mock and its assertion in sync.
- **`src/components/search/SearchBox.test.tsx`** (~`:18`), **`src/components/search/useDebouncedSearch.test.ts`** (~`:15`), **`src/routes/film.test.tsx`** (~`:20`) — change each `arc_stage: "trailer"` mock to a reachable value.

## Acceptance criteria

- The film-page arc stepper renders only the four reachable stages, in order: `Announced → Shooting → Wrapped → Released`.
- `ArcStepper` still highlights the correct current stage for each TMDB status (exactly one `aria-current="step"`).
- `ArcStage` is four-valued; no source or test references `cast` / `dated` / `trailer` as an arc stage.
- Tests/mocks previously referencing removed stages are updated to reachable values.
- `task test`, `task lint`, `task typecheck` all green; `task format` applied to touched files.

## Scope boundaries

**Out of scope:** any backend change; the `EVENT_TYPE_LABELS`/`eventTypeLabel` event-beat labels; the timeline/calendar beat surfaces; the reserved-but-unrendered search-result `arc_stage` badge.

## Definition of done

- One frontend PR on the `tom/neu-458-…` branch, per-ticket = per-PR.
- All acceptance criteria met; full local CI (`task test` + `task lint` + `task typecheck`) green before push.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
