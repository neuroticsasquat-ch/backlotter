# NEU-451 — Already-Scheduled Release-Date Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop weekly-release-calendar listicles minting spurious `release_date` events for films whose release date is already known.

**Architecture:** Two prompt-level guards, each at the layer that owns the decision (mirrors NEU-449). LINK strengthens its `roundup` not-news category so calendar listicles never link (primary; kills the exact repro). CLUSTER gains the film's known release date in its payload plus a wording line so a story restating an already-known date is dropped via the existing `off_topic` chute (defense-in-depth). Both leverage the `as_of_date` anchor already threaded by NEU-457.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async), Pydantic v2, pytest, ruff, pyright — all run in the `upmovies-backend` container via `task`.

## Global Constraints

- **Container-only.** Never run `pytest`/`ruff`/`pyright`/`python` on the host. Use `task test` (scope with `task test -- tests/unit/...`), `task lint`, `task format`, `task typecheck`. Keep the container up (`task up`).
- **Single PR, one branch.** All tasks land on `tom/neu-451-bug-film-already-scheduled-for-release-in-two-days`; open **one** backend PR at the end. No migration, no DTO/public-shape change, no frontend change.
- **TDD.** Write the failing test first; pytest-asyncio is in `auto` mode (no marker needed). Run integration tests as a directory/suite, never a single file (known session-loop quirk).
- **Type hints:** modern `X | None` / `X | Y`; **no** `from __future__ import annotations`. ruff line length 100.
- **Commits (backend convention):** Conventional Commits subject (`fix:`, `feat:`, `refactor:`, …); **no** Linear ID in the subject (optional `Refs NEU-451.` in body); **no** `🤖 Generated with Claude Code` footer; **no** `Co-Authored-By`. Pre-commit hooks delegate into Docker — commit normally (no `--no-verify`); run `task format` before committing. PR **title** gets the trailing `(NEU-451)`; the footer belongs in the PR **body** only.
- Do **not** touch Linear ticket status — the GitHub↔Linear connector moves it.

---

### Task 1: LINK — flag periodic release-calendar listicles as `roundup`

Strengthen the `roundup` not-news definition in the LINK classifier prompt so a "This Week's/Upcoming releases" multi-film listicle is not-news even when it states a release date. `roundup` is already in `_NOT_NEWS_CATEGORIES` and already routes to `link_status="rejected"`, so **no code-path change** is needed — this is prompt text plus a guard test.

**Files:**
- Modify: `src/upmovies/link/linker.py` (the `_INSTRUCTIONS` constant, ~lines 22-92)
- Test: `tests/unit/link/test_linker.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (behavioral prompt change only).

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/link/test_linker.py`:

```python
def test_instructions_flag_release_calendar_listicles():
    """NEU-451: weekly/monthly release-calendar listicles (a multi-film list where the
    tracked film is one entry among many) are not-news:roundup even when they state a
    release date — a calendar restating a scheduled date is not an announcement."""
    from upmovies.link.linker import _INSTRUCTIONS

    text = _INSTRUCTIONS.lower()
    assert "listicle" in text
    assert "one entry among many" in text
    assert "release-date announcement" in text
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/link/test_linker.py::test_instructions_flag_release_calendar_listicles`
Expected: FAIL (assertion error — substrings absent).

- [ ] **Step 3: Add the wording to `_INSTRUCTIONS`**

In `src/upmovies/link/linker.py`, inside the `not-news` bullet, immediately after the existing recirculation sentence that ends `...whether a beat is genuinely recent or re-circulated old news.`, append (mind the trailing `\` line-continuations used throughout this constant):

```python
A periodic release-calendar listicle — a "This Week's" / "This Month's" (OTT &) movie \
releases post, an "Upcoming <month> releases" roundup, or any multi-film list where a \
tracked film appears as one entry among many — is not-news (category "roundup") EVEN WHEN \
it states a release date: a calendar listicle restating a film's already-scheduled date is \
not a release-date announcement. Use `as_of_date` — a date the film already holds, at or \
near today, is not a new development.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/link/test_linker.py::test_instructions_flag_release_calendar_listicles`
Expected: PASS.

- [ ] **Step 5: Guard against regressions in the file's other prompt tests**

Run: `task test -- tests/unit/link/test_linker.py`
Expected: PASS (all existing linker tests still green — the cached-system-block and recirculation assertions are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/link/linker.py tests/unit/link/test_linker.py
git commit -m "fix: flag release-calendar listicles as roundup not-news

Refs NEU-451."
```

---

### Task 2: CLUSTER — thread known release date into payload + restatement guard

Give the CLUSTER prompt the film's exact known release date (today it only gets the year via `film_year`) and add a wording line so a story merely restating that date is dropped via the existing `off_topic` chute. `apply_cluster_decisions` already handles `off_topic` groups (→ `link_status="rejected"`, `link_note="off-topic"`, no event) — **no code-path change** there.

**Files:**
- Modify: `src/upmovies/link/cluster.py` — `assemble_cluster_payload` (~line 200), `build_cluster_request` (~line 303), `_INSTRUCTIONS` (~line 75)
- Modify (call sites): `scripts/validate_clustering.py:83`, `scripts/validate_clustering_overmerge.py:72`
- Test: `tests/unit/link/test_cluster_pure.py`

**Interfaces:**
- Consumes: `Film.release_date` (already loaded in `build_cluster_request`; already stored on `ClusterPlan.film_release_date`).
- Produces: `assemble_cluster_payload(*, film_title: str, film_year: int | None, film_release_date: date | None, existing_payload, new_payload, run_date: date)` — new **required** keyword-only param `film_release_date`. The user payload's `"film"` object becomes `{"title", "year", "release_date": <ISO YYYY-MM-DD or null>}`.

- [ ] **Step 1: Update the existing payload-shape test and add two new tests (all failing)**

In `tests/unit/link/test_cluster_pure.py`, update `test_assemble_cluster_payload_shape` to pass `film_release_date` and expect the new `film` object:

```python
def test_assemble_cluster_payload_shape():
    system, messages = assemble_cluster_payload(
        film_title="The Odyssey",
        film_year=2026,
        film_release_date=date(2026, 7, 17),
        existing_payload=[],
        new_payload=[{"n": 1, "title": "T", "summary": "S"}],
        run_date=date(2026, 6, 25),
    )
    assert system == [{"type": "text", "text": _INSTRUCTIONS}]
    assert len(messages) == 1 and messages[0]["role"] == "user"
    user = json.loads(messages[0]["content"])
    assert user["as_of_date"] == "2026-06-25"
    assert user["film"] == {"title": "The Odyssey", "year": 2026, "release_date": "2026-07-17"}
    assert user["existing_events"] == []
    assert user["new_stories"] == [{"n": 1, "title": "T", "summary": "S"}]
```

Add below it:

```python
def test_assemble_cluster_payload_release_date_null_when_absent():
    _, messages = assemble_cluster_payload(
        film_title="Untitled",
        film_year=None,
        film_release_date=None,
        existing_payload=[],
        new_payload=[],
        run_date=date(2026, 6, 25),
    )
    user = json.loads(messages[0]["content"])
    assert user["film"] == {"title": "Untitled", "year": None, "release_date": None}


def test_instructions_flag_already_scheduled_restatement():
    """NEU-451: a release_date event requires a NEW/CHANGED date; a story restating the
    film's already-known release_date is dropped as off_topic, not recorded."""
    text = _INSTRUCTIONS.lower()
    assert "new or changed" in text
    assert "restat" in text  # matches "restate"/"restating"/"restatement"
    assert "off_topic" in text
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: FAIL — `test_assemble_cluster_payload_shape` (missing required kwarg / wrong `film` shape) and the two new tests fail.

- [ ] **Step 3: Add `film_release_date` to `assemble_cluster_payload`**

In `src/upmovies/link/cluster.py`, change the signature and the `user["film"]` construction:

```python
def assemble_cluster_payload(
    *,
    film_title: str,
    film_year: int | None,
    film_release_date: date | None,
    existing_payload: list[dict[str, Any]],
    new_payload: list[dict[str, Any]],
    run_date: date,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Pure prompt assembly shared by build_cluster_request (production) and the
    validate_clustering harness. No DB, no LLM. NEU-377: plain system block (cluster
    instructions are below Sonnet's 2048-token cache floor, so no cache_control)."""
    user: dict[str, Any] = {
        "as_of_date": run_date.isoformat(),
        "film": {
            "title": film_title,
            "year": film_year,
            "release_date": film_release_date.isoformat() if film_release_date else None,
        },
        "existing_events": existing_payload,
        "new_stories": new_payload,
    }
    system = [{"type": "text", "text": _INSTRUCTIONS}]
    messages = [{"role": "user", "content": json.dumps(user)}]
    return system, messages
```

- [ ] **Step 4: Pass `film.release_date` at the production call site**

In `build_cluster_request` (`src/upmovies/link/cluster.py`, ~line 303), add the new kwarg to the `assemble_cluster_payload(...)` call:

```python
    system, messages = assemble_cluster_payload(
        film_title=film.title,
        film_year=film.release_date.year if film.release_date else None,
        film_release_date=film.release_date,
        existing_payload=existing_payload,
        new_payload=new_payload,
        run_date=run_date,
    )
```

- [ ] **Step 5: Add the restatement wording to `_INSTRUCTIONS`**

In `src/upmovies/link/cluster.py`, immediately after the existing `as_of_date` sentence (`...whether an event is recent, upcoming, or already past.`), append (mind the `\` line-continuations):

```python
A "release_date" event requires a story announcing a NEW or CHANGED release date. A story \
that merely restates the film's already-known release date (given as `film.release_date` in \
the payload), or lists it in a calendar / roundup context, is NOT a new release_date beat — \
put it in its own group with "type": "off_topic" and "confidence": null so it is dropped \
rather than recorded.
```

- [ ] **Step 6: Update the two validation-harness call sites**

In `scripts/validate_clustering.py` (~line 83) and `scripts/validate_clustering_overmerge.py` (~line 72), add `film_release_date=film.release_date,` to each `assemble_cluster_payload(...)` call (both already have `film` in scope and pass `film_year=film.release_date.year if film.release_date else None`).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: PASS (all three updated/new tests green).

- [ ] **Step 8: Commit**

```bash
git add src/upmovies/link/cluster.py scripts/validate_clustering.py scripts/validate_clustering_overmerge.py tests/unit/link/test_cluster_pure.py
git commit -m "fix: give cluster prompt the known release date and guard restatements

Refs NEU-451."
```

---

### Task 3: LINK golden-eval — add the Alpha listicles and confirm no metric regression

Add the three real *Alpha* listicles from the ticket as labeled `roundup` items and verify against the **real model** that they are now excluded and precision/recall/F1 do not regress. This is the behavioral proof for the LINK guard.

**Files:**
- Modify: `tests/fixtures/link/validation_set.json`

**Interfaces:** none (data + eval only).

- [ ] **Step 1: Look up Alpha's TMDB id**

*Alpha* (Alia Bhatt / Sharvari, 2026, YRF Spy Universe) is already in the catalog (it carries a release date). Get its `tmdb_id` from the DB:

```bash
task shell
python -c "import asyncio; from sqlalchemy import select; from upmovies.db import SessionLocal; from upmovies.catalog.models import Film
async def m():
    async with SessionLocal() as s:
        for f in (await s.execute(select(Film).where(Film.title.ilike('%alpha%')))).scalars():
            print(f.tmdb_id, f.title, f.release_date)
asyncio.run(m())"
```

Record the correct `tmdb_id` (disambiguate to the Alia Bhatt 2026 film if multiple match). Call it `<ALPHA_TMDB_ID>` below.

- [ ] **Step 2: Append the three labeled listicles to the fixture**

Add these objects to the JSON array in `tests/fixtures/link/validation_set.json` (substitute `<ALPHA_TMDB_ID>`; each is `relation="about"`, `is_production_news=false`, `exclusion_category="roundup"`):

```json
{
  "url": "https://www.esquireindia.co.in/entertainment/at-the-movies/alpha-movie-release-date-budget-cast-runtime-advance-booking-collection-alia-bhatt-hrithik-roshan-shah-rukh-khan",
  "source": "Esquire India",
  "title": "Alpha Movie: Release Date, Budget, Cast, Runtime, Advance Booking Collection And More",
  "summary": "The seventh film in the YRF Spy Universe series, Alpha is all set to release in theatres this Friday. Directed by debutant Shiv Rawail, the film stars Alia Bhatt and Sharvari.",
  "relation": "about",
  "expected_film_tmdb_id": <ALPHA_TMDB_ID>,
  "event_type": "release_date",
  "event_group": null,
  "is_production_news": false,
  "exclusion_category": "roundup"
},
{
  "url": "https://www.filmibeat.com/top-listing/this-weeks-ott-and-movie-releases-in-india-july-3-2026-alpha-dhamaal-4-nagabandham-rao-bahadur-super-subbu-and-more-7-8542.html",
  "source": "Filmibeat",
  "title": "This Week's OTT & Movie Releases in India (July 2-3, 2026): Alpha, Nagabandham, Super Subbu & More",
  "summary": "Explore the complete list of this week's OTT and theatrical releases in India (July 2-3, 2026), including Alpha, Dhamaal 4, Nagabandham, Rao Bahadur, Super Subbu, Isakapatnam, Mollywood Times, Hangman, and many more across Bollywood, Telugu, Tamil, Kannada, Malayalam, and Hollywood.",
  "relation": "about",
  "expected_film_tmdb_id": <ALPHA_TMDB_ID>,
  "event_type": "release_date",
  "event_group": null,
  "is_production_news": false,
  "exclusion_category": "roundup"
},
{
  "url": "https://www.msn.com/en-in/entertainment/bollywood/upcoming-bollywood-movie-releases-in-july-2026-alia-bhatt-sharvaris-alpha-ajay-devgns-dhamaal-4-and-more/ar-AA26hHWT",
  "source": "MSN",
  "title": "Upcoming Bollywood movie releases in July 2026: Alia Bhatt-Sharvari's Alpha, Ajay Devgn's Dhamaal 4 and more",
  "summary": "From action thrillers to comedies, July 2026 theatrical releases kick off the second half of the year with films such as Alpha and Dhamaal 4 among many others.",
  "relation": "about",
  "expected_film_tmdb_id": <ALPHA_TMDB_ID>,
  "event_type": "release_date",
  "event_group": null,
  "is_production_news": false,
  "exclusion_category": "roundup"
}
```

- [ ] **Step 3: Validate the fixture parses**

Run: `task test -- tests/unit/link`
Expected: PASS (loader/model validation is exercised by the link unit tests; if a dedicated fixture-load test exists it must stay green). This also confirms the JSON is well-formed and the new items satisfy `ValidationItem`'s consistency rules (`is_production_news=false` required alongside `exclusion_category`).

- [ ] **Step 4: Run the real-model linking eval (before/after)**

In the container (real `ANTHROPIC_API_KEY` in `.env`):

```bash
task shell
python scripts/validate_linking.py
```

Confirm in the output:
- The three new items appear under the news-value axis as **dropped-excluded** (not leaks). `leaks by category` must **not** gain `roundup` leaks from them.
- `precision` / `recall` / `f1` on the entity-linking axis do **not** regress versus the pre-change run. If you did not capture a baseline first, temporarily `git stash` the Task 1 prompt change, run once for the baseline, then unstash and re-run.

Record the before/after numbers (linking P/R/F1 and news-value leaks) in the PR body and in the spec's Testing section.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/link/validation_set.json
git commit -m "test: add Alpha release-calendar listicles to linking validation set

Refs NEU-451."
```

---

### Task 4: Full verification and PR

**Files:** none (verification + PR).

- [ ] **Step 1: Run the full local CI gate**

```bash
task format
task test
task lint
task typecheck
```
Expected: all green. (`task format` may reformat — re-stage and amend the relevant commit if it changes files.)

- [ ] **Step 2: Push the branch**

```bash
git push -u origin tom/neu-451-bug-film-already-scheduled-for-release-in-two-days
```

- [ ] **Step 3: Open the PR**

Title: `fix: stop already-scheduled films getting spurious release-date events (NEU-451)`

Body must include: a one-paragraph summary, the LINK vs CLUSTER split, the recorded before/after `validate_linking.py` metrics from Task 3, and the footer:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Confirm CI is green on the PR.**

---

## Notes for the implementer

- The `off_topic` drop path in `apply_cluster_decisions` is unchanged — do not add a new `link_note`. A restatement dropped by the CLUSTER guard will show `link_note="off-topic"`; that is intentional (reuse decided in the spec).
- The CLUSTER guard is **semantic** (model-driven). There is no deterministic date comparison to add; `is_stale_stage` is untouched (the repro date is in the future, so it wouldn't fire anyway).
- Do not bump `summary_prompt_version` — SUMMARIZE is not touched by this ticket.
- The CLUSTER behavioral guard is proven at the unit level (payload + wording, Task 2). A full model-driven check via `scripts/validate_clustering.py` is **optional** — the LINK guard (Task 3) catches the exact repro before CLUSTER is reached, so a dedicated restatement fixture in the cluster harness is only worth adding if a natural labeled case already exists. Do not block the PR on it.
