# NEU-449 — Stop Old Casting News Resurfacing as a New Event — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent re-circulated old casting/announcement news from minting a new event — via a semantic LINK guard (primary) and a deterministic CLUSTER release-date backstop.

**Architecture:** Two independent guards at the layers that already own the decision. LINK (`linker.py`, prompt only) learns to treat a soft/human-interest recirculation of an already-known beat as `not-news:downstream`. CLUSTER (`cluster.py`, deterministic) extends `is_stale_stage` to also drop early-production beats when the film's `release_date` has already passed as of the run date. See spec: `docs/superpowers/specs/NEU-449-stale-casting-recirculation.md`.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, pytest (pytest-asyncio auto mode), ruff, pyright. Everything runs in the container via `task` — **no host Python**.

## Global Constraints

- Run everything through `task` (never host `pytest`/`ruff`/`pyright`/`python`): `task test`, `task test -- tests/unit/link/test_cluster.py`, `task lint`, `task typecheck`, `task format`.
- Modern type hints (`X | None`, `X | Y`); **no** `from __future__ import annotations`. ruff line length 100.
- TDD: write the failing test first. pytest-asyncio is in `auto` mode (no `@pytest.mark.asyncio` needed). Never hit the live network in tests.
- A single integration test file run in isolation errors with an asyncio-loop warning (known quirk) — scope to a directory (`tests/integration/link/`) or run the whole suite.
- Commits/branch: work on the ticket branch `tom/neu-449-bug-old-casting-news-resurfaced-as-new-event`. Pre-commit hooks delegate into Docker — commit normally (no `--no-verify`); run `task format` before committing and keep the container up. Do **not** put a Linear ID or the Claude footer in commit subjects.
- Preserve existing rejection semantics for dropped stories exactly: `link_status="rejected"`, `film_id=None`, `link_confidence=None`, `link_note="stale-stage:{etype}"`, counted in `stories_rejected`.

---

## File Structure

- `src/upmovies/link/cluster.py` — extend `is_stale_stage` signature/logic; add `film_release_date` + `run_date` to `ClusterPlan`; populate them in `build_cluster_request`; pass them into `is_stale_stage` in `apply_cluster_decisions`.
- `src/upmovies/link/linker.py` — prompt text only (`_INSTRUCTIONS`): expand the `not-news` / `downstream` definition.
- `tests/unit/link/test_cluster.py` — update/extend `is_stale_stage` unit tests for the new signature + release-date rule.
- `tests/integration/link/test_cluster.py` — integration test: casting beat for a past-release film is rejected as `stale-stage`, mints no event.
- `tests/unit/link/test_linker.py` — unit tests: `not-news:downstream` routing + prompt-guidance assertion.
- `tests/fixtures/link/validation_set.json` — add one labeled recirculation item.

---

## Task 1: CLUSTER — deterministic release-date staleness backstop

Extend `is_stale_stage` so early-production beats are also stale when the film's `release_date` is already past the run date, and thread the two new inputs (`release_date`, `run_date`) through `ClusterPlan` → `apply_cluster_decisions`. Changing the signature breaks the single call site and the existing unit tests, so the signature change, the caller update, the `ClusterPlan` fields, and the tests all land together as one deliverable.

**Files:**
- Modify: `src/upmovies/link/cluster.py` (`is_stale_stage` ~line 50; `ClusterPlan` ~line 122; `build_cluster_request` ~line 296; `apply_cluster_decisions` ~line 354 & 394)
- Test: `tests/unit/link/test_cluster.py`, `tests/integration/link/test_cluster.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `is_stale_stage(event_type: str, film_status: str | None, release_date: date | None, as_of_date: date) -> bool`
  - `ClusterPlan` gains `film_release_date: date | None = None` and `run_date: date | None = None` (both default so existing `ClusterPlan(...)` constructions in tests keep compiling).

- [ ] **Step 1: Update the existing `is_stale_stage` unit tests to the new 4-arg signature and add the release-date cases**

In `tests/unit/link/test_cluster.py`, the current tests call `is_stale_stage(event_type, status)`. Replace the stale-stage test block with the following (keep the existing import `from upmovies.link.cluster import is_stale_stage` and add `from datetime import date`):

```python
import datetime as _dt

# A fixed run date used across the stale-stage tests.
AS_OF = _dt.date(2026, 7, 1)
PAST = _dt.date(2026, 1, 1)      # released before the run date
FUTURE = _dt.date(2026, 12, 1)   # not yet released


@pytest.mark.parametrize(
    "event_type", ["announced", "casting", "production_start", "production_wrap"]
)
@pytest.mark.parametrize("status", ["Post Production", "Released"])
def test_early_stage_on_wrapped_film_is_stale(event_type, status):
    # Existing status-based rule still fires regardless of release date.
    assert is_stale_stage(event_type, status, None, AS_OF) is True


@pytest.mark.parametrize(
    "event_type", ["announced", "casting", "production_start", "production_wrap"]
)
def test_early_stage_on_already_released_film_is_stale(event_type):
    # New rule: release_date already past the run date, even if status lags.
    assert is_stale_stage(event_type, "In Production", PAST, AS_OF) is True


@pytest.mark.parametrize(
    "event_type", ["announced", "casting", "production_start", "production_wrap"]
)
@pytest.mark.parametrize("status", ["In Production", "Planned", "Rumored", None])
def test_early_stage_on_unwrapped_upcoming_film_is_not_stale(event_type, status):
    # Future release date + non-wrapped status → not stale.
    assert is_stale_stage(event_type, status, FUTURE, AS_OF) is False
    # Unknown release date + non-wrapped status → not stale.
    assert is_stale_stage(event_type, status, None, AS_OF) is False


@pytest.mark.parametrize("event_type", ["trailer", "release_date", "first_look", "other"])
def test_non_early_stage_types_are_never_stale(event_type):
    assert is_stale_stage(event_type, "Released", PAST, AS_OF) is False
    assert is_stale_stage(event_type, "In Production", FUTURE, AS_OF) is False
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `task test -- tests/unit/link/test_cluster.py`
Expected: FAIL — `TypeError: is_stale_stage() takes 2 positional arguments but 4 were given` (signature not yet updated).

- [ ] **Step 3: Update `is_stale_stage` to the new signature and add the release-date rule**

In `src/upmovies/link/cluster.py`, replace the function:

```python
def is_stale_stage(
    event_type: str,
    film_status: str | None,
    release_date: date | None,
    as_of_date: date,
) -> bool:
    """A new event is 'stale-stage' when an early-or-mid production beat (casting/announced/
    production_start/production_wrap) is reported for a film that has already wrapped, released,
    or whose release date has already passed as of the run date. A film in Post Production has
    by definition already wrapped, so a fresh production_wrap event for it is stale (NEU-444,
    extending NEU-367). A film whose release_date is in the past is already out even if TMDB's
    status string lags, so early-production beats for it are re-circulated old news (NEU-449).
    Such events are dropped at clustering. NULL/unknown status with no past release date is
    never stale."""
    if event_type not in _STALE_EVENT_TYPES:
        return False
    if film_status in _WRAPPED_STATUSES:
        return True
    return release_date is not None and release_date < as_of_date
```

- [ ] **Step 4: Add the new `ClusterPlan` fields**

In `src/upmovies/link/cluster.py`, extend the dataclass (keep `film_status` as-is):

```python
@dataclass
class ClusterPlan:
    film_id: UUID
    existing_event_ids: list[UUID]
    unclustered_story_ids: list[UUID]
    film_status: str | None = None
    film_release_date: date | None = None
    run_date: date | None = None
```

- [ ] **Step 5: Populate the new fields in `build_cluster_request`**

In `build_cluster_request`, where the `ClusterPlan(...)` is constructed (~line 296), add the two fields (the function already receives `run_date` and already has `film`):

```python
    plan = ClusterPlan(
        film_id=film_id,
        existing_event_ids=[e.id for e in existing_events],
        unclustered_story_ids=[s.id for s in unclustered],
        film_status=film.status,
        film_release_date=film.release_date,
        run_date=run_date,
    )
```

- [ ] **Step 6: Pass the new args into `is_stale_stage` in `apply_cluster_decisions`**

In `apply_cluster_decisions`, `now = datetime.now(UTC)` already exists (~line 354). Derive the as-of date just after it:

```python
    now = datetime.now(UTC)
    as_of_date = plan.run_date or now.date()
```

Then update the call site (~line 394) from `if is_stale_stage(etype, plan.film_status):` to:

```python
            if is_stale_stage(etype, plan.film_status, plan.film_release_date, as_of_date):
```

- [ ] **Step 7: Run the unit tests to verify they pass**

Run: `task test -- tests/unit/link/test_cluster.py`
Expected: PASS (all stale-stage cases, including the new release-date rule).

- [ ] **Step 8: Write the failing integration test for the release-date backstop**

In `tests/integration/link/test_cluster.py`, mirror the existing `test_apply_rejects_stale_stage_new_event` (which uses `status="Post Production"`). Add a test that instead uses a **non-wrapped** status with a **past release date**, so only the new rule can reject it. Use the file's existing helpers/imports (`Film`, `Story`, `ClusterPlan`, `apply_cluster_decisions`, `select`, `Event`) and the same `raw` JSON shape as the existing stale test:

```python
async def test_apply_rejects_casting_for_already_released_film(session):
    import datetime as _dt

    film = Film(tmdb_id=4242, title="Angry Birds Movie 3", status="In Production",
                release_date=_dt.date(2026, 1, 1))
    session.add(film)
    await session.flush()
    s1 = Story(url="https://example.com/psalm", title="Psalm's acting debut",
               film_id=film.id, link_status="linked")
    session.add(s1)
    await session.flush()

    plan = ClusterPlan(
        film_id=film.id,
        existing_event_ids=[],
        unclustered_story_ids=[s1.id],
        film_status="In Production",
        film_release_date=_dt.date(2026, 1, 1),
        run_date=_dt.date(2026, 7, 1),
    )
    raw = '{"events": [{"existing": null, "type": "casting", "confidence": "confirmed", "stories": [1]}]}'
    result = await apply_cluster_decisions(session, plan=plan, raw=raw)

    assert result.events_created == 0
    assert result.stories_rejected == 1
    no_events = (await session.execute(select(Event).where(Event.film_id == film.id))).scalars().all()
    assert no_events == []
    refreshed = await session.get(Story, s1.id, populate_existing=True)
    assert refreshed.link_status == "rejected"
    assert refreshed.link_note == "stale-stage:casting"
```

> Match the exact `Story(...)` / `Film(...)` constructor kwargs and any helper functions the neighboring tests in this file use; adjust field names only if the existing tests differ. If `session.get(..., populate_existing=True)` isn't the file's idiom, re-read the row with `execution_options={"populate_existing": True}` as the other tests do.

- [ ] **Step 9: Run the integration test**

Run: `task test -- tests/integration/link/test_cluster.py`
Expected: PASS. (If run in isolation it may emit the known asyncio-loop warning — that's the documented quirk, not a failure.)

- [ ] **Step 10: Run lint, typecheck, and the scoped suite green**

Run: `task format && task lint && task typecheck && task test -- tests/unit/link tests/integration/link`
Expected: all green.

---

## Task 2: LINK — semantic recirculation guard + validation fixture

Teach the LINK classifier that a soft/human-interest recirculation of an already-known beat is `not-news:downstream`, lock the routing with a unit test, assert the prompt contains the new guidance, and add a labeled golden-eval fixture. This is prompt text + tests only — no LINK code-path change (the `downstream` category and its routing already exist).

**Files:**
- Modify: `src/upmovies/link/linker.py` (`_INSTRUCTIONS`, the `not-news` definition ~line 33-49)
- Test: `tests/unit/link/test_linker.py`
- Modify: `tests/fixtures/link/validation_set.json`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no new symbols; `_INSTRUCTIONS` text is the only source change.

- [ ] **Step 1: Write the failing unit tests (routing + prompt guidance)**

In `tests/unit/link/test_linker.py`, mirror `test_not_news_with_category_is_rejected` and `test_instructions_warn_against_interview_enthusiasm_headlines`. Add:

```python
async def test_not_news_downstream_recirculation_is_rejected():
    story = _story(title="Kim Kardashian's son Psalm makes acting debut in Angry Birds Movie 3")
    raw = (
        '[{"id": "' + str(story.id) + '", "film": 1, "confidence": 0.0, '
        '"reason": "not-news", "category": "downstream"}]'
    )
    result = apply_link_decisions(raw=raw, stories=[story], roster=_roster(story.film_id), floor=0.7)
    assert result.linked == 0
    assert story.link_status == "rejected"
    assert story.link_note == "not-news:downstream"


def test_instructions_flag_recirculated_old_news():
    from upmovies.link.linker import _INSTRUCTIONS

    text = _INSTRUCTIONS.lower()
    assert "recirculat" in text or "re-report" in text or "already-known" in text
    assert "publication date does not make it new" in text or "fresh publication date" in text
```

> Use the same `_story(...)` / `_roster(...)` helper signatures the existing tests in this file use. If `_roster` needs a `film_id`, generate one with `uuid4()` as the neighboring tests do; `_story` may already assign an id — match the existing pattern rather than the sketch above.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/link/test_linker.py`
Expected: FAIL — `test_instructions_flag_recirculated_old_news` fails (guidance not present yet). `test_not_news_downstream_recirculation_is_rejected` may already pass (routing exists); that's fine — it locks the behavior.

- [ ] **Step 3: Add the recirculation guidance to the LINK prompt**

In `src/upmovies/link/linker.py`, the `not-news` definition currently ends with "…and any story whose news value is entirely downstream of an earlier beat." Extend that `downstream` guidance. Append this sentence to the `not-news` definition block (keep the existing line-continuation `\` style and 100-char wrapping; run `task format` after):

```
A story that re-reports an already-known casting, role, or other prior beat through a \
milestone, "debut", celebrity-family, or human-interest angle — adding no NEW trade-confirmed \
development — is also not-news (category "downstream"): a fresh publication date does not make \
it new. Use `as_of_date` to reason about whether a beat is genuinely recent or re-circulated \
old news.
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `task test -- tests/unit/link/test_linker.py`
Expected: PASS. If `test_instructions_flag_recirculated_old_news` still fails, adjust the substring assertions in Step 1 to match the exact wording you used in Step 3 (keep them lowercase-compared).

- [ ] **Step 5: Resolve the Angry Birds Movie 3 TMDB id for the fixture**

The golden-eval fixture keys films by stable TMDB id. Find it in the catalog:

Run: `task shell` then in the container:
`psql "$DATABASE_URL" -c "SELECT tmdb_id, title, release_date, status FROM catalog.film WHERE title ILIKE '%angry birds%';"`

Record the `tmdb_id`. If the film is not tracked locally, pick any tracked film that plausibly received a recirculated human-interest casting piece, or look the id up on TMDB; note in the PR which film/id you used and why.

- [ ] **Step 6: Add the labeled recirculation item to the validation set**

Append one object to the array in `tests/fixtures/link/validation_set.json` (schema = `ValidationItem` in `src/upmovies/link/validation.py`; `exclusion_category` requires `is_production_news=False`). Replace `<TMDB_ID>` with the id from Step 5:

```json
{
  "url": "https://www.hola.com/us/entertainment/20260630910275/kim-kardashian-son-psalm-debut-actor-angry-birds-movie-3/",
  "source": "HOLA! USA",
  "title": "Kim Kardashian's son Psalm debut as an actor in upcoming 'Angry Birds Movie 3'",
  "summary": "A proud parenting milestone: Psalm West is making his acting debut, with Kim Kardashian celebrating the family moment. No new casting deal is announced — the role has been known for some time.",
  "relation": "about",
  "expected_film_tmdb_id": <TMDB_ID>,
  "event_type": "casting",
  "is_production_news": false,
  "exclusion_category": "downstream"
}
```

- [ ] **Step 7: Verify the fixture parses**

Run: `task test -- tests/unit/link/test_validation.py`
Expected: PASS — confirms the new item satisfies the `ValidationItem` model validators (`exclusion_category` requires `is_production_news=false`; a non-`about` item may not set these). If it fails on `expected_film_tmdb_id`, re-check Step 5.

- [ ] **Step 8: Run the linking validation harness against the real model (manual, costs tokens)**

This is a manual verification step (not part of `task test`; it needs a real API key in `.env`).

Run: `task shell` then `python scripts/validate_linking.py`
Expected: the new item is classified `not-news` / excluded (not linked as production news), and overall precision/recall/F1 do not regress versus the pre-change run. Record the before/after numbers in the PR description. If the model still links it, iterate on the Step 3 wording and re-run.

- [ ] **Step 9: Lint, typecheck, scoped suite green**

Run: `task format && task lint && task typecheck && task test -- tests/unit/link`
Expected: all green.

---

## Task 3: Full-suite verification, commit, and PR

**Files:** none (verification + git).

- [ ] **Step 1: Run the full CI-equivalent suite locally**

Run: `task format && task lint && task typecheck && task test`
Expected: all green. Fix anything red before proceeding (do not claim done on red).

- [ ] **Step 2: Confirm the branch**

Run: `git -C upcoming-movies-backend status && git -C upcoming-movies-backend branch --show-current`
Expected: on `tom/neu-449-bug-old-casting-news-resurfaced-as-new-event` (create it from `main` if not: `git checkout -b tom/neu-449-bug-old-casting-news-resurfaced-as-new-event`).

- [ ] **Step 3: Commit**

Stage and commit the backend changes (use `/commit-msg` to generate the message; Conventional Commits subject, no Linear ID, no Claude footer):

```bash
git add src/upmovies/link/cluster.py src/upmovies/link/linker.py \
        tests/unit/link/test_cluster.py tests/integration/link/test_cluster.py \
        tests/unit/link/test_linker.py tests/fixtures/link/validation_set.json
git commit   # message from /commit-msg, e.g. "fix: drop re-circulated old casting news at link and cluster stages"
```

- [ ] **Step 4: Push and open the PR**

Push the branch and open a PR against `main` (title carries the Linear ID parenthetical; body gets the Claude footer). Use `/pr-desc` for the body. Include the `validate_linking.py` before/after metrics from Task 2 Step 8.

Run: `git push -u origin tom/neu-449-bug-old-casting-news-resurfaced-as-new-event`
Then: `gh pr create --title "fix: stop old casting news resurfacing as a new event (NEU-449)" --body "<from /pr-desc>"`

---

## Self-Review

- **Spec coverage:** LINK semantic guard → Task 2 (Steps 3, 6, 8). CLUSTER deterministic backstop → Task 1 (Steps 3–6). Threading (`ClusterPlan` + `run_date`/`release_date`) → Task 1 (Steps 4–6). CLUSTER unit + integration tests → Task 1 (Steps 1, 8). LINK golden-eval fixture + harness run → Task 2 (Steps 6, 8). Rejection semantics preserved → Task 1 Step 8 assertions. Full suite green → Task 3 Step 1. All spec sections covered.
- **Out-of-scope items** (same-type dedup, article-body date extraction, `recency_days` changes) are correctly absent from all tasks.
- **Type consistency:** `is_stale_stage(event_type, film_status, release_date, as_of_date)` is defined in Task 1 Step 3 and called with exactly those args in Step 6; `ClusterPlan.film_release_date` / `.run_date` defined in Step 4 and populated in Steps 5–6. `link_note="not-news:downstream"` and `"stale-stage:casting"` match the code paths in `apply_link_decisions` / `apply_cluster_decisions`.
- **No placeholders:** the only intentional lookup is `<TMDB_ID>` (Task 2 Step 5 resolves it via a concrete query), not a vague TODO.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
