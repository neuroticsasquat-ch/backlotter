# NEU-452 — Production status derives solely from TMDB

- **Ticket:** [NEU-452](https://linear.app/neuroticsasquatch/issue/NEU-452/bug-fake-trailer-from-low-quality-source-wrongly-categorized-as) `[backend]` (Bug)
- **Project / milestone:** backlotter: Maintenance
- **Related:** [NEU-454](https://linear.app/neuroticsasquatch/issue/NEU-454) (merged — source-quality gate + confidence downgrade) unblocked this ticket; [NEU-456](https://linear.app/neuroticsasquatch/issue/NEU-456) (admin source-trust lever, frontend); [NEU-444](https://linear.app/neuroticsasquatch/issue/NEU-444) established the deterministic stale-stage posture in the same area.
- **Shape:** single backend PR (no migration, no config, no DTO/public-shape change, no frontend change).

## Problem (as reported)

A film ("M", releasing Oct 15 2027) had its production-status bar advance to **Trailer** off a **single low-trust story** (Mshale) claiming a trailer whose named cast ("Brendan Fraser and Rachel Weisz") is *The Mummy*'s — almost certainly fabricated. A fake trailer event shifted the film out of its correct TMDB production status.

The ticket's original framing — *"Should the status tracker rely solely on TMDB status?"* — is the decision recorded here.

## Root cause (established in code)

The film's arc stage is computed by `derive_arc_stage(status, event_types)` in `src/upmovies/public/arc.py:33`:

```python
def derive_arc_stage(status: str | None, event_types: Iterable[str]) -> str:
    best = _RANK[_STATUS_BASELINE.get(status or "", "announced")]
    for event_type in event_types:
        stage = _EVENT_STAGE.get(event_type)
        if stage is not None:
            best = max(best, _RANK[stage])
    return ARC_STAGES[best]
```

It returns the **max** of the TMDB-status baseline and any event-derived stage. So a single `trailer` event promotes the bar to `trailer`, overriding the film's real TMDB status. Two aggravating facts:

1. **Confidence is never consulted.** `Event.confidence` (`'confirmed' | 'rumored'`, `news/models.py:92`) does not enter this function. NEU-454 (merged, commit `dbdb57e`) downgrades low-trust single-source beats to `confidence="rumored"` via `downgrade_confidence()` — but because `derive_arc_stage` ignores confidence, that fix never reached this bug. The Mshale trailer is now `rumored` yet still shifts the bar.
2. **Event types lead TMDB.** `casting → cast`, `release_date → dated`, `trailer → trailer` can each push the bar ahead of what TMDB reports, on the strength of news alone.

## Chosen approach — arc stage is a pure function of TMDB status

Of the options weighed:

- **(A) Pure TMDB (chosen).** `derive_arc_stage` ignores events entirely; the bar reflects only `film.status`.
- (B) Confidence-gated events — count only `confidence="confirmed"` events. Rejected: keeps news in the status computation and leans on classifier confidence being trustworthy.
- (C) TMDB floor + capped confirmed lead — rejected as unnecessary complexity for a status bar.

(A) was chosen: production status is TMDB's job. It is the simplest correct rule, it fully severs the news→status coupling that produced this bug (and the whole class of "bad event shifts status" bugs), and it needs no per-event confidence reasoning. This matches the locked design decision "Status = TMDB only."

### The change

**`src/upmovies/public/arc.py`** — `derive_arc_stage` drops its `event_types` parameter and returns only the status baseline:

```python
def derive_arc_stage(status: str | None) -> str:
    """Return a film's current arc stage, derived solely from its TMDB status."""
    return ARC_STAGES[_RANK[_STATUS_BASELINE.get(status or "", "announced")]]
```

`ARC_STAGES`, `_RANK`, `_STATUS_BASELINE`, `_EVENT_STAGE`, and `most_significant_event_type` are **kept unchanged**. `_EVENT_STAGE` / `_RANK` are still used by `most_significant_event_type` to rank beats for the timeline/calendar (`public/service.py:610`) — that is beat ordering, a separate concern from production status, and is out of scope.

**`src/upmovies/public/service.py`** — update both call sites and delete the event-type gathering that existed only to feed them:

- Film index path: `_film_index_items` (`:142`) calls `derive_arc_stage(film.status)` (`:154`); the `_event_types_by_film` helper (`:117`) and its call (`:144`) are removed as dead code.
- Film detail path: `get_film_detail` computes `arc_stage = derive_arc_stage(film.status)` (`:286`); the `all_event_types` query (`:280`) is removed.

Net effect: one fewer DB query per index page and per film-detail request.

## Consequence (accepted)

The arc bar can now only ever be one of the four TMDB-mapped stages: `announced` (TMDB `Rumored`/`Planned`), `shooting` (`In Production`), `wrapped` (`Post Production`), `released` (`Released`). The `cast`, `dated`, and `trailer` stages become unreachable values — including for legitimate confirmed events.

This is the intended trade-off. The frontend `ArcStepper` (`components/film/ArcStepper.tsx`) renders all seven stages as a fixed lifecycle and highlights up to `current`; since `current` is now always one of the four TMDB values, it continues to render correctly with no change. The `ArcStage` type stays seven-valued.

> Out of scope / follow-up: the *visual* cleanup — dropping the three now-unreachable steps for a shorter stepper — is tracked as [NEU-458](https://linear.app/neuroticsasquatch/issue/NEU-458) (frontend), blocked by this ticket.

## Scope boundaries

**In scope:**

- `derive_arc_stage` signature + body change in `public/arc.py`.
- Both call-site updates and dead-query removal in `public/service.py`.
- Tests (below).

**Out of scope (deliberate):**

- Source-quality gating / confidence downgrade — owned by the merged NEU-454.
- Admin source-trust lever — NEU-456 (frontend).
- Beat ranking (`most_significant_event_type`) and the timeline/calendar surfaces.
- Any DB migration, config flag, DTO/public-shape change, or frontend change.

## Testing (TDD — failing test first)

Run integration tests as a directory/suite, not a single file (known pytest-asyncio quirk).

- **`tests/unit/public/test_arc.py`** — rewrite for the new single-argument signature:
  - `derive_arc_stage("Planned") == "announced"`, `"Rumored" == "announced"`, `"In Production" == "shooting"`, `"Post Production" == "wrapped"`, `"Released" == "released"`, `None == "announced"`, unknown status `== "announced"`.
  - Assert events no longer promote: the previous `derive_arc_stage("Planned", ["trailer"]) == "trailer"` expectation is removed (the new signature takes no events).
- **`tests/integration/routers/test_public_films.py`** — the `"In Production"` film with a `trailer` event (`:54`) now asserts `arc_stage == "shooting"` instead of `"trailer"`.
- **Regression fixture (the reported bug):** a film with TMDB `status="In Production"` plus a `trailer` event → `arc_stage` stays `"shooting"`. Cover both a `rumored` trailer (the Mshale case post-NEU-454) and a `confirmed` trailer, to lock in that confidence is irrelevant and events never shift status.

## Definition of done

- `derive_arc_stage` derives from `film.status` only; both `service.py` call sites updated; dead event-type queries removed.
- New/updated tests green; `task test`, `task lint`, `task typecheck` all green (`task format` applied).
- One backend PR on the `tom/neu-452-…` branch.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
