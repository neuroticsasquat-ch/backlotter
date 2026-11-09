**Milestone spec:** ../specs/2026-06-25-mvp-launch-polish-m02-polish-existing-pages.md

# Film-detail orders + exposes events by `created_at` (NEU-394) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development (write the failing test first), then superpowers:subagent-driven-development or superpowers:executing-plans to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public film page (`/film/{slug}`) order and date its event log by `news.event.created_at` — the same axis the home feed already uses — instead of `occurred_at`. After this change, an event lands under the same day on the film page as it does on the feed, closing the date-divergence rough edge in **Story NEU-386**.

**Realizes (M2):** Story NEU-386 — *"Event dates are consistent between the home feed and film pages."* This is the **backend half**. The frontend switch (timeline grouping/labels/ordering keyed off the renamed field) is **NEU-395**, which is *blocked by this ticket* and consumes the DTO contract defined here.

**Architecture:** Backend-only, read-path-only change confined to two source files plus one test file. No migration, no model change, no ingestion change — `Event.created_at` already exists (real column, `server_default=text("now()")`) and is already exposed on the feed DTO. We flip one `order_by` and rename one DTO field.

**Tech Stack:** Python 3.13, FastAPI, async SQLAlchemy 2 + asyncpg, Pydantic v2, pytest (pytest-asyncio `auto` mode). Everything runs in the container via `task` (no host Python).

## Global Constraints

- **Repo:** `upcoming-movies-backend` (under the `~/projects/upcoming-movies/` umbrella). Paths below are relative to that repo root.
- **Branch:** the Linear-provided branch for NEU-394 (one ticket = one PR).
- **Backend-only, read-path-only.** Touch `src/upmovies/public/service.py`, `src/upmovies/public/dto.py`, and `tests/integration/routers/test_public_films.py`. **No migration**, no `news/models.py` change, no ingestion change. Confirm by diff that changes are confined to these three files.
- **Do NOT touch the feed.** `get_feed` / `get_feed_grouped` already key off `created_at`; the per-event `FeedItem` DTO keeps **both** `occurred_at` and `created_at`. Leave `test_public_feed.py` and its `occurred_at` assertion untouched.
- **`occurred_at` stays everywhere else.** The column remains on the `Event` model; only the *film-detail event DTO* (`EventOut`) drops it. Model-level `occurred_at` usage in `link/`, `news/`, `synthesize/` tests is unrelated — do not touch.
- **TDD:** write/adjust the failing test first, watch it fail for the right reason, then change the code.
- **CI gate (run in-container before commit):** `task format` → `task lint` → `task typecheck` → `task test` all green. `alembic heads` must be unchanged (no migration added).
- **Commit style:** Conventional Commits subject, no Linear ID in the subject (optional `Refs NEU-394.` in body), no footer, no `Co-Authored-By`.

---

## The contract (what NEU-395 will consume)

This is the load-bearing decision; state it precisely because the FE codes against it.

- **Rename, don't add.** `EventOut` currently carries `occurred_at: datetime`. Replace it with **`created_at: datetime`** — a single rename, *not* a second additive field.
- **Why rename:** NEU-386's explicit goal is that the two surfaces can no longer disagree. After the FE switch (NEU-395) nothing on the film page reads `occurred_at` — it was used only for grouping, ordering, the `<time>` label, and the meta "latest summary" pick, all moving to `created_at`. Leaving a now-unused `occurred_at` on `EventOut` would invite the FE to silently reintroduce the divergence. So the film-detail event DTO exposes exactly one date, `created_at`.
- **Net JSON contract for each item in `FilmDetailResponse.events`:** gains `created_at`, loses `occurred_at`. All other `EventOut` fields (`event_type`, `confidence`, `summary`, `sources`) are unchanged. The top-level `FilmDetailResponse` shape is otherwise unchanged.
- **Out of contract scope:** the feed DTOs are untouched; `FeedItem` keeps both timestamps. NEU-395 is the only consumer that must change in lockstep, and it is sequenced after this PR merges.

---

## What changes

**`src/upmovies/public/service.py` — `get_film_detail`:**
1. **Ordering.** The summarized-events `select(...)` currently orders `Event.occurred_at.asc(), Event.id.asc()`. Switch the primary key to `Event.created_at.asc()` (keep `Event.id.asc()` as the deterministic tiebreaker). This mirrors the feed (`get_feed` orders `Event.created_at.desc()`; `get_feed_grouped` buckets on `date(timezone('UTC', Event.created_at))`) — same `created_at` axis, ascending shape the FE timeline already reverses to newest-first.
2. **DTO build.** Each `EventOut(...)` is built with `occurred_at=event.occurred_at`. Change to `created_at=event.created_at`.

**`src/upmovies/public/dto.py` — `EventOut`:**
3. Rename the field `occurred_at: datetime` → `created_at: datetime`. (`EventOut` is referenced only by `FilmDetailResponse.events` and built only in `get_film_detail` — verified — so this is a contained rename.)

Nothing else in `service.py` / `dto.py` changes. `FeedItem`, `FeedDayItem`, `FilmIndexItem`, the sources query, arc derivation, the `other`-exclusion, and the summary-less-event filtering all stay as-is.

---

## TDD testing intent

All test work is in `tests/integration/routers/test_public_films.py`. The relevant fixture, `add_event` (`tests/fixtures/public.py`), **already accepts and forwards an explicit `created_at`** (it sets `event.created_at` when passed, else falls back to the `now()` server default) — no fixture extension needed. Because the default `created_at` is `now()`, any test asserting a deterministic event order **must pass explicit `created_at` values per event** (relying on insertion order is flaky).

1. **Rework the existing ordering test** (`test_detail_returns_chronological_summarized_events_with_sources`). It currently drives order via per-event `occurred_at` and asserts `["trailer", "casting"]`. Rework it to:
   - drive order via explicit `created_at` per event (e.g. give the casting event an earlier `created_at` than the trailer, or vice-versa) so the expected ordering is unambiguous and *caused by* `created_at`, not `occurred_at`;
   - assert the response event order matches `created_at` ascending;
   - assert each event object exposes a `created_at` key (value matches what was set) **and** that `occurred_at` is absent from the event object — this pins the rename.
   - Keep the unrelated assertions (slug/title/release/arc_stage, summary text, source url/label) intact.
2. **Add a focused parity/regression assertion** (either folded into the reworked test or a small new test): two events whose `occurred_at` ordering is the *opposite* of their `created_at` ordering come back in `created_at` order — proving the switch took effect and a stale `occurred_at` sort would fail it.
3. **Leave the other detail tests** (`omits_summary_less_events`, `empty_log`, `unknown_slug_404`, `source_label`, `caps_sources`, `excludes_other_events`) behaviorally intact; they assert membership/filtering, not date ordering. Only adjust if they happen to assert the old `occurred_at` key (they do not today).
4. **Confirm no collateral damage:** the feed tests (`test_public_feed.py`, which *does* assert an `occurred_at` key on `FeedItem`) and the model-level `occurred_at` tests in `link/`/`news/`/`synthesize/` continue to pass unchanged.

**Red → green:** write the reworked/added assertions first against the current code. Expected failure: the ordering test fails (still sorting by `occurred_at`) and the `created_at`-key assertion fails (`EventOut` still emits `occurred_at`). Then apply the three source changes and watch the suite go green.

---

## Tasks

- [ ] **Task 1 — Tests first (red).** In `tests/integration/routers/test_public_films.py`, rework the chronological-ordering test to drive ordering via explicit `created_at`, assert `created_at`-ascending order, assert the `created_at` key is present and `occurred_at` absent on each event, and add the inverted-`occurred_at` parity assertion. Run `task test -- tests/integration/routers/test_public_films.py` (or the whole suite — single integration-file runs can emit a known asyncio-loop warning) and confirm the new assertions fail for the right reason.
- [ ] **Task 2 — Service + DTO (green).** In `public/service.py get_film_detail`, switch the order key to `Event.created_at.asc(), Event.id.asc()` and build `EventOut(created_at=event.created_at, ...)`. In `public/dto.py`, rename `EventOut.occurred_at` → `created_at`. Re-run the suite; the film-detail tests pass and the feed/model tests stay green.
- [ ] **Task 3 — Full CI gate.** Run `task format`, `task lint`, `task typecheck`, `task test` — all green. Confirm `alembic heads` is unchanged and `git diff` touches only the three files. Commit on the ticket branch.

---

## Acceptance criteria

1. `get_film_detail` returns events ordered by `created_at` ascending (tiebroken by `id`), matching the axis the feed already uses.
2. Each event in `FilmDetailResponse.events` exposes `created_at` as its display date; `occurred_at` is **no longer present** on the film-detail event object.
3. The feed DTOs are untouched — `FeedItem` still carries both `occurred_at` and `created_at`; `get_feed` / `get_feed_grouped` are unchanged.
4. No migration ran and no ingestion/model code changed — diff is confined to `public/service.py`, `public/dto.py`, and `test_public_films.py`; `alembic heads` unchanged.
5. `task format` / `lint` / `typecheck` / `test` are all green; the unrelated feed and model-level `occurred_at` tests still pass.
6. The DTO contract (event objects carry `created_at`, not `occurred_at`) is the surface NEU-395 will consume — film page parity with the feed is then completed by that FE ticket.

---

## Key files touched

- `src/upmovies/public/service.py` — `get_film_detail`: order key `occurred_at` → `created_at`; `EventOut` build field.
- `src/upmovies/public/dto.py` — `EventOut`: rename `occurred_at` → `created_at`.
- `tests/integration/routers/test_public_films.py` — rework ordering test to `created_at`; assert the renamed key; add inverted-`occurred_at` parity assertion.
- *(reference only, not modified)* `tests/fixtures/public.py` — `add_event` already forwards explicit `created_at`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
