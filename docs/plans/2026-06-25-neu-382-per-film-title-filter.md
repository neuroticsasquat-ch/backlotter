# Per-film Title-Token Fetch Filter (NEU-382) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut per-film Google News link-stage token spend by dropping off-topic search results at fetch time, before they reach the Stage-1 linker — without losing genuine coverage.

**Architecture:** A pure `title_matches(film_title, headline, *, min_ratio)` helper in `news/title_match.py` decides whether a per-film search result is plausibly about its originating film. The feeds fetcher zips each per-film search with the film title that produced it (order-aligned, no signature change) and filters parsed entries through `title_matches` before insert. Two config knobs (enable flag + min_ratio) gate it. The LLM linker remains the precision authority on whatever survives.

**Tech Stack:** Python 3.13, async SQLAlchemy 2 + asyncpg, FastAPI, pydantic-settings, feedparser, respx (test HTTP mocks), pytest (pytest-asyncio `auto` mode). All commands run **in the container via `task`** — never host Python.

## Global Constraints

- Modern type hints `X | None` / `X | Y`; **no** `from __future__ import annotations`.
- ruff line length 100, rules E,F,W,I,B,UP; `import x as x` re-export pattern in `__init__.py`.
- TDD: write the failing test first. pytest-asyncio `auto` (no `@pytest.mark.asyncio`). Mock HTTP with **respx**; never hit the live network in tests.
- **No schema change.** The filter runs in-process at fetch; nothing new is persisted.
- New behavior is **off by default at the function level** (`run_feeds_ingest` params default `False`/`0.5`) and **on in prod via settings** — existing tests/behavior unchanged unless explicitly enabled.
- `per_film_title_match_min_ratio` default **0.5** is provisional, finalized by the Task 4 measurement (tune so false-drops ≈ 0).
- **Single PR** on branch `tom/neu-382-backend-reduce-per-film-google-news-link-stage-token-spend`. Per Tom's workflow: do **not** commit per task — run scoped tests green at each task, then Tom runs full CI and commits once at the end (see Wrap-up). Integration tests: **don't run a single integration file in isolation** (known pytest-asyncio quirk) — scope to a directory.

---

### Task 1: Pure `title_matches` helper

**Files:**
- Create: `src/upmovies/news/title_match.py`
- Test: `tests/unit/news/test_title_match.py`

**Interfaces:**
- Produces: `title_matches(film_title: str, headline: str, *, min_ratio: float) -> bool` — `True` = keep the story for this film's per-film search. High-recall: a title with no significant tokens always returns `True`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/unit/news/test_title_match.py
from upmovies.news.title_match import title_matches


def test_full_title_match_is_kept():
    assert title_matches(
        "Spider-Man: Brand New Day",
        "Spider-Man: Brand New Day wraps filming",
        min_ratio=0.5,
    ) is True


def test_partial_below_threshold_is_dropped():
    # title significant tokens: spider, man, brand, new, day (5)
    # headline shares only new, day -> 2/5 = 0.4 < 0.5
    assert title_matches(
        "Spider-Man: Brand New Day",
        "A new day dawns at the bakery",
        min_ratio=0.5,
    ) is False


def test_whole_word_boundary_no_substring_match():
    # "war" must not match "warehouse"
    assert title_matches("War", "Warehouse fire downtown", min_ratio=0.5) is False
    assert title_matches("War", "This means war for the studio", min_ratio=0.5) is True


def test_stopwords_are_ignored():
    # significant title tokens: girl, clouds
    assert title_matches(
        "The Girl in the Clouds", "Girl in clouds gets a release date", min_ratio=0.5
    ) is True
    assert title_matches(
        "The Girl in the Clouds", "The release of the film", min_ratio=0.5
    ) is False


def test_no_significant_tokens_is_kept():
    # all-stopword / too-short title -> nothing to assess -> keep (high recall)
    assert title_matches("A", "totally unrelated headline", min_ratio=0.5) is True


def test_non_ascii_title_matches_non_ascii_headline():
    assert title_matches("Касса невест", "Касса невест выходит в прокат", min_ratio=0.5) is True
    assert title_matches("Касса невест", "Stock futures rise on Wall Street", min_ratio=0.5) is False


def test_numbered_sequel_keeps_on_topic_drops_generic():
    assert title_matches(
        "How to Train Your Dragon 2", "How to Train Your Dragon 2 soars", min_ratio=0.5
    ) is True
    assert title_matches(
        "How to Train Your Dragon 2", "Dragon boats race down the river", min_ratio=0.5
    ) is False


def test_curated_recall_rows_are_kept():
    # Real 'about' headline patterns must survive the filter (the recall guard).
    assert title_matches(
        "Avengers: Doomsday",
        "Famke Janssen Thinks Marvel Made A Mistake Not Bringing Her Back For 'Avengers: Doomsday'",
        min_ratio=0.5,
    ) is True
    assert title_matches(
        "Love and War", "First Look At 'Love and War' Revealed", min_ratio=0.5
    ) is True
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/news/test_title_match.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.news.title_match'`.

- [ ] **Step 3: Implement the helper**

```python
# src/upmovies/news/title_match.py
"""Cheap, high-recall title-token match for filtering per-film Google News results
before they reach the link stage. Pure — no I/O.

A per-film Google search (`<title> when:Nd`, deliberately unquoted) returns a large,
roughly title-independent junk floor. This drops headlines that clearly aren't about the
film while keeping anything with enough title-token overlap; the LLM linker remains the
precision authority on whatever survives."""

import re

# Common words that carry no disambiguating signal in a film title.
_STOPWORDS: frozenset[str] = frozenset(
    {"the", "a", "an", "of", "and", "or", "to", "in", "on", "at", "for", "part"}
)

_WORD_RE = re.compile(r"\w+", re.UNICODE)


def _significant_tokens(text: str) -> list[str]:
    return [t for t in _WORD_RE.findall(text.lower()) if len(t) > 1 and t not in _STOPWORDS]


def title_matches(film_title: str, headline: str, *, min_ratio: float) -> bool:
    """True if the headline should be kept for this film's per-film search.

    High-recall: a title with no significant tokens (all-stopword / single-char / numeric
    / non-Latin that tokenizes to nothing) is always kept — we don't filter what we can't
    assess. Otherwise keep when the fraction of significant title tokens present as whole
    words in the headline is >= min_ratio (single-token titles thus require that token)."""
    title_tokens = _significant_tokens(film_title)
    if not title_tokens:
        return True
    headline_tokens = set(_significant_tokens(headline))
    hits = sum(1 for t in title_tokens if t in headline_tokens)
    return hits / len(title_tokens) >= min_ratio
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/news/test_title_match.py`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint + typecheck the new file**

Run: `task format && task lint && task typecheck`
Expected: clean (no errors on `title_match.py` / `test_title_match.py`).

---

### Task 2: Config knobs

**Files:**
- Modify: `src/upmovies/config.py` (after the `feeds_per_film_*` block, ~line 44-47)
- Test: `tests/unit/test_config.py`

**Interfaces:**
- Produces: `Settings.per_film_title_filter_enabled: bool` (default `True`, alias `PER_FILM_TITLE_FILTER_ENABLED`); `Settings.per_film_title_match_min_ratio: float` (default `0.5`, alias `PER_FILM_TITLE_MATCH_MIN_RATIO`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/unit/test_config.py  (append; reuses the existing _set_required helper)
def test_settings_per_film_title_filter_defaults(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.delenv("PER_FILM_TITLE_FILTER_ENABLED", raising=False)
    monkeypatch.delenv("PER_FILM_TITLE_MATCH_MIN_RATIO", raising=False)
    s = Settings()  # type: ignore[call-arg]
    assert s.per_film_title_filter_enabled is True
    assert s.per_film_title_match_min_ratio == 0.5


def test_settings_per_film_title_match_min_ratio_override_from_env(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.setenv("PER_FILM_TITLE_MATCH_MIN_RATIO", "0.6")
    s = Settings()  # type: ignore[call-arg]
    assert s.per_film_title_match_min_ratio == 0.6
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/test_config.py -k per_film_title`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'per_film_title_filter_enabled'`.

- [ ] **Step 3: Add the config fields**

In `src/upmovies/config.py`, immediately after the `feeds_per_film_throttle_seconds` field:

```python
    per_film_title_filter_enabled: bool = Field(
        default=True, alias="PER_FILM_TITLE_FILTER_ENABLED"
    )
    per_film_title_match_min_ratio: float = Field(
        default=0.5, alias="PER_FILM_TITLE_MATCH_MIN_RATIO"
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/test_config.py -k per_film_title`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint + typecheck**

Run: `task lint && task typecheck`
Expected: clean.

---

### Task 3: Wire the filter into the feeds fetcher

**Files:**
- Modify: `src/upmovies/news/fetcher.py` (`FeedsIngestResult`, `run_feeds_ingest`, `_ingest_entries`, Phase B loop)
- Modify: `src/upmovies/routers/ingest_admin.py` (`_background_feeds`)
- Test: `tests/integration/news/test_fetcher.py`

**Interfaces:**
- Consumes: `title_matches(...)` (Task 1); `Settings.per_film_title_filter_enabled` / `Settings.per_film_title_match_min_ratio` (Task 2).
- Produces: `run_feeds_ingest(..., per_film_title_filter_enabled: bool = False, per_film_title_match_min_ratio: float = 0.5)`; `FeedsIngestResult.stories_filtered: int` (default `0`).

- [ ] **Step 1: Write the failing integration test**

```python
# tests/integration/news/test_fetcher.py  (append; reuses _xml, _rss, _stories,
# _seed_films, per_film_google_sources, run_feeds_ingest, create_run already imported)
@respx.mock
async def test_per_film_title_filter_drops_off_topic_and_leaves_trades(session):
    await _seed_films(session, ["Spider-Man"])
    pf = per_film_google_sources(["Spider-Man"], 36500)[0]
    respx.get(RSS_URL).mock(
        return_value=_xml(_rss([("Totally unrelated trade headline", "https://deadline.com/x", None)]))
    )
    respx.get(pf.url).mock(
        return_value=_xml(
            _rss(
                [
                    ("Spider-Man swings into a new trailer", "https://news.example/spidey", None),
                    ("Local bakery wins an award", "https://news.example/bakery", None),
                ]
            )
        )
    )
    run_id = await create_run(session, kind="feeds")
    await session.commit()
    result = await run_feeds_ingest(
        session_factory=lambda: session,
        run_id=run_id,
        recency_days=36500,
        per_film_enabled=True,
        per_film_throttle=0.0,
        per_film_title_filter_enabled=True,
        per_film_title_match_min_ratio=0.5,
        sources=[FeedSource("Deadline", RSS_URL)],
    )

    urls = {s.url for s in await _stories(session)}
    assert "https://news.example/spidey" in urls      # on-topic per-film kept
    assert "https://news.example/bakery" not in urls  # off-topic per-film dropped
    assert "https://deadline.com/x" in urls            # trade feed NOT filtered
    assert result.stories_filtered == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/news/`
Expected: FAIL — `TypeError: run_feeds_ingest() got an unexpected keyword argument 'per_film_title_filter_enabled'`.

- [ ] **Step 3: Implement the wiring**

In `src/upmovies/news/fetcher.py`:

(a) Add the import near the other `upmovies.news` imports:
```python
from upmovies.news.title_match import title_matches
```

(b) Add the result field to `FeedsIngestResult`:
```python
@dataclass
class FeedsIngestResult:
    feeds_processed: int
    feeds_failed: int
    stories_inserted: int
    films_queried: int = 0
    blocked: bool = False
    stories_filtered: int = 0
```

(c) Add the two params to `run_feeds_ingest`'s signature (after `per_film_throttle`):
```python
    per_film_enabled: bool = False,
    per_film_throttle: float = 1.0,
    per_film_title_filter_enabled: bool = False,
    per_film_title_match_min_ratio: float = 0.5,
    sources: Sequence[FeedSource] | None = None,
```

(d) Near `stories_inserted = 0`, add the counter:
```python
    stories_filtered = 0
```

(e) Replace `_ingest_entries` with a filtering version (uses the closed-over `cutoff`,
`session_factory`, `run_id`, and the new params; declares `stories_filtered` nonlocal):
```python
    async def _ingest_entries(
        source: FeedSource, content: bytes, *, match_title: str | None = None
    ) -> int:
        nonlocal stories_filtered
        entries = drop_stale(parse_feed(source.name, content), cutoff=cutoff)
        if match_title is not None:
            kept = [
                e
                for e in entries
                if title_matches(match_title, e.title, min_ratio=per_film_title_match_min_ratio)
            ]
            stories_filtered += len(entries) - len(kept)
            entries = kept
        async with _owned_session(session_factory) as s:
            inserted = await upsert_stories(s, entries)
            await record_progress(s, run_id, processed_delta=inserted)
            await s.commit()
        return inserted
```

(f) In the Phase B loop, zip titles with their searches (order-aligned 1:1 — `per_film_google_sources`
builds one source per title in order) and pass the match title when filtering is on:
```python
        if per_film_enabled:
            titles = await _film_titles(session_factory)
            for title, source in zip(titles, per_film_google_sources(titles, recency_days)):
                try:
                    resp = await client.get(source.url)
                    if _looks_blocked(resp):
                        blocked = True
                        block_reason = f"HTTP {resp.status_code}"
                        log.error(
                            "per-film fetch blocked after %d films (%s)",
                            films_queried,
                            block_reason,
                        )
                        break
                    resp.raise_for_status()
                    match_title = title if per_film_title_filter_enabled else None
                    stories_inserted += await _ingest_entries(
                        source, resp.content, match_title=match_title
                    )
                    films_queried += 1
                except Exception:
                    log.exception("per-film feed failed (%s)", source.url)
                    feeds_failed += 1
                    await _record_failure()
                await asyncio.sleep(per_film_throttle)
            if stories_filtered:
                log.info("per-film title filter dropped %d off-topic entries", stories_filtered)
```

(g) Add `stories_filtered=stories_filtered` to the `FeedsIngestResult(...)` constructed at the end of
`run_feeds_ingest` (the return that already passes `feeds_processed=`, `stories_inserted=`, etc.).

In `src/upmovies/routers/ingest_admin.py`, pass the settings through in `_background_feeds`'s
`run_feeds_ingest(...)` call (after `per_film_throttle=...`):
```python
            per_film_title_filter_enabled=settings.per_film_title_filter_enabled,
            per_film_title_match_min_ratio=settings.per_film_title_match_min_ratio,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/news/`
Expected: PASS — the new test passes and all pre-existing `tests/integration/news/` tests stay green (their `run_feeds_ingest` calls don't pass the new params, so filtering defaults off).

- [ ] **Step 5: Lint + typecheck**

Run: `task lint && task typecheck`
Expected: clean.

---

### Task 4: False-drop measurement script + tune `min_ratio`

**Files:**
- Create: `scripts/measure_title_filter.py`
- Modify (only if measurement says so): `src/upmovies/config.py` (`per_film_title_match_min_ratio` default)
- Modify: `docs/specs/2026-06-25-neu-382-per-film-title-filter-design.md` (umbrella — add a Results section)

**Interfaces:**
- Consumes: `title_matches` (Task 1); `load_validation_set` (`upmovies.link.validation`); `Film` (`upmovies.catalog.models`).

- [ ] **Step 1: Create the measurement script**

```python
# scripts/measure_title_filter.py
"""Measure the per-film title-token filter's false-drop rate against the labeled
validation set. Read-only — records nothing. Run in the container:

    task shell
    python scripts/measure_title_filter.py

For each candidate min_ratio it reports how many genuinely-'about' stories the filter
would wrongly drop (false drops). Tune the config default to keep this ~= 0."""

import asyncio

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.db import SessionLocal
from upmovies.link.validation import load_validation_set
from upmovies.news.title_match import title_matches

VALIDATION_PATH = "tests/fixtures/link/validation_set.json"
RATIOS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]


async def main() -> None:
    items = [
        it
        for it in load_validation_set(VALIDATION_PATH)
        if it.relation == "about" and it.expected_film_tmdb_id is not None
    ]
    ids = {it.expected_film_tmdb_id for it in items}
    async with SessionLocal() as s:
        rows = (
            await s.execute(select(Film.tmdb_id, Film.title).where(Film.tmdb_id.in_(ids)))
        ).all()
    title_by_id = {tid: title for tid, title in rows}
    usable = [it for it in items if it.expected_film_tmdb_id in title_by_id]
    skipped = len(items) - len(usable)
    print(f"about-items={len(items)} usable={len(usable)} skipped_not_in_roster={skipped}")
    print(f"{'min_ratio':>10} {'false_drops':>12} {'rate':>8}")
    for r in RATIOS:
        drops = sum(
            1
            for it in usable
            if not title_matches(title_by_id[it.expected_film_tmdb_id], it.title, min_ratio=r)
        )
        rate = drops / len(usable) if usable else 0.0
        print(f"{r:>10.2f} {drops:>12} {rate:>7.1%}")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Lint + typecheck the script**

Run: `task format && task lint && task typecheck`
Expected: clean (CI bar for scripts is lint + typecheck, mirroring `validate_linking.py` / `audit_source_roi.py`).

- [ ] **Step 3: Run the measurement (container must be up with the localdev corpus)**

Run: `task shell` then `python scripts/measure_title_filter.py`
Expected: a min_ratio→false-drop table. **Pick the largest `min_ratio` whose false-drop rate is ≈ 0%** (most aggressive junk removal that still preserves coverage). If that value differs from `0.5`, update the `per_film_title_match_min_ratio` default in `config.py` and re-run Task 2's default test asserting the new value.

- [ ] **Step 4: (Manual, Tom's pass — real tokens) before/after cost check**

With the chosen `min_ratio`, run a fresh per-film feeds ingest + link, then re-run
`python scripts/audit_source_roi.py`. Record in the spec's new **Results (measured YYYY-MM-DD)**
section: the chosen `min_ratio` + its false-drop rate, the per-film story-volume reduction, and
confirmation that per-film `unique_events` did not materially drop. This token-spending verification
is the acceptance artifact, not a CI gate.

---

## Wrap-up: CI + single commit/PR (Tom)

Per Tom's workflow this whole change is **one PR** — do not commit per task. When all four tasks are green:

- [ ] Run the full local CI (pre-commit hooks delegate into the container, so commit normally; keep the container up): `task format && task lint && task typecheck && task test` — all green (alembic not touched; no migration).
- [ ] On branch `tom/neu-382-backend-reduce-per-film-google-news-link-stage-token-spend`, commit with `/commit-msg` and open the PR with `/pr-desc` (Conventional Commits; PR title carries the `(NEU-382)` parenthetical; `🤖 Generated with Claude Code` footer in the PR body only).

## Self-Review

- **Spec coverage:** `title_match.py` pure fn + rails → Task 1; config knobs → Task 2; fetch-time threading + Phase-B filtering + observability (`stories_filtered` + log) + `_background_feeds` wiring → Task 3; false-drop validation against the fixture + min_ratio tuning + audit before/after → Task 4. "No popularity gate / no schema change / trade feeds untouched / one PR" are enforced by the Global Constraints and the off-by-default function params. The /Film·Collider·Empire drop is explicitly out of scope (separate ticket) — not in this plan by design.
- **Placeholder scan:** none — every step carries concrete code/commands; the only run-time-filled values are the tuned `min_ratio` and the measured volume numbers (Task 4), which are intentionally measured, not pre-filled.
- **Type consistency:** `title_matches(film_title, headline, *, min_ratio)` is defined in Task 1 and consumed with that exact signature in Tasks 3 and 4; `per_film_title_filter_enabled` / `per_film_title_match_min_ratio` names match across config (Task 2), fetcher params (Task 3), and `_background_feeds` (Task 3); `FeedsIngestResult.stories_filtered` is defined and asserted with the same name.
