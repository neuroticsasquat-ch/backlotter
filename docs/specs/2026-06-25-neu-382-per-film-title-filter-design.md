# NEU-382 — Reduce per-film Google News link-stage spend (title-token fetch filter) — design

- **Ticket:** NEU-382 · **Milestone:** LLM Cost & Token Efficiency · **Date:** 2026-06-25
- **Type:** behavior change (ingest-time filter), no schema change
- **Origin:** rescoped from the NEU-381 "prune low-ROI sources" fast-follow (see `2026-06-24-neu-381-source-roi-audit-design.md`).

## Problem

Per-film Google News is 94% of ingested story volume and ~94% of link-stage token cost, at a 10.5%
link rate — so ~90% of the 20,060 per-film stories are **rejected** by the Stage-1 linker, each still
paying full link-stage tokens. That rejected volume is the waste to cut. The constraint: per-film is
also the dominant **value** source (it produces 89% of all events as "pure per-film"), so coverage must
be preserved.

## Measurement findings (drove the approach)

Two measurements were run on localdev (2026-06-25) before design:

**Value distribution (DB, exact).** 347 of 392 events (89%) are *pure per-film* — every member story
came from the per-film search, so they vanish if that film isn't searched. A popularity gate's value
loss is roughly **linear**, not tail-concentrated: dropping the bottom 25% of films by popularity loses
6% of events; bottom 50% loses 18%. Low-popularity films carry real (if smaller) unique value.

**Volume distribution (live probe, 32 films stratified by popularity quartile).**

| quartile | items/film | on-topic | junk/film |
|---|---|---|---|
| Q1 (least popular) | 15.4 | 14% | 13.2 |
| Q2 | 22.8 | 33% | 15.2 |
| Q3 | 42.8 | 66% | 14.5 |
| Q4 (most popular) | 38.4 | 52% | 18.2 |

The junk floor is **~13–18 stories/film and roughly constant across popularity**. The unquoted
`<title> when:Nd` query (deliberately unquoted in `feeds.py` for recall — "linker owns precision")
returns a near-fixed junk floor for *every* film; popular films merely add on-topic coverage on top.
The real volume driver is **title genericness**, not popularity: obscure films with common-word titles
("Gladys" 30 items/2% on-topic, "By Any Means" 52/2%, "Night Comes" 53, "Zero A.D." 62) generate the
most junk; foreign/obscure titles often return 0. Even the most popular films still carry an ~18-junk/film floor.

**Conclusion.** A popularity gate is blunt — it trades coverage breadth for cost and loses value
linearly, because the junk it targets is not concentrated in the tail. A **title-token match filter at
fetch time** attacks the junk floor across *all* films (popularity-agnostic), drops obvious non-matches
*before* they cost a link token, and loses ~no genuine coverage.

## Approach

Filter per-film search results against the originating film's title **at fetch time**, before insert.
When we fetch film X's per-film search, X's title is in hand, so a cheap, high-recall, non-LLM
title-token match drops headlines that clearly aren't about X. The LLM linker remains the precision
authority on what survives the filter — this is only a pre-cut for obvious junk.

**Rejected alternatives:** popularity gate (blunt — see findings); quoting the Google query
(`"<title>"` — Google quoting is fuzzy relevance-matching per the `feeds.py` note, unreliable and
less controllable than an explicit post-filter).

## Design

### 1. Pure module `news/title_match.py`

```
title_matches(film_title: str, headline: str, *, min_ratio: float) -> bool
```

- Lowercase both; split to Unicode word tokens; drop a small stopword set
  (`the a an of and or to in on part`…) and 1-character tokens → *significant title tokens*.
- Match = (significant title tokens present as **whole words** in the headline) / (significant title
  tokens) ≥ `min_ratio`. Whole-word matching (not substring) so "War" does not match "warehouse".
- **High-recall safety rails:**
  - Title with **no significant tokens** (all-stopword, numeric-only, or non-Latin script that
    tokenizes to nothing) → **keep** (don't filter what we can't assess; let the linker decide).
  - **Single significant token** titles require that one token present (ratio 1.0 of 1).
- Pure, no I/O — unit-tested in isolation.

### 2. Thread the originating title into the fetch loop

`per_film_google_sources` yields `(title, FeedSource)` pairs (today it yields bare `FeedSource`s with the
title baked into the URL). Phase B of `news/fetcher.py` then runs each per-film entry through
`title_matches(title, entry.title, min_ratio=…)` and only inserts matches via `upsert_stories`.
**Phase A (trade RSS + broad Google queries) is untouched** — only per-film is filtered.

### 3. Config (mirrors the existing `feeds_per_film_*` pattern; env-overridable for tuning)

- `per_film_title_filter_enabled: bool = True` (alias `PER_FILM_TITLE_FILTER_ENABLED`)
- `per_film_title_match_min_ratio: float = 0.5` (alias `PER_FILM_TITLE_MATCH_MIN_RATIO`) — starting
  value; finalized by the false-drop measurement below.

### 4. Observability

Per-run count of dropped per-film entries is logged and folded into the run's progress as a `filtered`
tally so the cut is visible in run records (not silently swallowed). No silent truncation.

### Data flow

per-film fetch (title known) → `parse_feed` → **`title_matches` filter** → `upsert_stories` (matches
only) → `pending` → linker (final precision) → cluster → events. Strictly less reaches the linker;
coverage loss is bounded and measured.

## Validation & acceptance

Reuses existing labeled data — no new corpus.

- **False-drop measurement.** Run `title_matches` over `tests/fixtures/link/validation_set.json`: for
  every item that is genuinely about a film (`relation='about'` with an `expected_film_tmdb_id`), match
  its headline against that film's roster title and count how many the filter would wrongly drop. The
  validation set is trade-sourced, which phrases films differently than the title — a conservative
  (harder) recall test. **Tune `min_ratio` so false-drops ≈ 0.**
- **Cost measurement.** Re-run `scripts/audit_source_roi.py` before/after a fresh per-film ingest:
  report per-film link-volume reduction and confirm per-film `unique_events` is not materially down.

**Acceptance:**
- `title_matches` is pure and unit-tested across the edge cases below.
- False-drop rate ≈ 0 on the validation set at the chosen `min_ratio`.
- Measured per-film story-volume reduction reported; per-film `unique_events` preserved; no
  public-surface regression.
- Backend CI green (lint + typecheck + tests).

## Testing (TDD)

- **Unit (`title_match`):** multi-word match above/below threshold; whole-word boundary
  ("War" ≠ "warehouse"); stopword handling; single-token title; no-usable-token title → keep;
  non-ASCII title → keep (or match); numbered sequel ("How to Train Your Dragon 2").
- **Integration (fetcher):** a per-film entry failing the match is not inserted; trade/broad-feed
  entries are unaffected; the dropped count is surfaced on the run. (Per the repo quirk, scope
  integration runs to a directory, don't run a single integration file in isolation.)

## Out of scope (deliberate)

- **Popularity gate** — measured blunt; not pursued.
- **Schema / persistence** — the filter runs in-process at fetch using the in-hand title; nothing new
  is stored. (Persisting the originating film to fix NEU-381's rejected-story attribution gap is a
  possible future, explicitly deferred.)
- **Query quoting**, trade/broad-feed filtering, cluster/summarize stages.
- **Dropping /Film · Collider · Empire** from `feeds.py` — separate tiny PR per the ticket (quality
  cleanup, ~$0.011, not the cost lever).

## Locked decisions (Tom approved)

- Primary lever = title-token fetch filter (not popularity gate).
- Default tuned to **~0 false-drops** on the validation set; `min_ratio` stays an env knob to dial up later.
- **No persistence** of the originating film — in-process filter, no schema change, smallest PR.

## Self-review

- **Placeholders:** none — the only unfilled value is the final tuned `min_ratio` (set during impl by
  the false-drop measurement, default 0.5) and the measured volume-reduction number (filled at run time).
- **Consistency:** the trusted-trade/per-film framing and cost figures match the NEU-381 results
  spec; the filter is defined once (pure function) and consumed once (fetcher Phase B).
- **Scope:** single backend PR — one pure module + config + fetcher threading + tests; popularity gate,
  persistence, and the feed-drop are explicitly carved out.
- **Ambiguity:** "match" is pinned to a whole-word significant-token ratio with explicit high-recall
  rails for the un-assessable cases; "didn't hurt coverage" is pinned to ≈0 false-drops on labeled data
  plus preserved per-film `unique_events`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
