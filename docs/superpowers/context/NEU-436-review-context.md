# NEU-436 review context

Stable intent for `/reviewit`, `/addressit`, `/mergeit`. Diff and comment threads are fetched live, not stored here.

## Linear ticket

- **ID:** NEU-436
- **Title:** Filter out shorts, microreleases, and other low quality films from release calendar
- **State:** In Review
- **Project:** backlotter: Maintenance · **Team:** Neuroticsasquatch
- **Description:** (empty in Linear — intent lives in the spec/plan below)
- **PR:** upcoming-movies-backend #87 — feat(ingest): filter shorts at TMDB ingest time (NEU-436)

## Spec & plan

Authoritative intent lives in:
- Spec: `docs/superpowers/specs/NEU-436-filter-shorts-at-ingest.md`
- Plan: `docs/superpowers/plans/NEU-436-filter-shorts-at-ingest.md`

### Core intent

Stop **shorts** from entering the catalog by skipping them at TMDB ingest time, before
upsert — so a short never reaches `catalog.film`, never appears on any surface, and never
triggers the linking/clustering/synthesis LLM pipeline (the token-saving move).

### Scope decisions (binding)

- **Filter at ingest, not query time.**
- **Shorts only** — define a short as `0 < runtime < TMDB_MIN_RUNTIME` (default 60 min).
  - `runtime == 0` or `None` = unknown/unfinished → **keep**. Only a known, small runtime is a short.
- **No re-release rule** (unreachable given the discovery window).
- **No editorial blocklist** (CatVideoFest stays).
- **No popularity/vote/genre/language filters.** Existing popularity floor (1.0) and status
  skip (`Released`, `Canceled`) unchanged.
- **Forward-only** — no cleanup of already-ingested shorts.

### Design shape

1. Pure `classify_skip(details, *, excluded_statuses, min_runtime) -> str | None` in new
   `ingest/tmdb/filters.py`. Returns `"excluded_status"`, `"short"`, or `None`. Status check
   precedes runtime check. `min_runtime=0` disables the shorts rule.
2. `run_tmdb_ingest` gains `min_runtime: int = 0`; loop calls `classify_skip` before
   `upsert_film`; per-reason `Counter` (`skip_counts`).
3. `IngestResult` keeps `films_skipped` total, gains `skipped_by_reason: dict[str, int]`.
   Success detail string shows per-reason breakdown.
4. Config: `tmdb_min_runtime: int = Field(default=60, alias="TMDB_MIN_RUNTIME")`.
5. Call site `routers/ingest_admin.py` passes `min_runtime=settings.tmdb_min_runtime`.

### Acceptance criteria

1. Film with `0 < runtime < TMDB_MIN_RUNTIME` skipped, never written.
2. Film with runtime 0/None kept.
3. Film with `runtime >= TMDB_MIN_RUNTIME` kept.
4. Existing status skip + popularity floor unchanged.
5. `TMDB_MIN_RUNTIME=0` disables the filter.
6. Run summary reports per-reason skip counts.
7. `task test`, `task lint`, `task typecheck` all green.

### Plan-level constraints relevant to review

- Everything runs in container via `task`; no host pytest/ruff/pyright.
- TDD: failing test first. pytest-asyncio auto mode (no `@pytest.mark.asyncio`). respx mocks; never hit network.
- Type hints modern `X | None`; no `from __future__ import annotations`. ruff line length 100.
- No DB schema change → no Alembic migration.
- `run_tmdb_ingest` `min_runtime` default `0` preserves existing callers/tests.

### Out of scope

Re-release detection; editorial blocklist; popularity/vote/genre/language filters;
query-time filtering; backfill/cleanup of already-ingested shorts.
