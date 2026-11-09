# Pre-release Ingestion Filter — Design

- **Date:** 2026-06-19
- **Status:** Approved (pending implementation)
- **Component:** `upcoming-movies-backend` — TMDB discover ingestion

## Problem

The TMDB discover ingestion is release-date + popularity centric. Run at popularity
floor 0 with a 30-day past window, it pulled 3,034 films, of which:

- ~2,021 (67%) were already **Released** — recent micro-releases dragged in by the
  30-day past window.
- ~60% had no `imdb_id`: an obscure long tail (popularity ≈ 0, 0 votes, freshly-created
  TMDB entries) that mostly is not on IMDB at all.

The product's purpose is to track films through their **pre-release** production
lifecycle, not to mirror recently-released micro-cinema. We want pre-release films,
minimal already-released noise, and limited "never gets made" vaporware — without a
flood of obscure titles.

## Decision: Path A (date-gated discovery)

Two TMDB limitations, confirmed empirically, bound what is achievable:

1. **No date → invisible to discover.** `primary_release_date` range filters cannot match
   a film with no date. ~73k undated en/US films are unreachable.
2. **No status filter in discover.** `with_status` is silently ignored; production status
   is known only after fetching `/movie/{id}` details.

So truly early-stage *undated* films cannot be discovered via `/discover/movie`. We accept
this: **a film enters the tracker once it has a future release date and is still
pre-release.** Capturing undated, just-announced projects (Path B — changes feed /
person-company tracking) is out of scope.

## Filter criteria

A film is ingested iff all hold:

| Lever | Value |
|---|---|
| `primary_release_date` ≥ | today (past window = 0 days) |
| `primary_release_date` ≤ | today + 1095 days |
| popularity ≥ | 1.0 |
| status ∉ | {Released, Canceled} |

Expected yield ≈ **155 films** per run (vs. 3,034 before).

## Implementation

### 1. Config defaults (`config.py`)

These are product defaults — they apply to the GitHub Actions prod cron and local dev
alike:

| Setting | Old | New |
|---|---|---|
| `tmdb_release_window_past_days` | 30 | **0** |
| `tmdb_min_popularity` | 10.0 | **1.0** |
| `tmdb_release_window_future_days` | 1095 | 1095 (unchanged) |
| `tmdb_excluded_statuses` (new) | — | **`"Released,Canceled"`** |

`tmdb_excluded_statuses` is a comma-separated string parsed to a set, mirroring the
existing `cors_allowed_origins` pattern.

### 2. Service status filter (`ingest/tmdb/service.py`)

`run_tmdb_ingest` gains an `excluded_statuses: frozenset[str]` parameter. After the
details fetch:

- If `details.status in excluded_statuses`: increment a local `skipped` counter, reset
  `consecutive_failures` (the fetch succeeded), and `continue` — no upsert, and not
  counted as processed or failed.
- A null/unknown status is **not** excluded; only the explicit configured statuses are
  skipped.
- The trigger wrapper (`routers/ingest_admin.py::_background_tmdb`) passes the set from
  the new config setting.
- `finalize_run` records `detail = f"upserted {processed}, skipped {skipped} (excluded status)"`
  for observability — no schema change (the `detail` column already exists).

### 3. Revert dev override

Remove the `TMDB_MIN_POPULARITY: "${TMDB_MIN_POPULARITY:-0}"` line added to
`docker-compose.yml`. Dev now matches prod behavior via `config.py`.

## Lifecycle behavior (no extra code)

A tracked film that later releases falls out of the future-date discovery window and is no
longer fetched. Its row remains in `catalog.film`, frozen at its last pre-release state.
We never delete films. The status filter prevents bulk-importing the back catalog; it is
not a pruning mechanism. Keeping released films' data current is out of scope.

## Out of scope

- Path B: capturing undated / just-announced films.
- Pruning or archiving films after they release.
- Refreshing released films' metadata after they leave the window.

## Testing (TDD, respx)

- A `Released` film and a `Canceled` film are fetched but **not** upserted.
- A `Planned` / `In Production` film **is** upserted.
- `past_days = 0` makes `release_date_gte == today`.
- No Alembic migration (no schema change).

## Dev data refresh

After the code change: `TRUNCATE catalog.film` and re-ingest → a clean ~155-film corpus
replacing the current 3,033.

## Supporting data (probed 2026-06-19, en/US)

Floor × pre-release count (future-dated; status ∈ {Rumored, Planned, In Production,
Post Production}):

| Popularity floor | All future | Pre-release only |
|---|---|---|
| 0 | 1,227 | 1,002 |
| **1** | 195 | **155** |
| 2 | 82 | 69 |
| 5 | 35 | 28 |
| 10 | 17 | 16 |

Future-only status mix at floor 0: In Production 591 · Post Production 293 · Planned 111 ·
Rumored 7 (plus Released 211 and Canceled 5, which the status filter excludes).
