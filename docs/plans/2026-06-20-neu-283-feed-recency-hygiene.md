# Feed Recency Hygiene (NEU-283) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop old/evergreen articles landing in `news.story` by adding a Google News `when:Nd` operator and a `published_at` recency gate, both driven by one env knob (`FEED_RECENCY_DAYS`, default 14).

**Architecture:** A single setting feeds two filters. `feeds.py` gains a `feed_sources(recency_days)` builder that appends `when:{N}d` to the four Google News queries (trade RSS feeds untouched). `fetcher.py` gains a pure `drop_stale(entries, cutoff)` helper applied between parse and upsert; null-dated entries always pass (safety net for the trade feeds). The trigger passes `settings.feed_recency_days` through.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, Pydantic v2 / pydantic-settings, feedparser, httpx, pytest + respx. **Everything runs in Docker via `task`** — never run `python`/`pytest`/`ruff` on the host.

**Spec:** `docs/specs/2026-06-20-feed-recency-hygiene-design.md`

---

## Execution notes (this repo / user)

- **Branch:** do all work on `tom/neu-283-backlog-google-news-whennd-fetcher-published_at-recency-gate` (the Linear branch), cut from `main`. Verify branch + clean tree before starting.
- **Single PR for the whole ticket.** The tasks are interdependent (the `run_feeds_ingest` signature change touches builder + gate + wiring together); splitting into per-task PRs would leave intermediate CI red. Each task is still committed separately on the branch.
- **Subagents do NOT commit.** The orchestrator/user commits at each task boundary and opens the one PR at the end (use `/commit-msg` and `/pr-desc`).
- **Pre-commit hooks delegate into Docker** — commit normally (no `--no-verify`); run `task format` first and keep the container up (`task up`).
- **No migration:** this change touches no models/schema, so there is no Alembic step.
- **CI gate before pushing:** `task format` then `task test`, `task lint`, `task typecheck` all green.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/upmovies/config.py` | Settings | Add `feed_recency_days` field |
| `src/upmovies/news/feeds.py` | Source config | Replace static `FEED_SOURCES` tuple with `feed_sources(recency_days)` builder + `when:Nd` |
| `src/upmovies/news/fetcher.py` | Fetch + parse + persist | Add pure `drop_stale`; `run_feeds_ingest` gains `recency_days`, builds sources via `feed_sources`, applies the gate |
| `src/upmovies/routers/ingest_admin.py` | Triggers | `_background_feeds` passes `recency_days=settings.feed_recency_days` |
| `tests/unit/news/test_recency.py` | Unit | New — `drop_stale` logic |
| `tests/unit/news/test_feeds.py` | Unit | New — `feed_sources` builder / `when:Nd` |
| `tests/integration/news/test_fetcher.py` | Integration | Update `_run` helper; add end-to-end gate test |

---

## Task 1: Add the `FEED_RECENCY_DAYS` setting

**Files:**
- Modify: `src/upmovies/config.py` (after the `link_batch_size` line, ~line 35)

- [ ] **Step 1: Add the setting field**

In `src/upmovies/config.py`, immediately after the `link_batch_size` field, add:

```python
    # Feed-ingestion recency window: Google News `when:Nd` + the published_at drop gate.
    feed_recency_days: int = Field(default=14, alias="FEED_RECENCY_DAYS")
```

- [ ] **Step 2: Verify the suite still passes (new field, default — no behavior change yet)**

Run: `task typecheck && task test`
Expected: PASS (no regressions; the field is unused so far).

- [ ] **Step 3: Checkpoint (orchestrator commits)**

```bash
task format && git add -A && git commit -m "feat: add FEED_RECENCY_DAYS setting"
```

---

## Task 2: Pure `drop_stale` recency helper

**Files:**
- Modify: `src/upmovies/news/fetcher.py` (add function after `parse_feed`)
- Test: `tests/unit/news/test_recency.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/news/test_recency.py`:

```python
from datetime import UTC, datetime

from upmovies.news.fetcher import StoryEntry, drop_stale


def _entry(url: str, published_at: datetime | None) -> StoryEntry:
    return StoryEntry(source="X", url=url, title="t", published_at=published_at, raw={})


def test_drop_stale_keeps_recent_and_undated_drops_old():
    cutoff = datetime(2026, 6, 6, tzinfo=UTC)
    recent = _entry("https://e/recent", datetime(2026, 6, 10, tzinfo=UTC))
    at_cutoff = _entry("https://e/at", datetime(2026, 6, 6, tzinfo=UTC))  # boundary: kept (>=)
    old = _entry("https://e/old", datetime(2026, 1, 1, tzinfo=UTC))
    undated = _entry("https://e/undated", None)

    kept = drop_stale([recent, at_cutoff, old, undated], cutoff=cutoff)

    assert kept == [recent, at_cutoff, undated]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/news/test_recency.py`
Expected: FAIL — `ImportError: cannot import name 'drop_stale'`.

- [ ] **Step 3: Implement `drop_stale`**

In `src/upmovies/news/fetcher.py`, add immediately after the `parse_feed` function:

```python
def drop_stale(entries: Sequence[StoryEntry], *, cutoff: datetime) -> list[StoryEntry]:
    """Drop dated entries older than `cutoff`. Null-dated entries are always kept — a
    safety net, since many trade-feed items omit a parseable date."""
    return [e for e in entries if e.published_at is None or e.published_at >= cutoff]
```

(`Sequence` and `datetime` are already imported in this module.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/news/test_recency.py`
Expected: PASS.

- [ ] **Step 5: Checkpoint (orchestrator commits)**

```bash
task format && git add -A && git commit -m "feat: add drop_stale recency helper for feed entries"
```

---

## Task 3: `feed_sources(recency_days)` builder with `when:Nd`, and rewire the fetcher

This task adds the builder, then makes `run_feeds_ingest` build its default sources from it and take a `recency_days` kwarg. It does **not** wire the gate yet (Task 4). After this task the whole suite is green.

**Files:**
- Modify: `src/upmovies/news/feeds.py` (replace the `FEED_SOURCES` tuple, lines ~23–42)
- Modify: `src/upmovies/news/fetcher.py` (import + `run_feeds_ingest` signature)
- Modify: `src/upmovies/routers/ingest_admin.py` (`_background_feeds`, ~line 67)
- Modify: `tests/integration/news/test_fetcher.py` (`_run` helper, ~line 34)
- Test: `tests/unit/news/test_feeds.py` (create)

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/news/test_feeds.py`:

```python
from upmovies.news.feeds import feed_sources


def test_google_queries_carry_the_when_operator():
    google = [s for s in feed_sources(14) if s.name.startswith("Google News")]
    assert len(google) == 4
    # quote() encodes "when:14d" as "when%3A14d"
    assert all("when%3A14d" in s.url for s in google)


def test_trade_feeds_are_returned_unchanged_without_a_when_operator():
    sources = feed_sources(14)
    deadline = next(s for s in sources if s.name == "Deadline")
    assert deadline.url == "https://deadline.com/feed/"
    assert "when" not in deadline.url
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/news/test_feeds.py`
Expected: FAIL — `ImportError: cannot import name 'feed_sources'`.

- [ ] **Step 3: Implement the builder in `feeds.py`**

In `src/upmovies/news/feeds.py`, replace the entire `FEED_SOURCES = (...)` tuple (lines ~23–42) with:

```python
_TRADE_FEEDS: tuple[FeedSource, ...] = (
    FeedSource("Deadline", "https://deadline.com/feed/"),
    FeedSource("Variety", "https://variety.com/feed/"),
    FeedSource("The Hollywood Reporter", "https://www.hollywoodreporter.com/feed/"),
    FeedSource("Collider", "https://collider.com/feed/"),
    FeedSource("/Film", "https://www.slashfilm.com/feed/"),
    # Empire's old /movies/news/feed/ path 404s now; the live feed is Bauer Media's
    # central aggregator (and it 403s any client without an identifying User-Agent).
    FeedSource(
        "Empire",
        "https://rss.onebauer.media/api/feed-aggregator?hostname=https://www.empireonline.com",
    ),
    FeedSource("ScreenRant", "https://screenrant.com/feed/"),
)

# Broad Google News queries (casting/release/trailer/greenlight signals). The `when:Nd`
# operator is appended at build time so the source-side filter tracks FEED_RECENCY_DAYS.
_GOOGLE_QUERIES: tuple[tuple[str, str], ...] = (
    ("Google News: casting", "movie casting"),
    ("Google News: release date", "movie release date"),
    ("Google News: trailer", "movie trailer"),
    ("Google News: greenlight", "movie greenlight"),
)


def feed_sources(recency_days: int) -> tuple[FeedSource, ...]:
    """Full source list: static trade RSS/Atom feeds plus Google News queries bounded to
    the last `recency_days` days via the `when:Nd` operator."""
    google = tuple(
        FeedSource(name, _google_news(f"{query} when:{recency_days}d"))
        for name, query in _GOOGLE_QUERIES
    )
    return _TRADE_FEEDS + google
```

(Keep the `FeedSource` NamedTuple and the `_google_news` helper above unchanged.)

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `task test -- tests/unit/news/test_feeds.py`
Expected: PASS.

- [ ] **Step 5: Rewire `run_feeds_ingest` to build sources from `feed_sources`**

In `src/upmovies/news/fetcher.py`:

Change the import (line ~24) from:

```python
from upmovies.news.feeds import FEED_SOURCES, FeedSource
```

to:

```python
from upmovies.news.feeds import FeedSource, feed_sources
```

Change the `run_feeds_ingest` signature + opening (lines ~124–133) from:

```python
async def run_feeds_ingest(
    *,
    session_factory: SessionFactory,
    run_id: UUID,
    sources: Sequence[FeedSource] = FEED_SOURCES,
    timeout: float = 30.0,
) -> FeedsIngestResult:
    feeds_processed = 0
```

to:

```python
async def run_feeds_ingest(
    *,
    session_factory: SessionFactory,
    run_id: UUID,
    recency_days: int,
    sources: Sequence[FeedSource] | None = None,
    timeout: float = 30.0,
) -> FeedsIngestResult:
    if sources is None:
        sources = feed_sources(recency_days)
    feeds_processed = 0
```

- [ ] **Step 6: Pass the setting through the trigger**

In `src/upmovies/routers/ingest_admin.py`, change `_background_feeds` (line ~67) from:

```python
        await run_feeds_ingest(session_factory=_session_factory, run_id=run_id)
```

to:

```python
        await run_feeds_ingest(
            session_factory=_session_factory,
            run_id=run_id,
            recency_days=settings.feed_recency_days,
        )
```

- [ ] **Step 7: Update the integration test helper for the new required kwarg**

In `tests/integration/news/test_fetcher.py`, change the `_run` helper (lines ~34–38) from:

```python
async def _run(session, sources):
    run_id = await create_run(session, kind="feeds")
    await session.commit()
    result = await run_feeds_ingest(session_factory=lambda: session, run_id=run_id, sources=sources)
    return run_id, result
```

to:

```python
async def _run(session, sources, recency_days=36500):
    run_id = await create_run(session, kind="feeds")
    await session.commit()
    result = await run_feeds_ingest(
        session_factory=lambda: session,
        run_id=run_id,
        recency_days=recency_days,
        sources=sources,
    )
    return run_id, result
```

(The huge default ~100 years keeps the existing fixed-date fixtures from ever being dropped once the gate is wired in Task 4, so those tests stay deterministic. The `test_ingest_admin.py` mocks already accept `**kwargs`, so they need no change.)

- [ ] **Step 8: Run the full suite (everything green; gate not yet active)**

Run: `task test`
Expected: PASS — all existing feed/admin tests plus the two new unit suites.

- [ ] **Step 9: Checkpoint (orchestrator commits)**

```bash
task format && git add -A && git commit -m "feat: build feed sources with Google News when:Nd window"
```

---

## Task 4: Wire the `published_at` gate (TDD via integration test)

`drop_stale` (Task 2) is not called yet. This task adds a failing end-to-end test, then wires the gate into `run_feeds_ingest` to make it pass.

**Files:**
- Modify: `tests/integration/news/test_fetcher.py` (imports + new helper + new test)
- Modify: `src/upmovies/news/fetcher.py` (`datetime` import + cutoff + `drop_stale` call)

- [ ] **Step 1: Add a dynamic-date RSS helper + the failing test**

At the top of `tests/integration/news/test_fetcher.py`, add to the imports:

```python
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
```

Add this RSS builder near the other module-level helpers (e.g. after `_xml`):

```python
GATE_URL = "https://gate.example/feed"


def _rss(items: list[tuple[str, str, datetime | None]]) -> str:
    rows = []
    for title, url, dt in items:
        date_line = f"      <pubDate>{format_datetime(dt)}</pubDate>\n" if dt else ""
        rows.append(
            "    <item>\n"
            f"      <title>{title}</title>\n"
            f"      <link>{url}</link>\n"
            f"{date_line}"
            "    </item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0"><channel><title>Gate</title>\n'
        + "\n".join(rows)
        + "\n</channel></rss>\n"
    )
```

Add the test at the end of the file:

```python
@respx.mock
async def test_stale_dated_entries_dropped_keeping_recent_and_undated(session):
    now = datetime.now(UTC)
    respx.get(GATE_URL).mock(
        return_value=_xml(
            _rss(
                [
                    ("Recent", "https://gate.example/recent", now - timedelta(days=2)),
                    ("Stale", "https://gate.example/stale", now - timedelta(days=100)),
                    ("Undated", "https://gate.example/undated", None),
                ]
            )
        )
    )

    _, result = await _run(session, [FeedSource("Gate", GATE_URL)], recency_days=14)

    assert result.stories_inserted == 2
    assert {s.url for s in await _stories(session)} == {
        "https://gate.example/recent",
        "https://gate.example/undated",
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/news/test_fetcher.py::test_stale_dated_entries_dropped_keeping_recent_and_undated`
Expected: FAIL — `assert result.stories_inserted == 2` gets `3` (the stale entry is still inserted; the gate isn't wired).

- [ ] **Step 3: Wire the gate into `run_feeds_ingest`**

In `src/upmovies/news/fetcher.py`, add `timedelta` to the datetime import (line ~13):

```python
from datetime import UTC, datetime, timedelta
```

In `run_feeds_ingest`, compute the cutoff once, right after the `sources` is resolved:

```python
    if sources is None:
        sources = feed_sources(recency_days)
    cutoff = datetime.now(UTC) - timedelta(days=recency_days)
    feeds_processed = 0
```

Apply the gate immediately after parsing each feed (line ~142), changing:

```python
                entries = parse_feed(source.name, resp.content)
```

to:

```python
                entries = parse_feed(source.name, resp.content)
                entries = drop_stale(entries, cutoff=cutoff)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/news/test_fetcher.py::test_stale_dated_entries_dropped_keeping_recent_and_undated`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `task test`
Expected: PASS (existing tests unaffected — their `_run` default window is ~100 years).

- [ ] **Step 6: Checkpoint (orchestrator commits)**

```bash
task format && git add -A && git commit -m "feat: drop stale-dated feed entries past the recency window"
```

---

## Wrap-up

- [ ] **Run the full CI gate locally**

Run: `task format && task test && task lint && task typecheck`
Expected: all green. (No Alembic step — no schema change.)

- [ ] **Open the single PR for NEU-283**

Use `/commit-msg` (if squashing) and `/pr-desc`. PR title carries the Linear ID parenthetical, e.g. `feat: add feed recency hygiene (when:Nd + published_at gate) (NEU-283)`. Push the branch and open the PR against `main`.

---

## Self-Review (author check)

- **Spec coverage:** ✅ `FEED_RECENCY_DAYS` setting (T1); Google `when:Nd` builder (T3); pure `drop_stale` gate keeping null-dated (T2 + wired T4); trigger wiring (T3); unit + integration tests (T2/T3/T4); out-of-scope items unchanged (no linker-window edit, no backfill, NEU-287 is separate). The empirical `when:Nd` validation is recorded in the spec, not re-run here.
- **Placeholder scan:** ✅ none — every code/test step has full content.
- **Type consistency:** ✅ `feed_sources(recency_days: int) -> tuple[FeedSource, ...]`, `drop_stale(entries, *, cutoff) -> list[StoryEntry]`, and `run_feeds_ingest(..., recency_days: int, sources: Sequence[FeedSource] | None = None)` are used identically everywhere they appear (builder, fetcher, trigger, tests).
