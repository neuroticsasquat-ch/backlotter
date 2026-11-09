# NEU-452 — Production status derives solely from TMDB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a film's arc stage (production-status bar) a pure function of its TMDB `status`, so news events — including fabricated or low-trust ones — can never shift it.

**Architecture:** `derive_arc_stage` in `public/arc.py` currently returns `max(TMDB-status baseline, event-derived stage)`. Drop the event input entirely so it returns only the status baseline. Update the two `public/service.py` call sites and delete the event-type queries that existed only to feed them. Beat-ranking (`most_significant_event_type`) and the timeline/calendar are untouched.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 (async), pytest (pytest-asyncio `auto` mode). Everything runs in Docker via `task` — never invoke `pytest`/`ruff`/`pyright` on the host.

## Global Constraints

- **Run all tooling in the container via `task`.** `task test` (scope with `task test -- <path>`), `task lint`, `task typecheck`, `task format`. Keep the container up (`task up`).
- **Integration tests must be run as a directory/suite, not a single file** — running one integration file in isolation raises a pytest-asyncio session-loop error (known quirk). Unit-test files may be run individually.
- **No** DB migration, config flag, DTO/public-shape change, or frontend change. The `ArcStage` DTO type stays seven-valued.
- **Commits:** Conventional Commits subject (`fix:` / `refactor:`), **no** Linear ID in the subject (optional `Refs NEU-452.` in the body), **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. Run `task format` before committing (pre-commit hooks delegate into Docker; commit normally, no `--no-verify`).
- **Branch:** work on the ticket branch `tom/neu-452-bug-fake-trailer-from-low-quality-source-wrongly-categorized`. One PR for the whole fix.
- **Note on execution:** per the user's workflow, when running subagent-driven-development the commit step is stripped from implementer prompts and the user commits once at the end. The commit step below is retained for plan completeness.

---

### Task 1: arc_stage derives solely from TMDB status

**Files:**
- Modify: `src/upmovies/public/arc.py:33-40` (`derive_arc_stage`)
- Modify: `src/upmovies/public/service.py:117-128` (delete `_event_types_by_film`), `:142-157` (`_film_index_items`), `:270` (its caller), `:280-286` (detail path)
- Test (replace): `tests/unit/public/test_arc.py`
- Test (modify): `tests/integration/routers/test_public_films.py:54`
- Test (add): `tests/integration/routers/test_public_films.py` (new regression test)

**Interfaces:**
- Produces: `derive_arc_stage(status: str | None) -> str` — single argument; returns one of `"announced" | "shooting" | "wrapped" | "released"` derived only from `_STATUS_BASELINE`. (Previously `derive_arc_stage(status, event_types)`.)
- Unchanged: `most_significant_event_type(event_types: Iterable[str]) -> str`, `ARC_STAGES`, `_RANK`, `_STATUS_BASELINE`, `_EVENT_STAGE`.

- [ ] **Step 1: Rewrite the arc unit test for the new single-argument signature**

Replace the entire contents of `tests/unit/public/test_arc.py` with:

```python
from upmovies.public.arc import derive_arc_stage, most_significant_event_type


def test_status_baselines():
    assert derive_arc_stage("Rumored") == "announced"
    assert derive_arc_stage("Planned") == "announced"
    assert derive_arc_stage("In Production") == "shooting"
    assert derive_arc_stage("Post Production") == "wrapped"
    assert derive_arc_stage("Released") == "released"


def test_unknown_or_none_status_floors_to_announced():
    assert derive_arc_stage(None) == "announced"
    assert derive_arc_stage("Whatever") == "announced"


def test_most_significant_picks_highest_ranked_type():
    assert most_significant_event_type(["announced", "casting", "trailer"]) == "trailer"
    assert most_significant_event_type(["casting", "release_date"]) == "release_date"
    assert most_significant_event_type(["production_start", "production_wrap"]) == "production_wrap"


def test_most_significant_is_order_independent():
    assert most_significant_event_type(["trailer", "announced"]) == "trailer"
    assert most_significant_event_type(["announced", "trailer"]) == "trailer"


def test_most_significant_single_type():
    assert most_significant_event_type(["casting"]) == "casting"


def test_most_significant_other_ranks_below_announced():
    assert most_significant_event_type(["announced", "other"]) == "announced"


def test_most_significant_other_only():
    assert most_significant_event_type(["other"]) == "other"
    assert most_significant_event_type(["other", "other"]) == "other"


def test_most_significant_first_look_ranks_below_arc_types():
    # first_look ranks like other (-1): loses to any arc-stage type, wins when alone.
    assert most_significant_event_type(["casting", "first_look"]) == "casting"
    assert most_significant_event_type(["first_look"]) == "first_look"
```

(This drops the four event-advancing arc tests — `test_event_types_advance_stage`, `test_max_combine_takes_the_furthest_stage`, `test_other_event_type_contributes_nothing`, `test_first_look_contributes_nothing_to_arc` — because arc stage no longer takes events. All `most_significant_event_type` tests are preserved unchanged.)

- [ ] **Step 2: Update the existing integration assertion (In Production + trailer → shooting)**

In `tests/integration/routers/test_public_films.py`, change line 54 from:

```python
    assert body["arc_stage"] == "trailer"  # In Production baseline, trailer event wins
```

to:

```python
    assert body["arc_stage"] == "shooting"  # arc_stage tracks TMDB status only (NEU-452)
```

- [ ] **Step 3: Add the regression test (the Mshale case)**

Append this test to `tests/integration/routers/test_public_films.py`:

```python
async def test_arc_stage_ignores_events_and_tracks_tmdb_status(client, make_film, add_event):
    """NEU-452: a fabricated/low-trust trailer must not shift production status.

    A film TMDB-reported as "In Production" stays at arc_stage "shooting" regardless of
    trailer events — whether rumored (the Mshale case after NEU-454's source downgrade)
    or confirmed. Production status derives solely from TMDB `status`.
    """
    film = await make_film(slug="mshale-2027", title="M", status="In Production")
    await add_event(
        film=film, event_type="trailer", confidence="rumored", summary="Trailer (rumored)."
    )
    await add_event(
        film=film, event_type="trailer", confidence="confirmed", summary="Trailer (confirmed)."
    )

    r = await client.get("/films/mshale-2027")
    assert r.status_code == 200
    assert r.json()["arc_stage"] == "shooting"
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `task test -- tests/unit/public/test_arc.py`
Expected: FAIL — `test_status_baselines` / `test_unknown_or_none_status_floors_to_announced` raise `TypeError: derive_arc_stage() missing 1 required positional argument: 'event_types'` (the impl still requires two args).

Run: `task test -- tests/integration/routers/`
Expected: FAIL — `test_detail_returns_chronological_summarized_events_with_sources` now expects `"shooting"` but the impl still returns `"trailer"`; `test_arc_stage_ignores_events_and_tracks_tmdb_status` likewise fails (impl returns `"trailer"`).

- [ ] **Step 5: Make `derive_arc_stage` pure-TMDB**

In `src/upmovies/public/arc.py`, replace the `derive_arc_stage` function (lines 33-40) with:

```python
def derive_arc_stage(status: str | None) -> str:
    """Return a film's current arc stage, derived solely from its TMDB status.

    News events never influence production status (NEU-452): a low-trust or fabricated
    beat must not shift a film's stage. Only `film.status` (from TMDB) maps to a stage.
    """
    return ARC_STAGES[_RANK[_STATUS_BASELINE.get(status or "", "announced")]]
```

Leave `ARC_STAGES`, `_RANK`, `_STATUS_BASELINE`, `_EVENT_STAGE`, `most_significant_event_type`, and the `from collections.abc import Iterable` import as-is (`_EVENT_STAGE`/`_RANK`/`Iterable` are still used by `most_significant_event_type`).

- [ ] **Step 6: Update both `service.py` call sites and remove the now-dead event-type queries**

In `src/upmovies/public/service.py`:

**(a)** Delete the `_event_types_by_film` helper entirely (lines 117-128):

```python
async def _event_types_by_film(
    session: AsyncSession, film_ids: list[UUID]
) -> dict[UUID, list[str]]:
    if not film_ids:
        return {}
    rows = await session.execute(
        select(Event.film_id, Event.event_type).where(Event.film_id.in_(film_ids)).distinct()
    )
    result: dict[UUID, list[str]] = {}
    for film_id, event_type in rows:
        result.setdefault(film_id, []).append(event_type)
    return result
```

**(b)** Replace `_film_index_items` (lines 142-157) with a synchronous, event-free version:

```python
def _film_index_items(films: list[Film]) -> list[FilmIndexItem]:
    """Build FilmIndexItem list for a page of Film rows."""
    items: list[FilmIndexItem] = []
    for film in films:
        assert film.slug is not None
        items.append(
            FilmIndexItem(
                slug=film.slug,
                title=film.title,
                release_year=_release_year(film.release_date),
                poster_path=film.poster_path,
                arc_stage=derive_arc_stage(film.status),
            )
        )
    return items
```

**(c)** Update its caller (line 270) — drop `await` and the `session` argument:

```python
    items = _film_index_items(list(films))
```

**(d)** In `get_film_detail`, remove the `all_event_types` query (lines 280-285) and make the arc call single-argument. The block:

```python
    all_event_types = [
        event_type
        for (event_type,) in await session.execute(
            select(Event.event_type).where(Event.film_id == film.id).distinct()
        )
    ]
    arc_stage = derive_arc_stage(film.status, all_event_types)
```

becomes:

```python
    arc_stage = derive_arc_stage(film.status)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `task test -- tests/unit/public/test_arc.py`
Expected: PASS.

Run: `task test -- tests/integration/routers/`
Expected: PASS (including `test_arc_stage_ignores_events_and_tracks_tmdb_status` and the updated detail test).

- [ ] **Step 8: Run the full CI gate**

Run: `task format` then `task test` then `task lint` then `task typecheck`
Expected: all green. (No unused imports: `UUID`, `select`, `Event` remain used elsewhere in `service.py`.)

- [ ] **Step 9: Commit**

```bash
git add src/upmovies/public/arc.py src/upmovies/public/service.py tests/unit/public/test_arc.py tests/integration/routers/test_public_films.py
git commit -m "fix: derive film arc stage from TMDB status only

News events no longer influence production status, so a fabricated or
low-trust trailer beat can't shift a film's stage. Drops the event input
to derive_arc_stage and removes the now-dead event-type queries.

Refs NEU-452."
```

---

## Self-Review

**Spec coverage:**
- "arc_stage becomes a pure function of `film.status`" → Step 5. ✓
- "update both call sites; delete `_event_types_by_film` and `all_event_types`" → Step 6. ✓
- "keep `most_significant_event_type` / `_EVENT_STAGE` / `_RANK`" → Step 5 note; unit tests preserved in Step 1. ✓
- Unit tests for new signature (all baseline values + None/unknown) → Step 1. ✓
- Existing integration assertion flips to `"shooting"` → Step 2. ✓
- Regression fixture (In Production + rumored **and** confirmed trailer → shooting) → Step 3. ✓
- No migration/config/DTO/frontend change → Global Constraints; none of the steps touch those. ✓
- Frontend NEU-458 is a separate ticket → out of scope here. ✓

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to" — every code block is complete. ✓

**Type consistency:** `derive_arc_stage(status: str | None) -> str` used consistently in Steps 5, 6(b), 6(d). `_film_index_items(films)` (sync) matches its caller in 6(c). ✓
