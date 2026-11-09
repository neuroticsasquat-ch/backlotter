# NEU-367 — Linker recall: reject promotional/interview/stale-stage pieces as not-news

- **Ticket:** [NEU-367](https://linear.app/neuroticsasquatch/issue/NEU-367/backend-linker-recall-reject-promotionalinterviewstale-stage-pieces-as) · `[backend]` · Project *Movies: Content Quality* · Milestone *MVP Quality Bar* · Priority High
- **Branch:** `tom/neu-367-backend-linker-recall-reject-promotionalinterviewstale-stage`
- **Related:** [NEU-358](https://linear.app/neuroticsasquatch/issue/NEU-358/backend-tighten-linker-event-acceptance-criteria) (the Stage-1 not-news filter this builds on — shipped), [NEU-359](https://linear.app/neuroticsasquatch/issue/NEU-359/backend-trim-synthesis-summaries-to-the-factual-announcement), [NEU-368](https://linear.app/neuroticsasquatch/issue/NEU-368/backend-tighten-summary-prompt-drop-redundant-film-title-extraneous) (summary-prompt fixes — **separate PR, `summarizer.py` only**).
- **Date:** 2026-06-24

## Problem

NEU-358 shipped the right not-news exclusion list in the Stage-1 linker, but Haiku **under-enforces** it: promotional / interview / reaction pieces about films that already wrapped still link as real beats. This is the accuracy-tuning pass NEU-358 explicitly deferred, now driven by real misclassifications found in the bulk re-link preview. **This ticket is the linker-recall fix only** — the summary-prompt refinements are split to NEU-368.

The 18% of non-news events split into **two distinct failure modes** that need different fixes:

1. **Stale-stage events (~53):** genuinely film-relevant stories that get *classified* into an early-stage `event_type` that contradicts the film's production `status` — `casting`/`announced`/`production_start` on films already in **Post Production** (39 casting + 11 announced + 3 production_start). The story passes Stage-1 legitimately; the defect only becomes visible at **Stage-2**, where `event_type` exists alongside film context. A wrapped film does not get fresh casting/announcement news.
2. **Interview/reaction pieces (~9):** the linker should have called these `not-news` at **Stage-1** but Haiku under-enforced. The prompts already name these exclusions verbatim — the model just isn't applying them.

These are addressed by complementary mechanisms (a deterministic Stage-2 gate + a Stage-1 prompt strengthening), plus a read-side hide for the `other` catch-all where residual hype lands.

## Evidence

Three user-flagged events — all on **Star Wars: Starfighter / Spaceballs**, both **Post Production** (wrapped, cast months ago):

| Story headline | Outlet | Film (status) | Linked as |
| -- | -- | -- | -- |
| Lewis Pullman on getting the chance to work with his dad on Spaceballs sequel | JoBlo | Spaceballs: The New One (Post Production) | `casting` |
| Amy Adams TEASES Her Excitement For Star Wars: Starfighter Ahead Of Its Release | Mshale | Star Wars: Starfighter (Post Production) | `other` |
| Star Wars: Matt Smith Opens up on His 'Interesting Guy or Girl' Starfighter Role | SuperHeroHype | Star Wars: Starfighter (Post Production) | `casting` |

Scan across the 293 events in the re-linked preview: **53 stale-stage events** (39 casting + 11 announced + 3 production_start on Post-Production films) and **9 explicit interview/reaction headlines** linked as beats. Roughly **18% of current events** are this class of non-news.

The Amy Adams case is instructive: it lands in `other`, which the Stage-2 gate does **not** target (only the three early-stage types), so it survives the gate — only the strengthened Stage-1 prompt or the `other`-hide removes it. This is exactly why all three mechanisms are needed.

## Architecture & relevant current state

The link pipeline runs in two LLM stages (`src/upmovies/link/pipeline.py`):

- **Stage 1 — linker** (`linker.py`): classifies each story `about` / `mention` / `no-match` / `not-news` against a roster and links `about` stories to a film. The roster (`roster.py`) carries title/original_title/year/overview/genres — **not `status`** — and the linker assigns **no `event_type`**. So Stage 1 cannot apply a "casting on a wrapped film" rule precisely.
- **Stage 2 — clustering** (`cluster.py`): groups a film's `linked`-but-unclustered stories into `Event` rows and assigns `event_type ∈ {announced, casting, production_start, production_wrap, release_date, trailer, other}`. It already loads the `Film` object in `build_cluster_request` but passes only title+year to the LLM — **`film.status` is loaded and unused.** Clustering is idempotent: it only processes `linked` stories with no `event_story` row (`EventStory.story_id` is unique). **Consequence:** any gate must *consume* the gated stories (remove them from the `link_status=="linked"` pool), or they get re-clustered and re-classified on every future run.

`film.status` (`catalog.film.status`, nullable Text) is populated from TMDB with values `Rumored` / `Planned` / `In Production` / `Post Production` / `Released` (already mapped in `public/arc.py`).

The public surface (`public/service.py`) currently applies **no** event-type filtering — all 7 types, including `other`, flow to `/feed`, `/feed/grouped`, and `/films/{slug}`.

### 1. Stage-2 production-stage gate (`src/upmovies/link/cluster.py`)

A deterministic, prompt-independent gate that drops the ~53 stale-stage events at the moment `event_type` is assigned.

- **Pure helper** `is_stale_stage(event_type: str, film_status: str | None) -> bool`:

  ```python
  _STALE_EVENT_TYPES = {"announced", "casting", "production_start"}
  _WRAPPED_STATUSES = {"Post Production", "Released"}

  def is_stale_stage(event_type: str, film_status: str | None) -> bool:
      return event_type in _STALE_EVENT_TYPES and film_status in _WRAPPED_STATUSES
  ```

  NULL/unknown status → not stale (safe default; never reject on missing data). No I/O — unit-testable directly.

- **`ClusterPlan`** gains `film_status: str | None`, populated in `build_cluster_request` from the already-loaded `film` (no extra query). It rides the plan, so both the sequential and batched apply paths (`apply_cluster_decisions`) receive it. The status is a point-in-time snapshot taken at build; acceptable for a slow-moving field.

- **`apply_cluster_decisions`** gets one new branch. For each **new** event group (i.e. not an attach-to-existing), *after* the existing `type`/`confidence` validation, if `is_stale_stage(etype, plan.film_status)`:
  - **Do not create the `Event`.** Instead reject each story in the group exactly like NEU-358's Stage-1 reject branch: `story.link_status = "rejected"`, `story.film_id = None`, `story.link_confidence = None`, `story.link_note = f"stale-stage:{etype}"`.
  - Attach-to-existing groups are **untouched** — those events predate the status change and re-litigating them is out of scope.
  - This consumes the stories (they leave the `linked` clustering pool), so the gate is idempotent — no re-clustering churn.

- **`ClusterResult`** gains `stories_rejected: int`. The pipeline's `_cluster_stage_sequential` / `_cluster_stage_batched` aggregate it and include it in the `finalize_run` detail string (auditable run accounting).

- **Scope of the gate:** only the three evidenced types (`announced`, `casting`, `production_start`) × `{Post Production, Released}`. Deliberately **not** gating `production_wrap`, nor early-stage types on `In Production` films — the evidenced 53 are exactly these three on wrapped/released films, and widening risks false rejects. The two sets are module constants, easy to widen later.

**Rejection rationale audit:** `link_note = "stale-stage:<type>"` is surfaced by the existing `scripts/diagnose_linking.py` (same mechanism NEU-358 used for `not-news:<category>`). No new endpoint.

### 2. Stage-1 linker prompt strengthening (`src/upmovies/link/linker.py`)

Reinforce the existing `not-news` bullet in `_INSTRUCTIONS` so Haiku actually applies the rules it already names — catching interview/reaction pieces regardless of film stage.

- Add concrete headline-pattern negatives to the `not-news` definition: enthusiasm / interview verbs — *"teases", "reacts to", "opens up", "can't wait", "excited for", "ahead of its release"* — and restate the operative test: **a story that reports no NEW production fact is `not-news`, even if it is unmistakably about the film.**
- **No JSON-contract change:** the `not-news` reason and the `reaction` / `interview-quote` categories already exist from NEU-358; these headlines map onto them.
- **No version field:** the linker has no `link_prompt_version` concept (re-linking is done by resetting `linked→pending` and re-running). Not adding one (YAGNI; consistent with NEU-358).

### 3. `other`-hide at the public surface (`src/upmovies/public/service.py`)

The `other` catch-all carries residual hype that neither the gate (it only targets the three early-stage types) nor the prompt always catches. NEU-358 deliberately kept `other` valid (it also carries legit studio/format/distribution beats), so the decision here is to **hide it from users, not delete it** — a reversible read-side filter, no data loss.

- A single module-level predicate (`Event.event_type != "other"`) applied uniformly to **every site that defines a *public* event**: `get_film_detail`'s summarized-events query, `get_feed` (rows **and** count), `get_feed_grouped`'s `base` select, `get_film_index`'s `has_summary` existence check, and `get_sitemap_films`.
- Applying it uniformly (not just on the three event-list surfaces) prevents the edge case where a film whose **only** events are `other` would list in the index/sitemap yet render an empty timeline.
- **Arc-stage derivation is unaffected** and left untouched: `other` has no mapping in `arc.py`'s `_EVENT_STAGE`, so it never contributes to a film's arc stage. (`_event_types_by_film` and the `all_event_types` query in `get_film_detail` feed arc-stage only and need no change.)

### 4. Eval & fixtures (`tests/fixtures/link/validation_set.json`)

Follow NEU-358's curated-rows-plus-manual-pass split exactly.

- **In this PR (CI guard):** add curated `about` + `is_production_news: false` rows for the flagged interview/reaction examples (Amy Adams "teases", Matt Smith "opens up", Anya Taylor-Joy "reacts to … Casting", Ali Fazal "opens up about Mirzapur", …), categorized `interview-quote` / `reaction` using the schema NEU-358 already added (`is_production_news` + `exclusion_category`). Synthetic-but-schema-valid is sufficient for the unit-test guard; real-roster membership matters only for Tom's manual API run.
- The existing `scripts/validate_linking.py` harness measures the **Stage-1 prompt** axis (news-value precision/recall + leak-by-category). The **Stage-2 gate is deterministic**, so it is covered by unit + integration tests rather than the harness.

## Components & files touched

| File | Change |
|---|---|
| `src/upmovies/link/cluster.py` | `is_stale_stage` helper + `_STALE_EVENT_TYPES`/`_WRAPPED_STATUSES`; `ClusterPlan.film_status`; `build_cluster_request` populates it; `apply_cluster_decisions` stale-stage reject branch; `ClusterResult.stories_rejected`. |
| `src/upmovies/link/pipeline.py` | Aggregate `stories_rejected` across cluster stages; include in `finalize_run` detail. |
| `src/upmovies/link/linker.py` | `_INSTRUCTIONS`: strengthen the `not-news` bullet with interview/enthusiasm headline patterns + the "no new production fact" test. |
| `src/upmovies/public/service.py` | `Event.event_type != "other"` predicate applied to film-detail events, `/feed` (rows+count), `/feed/grouped`, `get_film_index` `has_summary`, `get_sitemap_films`. |
| `tests/fixtures/link/validation_set.json` | Curated interview/reaction `not-news` rows for the flagged examples. |
| `tests/unit/link/test_cluster.py` *(new)* | Pure `is_stale_stage` truth table. |
| `tests/integration/link/test_cluster.py` *(existing)* | `apply_cluster_decisions` gate behavior (DB session). |
| `tests/integration/routers/test_public_films.py` · `test_public_feed.py` · `test_public_feed_grouped.py` · `test_public_sitemap.py` *(existing)* | `other` excluded from detail/index/feed/grouped/sitemap. |
| `tests/unit/link/test_validation.py` *(existing)* | New curated rows present + schema-valid (extend the NEU-358 fixture guard). |

## Testing (TDD, one backend PR — everything via `task` in-container)

Write each failing test first.

1. **`is_stale_stage` unit** (`tests/unit/link/test_cluster.py`, new) — truth table: each of `{announced, casting, production_start}` × `{Post Production, Released}` → `True`; the same types × `{In Production, Planned, Rumored, None}` → `False`; non-stale types (`trailer`, `release_date`, `production_wrap`, `other`) × any status → `False`.
2. **Gate integration** (`tests/integration/link/test_cluster.py`, existing) — a new event group classified `casting` on a `Post Production` film: **no `Event` row created**, each story `link_status == "rejected"` with `film_id is None`, `link_confidence is None`, `link_note == "stale-stage:casting"`, and `ClusterResult.stories_rejected == N`; a new `trailer`/`release_date` group on the same film → event **created** normally; an attach-to-existing group → unaffected; `film_status is None` → not gated (event created). Regression: the existing cluster tests stay green.
3. **Public `other`-hide** (existing `tests/integration/routers/test_public_*.py`) — `/films/{slug}`, `/feed`, `/feed/grouped` exclude `other` events; a film whose only events are `other` drops from the film index and sitemap.
4. **Fixture guard** (`tests/unit/link/test_validation.py`, existing) — the new curated interview/reaction rows load and validate (`about` + `is_production_news=False` + a recognized `exclusion_category`).

**Integration-test quirk:** items 2 and 3 are integration tests (DB session). Per the repo CLAUDE.md, running a *single* integration file in isolation throws a pytest-asyncio session-loop warning — scope to a directory (`task test -- tests/integration/link`, `task test -- tests/integration/routers`) or run the whole suite. Unit items 1 and 4 are safe to run as single files.

All of `task test`, `task lint`, `task typecheck`, `task format` must be green before the PR (full CI locally per house rules).

## Out of scope

- **`summarizer.py` / summary-prompt refinements** — split to **NEU-368** (separate PR).
- **DB migration** — none. The gate reuses existing columns (`link_status`, `link_note`, `film_id`, `link_confidence`); the `other`-hide is read-only; the prompt change is text. The `ClusterResult.stories_rejected` field is an in-memory dataclass, not a DB column.
- **`link_prompt_version`** — the linker has no version concept; not adding one.
- **Stage-1 status-in-roster** — the linker cannot apply the stage gate precisely (no `event_type` at Stage 1); the gate stays at Stage 2 where both signals exist.
- **Widening the gate** to `production_wrap` or to early-stage types on `In Production` films — kept to the evidenced three types × wrapped/released statuses.
- **Retroactive cleanup of already-linked/clustered data** — the gate and prompt apply going forward. To clean existing data, Tom runs the manual preview re-scan (reset `linked→pending`, widen `LINK_RECENCY_DAYS`, re-link, re-synthesize, re-scan) — an ops action, not built here.
- **Tom's manual sign-off run** — the full preview re-scan to confirm the 53 stale-stage + interview events drop (needs a real API key + token cost; not a merge blocker).

## Acceptance criteria (from the ticket)

- Stale-stage events (`casting`/`announced`/`production_start` on Post-Production/Released films) are no longer created as events. *(Deterministic gate; guarded by unit + integration tests; confirmed at scale by Tom's manual re-scan.)*
- Interview/enthusiasm pieces are more reliably rejected at Stage 1. *(Strengthened prompt; measured by `validate_linking.py`'s news-value section on Tom's manual run; curated rows guard the direction in CI.)*
- `other`-typed events no longer appear on the public surface. *(Read-side predicate across all public-event sites; covered by public-service tests.)*
- Rejection rationale is logged/surfaced for audit. *(`link_note = "stale-stage:<type>"`, surfaced by `diagnose_linking.py`; `stories_rejected` in the run detail.)*
