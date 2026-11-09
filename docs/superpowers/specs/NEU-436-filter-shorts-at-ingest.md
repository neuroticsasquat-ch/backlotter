# NEU-436 — Filter shorts out of the release calendar (at ingest)

**Ticket:** [NEU-436](https://linear.app/neuroticsasquatch/issue/NEU-436) — "Filter out shorts, microreleases, and other low quality films from release calendar"
**Project:** backlotter: Maintenance · **Repo:** `upcoming-movies-backend`
**Status:** design approved

## Problem

The production release calendar surfaces films that aren't real upcoming features.
The two instigating examples:

- **Knives (2026)** — a **7-minute short** (genres History/War) with a real "wide" date.
- **CatVideoFest 2026** — a 70-minute annual cat-video **compilation event**, real limited
  release, real distributor (Oscilloscope).

Beyond cluttering the calendar, every junk film also incurs downstream LLM cost: once
ingested into `catalog.film`, a film flows through entity linking → clustering → story
synthesis. Filtering at ingest avoids both the calendar clutter **and** that token spend.

## Goal

Stop **shorts** from entering the catalog by skipping them at TMDB ingest time, before
upsert. A short never reaches `catalog.film`, so it never appears on any surface and never
triggers the linking/clustering/synthesis pipeline.

## Scope decisions (from brainstorming)

These were explicitly decided and bound the work:

- **Filter at ingest, not at query time.** The point is to never ingest these films, so the
  downstream LLM pipeline never runs on them. This is the token-saving move.
- **Shorts only.** The single real, automatable rule.
  - Define a short as `0 < runtime < TMDB_MIN_RUNTIME` (default **60** minutes).
  - `runtime == 0` or `runtime is None` means **unknown/unfinished** → **keep** (upcoming
    features often have no runtime yet; e.g. the Beatles biopics, the next Exorcist). Only a
    *known, small* runtime is treated as a short. *Knives* (7m) is caught; an unfinished
    feature (runtime 0) is not.
- **No re-release rule.** It would be dead code: discovery queries TMDB by
  `primary_release_date.gte = today` (`TMDB_RELEASE_WINDOW_PAST_DAYS = 0`), so a re-issued
  classic (old primary date) is never discovered and never ingested. `film_release_date` is
  only ever written by `_rebuild_release_dates` inside `upsert_film` — there is no separate
  release-date refresh job. The rule could only ever fire if `TMDB_RELEASE_WINDOW_PAST_DAYS`
  were widened past ~730 days.
- **No editorial blocklist.** Considered (and prototyped in discussion) for the
  CatVideoFest class, then dropped: a real limited theatrical release has no structured
  TMDB signal distinguishing it from junk, and we chose not to editorialize what's genuinely
  releasing. CatVideoFest stays.
- **No popularity/vote/genre/language filters.** Popularity fails as a quality signal here:
  big upcoming films (Beatles biopics, next Exorcist) sit barely above the existing 1.0
  floor. Vote signals are ~0 for unreleased films. The existing popularity floor (1.0) and
  status skip (`Released`, `Canceled`) are unchanged.
- **Forward-only.** No cleanup of already-ingested shorts. *Knives* (already live) stays on
  the calendar until removed by hand; this ticket only prevents future ingestion. (A
  one-time purge, if wanted, is a separate concern.)

## Design

### 1. Pure skip classifier — `src/upmovies/ingest/tmdb/filters.py` (new)

A pure function so it's unit-testable with no DB or HTTP, and so skip logic has one home.
It folds in the existing status check:

```python
from upmovies.ingest.tmdb.schemas import TMDBMovieDetails


def classify_skip(
    details: TMDBMovieDetails,
    *,
    excluded_statuses: frozenset[str],
    min_runtime: int,
) -> str | None:
    """Return a skip reason for a film that should NOT be ingested, or None to keep it.

    Reasons: "excluded_status" (status in the excluded set), "short" (a known runtime
    below the floor). runtime of 0/None is treated as unknown and kept.
    """
    if details.status in excluded_statuses:
        return "excluded_status"
    if details.runtime is not None and 0 < details.runtime < min_runtime:
        return "short"
    return None
```

Setting `min_runtime = 0` disables the shorts rule (`0 < runtime < 0` is never true).

### 2. Loop integration — `src/upmovies/ingest/tmdb/service.py`

`run_tmdb_ingest` gains a `min_runtime: int` parameter (mirroring `min_popularity` and
`excluded_statuses`). Inside the candidate loop, the current inline status check:

```python
details = await client.movie_details(tmdb_id)
if details.status in excluded_statuses:
    skipped += 1
    consecutive_failures = 0
    continue
```

becomes a single classifier call:

```python
details = await client.movie_details(tmdb_id)
reason = classify_skip(details, excluded_statuses=excluded_statuses, min_runtime=min_runtime)
if reason is not None:
    skip_counts[reason] += 1
    consecutive_failures = 0
    continue
```

The skip happens **before** `upsert_film`, so skipped films are never written.

### 3. Per-reason skip observability

Replace the single `skipped` int with a `collections.Counter` (`skip_counts`).

- `IngestResult` keeps `films_skipped: int` (the total, `sum(skip_counts.values())`) for
  backward compatibility, and gains `skipped_by_reason: dict[str, int] = field(default_factory=dict)`.
- The `finalize_run` success detail changes from `"upserted {processed}, skipped {skipped} (excluded status)"`
  to a per-reason breakdown, e.g. `"upserted 120, skipped 12 (short=9, excluded_status=3)"`.
- The early-abort `return` path (consecutive failures) also returns the populated
  `skipped_by_reason`.

### 4. Config — `src/upmovies/config.py`

Add alongside the other `tmdb_*` discover settings:

```python
tmdb_min_runtime: int = Field(default=60, alias="TMDB_MIN_RUNTIME")
```

### 5. Call site — `src/upmovies/routers/ingest_admin.py`

In `_background_tmdb` (the `run_tmdb_ingest(...)` call at lines ~51–60), pass:

```python
min_runtime=settings.tmdb_min_runtime,
```

## Testing (TDD — write the failing test first)

**Unit — `classify_skip`** (new test file under `tests/unit/ingest/tmdb/`):

| runtime | status | min_runtime | expected |
|--------:|--------|------------:|----------|
| 7 | (ok) | 60 | `"short"` |
| 59 | (ok) | 60 | `"short"` |
| 60 | (ok) | 60 | `None` (boundary kept) |
| 0 | (ok) | 60 | `None` (unfinished kept) |
| None | (ok) | 60 | `None` (unknown kept) |
| 7 | (ok) | 0 | `None` (rule disabled) |
| 7 | `Canceled` (excluded) | 60 | `"excluded_status"` (status precedence) |
| 120 | `Released` (excluded) | 60 | `"excluded_status"` |

**Integration — `run_tmdb_ingest`** (extend `tests/integration/ingest/tmdb/test_service.py`,
respx-mocked TMDB, follow the existing excluded-status test as a template):

- A discovered short (e.g. runtime 7) is **not** upserted — absent from `catalog.film` —
  and the run's `skipped_by_reason["short"]` / total `films_skipped` reflect it.
- A normal feature alongside it **is** upserted.
- The finalize detail string includes the per-reason breakdown.

**Config — `tests/unit/test_config.py`:** `tmdb_min_runtime` defaults to 60 and reads
`TMDB_MIN_RUNTIME`.

## Acceptance criteria

1. A TMDB film with `0 < runtime < TMDB_MIN_RUNTIME` (default 60) is skipped at ingest and
   never written to `catalog.film`.
2. A film with `runtime` of 0 or `None` is **kept** (not treated as a short).
3. A film with `runtime >= TMDB_MIN_RUNTIME` is kept.
4. The existing status skip and popularity floor behave exactly as before.
5. `TMDB_MIN_RUNTIME=0` disables the shorts filter.
6. The ingest run summary reports skip counts per reason
   (e.g. `skipped 12 (short=9, excluded_status=3)`).
7. `task test`, `task lint`, `task typecheck` all green.

## Out of scope

- Re-release detection (unreachable given the discovery window).
- Editorial blocklist / admin-managed exclusion table.
- Popularity / vote / genre / language quality filters.
- Any query-time filtering of calendar, browse, or home feed (no changes to
  `public/service.py` or the frontend).
- Cleanup/removal of already-ingested shorts (forward-only).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
