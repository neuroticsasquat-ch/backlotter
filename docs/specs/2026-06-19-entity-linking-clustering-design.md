# Entity Linking & Clustering — Design

- **Date:** 2026-06-19
- **Status:** Approved (pending implementation)
- **Component:** `upcoming-movies-backend` — new `link` pipeline + `news` schema extensions
- **Linear:** project *Movies: Entity Linking & Clustering*; spike NEU-259
- **Builds on:** [2026-06-19-full-tmdb-capture-normalization-design.md](2026-06-19-full-tmdb-capture-normalization-design.md), [2026-06-19-prerelease-ingestion-filter-design.md](2026-06-19-prerelease-ingestion-filter-design.md)

## What this is

The technical moat. Sits between two already-built seams:

- **Upstream — the canonical spine:** `catalog.film` holds the full TMDB object for a
  deliberately small, pre-release-only corpus (~200–300 films: future-dated, popularity
  ≥ 1, status ∉ {Released, Canceled}). No credits/cast (deferred in the capture spec).
- **Upstream — raw stories:** the feeds pipeline lands items in `news.story` deduped by
  URL, with a **nullable `film_id` FK that is explicitly the attach point this project
  populates.** `story.raw` keeps only `title`, `summary` (the dek), `published`, `author`
  — **feeds only, no article bodies** (ToS-clean). The entire linking/clustering signal is
  *headline + one-paragraph dek*.
- **Downstream — Synthesis (NEU-260)** consumes the event records this project emits: it
  writes one neutral 2–3 sentence update per event, feeding the per-movie chronological log
  and the global "updated today" feed.

This project does three things: **link** each story to the right film (or reject it),
**cluster** a film's stories into distinct events (dedup + segmentation), and **classify**
each event's significance — emitting event records as the contract to Synthesis.

## Decisions

| Question | Decision |
|---|---|
| Linking architecture | **LLM-first, no embeddings.** Prompt-cache the whole ~216-film roster and let the LLM adjudicate. The ingestion filter caps the corpus at ~200–300, so candidate-generation / pgvector buys nothing now. |
| Review model | **Fully automatic** with a single confidence floor. No human-in-the-loop review queue in the MVP. |
| Significance model | **Two axes:** `event_type` (the beat) × `confidence` (`confirmed`/`rumored` binary). |
| Clustering scope | **Per film, per window** — link first, so dedup is segmenting a handful of stories per film, not O(stories²). |
| Story↔event cardinality | **One event per story** (a story reporting two beats attaches to its dominant one). |
| Idempotency | Stage 2 is shown **existing recent events + new stories**; it attaches or opens events, so re-runs grow events instead of duplicating them. |
| Models | link = **Haiku 4.5** (high volume, ~87% rejection, cached roster); cluster/classify = **Sonnet 4.6** (judgment). Config-swappable. |
| Credits | **Deferred** — accept the "named only by director/star" recall gap for the MVP. Tracked as an Ingestion & Feeds backlog item. |
| Story recency at ingestion | **Out of scope here** — the link step windows regardless. A source-side recency fix is a separate Ingestion & Feeds ticket (see Deferred). |

## Architecture — the `link` pipeline

A third `ingest_run` kind (`link`) alongside `tmdb` and `feeds`, run **after** `feeds` in
the daily sequence. Idempotent and re-runnable: it only ever touches `pending` stories and
recent events. The film roster is built once per run and **prompt-cached** across all LLM
calls in that run.

```
stories (pending, recent)
        │
        ▼
 ┌──────────────┐   Haiku, cached roster, batched
 │ 1. LINK      │   per story → {film_id|null, confidence, reason}
 └──────┬───────┘   apply floor → story.link_status / film_id
        │ linked stories, grouped by film
        ▼
 ┌──────────────┐   Sonnet, one call per film
 │ 2. CLUSTER + │   input: existing recent events + new stories
 │    CLASSIFY  │   → event assignments + event_type + confidence
 └──────┬───────┘
        │
        ▼
 ┌──────────────┐
 │ 3. EMIT      │   upsert news.event + news.event_story
 └──────────────┘
```

Both stages follow the existing ingestion conventions: `(session_factory, run_id, …)`,
commit per unit of work (one story batch / one film) so a single failure never rolls back
others, and wire `ingest.runs` (`create_run`/`record_progress`/`finalize_run`).

## Schema (`news`)

### `news.story` — extended (link state)

| Column | Type | Notes |
|---|---|---|
| `link_status` | Text, default `'pending'`, **indexed** | `pending` \| `linked` \| `rejected`; check constraint. The pipeline scans on this. |
| `link_confidence` | Float, nullable | The linker's confidence for the chosen film (null when rejected/no-match). |
| `linked_at` | timestamptz, nullable | When the link step processed the story. |
| `link_note` | Text, nullable | Debug breadcrumb (e.g. `mention-only`, `no-match`, `below-floor`). |

`film_id` already exists (FK → `catalog.film.id`, `ON DELETE SET NULL`). It is set **only**
when the story is genuinely *about* the film (mentions are rejected).

### `news.event`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `film_id` | uuid, FK → `catalog.film.id` (`ON DELETE CASCADE`), indexed | the film this event belongs to |
| `event_type` | Text, check → taxonomy | see Significance taxonomy |
| `confidence` | Text, check ∈ {`confirmed`, `rumored`} | noise-control axis |
| `occurred_at` | timestamptz | event date, derived from member stories (earliest member `published_at`, `fetched_at` fallback) |
| `created_at` | timestamptz, default `now()` | drives the "updated today" feed |
| `updated_at` | timestamptz, default `now()` | bumped when new stories attach |

**No summary column.** Synthesis owns its own summary layer keyed by `event_id`; this
project's contract stops at the event + its sources.

### `news.event_story`

| Column | Type | Notes |
|---|---|---|
| `event_id` | uuid, FK → `news.event.id` (`ON DELETE CASCADE`) | |
| `story_id` | uuid, FK → `news.story.id` (`ON DELETE CASCADE`), **unique** | one event per story |

Composite pk (`event_id`, `story_id`); the unique constraint on `story_id` enforces the
one-event-per-story rule.

## The three LLM stages

### Roster (built once, prompt-cached)

A compact list of every tracked film: `film_id`, `title`, `original_title`, release year,
a trimmed `overview`, and `genres`. ~216 rows ≈ a few thousand tokens. Cached as a stable
prompt prefix so each link/cluster call reuses it.

### Stage 1 — Link (Haiku)

Batch ~10–20 `pending` stories (within the recency window) per call against the cached
roster. Per story, the model returns:

```
{ "story_id": "...", "film_id": "<uuid>" | null,
  "confidence": 0.0–1.0, "reason": "about" | "mention" | "no-match" }
```

Resolution:
- `film_id` set, `reason = about`, `confidence ≥ floor` → `link_status = linked`, set
  `film_id`, `link_confidence`, `linked_at`.
- Anything else (no match, mention-only, or below floor) → `link_status = rejected`,
  `link_note` records which. `film_id` stays null.

The prompt makes **"none" the comfortable default** — ~87% of stories attach to nothing
(see Supporting data), and the model must distinguish *the tracked film "Runner"* from
*"showrunner"* / *"Blade Runner"*, and reject TV, games, sports, obituaries, and
already-released films.

### Stage 2 — Cluster + Classify (Sonnet)

For each film that gained linked stories, one call whose input is **that film's recent
existing events (with their member story headlines) plus its new linked stories**. The
model:
- attaches each new story to an existing event, or opens a new event;
- assigns every event an `event_type` and a `confidence` (`confirmed`/`rumored`).

N is tiny per film (even Spider-Man is ~5 events across weeks), so this fits one call.
Output drives the upsert in Stage 3 (new events inserted; existing events gain
`event_story` rows and a bumped `updated_at`).

## Significance taxonomy

`event_type` maps to the initiative's status arc
(announced → cast → shooting → wrapped → dated → trailer → released):

| `event_type` | Arc stage | Corpus frequency |
|---|---|---|
| `announced` | announced / greenlight | Rare in-corpus (films enter already-dated). |
| `casting` | cast | High. |
| `production_start` | shooting | Rarer (most films arrive In Production / Post). |
| `production_wrap` | wrapped | Medium. |
| `release_date` | dated | High + high-signal (set / move / delay / pull). |
| `trailer` | trailer | High. |
| `other` | — | Real per-film beat that isn't above (poster, still, synopsis, festival slot). |

`confidence` ∈ {`confirmed`, `rumored`} is independent of type and is the axis the paid
tier later filters on ("alert on confirmed casting/date/trailer; skip rumor"). It is a
**label, not a gate** — `rumored` events are still recorded.

## Confidence floor & auto behavior

- **Link confidence** has a hard floor: below it → `rejected` silently (no queue). This is
  the one tunable knob, set against the validation baseline (§Validation). Stored config
  default; start conservative (precision-favoring) and relax if recall is too low.
- **Event confidence** is never a gate — `rumored` is a legitimate stored value.

## Idempotency / re-run / event-evolution

- Stories are processed once (`pending` → `linked`/`rejected`); re-runs never re-link.
- Events **grow**: later outlets on the same beat attach to the existing event (Stage 2
  sees recent events), bumping `updated_at` and the source set rather than duplicating.
- An event "ages out" of Stage 2's consideration once older than the window; its row
  persists.
- Re-running the whole pipeline with no new stories is a no-op.

## Recency windowing

Stage 1 selects `pending` stories where `coalesce(published_at, fetched_at)` is within a
configurable window (default ~30–45 days). This protects the linker from the resurfaced-old
-article problem (Google News surfaces evergreen matches; the corpus has stories dated back
to 2015) **regardless** of whether ingestion is fixed. The source-side ingestion recency
gate is a separate Ingestion & Feeds concern (see Deferred).

## Pipeline ops

- Extend the `ingest.ingest_run.kind` check constraint to include `link`.
- `POST /admin/ingest/link` (ADMIN_TOKEN via `require_admin`): create a `link` run, spawn
  the background task, return `{run_id}` 202 — mirroring the tmdb/feeds triggers.
- Add `link` to the GitHub Actions daily cron **after** feeds (tmdb → feeds → link), same
  trigger-then-poll pattern.
- `finalize_run` `detail` records observability counts, e.g.
  `"linked 41, rejected 533; 18 films touched, 27 events (5 new)"`.
- The existing admin runs UI surfaces `link` runs for free (kind is data-driven); an
  optional FE tweak labels the new kind.

## Config (`config.py`)

New settings (pydantic-settings, env-aliased):
- `ANTHROPIC_API_KEY` (**required** once the pipeline ships).
- `link_model` (default `claude-haiku-4-5`), `cluster_model` (default `claude-sonnet-4-6`).
- `link_confidence_floor` (float, **0.70** — validated by the NEU-299 floor sweep; see §Baseline results).
- `link_recency_days` (default 45).
- `link_batch_size` (default 15).

## Validation harness & accuracy baseline (the spike deliverable)

The current **620-story corpus is a right-sized, hand-labelable validation universe** (only
~80 plausibly match a tracked film).

- **Labeled set:** for a sample (~150–200 stories: all plausible matches + a reject
  sample), record the correct `film_id` (or none), `about`/`mention`, and for linked ones
  the expected event grouping + `event_type`.
- **Metrics harness:** run Stage 1 against the labeled set → linking **precision / recall /
  F1** (precision-weighted, given the auto-publish design). Run Stage 2 → cluster purity /
  dedup quality (do same-event stories land together; are distinct beats split).
- **Baseline + tuning loop:** record the numbers, then tune the prompt + `confidence_floor`
  against them. This harness is the regression guard for future prompt changes.
- Stored as a committed fixture + a runnable harness (not a live-network test; mock the
  Anthropic client per repo convention).

### Baseline results (2026-06-22)

Produced under NEU-299. The labeling step deferred during M3 (the fixture had shipped
empty) was completed here: a 277-row labeled set, hand-reviewed from Sonnet-proposed
candidates (`scripts/propose_validation_labels.py` → browser review UI
`scripts/build_review_html.py` → `tests/fixtures/link/validation_set.json`). Composition:
**76 `about`, 14 `mention`, 187 `none`** — 84 of the nones tagged `untracked_film` (real
movie news about films not in the pre-release roster; sizing evidence for NEU-285).

**Stage-1 linking** (`scripts/validate_linking.py`, `claude-haiku-4-5`, floor 0.70):

| Run | TP | FP | FN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| A | 72 | 1 | 4 | 0.986 | 0.947 | 0.966 |
| B | 72 | 1 | 6 | 0.986 | 0.921 | 0.952 |

Precision is **~0.99 and stable**; recall is **~0.92–0.95**, varying run-to-run as a few
borderline `about`/`mention` cases flip (same model, same set). Treat recall as a band, not
a point.

**Error analysis** (`scripts/diagnose_linking.py`): every false negative is an
`about`/`mention` *classification* call (model said `mention`/`no-match`) — **0 below-floor,
0 wrong-film**. The lone false positive is a magazine issue-preview roundup linked to its
lead title. The model never mis-links to the wrong film and never loses a link to the
threshold; the only error mode is the genuinely-fuzzy about/mention boundary (e.g. "<actor>
thinks Marvel erred by not bringing them back for <film>").

**Floor sweep** — flat across the usable range, because the errors are classification, not
confidence:

| floor | P | R | F1 | FP | FN |
|---|---|---|---|---|---|
| 0.50–0.75 | 0.986 | 0.921 | 0.952 | 1 | 6 |
| 0.80 | 0.986 | 0.908 | 0.945 | 1 | 7 |
| 0.90 | 1.000 | 0.763 | 0.866 | 0 | 18 |

**Decision: `link_confidence_floor` stays 0.70** (anywhere 0.50–0.75 is equivalent —
lowering recovers nothing, raising to 0.90 craters recall).

**Conclusions for the deferred backlog:**
- **HITL review queue (NEU-281):** not needed — 0.99 precision validates the auto-publish design.
- **Embeddings / pgvector (NEU-282):** not needed — no candidate-gen recall gap or cost problem the LLM-first path can't meet.
- **Credits ingestion (NEU-284):** deferred — only 1 of 6 misses (a film named by franchise+star, not title) might benefit; not compelling.
- **Only real lever:** prompt-tune the about/mention boundary (few-shot the character-detail / cast-on-set cases). Upside ~2–3 cases vs. a precision risk; low priority, not an MVP blocker.

**Not yet measured:** Stage-2 cluster purity / dedup — the set has no `event_group` labels
yet and `validate_linking.py` scores Stage 1 only. Linking precision is the MVP gate, so
this is deferred; closing it fully needs an `event_group` labeling pass + a Stage-2 harness
run.

## Testing (TDD)

- **Schema/migration:** new `story` columns + `event` / `event_story` tables; check
  constraints; `event_story.story_id` uniqueness rejects a second event for a story.
- **Link service:** mocked Anthropic responses — an `about`+high-confidence story links; a
  `mention` rejects; a below-floor `about` rejects with `link_note = below-floor`; a
  no-match rejects. Roster builder produces the expected compact rows.
- **Cluster service:** new stories on a fresh film create events with correct types; a new
  story matching an existing event attaches (no duplicate, `updated_at` bumped); two
  distinct beats on one film split into two events.
- **Pipeline:** `link` run wires `ingest.runs`, commits per unit, finalizes with counts;
  recency window excludes old stories; re-run with no new stories is a no-op.
- Anthropic calls are **mocked** (never hit the live API). `task test`, `task lint`,
  `task typecheck` green (run `task format`).

## Delivery plan (milestones)

Sub-issues are 1-PR-each, backend unless noted. Final ticket shapes are set in the Linear
scoping pass.

- **M1 — Linking core:** link-state schema + migration + `link` ingest kind; roster
  builder; Anthropic client wrapper (SDK + prompt caching, config); LLM link service +
  floor; `link` pipeline (Stage 1) + trigger endpoint + cron wiring. *Output:* stories get
  `film_id`.
- **M2 — Clustering & significance:** `news.event` + `news.event_story` schema + migration;
  cluster+classify service (idempotent merge); emit/upsert events wired as Stage 2.
  *Output:* event records feeding Synthesis.
- **M3 — Validation & accuracy baseline:** labeled set from the current corpus; metrics
  harness; measured baseline + prompt/floor tuning; documented accuracy numbers (the spike
  deliverable). Sequenced early enough to tune M1/M2 against it.

## Out of scope / Deferred

Captured as backlog issues in their **home projects** during the scoping pass (not a
separate project), each linking this spec:

| Deferred item | Home project | Rationale |
|---|---|---|
| Human-in-the-loop review queue | Entity Linking & Clustering | MVP is auto-only; revisit if the baseline demands review. |
| Embeddings / pgvector escalation | Entity Linking & Clustering | Only if validation shows candidate-gen / cost problems. |
| Credits/cast-crew ingestion (linking recall) | Ingestion & Feeds | Closes the "named by director/star" gap; TMDB-spine scope. |
| Google News `when:Nd` + fetcher `published_at` recency gate | Ingestion & Feeds | Source-side data hygiene; link step already windows. |
| Path B (undated / just-announced films) | Ingestion & Feeds | Already documented out-of-scope in the prerelease spec. |
| Released-film pruning / refresh | Ingestion & Feeds | Catalog maintenance. |

Also out of scope here: any film/event-serving API endpoint or frontend reads of events
(that's Synthesis), and the synthesized summary text itself.

## Supporting data (probed 2026-06-19, local corpus)

**Films:** 216 tracked (208 with IMDb id). Status: Post Production 134 · In Production 59 ·
Planned 22 · Rumored 1. Dated 2026-06-24 → 2028-06-29. Language: en 155 + global tail
(hi 10, te 9, ja 7, ta 6, fr/es 4, ru 3, …).

**Stories:** 620 total, **0 linked** (greenfield). Recency: 484 in last 30d, 507 in 90d,
582 in 365d, **38 older than a year** (floor 2015). Sources: Google News greenlight 126 ·
Empire 119 · GN casting 102 · GN release date 101 · GN trailer 100 · /Film 20 · Deadline
12 · Variety 10 · Collider 10 · THR 10 · ScreenRant 10. The 4 broad Google-News queries
dominate (~530 of 620).

**Naive title-match probe** (film title as substring of story title+dek):
- **82 / 620 (13%)** stories mention a tracked title (len ≥ 5); 56 at len ≥ 8. Only **30
  distinct films** light up → **linking is ~87% rejection.**
- Lexical matching is both leaky and noisy: `"Runner"` matched *"showrunner"* and *"Blade
  Runner"*; `"Dragon"` matched *"Dragon Striker"*. Short titles are false-friend magnets —
  confirming an LLM that sees the whole headline is required, and that a lexical pre-filter
  would lose recall *and* add false positives.
- Power-law concentration: Spider-Man: Brand New Day 20 · Shrek 5 9 · Dragon 6 · Hexed /
  The Odyssey / Minions & Monsters 4 · then a tail of 2–3. The 20 Spider-Man stories span
  trailer + casting + date — i.e. multiple **events**, confirming clustering is *event
  segmentation*, not just dedup.
