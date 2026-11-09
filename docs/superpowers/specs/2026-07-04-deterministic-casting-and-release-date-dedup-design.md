# Deterministic dedup for casting (per-performer) and release-date (restatement) events

**Source:** [NEU-491](https://linear.app/neuroticsasquatch/issue/NEU-491/bugs-2026-07-04) — *Bugs: 2026-07-04* (recurrences of previously "fixed" casting/release-date bugs)
**Project:** backlotter: Maintenance
**Layer:** CLUSTER (`src/upmovies/link/cluster.py`), plus SYNTHESIZE (summarizer scoping) and INGEST (Film field-change trigger)
**Date:** 2026-07-04
**Related:** NEU-448 (trailer/first_look deterministic dedup — the pattern this extends), NEU-449/451/483 (the prompt-only fixes that regressed), NEU-454 (source gate — lever 2, separate)
**Tickets:** [NEU-492](https://linear.app/neuroticsasquatch/issue/NEU-492) (Part A casting), [NEU-493](https://linear.app/neuroticsasquatch/issue/NEU-493) (Part B field-change infra), [NEU-494](https://linear.app/neuroticsasquatch/issue/NEU-494) (Part C release-date, `blockedBy` NEU-493). Three backend PRs.

## Problem

Today's bug batch (NEU-491) is dominated by recurrences of bugs marked "fixed" in prior batches:

- **Old/duplicate casting → new event** (bugs #1, #4, #5): old casting news, casting already recorded in a prior event, and the same news spawning multiple events in one day. NEU-483 added a casting-consolidation *prompt rule* yesterday; it regressed today.
- **Restated release date → new event** (bug #6): a low-quality promo article created a `release_date` event for a film that already had that date (OK Madam 2). NEU-451 + NEU-483 added *prompt rules* to drop restatements; they regressed today.

**Root cause of the recurrence** (verified against `main`): every one of these fixes is an English rule appended to an LLM prompt, "tested" only by asserting the prompt string contains the phrase (`assert "…" in _INSTRUCTIONS`). Probabilistic models regress on new inputs; a presence check can't catch it. The one *deterministic* guardrail that exists (NEU-448's `_SINGULAR_BEAT_TYPES` windowed dedup) deliberately **excludes** casting and release_date — correctly, because those event types are legitimately repeatable and can't be collapsed by type.

## Principle

Move the **mechanical decision into Python**; leave the model only a **narrow extraction** job.

- The model already must identify a performer name to type something `casting`, and already sees `film.release_date`. It's the *comparison/partition* it can't be trusted to do reliably.
- So: the model extracts the performer names / the claimed date; **code** decides new-vs-recorded. That decision is deterministic, unit-testable without an LLM, and can't silently regress.

The existing NEU-448 guardrail generalizes from "key = event type" to "key = a function of the event": trailer/first_look keep the type-singleton key; casting keys on **performer identity**; release_date keys on **claimed date vs. the known date**.

---

## Part A — Casting per-performer dedup

### A1. Extraction (cluster output)

Add a per-event `cast` field to the cluster JSON contract for `casting` events: the list of performer names the story names as joining *this* film (the same names the prompt already requires to justify a `casting` type). Non-casting events omit it.

- `ClusterGroup` dataclass: add `cast: list[str] | None`.
- `parse_cluster_groups`: parse `cast` (tolerate missing/null → `[]`).
- `_INSTRUCTIONS` JSON schema line: document `"cast"` for casting events.

### A2. Storage (`Event.subject_key`)

New nullable column on `news.event`:

```python
subject_key: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
```

Holds the **normalized** performer names a casting event represents (null for non-casting types). Needed so a *new* casting story can dedup against *prior-run* events — existing events carry no performer data today. Alembic migration; `create_all` picks it up for tests.

**Normalization** (`_normalize_name`, pure fn, unit-tested): Unicode NFKC → `casefold()` → strip → collapse internal whitespace. E.g. `"Alain  Chabat"` → `"alain chabat"`. Diacritic-folding is out of scope for v1 (noted as an improvable limitation).

### A3. Deterministic routing (`apply_cluster_decisions`)

For a **new** `casting` group, after the existing `off_topic` / `is_stale_stage` / invalid-type guards:

1. Build the film's **recorded-performer index** once per apply pass: a set of normalized names drawn from *all* the film's existing `casting` events (a dedicated query on `subject_key`, **not** limited to the 25-event display cap — dedup must be complete), plus any casting events created earlier in this same pass.
2. Normalize the group's `cast` → `names`. Partition:
   - `new_names = [n for n in names if n not in index]`
   - matched names (already in the index) are simply already-recorded — **we do not attach to their events.**
3. **If `new_names` is non-empty:** create **one** new `casting` event with `subject_key = new_names`; attach the group's stories to it; add `new_names` to the in-pass index. (A story introducing two genuinely-new performers at once → one event naming both — they share one announcement.)
4. **If `new_names` is empty:** the story is a pure restatement — **drop it** (`link_status = "rejected"`, `film_id = None`, `link_note = "casting-recorded"`), mirroring the existing off_topic/stale-stage rejection path. No event, no attach.

Worked example (the case that killed overlap-attach): existing event E1 = `{monica barbaro}`; new story names `{monica barbaro, john doe}` → `new_names = {john doe}` → create E2 = `{john doe}`, attach the story to E2, leave E1 untouched.

### A4. Summarizer scoping

The event's source story may name already-recorded performers (Monica), so the blurb must be scoped to the event's own subject. Pass `event.subject_key` into the summarizer for casting events so it names **only** those performers (→ "John Doe has joined the cast"). Small wire-through: `summarizer.py` currently builds from event stories + type only.

### A5. Backfill (separate, non-blocking task)

Existing casting events have `subject_key = NULL`. Until backfilled, a new story about an already-recorded performer whose event predates this change sees them as *new* → re-records them. A one-time backfill script extracts performer names from each existing casting event's attached stories (reusing the extraction path) and populates `subject_key`. Ships as its own step; not a blocker for the guardrail landing.

### A6. Config

No recency window for casting (identity, not recency, is the key — a performer cast months ago is still recorded). No new knob required for Part A.

---

## Part B — Film field-change tracking (reusable infra)

Generic "when did we last learn a value" tracking for `catalog.film`, so Part C (and future deterministic checks on `status`, `title`, `runtime`, …) can ask "has this value been established for > N days?" without bespoke per-field columns.

**Why a DB trigger, not app-level:** `_upsert_film_row` is a blind `INSERT … ON CONFLICT DO UPDATE` — it never reads the prior value in-app, so an application diff would force a read-modify-write and lose the atomic upsert. A `BEFORE UPDATE` trigger has `OLD`/`NEW` for free, fires inside the same statement, and catches every writer (present and future).

### B1. History table

```sql
CREATE TABLE catalog.film_field_change (
  id bigserial PRIMARY KEY,
  film_id uuid NOT NULL REFERENCES catalog.film(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_film_field_change_lookup
  ON catalog.film_field_change (film_id, field, changed_at DESC);
```

### B2. Generic trigger

A PL/pgSQL `BEFORE UPDATE ON catalog.film` function iterates `to_jsonb(NEW)` keys and, for each key **not** on the volatile denylist where `OLD->k IS DISTINCT FROM NEW->k`, inserts a change row.

- **Volatile denylist** (tunable): `popularity, vote_average, vote_count, revenue, tmdb_raw, updated_at`. These churn on nearly every ingest and would bury the signal. Everything else — including columns added later — is tracked automatically.
- The trigger is **`BEFORE UPDATE` only**: a value set at INSERT and never changed has no change row (see B4 baseline).

### B3. Test-harness parity (the wrinkle)

Tests build the schema with `create_all` (SQLAlchemy models only); the trigger lives in an Alembic migration and would be absent from the test DB. Install it in both by attaching the DDL to the table:

```python
event.listen(Film.__table__, "after_create", DDL(<function + trigger SQL>))
```

so `create_all` and Alembic stay in sync. The Alembic migration hand-writes the same function/trigger via `op.execute` (not autogenerated).

### B4. Consumer helper

`field_changed_at(session, film_id, field) -> datetime | None` = latest `changed_at` for that `(film_id, field)`. **Baseline fallback:** because the trigger is UPDATE-only, a never-changed value returns `None`; callers treat `film.created_at` as the lower bound ("known since at least creation").

## Part C — Release-date restatement guard (consumes Part B)

### C1. Extraction (cluster output)

Add `claimed_date` (`YYYY-MM-DD` or null) to the cluster JSON contract for `release_date` events — the date the story asserts. `ClusterGroup`: add `claimed_date: date | None`; parse tolerantly (unparseable → null).

### C2. Deterministic drop (`apply_cluster_decisions`)

Bug #6 is a promo restating a date the film **already held from TMDB** (no prior news event), so the guard compares against `film.release_date`. For a new `release_date` group with a parseable `claimed_date`:

- Compute `established_since = field_changed_at(film_id, "release_date") or film.created_at` (Part B helper).
- If `claimed_date == film.release_date` **and** `as_of_date - established_since > LINK_RELEASE_RESTATE_DAYS` (new config knob, default **7**) → **drop** as restatement (`link_note = "release-date-restated"`). An established date restated by a promo is not news.
- If `claimed_date == film.release_date` but the date was set **recently** (≤ knob) → keep: this may be the genuine announcement, coinciding with a fresh TMDB update.
- If `claimed_date != film.release_date` → a genuinely changed date → keep (create the event as today).
- If `claimed_date` is null/unparseable → no deterministic drop; fall through to current prompt-driven behavior.

The knob threads into `apply_cluster_decisions` exactly like `dedup_days`/`unresolved_tier` do today.

---

## Acceptance criteria

**Casting:**
- Existing casting event `{monica barbaro}` + new story `{monica barbaro, john doe}` → one new event `{john doe}`; original untouched; summary names only John Doe.
- New story restating an already-recorded performer → dropped, no new event.
- Two stories about the same new casting in one run → one event (in-pass index).
- A genuinely new performer → its own new event.

**Field-change tracking:**
- Changing `catalog.film.release_date` (or `status`, `title`, …) writes a `film_field_change` row; changing only `popularity`/`vote_count`/etc. writes nothing.
- `field_changed_at` returns the last change time, or `None` (→ caller uses `created_at`) for a never-changed value.

**Release-date:**
- Promo story whose `claimed_date` equals a `release_date` established > knob days ago → dropped.
- Story restating a date the film set **within** the knob window → recorded (may be the real announcement).
- Story announcing a *changed* date (≠ current) → recorded.
- Story with no parseable date → unchanged behavior.

## Testing (TDD) — behavioral gates, not prompt-string checks

The point of this work is durable regression coverage. **Unit tests on `apply_cluster_decisions` with a fake cluster payload (no LLM)** are the core:

- casting partition: new-only, matched-only (drop), mixed old/new (the Monica/John case), two-new-in-one-story, in-pass dedup.
- `_normalize_name` unit cases.
- release_date: restatement drop (established date), recently-set-date keep, changed-date keep, null-date passthrough, recency boundary.
- **Field-change trigger** (integration, real Postgres): update a tracked column → one `film_field_change` row; update a denylisted column → none; `field_changed_at` returns the latest. Requires the `after_create` DDL so the trigger exists under `create_all`.
- **Regression fixtures** for the concrete NEU-491 inputs (Angry Birds/Psalm casting, OK Madam 2 date) added to the validation set so these exact stories become scored, blocking cases — the thing NEU-483's presence checks weren't.

## Scope / non-goals

- **No self-heal.** Clustering is idempotent; this prevents *future* dupes only. Existing duplicate events need a manual re-cluster; existing casting events need the A5 backfill for full dedup coverage.
- **Three PRs** per the 1-ticket-1-PR convention: **A** (casting: cluster + `Event.subject_key` migration + summarizer + backfill), **B** (Film field-change trigger + `film_field_change` table + helper), **C** (release-date: cluster `claimed_date` + restatement guard). A and B are independent; **C depends on B**.
- **Name matching is string-based** (normalized). Aliases/typos/homonyms can miss; TMDB-person-id resolution is explicitly deferred (fragile for breaking cast news — newcomers/child actors like Psalm West don't resolve).
- Source-quality gating on event *creation* (the "trusted sources only" lever) is **separate** — tracked against NEU-454's follow-up, not here.

## Decisions settled

- **Casting key:** normalized name (not TMDB person id).
- **Release-date recency:** generic Film field-change tracking (Part B), consumed by Part C — replaces the earlier bespoke `Film.release_date_set_at`.
- **Denylist** (Part B, tunable later): `popularity, vote_average, vote_count, revenue, tmdb_raw, updated_at`.
- **Knob default:** `LINK_RELEASE_RESTATE_DAYS = 7`.

No open blockers — ready for ticketing + implementation planning.
