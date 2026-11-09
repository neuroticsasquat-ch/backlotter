# Cap Per-Event Source Citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show at most 3 source citations per event, deduped to distinct outlets, choosing the most-recent story per outlet, applied once in the backend.

**Architecture:** Introduce a pure, DB-free `public/sources.py` module that owns source display + selection (`outlet_label`, relocated from `service.py`, plus a new `cap_sources` helper). Wire `cap_sources` into the two source-assembly sites in `public/service.py` (`get_film_detail`, `get_feed`) so the feed and the film timeline share one capped, deduped, newest-first list. No DTO, schema, migration, or frontend change.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, pytest. Everything runs in the container via `task` (no host Python).

## Global Constraints

- **Blocked by NEU-360 — already merged** (commit `4d8137f`, PR #39). `Story.outlet` and `outlet_label` exist on `main`; this plan assumes that state. No further dependency.
- **All tooling runs in the container via `task`** — never run `pytest`/`ruff`/`pyright` on the host. Test: `task test` (scope with `task test -- tests/unit/public/...`). Format: `task format`. Lint: `task lint`. Types: `task typecheck`. Keep the container up (`task up`).
- **Before every commit:** run `task format` (ruff reformats), then `git add -A`, then commit. Pre-commit hooks delegate into Docker — commit normally, no `--no-verify`.
- **Commit style (backend CLAUDE.md):** Conventional Commits subject; **no** Linear ID in the subject (optional `Refs NEU-361.` in the body); **no** `🤖 Generated with Claude Code` footer in commits; **no** `Co-Authored-By` trailer.
- **Coding style:** modern type hints (`X | None`, no `Optional`); no `from __future__ import annotations`; ruff line length 100; TDD (failing test first); pytest-asyncio is in `auto` mode (no `@pytest.mark.asyncio`).
- **Cap value:** `SOURCE_CAP = 3` (a plain module constant — not a `config.py` field).
- **Both tasks ship as one PR** off branch `tom/neu-361-cap-per-event-source-citations-at-34` (the spec calls for a single backend PR). Two commits on that branch is fine.

---

### Task 1: Pure `public/sources.py` — relocate `outlet_label`, add `cap_sources`

Create the pure selection module and move `outlet_label` into it. After this task the public API behaviour is **unchanged** (`cap_sources` exists and is fully unit-tested but is not yet wired into `service.py`). The full suite stays green.

**Files:**
- Create: `src/upmovies/public/sources.py`
- Create: `tests/unit/public/test_sources.py`
- Modify: `src/upmovies/public/service.py` (remove the local `outlet_label` def at lines 21–24; import it from the new module)
- Delete: `tests/unit/public/test_service.py` (its two `outlet_label` tests move into `test_sources.py`)

**Interfaces:**
- Produces:
  - `SOURCE_CAP: int = 3`
  - `outlet_label(story: Story) -> str` — resolved publisher (`story.outlet`) else `story.source`.
  - `cap_sources(stories: list[Story], cap: int = SOURCE_CAP) -> list[Story]` — returns the most-recent story per distinct (normalized) outlet, newest-first, at most `cap`. Order-independent of the input.
- Consumes: `upmovies.news.models.Story` (fields used: `.outlet`, `.source`, `.published_at`, `.id`).

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/public/test_sources.py`:

```python
from datetime import UTC, datetime
from uuid import UUID

from upmovies.news.models import Story
from upmovies.public.sources import SOURCE_CAP, cap_sources, outlet_label


def _dt(day: int) -> datetime:
    return datetime(2025, 3, day, tzinfo=UTC)


def _story(
    *,
    source: str = "Deadline",
    outlet: str | None = None,
    published_at: datetime | None = None,
    id: UUID | None = None,
    url: str | None = None,
    title: str = "t",
) -> Story:
    return Story(
        id=id,
        source=source,
        outlet=outlet,
        url=url or f"https://x/{source}/{published_at}",
        title=title,
        published_at=published_at,
    )


def test_source_cap_default_is_three():
    assert SOURCE_CAP == 3


def test_outlet_label_prefers_resolved_outlet():
    assert outlet_label(_story(outlet="Deadline", source="Google News: per-film")) == "Deadline"


def test_outlet_label_falls_back_to_source_when_outlet_none():
    assert outlet_label(_story(outlet=None, source="Deadline")) == "Deadline"


def test_cap_sources_returns_distinct_outlets_newest_first():
    stories = [
        _story(source="Variety", published_at=_dt(2)),
        _story(source="Deadline", published_at=_dt(5)),
    ]
    assert [outlet_label(s) for s in cap_sources(stories)] == ["Deadline", "Variety"]


def test_cap_sources_trims_to_three_keeping_most_recent_outlets():
    stories = [
        _story(source="Deadline", published_at=_dt(5)),
        _story(source="Variety", published_at=_dt(4)),
        _story(source="The Hollywood Reporter", published_at=_dt(3)),
        _story(source="Collider", published_at=_dt(2)),
        _story(source="Empire", published_at=_dt(1)),
    ]
    result = cap_sources(stories)
    assert [outlet_label(s) for s in result] == ["Deadline", "Variety", "The Hollywood Reporter"]


def test_cap_sources_dedupes_outlet_keeping_most_recent():
    stories = [
        _story(source="Deadline", url="https://d/old", published_at=_dt(1)),
        _story(source="Deadline", url="https://d/new", published_at=_dt(5)),
        _story(source="Variety", published_at=_dt(3)),
    ]
    result = cap_sources(stories)
    assert [outlet_label(s) for s in result] == ["Deadline", "Variety"]
    assert result[0].url == "https://d/new"  # kept the most-recent Deadline


def test_cap_sources_dedupe_key_uses_outlet_label_fallback():
    # one row resolves via outlet, the other via source — same publisher, dedupe to one
    stories = [
        _story(source="Deadline", outlet=None, published_at=_dt(1)),
        _story(source="Google News: per-film", outlet="Deadline", published_at=_dt(5)),
    ]
    result = cap_sources(stories)
    assert [outlet_label(s) for s in result] == ["Deadline"]
    assert result[0].published_at == _dt(5)


def test_cap_sources_null_published_at_sorts_last():
    stories = [
        _story(source="NoDate", published_at=None),
        _story(source="Deadline", published_at=_dt(2)),
        _story(source="Variety", published_at=_dt(1)),
    ]
    assert [outlet_label(s) for s in cap_sources(stories)] == ["Deadline", "Variety", "NoDate"]


def test_cap_sources_id_tiebreak_is_deterministic():
    id_a = UUID("00000000-0000-0000-0000-00000000000a")
    id_b = UUID("00000000-0000-0000-0000-00000000000b")
    same = _dt(3)
    s_a = _story(source="Alpha", id=id_a, published_at=same)
    s_b = _story(source="Bravo", id=id_b, published_at=same)
    # same published_at → id ascending, regardless of input order
    assert [s.id for s in cap_sources([s_b, s_a])] == [id_a, id_b]
    assert [s.id for s in cap_sources([s_a, s_b])] == [id_a, id_b]


def test_cap_sources_normalizes_outlet_for_dedupe():
    stories = [
        _story(source="The Hollywood Reporter", url="https://thr/new", published_at=_dt(5)),
        _story(source="hollywood   reporter", url="https://thr/old", published_at=_dt(1)),
        _story(source="Variety", published_at=_dt(3)),
    ]
    result = cap_sources(stories)
    # casefold + "the " strip + whitespace-collapse make these one outlet;
    # the verbatim label of the most-recent kept story is displayed.
    assert [outlet_label(s) for s in result] == ["The Hollywood Reporter", "Variety"]
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `task test -- tests/unit/public/test_sources.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.public.sources'`.

- [ ] **Step 3: Create the pure module**

Create `src/upmovies/public/sources.py`:

```python
from upmovies.news.models import Story

SOURCE_CAP = 3


def outlet_label(story: Story) -> str:
    """Display label for a source: the resolved publisher when present (Google News
    rows), otherwise the stored `source` (trade feeds, or unresolved rows)."""
    return story.outlet or story.source


def _dedupe_key(label: str) -> str:
    """Normalized key deciding which citations count as the same outlet. Display
    still uses the verbatim label; only the dedupe comparison is normalized:
    casefold, collapse internal whitespace, and drop a leading "the "."""
    norm = " ".join(label.casefold().split())
    if norm.startswith("the "):
        norm = norm[4:]
    return norm


def cap_sources(stories: list[Story], cap: int = SOURCE_CAP) -> list[Story]:
    """Most-recent distinct outlets, newest-first, capped to `cap`.

    Order-independent of the input: sorts internally (newest `published_at` first,
    NULL `published_at` last, story `id` as a stable tiebreak), keeps the first
    story seen per normalized outlet (= the most recent), and returns at most `cap`.
    """
    ordered = sorted(
        stories,
        key=lambda s: (
            s.published_at is None,  # non-NULL published_at first
            -(s.published_at.timestamp()) if s.published_at else 0.0,  # newest first
            str(s.id),  # stable tiebreak
        ),
    )
    seen: set[str] = set()
    result: list[Story] = []
    for story in ordered:
        key = _dedupe_key(outlet_label(story))
        if key in seen:
            continue
        seen.add(key)
        result.append(story)
        if len(result) >= cap:
            break
    return result
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `task test -- tests/unit/public/test_sources.py`
Expected: PASS (all 11 tests).

- [ ] **Step 5: Relocate `outlet_label` out of `service.py`**

In `src/upmovies/public/service.py`, **delete** the local definition (currently lines 21–24):

```python
def outlet_label(story: Story) -> str:
    """Display label for a source: the resolved publisher when present (Google News
    rows), otherwise the stored `source` (trade feeds, or unresolved rows)."""
    return story.outlet or story.source
```

…and add this import alongside the other `upmovies.public.*` imports (after the `from upmovies.public.dto import (...)` block):

```python
from upmovies.public.sources import outlet_label
```

Leave the two `outlet_label(...)` call sites in `get_film_detail` and `get_feed` unchanged for now. Do **not** import `cap_sources` yet — it is unused until Task 2 and would trip ruff's unused-import (F401) check.

- [ ] **Step 6: Delete the now-relocated service unit test**

The two tests in `tests/unit/public/test_service.py` were moved into `test_sources.py` in Step 1. Delete the file:

Run: `git rm tests/unit/public/test_service.py`

- [ ] **Step 7: Run the full suite + format**

Run: `task format` then `task test` then `task lint` then `task typecheck`
Expected: all green. (`service.py` behaviour is unchanged; `cap_sources` is tested but unwired.)

- [ ] **Step 8: Commit**

```bash
task format
git add -A
git commit -m "feat(public): add cap_sources helper and relocate outlet_label

Refs NEU-361."
```

---

### Task 2: Wire `cap_sources` into the feed and film-detail responses

Apply the cap at both source-assembly sites so events expose at most 3 distinct-outlet citations, newest-first.

**Files:**
- Modify: `src/upmovies/public/service.py` (import `cap_sources`; wrap the two source list comprehensions)
- Modify: `tests/integration/routers/test_public_feed.py` (add a cap+dedupe test)
- Modify: `tests/integration/routers/test_public_films.py` (add a cap+dedupe test)

**Interfaces:**
- Consumes: `cap_sources` from `upmovies.public.sources` (Task 1).
- Produces: no signature change — `EventOut.sources` / `FeedItem.sources` now hold ≤ 3 entries.

- [ ] **Step 1: Write the failing integration tests**

Append to `tests/integration/routers/test_public_feed.py`:

```python
async def test_feed_caps_sources_at_three_distinct_outlets_newest_first(
    client, make_film, add_event
):
    film = await make_film(slug="cap-feed-2026")
    await add_event(
        film=film,
        summary="Lots of coverage.",
        sources=(
            {"url": "https://d/old", "source": "Deadline",
             "published_at": datetime(2025, 3, 1, tzinfo=UTC)},
            {"url": "https://d/new", "source": "Deadline",
             "published_at": datetime(2025, 3, 5, tzinfo=UTC)},
            {"url": "https://v/1", "source": "Variety",
             "published_at": datetime(2025, 3, 4, tzinfo=UTC)},
            {"url": "https://t/1", "source": "The Hollywood Reporter",
             "published_at": datetime(2025, 3, 3, tzinfo=UTC)},
            {"url": "https://c/1", "source": "Collider",
             "published_at": datetime(2025, 3, 2, tzinfo=UTC)},
        ),
    )

    item = (await client.get("/feed")).json()["items"][0]
    # 5 stories / 4 distinct outlets -> top 3 by recency, deduped, newest-first.
    assert [s["source"] for s in item["sources"]] == [
        "Deadline",
        "Variety",
        "The Hollywood Reporter",
    ]
```

Append to `tests/integration/routers/test_public_films.py`:

```python
async def test_film_detail_caps_sources_at_three_distinct_outlets_newest_first(
    client, make_film, add_event
):
    film = await make_film(slug="cap-detail-2026")
    await add_event(
        film=film,
        summary="Lots of coverage.",
        sources=(
            {"url": "https://d/old", "source": "Deadline",
             "published_at": datetime(2025, 3, 1, tzinfo=UTC)},
            {"url": "https://d/new", "source": "Deadline",
             "published_at": datetime(2025, 3, 5, tzinfo=UTC)},
            {"url": "https://v/1", "source": "Variety",
             "published_at": datetime(2025, 3, 4, tzinfo=UTC)},
            {"url": "https://t/1", "source": "The Hollywood Reporter",
             "published_at": datetime(2025, 3, 3, tzinfo=UTC)},
            {"url": "https://c/1", "source": "Collider",
             "published_at": datetime(2025, 3, 2, tzinfo=UTC)},
        ),
    )

    sources = (await client.get("/films/cap-detail-2026")).json()["events"][0]["sources"]
    assert [s["source"] for s in sources] == ["Deadline", "Variety", "The Hollywood Reporter"]
```

(`datetime`/`UTC` are already imported at the top of both files.)

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `task test -- tests/integration/routers/test_public_feed.py tests/integration/routers/test_public_films.py`
Expected: FAIL — both new tests currently return all 5 sources in oldest-first order, so the list-equality assertions fail.

- [ ] **Step 3: Wire `cap_sources` into `service.py`**

In `src/upmovies/public/service.py`, change the Task 1 import line to also bring in `cap_sources`:

```python
from upmovies.public.sources import cap_sources, outlet_label
```

In `get_film_detail`, change the source comprehension inside the `EventOut(...)` construction from:

```python
            sources=[
                SourceOut(
                    url=story.url,
                    source=outlet_label(story),
                    title=story.title,
                    published_at=story.published_at,
                )
                for story in sources_by_event.get(event.id, [])
            ],
```

to:

```python
            sources=[
                SourceOut(
                    url=story.url,
                    source=outlet_label(story),
                    title=story.title,
                    published_at=story.published_at,
                )
                for story in cap_sources(sources_by_event.get(event.id, []))
            ],
```

In `get_feed`, make the identical change to the `FeedItem(...)` source comprehension:

```python
                sources=[
                    SourceOut(
                        url=story.url,
                        source=outlet_label(story),
                        title=story.title,
                        published_at=story.published_at,
                    )
                    for story in cap_sources(sources_by_event.get(event.id, []))
                ],
```

- [ ] **Step 4: Run the new tests to confirm they pass**

Run: `task test -- tests/integration/routers/test_public_feed.py tests/integration/routers/test_public_films.py`
Expected: PASS.

- [ ] **Step 5: Run the full CI pipeline locally**

Run: `task format` then `task test` then `task lint` then `task typecheck`
Expected: all green. Existing source tests remain valid — every prior fixture event has ≤ 1 source or asserts sources as a set, so the newest-first reorder does not break them.

- [ ] **Step 6: Commit**

```bash
task format
git add -A
git commit -m "feat(public): cap event source citations at 3 distinct outlets

Refs NEU-361."
```

---

## Self-Review

**Spec coverage:**
- Cap = 3 → `SOURCE_CAP` (Task 1) enforced in both sites (Task 2). ✓
- Dedupe by outlet before cap → `cap_sources` dedupes on `_dedupe_key(outlet_label(...))` (Task 1). ✓
- Most-recent distinct outlets, newest-first → internal sort + first-seen-per-key (Task 1); asserted end-to-end (Task 2). ✓
- Silent overflow, no DTO/schema/FE change → no DTO edits anywhere; only the comprehension iterable changes. ✓
- Backend layer, both sites share one helper → `cap_sources` applied in `get_film_detail` and `get_feed` (Task 2). ✓
- Light-normalized key, verbatim display → `_dedupe_key` normalizes; `outlet_label` returns the verbatim kept-story label; covered by `test_cap_sources_normalizes_outlet_for_dedupe`. ✓
- `outlet_label` relocation keeps the existing two unit tests → moved into `test_sources.py`, old file deleted (Task 1). ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `cap_sources(stories: list[Story], cap: int = SOURCE_CAP) -> list[Story]` and `outlet_label(story: Story) -> str` are referenced identically in Tasks 1 and 2; `SOURCE_CAP` name consistent throughout.
