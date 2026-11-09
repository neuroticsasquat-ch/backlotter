# Resolve Google News Sources to Real Outlets (NEU-360) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the real publisher (Deadline, Variety, …) for stories ingested via Google News, instead of the aggregator label "Google News: per-film".

**Architecture:** A pure resolver reads the publisher from each Google News RSS item's `<source>` element (feedparser `entry.source.title`), falling back to the `"Headline - Publisher"` title suffix. The result is captured at ingest into a new nullable `Story.outlet` column; reads display `story.outlet or story.source`. A one-time migration backfills existing rows from their stored title. No network calls; Google's encoded redirect URLs are never followed.

**Tech Stack:** Python 3.13, async SQLAlchemy 2.0, Alembic, feedparser, httpx, Pydantic, pytest (+ respx), ruff, pyright. Docker-only local dev driven by `task` (go-task).

## Global Constraints

- **Single backend PR.** Branch: `tom/neu-360-backend-resolve-google-news-source-urls-to-actual-outlets`.
- **Modern type hints** `X | None` / `X | Y`; **no** `from __future__ import annotations`.
- **Zero extra network calls.** Resolution uses only data already in the parsed feed. URL-redirect-following is **not** implemented.
- **Store the outlet verbatim** (`entry.source.title` as-is). Normalization / dedupe / capping belong to NEU-361 — out of scope here.
- **Scope = all Google News sources**, matched by the `"Google News:"` name prefix (per-film + the four broad queries). Trade-feed rows are left untouched (their `source` is already the outlet).
- **All commands run in Docker via `task`:** tests `task test -- <args>`; format `task format`; lint `task lint`; types `task typecheck` (pyright); migrations `task makemigration -- "<msg>"` and `task migrate`. Keep the container up.
- **Commits:** Per the user's subagent-driven workflow, **implementer tasks do NOT commit** — each task ends at green tests. The user makes a **single commit + PR at the end** (see "Final Verification & Wrap-Up"). Pre-commit hooks delegate into Docker, so the final commit runs normally (no `--no-verify`), after `task format`.
- **The integration test DB is built from `Base.metadata.create_all`** (see `tests/conftest.py`), not from migrations — so integration tests exercise the model column; the migration is validated separately.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/upmovies/news/outlet.py` *(new)* | Pure outlet resolution: `outlet_from_title`, `outlet_from_entry`. No I/O, no DB. |
| `tests/unit/news/test_outlet.py` *(new)* | Unit tests for the resolver. |
| `src/upmovies/news/feeds.py` *(modify)* | Add `is_google_source(name)` predicate. |
| `tests/unit/news/test_feeds.py` *(modify)* | Test the predicate. |
| `src/upmovies/news/models.py` *(modify)* | Add nullable `Story.outlet` column. |
| `migrations/versions/<rev>_add_news_story_outlet.py` *(new)* | Add the column + title-suffix backfill of existing Google rows. |
| `tests/integration/news/test_story_outlet.py` *(new)* | Round-trip the `outlet` column. |
| `src/upmovies/news/fetcher.py` *(modify)* | `StoryEntry.outlet`, `_RAW_KEYS += "source"`, gated resolve in `parse_feed`, write `outlet` in `upsert_stories`. |
| `tests/unit/news/test_fetcher.py` *(modify)* | `parse_feed` outlet capture + gating. |
| `tests/integration/news/test_fetcher.py` *(modify)* | DB round-trip of `outlet` + `raw["source"]`. |
| `src/upmovies/public/service.py` *(modify)* | `outlet_label(story)` helper + both source-assembly call sites. |
| `tests/fixtures/public.py` *(modify)* | `add_event` fixture accepts `outlet` per source. |
| `tests/unit/public/test_service.py` *(new)* | Unit-test `outlet_label`. |
| `tests/integration/routers/test_public_feed.py` *(modify)* | Feed route surfaces resolved outlet. |
| `tests/integration/routers/test_public_films.py` *(modify)* | Film-detail route surfaces resolved outlet. |

---

## Task 1: Pure outlet resolver

**Files:**
- Create: `src/upmovies/news/outlet.py`
- Test: `tests/unit/news/test_outlet.py`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `outlet_from_title(title: str) -> str | None`
  - `outlet_from_entry(entry: Any) -> str | None` (`entry` is a feedparser entry, dict-like)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/news/test_outlet.py`:

```python
from upmovies.news.outlet import outlet_from_entry, outlet_from_title


def test_outlet_from_title_takes_trailing_segment():
    assert outlet_from_title("Big Movie Casts a Star - Deadline") == "Deadline"


def test_outlet_from_title_uses_last_separator():
    assert outlet_from_title("Dune: Part Three - Everything We Know - Variety") == "Variety"


def test_outlet_from_title_none_without_separator():
    assert outlet_from_title("No separator in this headline") is None


def test_outlet_from_title_none_on_empty_trailing_segment():
    assert outlet_from_title("Trailing dash - ") is None


def test_outlet_from_entry_prefers_source_element_over_title():
    entry = {"source": {"title": "The Hollywood Reporter"}, "title": "Headline - Wrong Name"}
    assert outlet_from_entry(entry) == "The Hollywood Reporter"


def test_outlet_from_entry_strips_whitespace_from_source():
    entry = {"source": {"title": "  Collider  "}}
    assert outlet_from_entry(entry) == "Collider"


def test_outlet_from_entry_falls_back_to_title_suffix_when_source_empty():
    entry = {"source": {}, "title": "Sequel Greenlit - Variety"}
    assert outlet_from_entry(entry) == "Variety"


def test_outlet_from_entry_uses_title_when_source_missing():
    entry = {"title": "Casting News - Deadline"}
    assert outlet_from_entry(entry) == "Deadline"


def test_outlet_from_entry_none_when_unresolvable():
    entry = {"source": {}, "title": "No outlet anywhere"}
    assert outlet_from_entry(entry) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/news/test_outlet.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.news.outlet'`

- [ ] **Step 3: Write the resolver**

Create `src/upmovies/news/outlet.py`:

```python
"""Resolve the real publisher name for Google News stories.

Google News RSS items carry the actual outlet in their `<source>` element, which
feedparser exposes as `entry.source.title`. When that is absent, the item title
arrives as "Headline - Publisher" and the trailing segment is the outlet. Both
paths are zero-network — we never follow the (encoded, fragile) Google redirect URL.
"""

from typing import Any


def outlet_from_title(title: str) -> str | None:
    """Extract the publisher from a "Headline - Publisher" Google News title.

    Splits on the LAST " - " so headlines containing earlier dashes still resolve to
    the trailing publisher. Returns None when there is no separator or the trailing
    segment is empty/whitespace.
    """
    _head, sep, tail = title.rpartition(" - ")
    if not sep:
        return None
    return tail.strip() or None


def outlet_from_entry(entry: Any) -> str | None:
    """Resolve a Google News item's outlet: prefer the RSS `<source>` element
    (`entry.source.title`), then fall back to the title suffix. `entry` is a
    feedparser entry (dict-like)."""
    source = entry.get("source")
    name = source.get("title") if isinstance(source, dict) else None
    if isinstance(name, str) and name.strip():
        return name.strip()
    return outlet_from_title(entry.get("title") or "")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/news/test_outlet.py -v`
Expected: PASS (8 passed)

---

## Task 2: `Story.outlet` column + migration

**Files:**
- Modify: `src/upmovies/news/models.py` (the `Story` class, after the `source` column ~line 39)
- Create: `migrations/versions/<rev>_add_news_story_outlet.py` (generated, then hand-edited)
- Test: `tests/integration/news/test_story_outlet.py`

**Interfaces:**
- Consumes: `outlet_from_title` (Task 1), used by the migration backfill.
- Produces: `Story.outlet: Mapped[str | None]` — nullable `Text`, no index.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/news/test_story_outlet.py`:

```python
from sqlalchemy import select

from upmovies.news.models import Story


async def test_story_outlet_column_roundtrips(session):
    session.add(
        Story(
            source="Google News: per-film",
            url="https://news.example/x",
            title="Headline - Deadline",
            outlet="Deadline",
        )
    )
    await session.commit()
    loaded = (
        await session.execute(select(Story).where(Story.url == "https://news.example/x"))
    ).scalar_one()
    assert loaded.outlet == "Deadline"


async def test_story_outlet_defaults_to_none(session):
    session.add(Story(source="Deadline", url="https://deadline.com/y", title="Trade story"))
    await session.commit()
    loaded = (
        await session.execute(select(Story).where(Story.url == "https://deadline.com/y"))
    ).scalar_one()
    assert loaded.outlet is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/news/test_story_outlet.py -v`
Expected: FAIL — `TypeError: 'outlet' is an invalid keyword argument for Story`

- [ ] **Step 3: Add the model column**

In `src/upmovies/news/models.py`, inside `class Story`, add the `outlet` column immediately after the `source` column:

```python
    source: Mapped[str] = mapped_column(Text, nullable=False)
    outlet: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/integration/news/test_story_outlet.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Generate the migration**

Run: `task makemigration -- "add news.story.outlet"`
This autogenerates `migrations/versions/<rev>_add_news_story_outlet.py` containing an `op.add_column(...)` for `news.story.outlet`.

- [ ] **Step 6: Hand-edit the migration to add the backfill**

Open the generated file. Confirm `down_revision = 'fc07fca34f59'` (the current head — this keeps a single linear head). Replace the `upgrade()`/`downgrade()` bodies so they read exactly:

```python
def upgrade() -> None:
    op.add_column("story", sa.Column("outlet", sa.Text(), nullable=True), schema="news")

    # Backfill existing Google News rows from the title suffix. Their stored `raw`
    # predates `<source>` capture, so the suffix is all we have. Reuses the same pure
    # helper the live ingest path is built on. Trade-feed rows are left NULL — their
    # `source` is already the outlet, so the read path falls back to it.
    from upmovies.news.outlet import outlet_from_title

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, title FROM news.story "
            "WHERE source LIKE 'Google News:%' AND outlet IS NULL"
        )
    ).fetchall()
    for row in rows:
        outlet = outlet_from_title(row.title)
        if outlet is not None:
            bind.execute(
                sa.text("UPDATE news.story SET outlet = :outlet WHERE id = :id"),
                {"outlet": outlet, "id": row.id},
            )


def downgrade() -> None:
    op.drop_column("story", "outlet", schema="news")
```

Ensure `from alembic import op` and `import sqlalchemy as sa` are present at the top (autogenerate adds them).

- [ ] **Step 7: Apply and verify the migration**

Run: `task migrate`
Expected: `Running upgrade fc07fca34f59 -> <rev>, add news.story.outlet` with no errors. (This applies to the localdev DB and backfills its existing Google News rows — the intended effect.)

Spot-check the backfill in your DB tool (psql / IDE) — should list real publication names, not "Google News: per-film":
```sql
SELECT outlet, count(*) FROM news.story
WHERE source LIKE 'Google News:%' AND outlet IS NOT NULL
GROUP BY outlet ORDER BY count DESC LIMIT 10;
```
Expected: real outlet names (Deadline, Variety, …) with non-trivial counts.

---

## Task 3: Capture the outlet at ingest

**Files:**
- Modify: `src/upmovies/news/feeds.py` (add `is_google_source`)
- Modify: `src/upmovies/news/fetcher.py` (`StoryEntry`, `_RAW_KEYS`, `parse_feed`, `upsert_stories`, imports)
- Modify: `tests/unit/news/test_feeds.py` (predicate test)
- Modify: `tests/unit/news/test_fetcher.py` (`parse_feed` outlet capture)
- Modify: `tests/integration/news/test_fetcher.py` (DB round-trip)

**Interfaces:**
- Consumes: `outlet_from_entry` (Task 1), `Story.outlet` column (Task 2).
- Produces:
  - `feeds.is_google_source(name: str) -> bool`
  - `StoryEntry.outlet: str | None` (the persisted resolved outlet for Google rows, else `None`)

- [ ] **Step 1: Write the failing predicate test**

In `tests/unit/news/test_feeds.py`, add (and extend the import line to include `is_google_source`):

```python
from upmovies.news.feeds import feed_sources, is_google_source, per_film_google_sources


def test_is_google_source_matches_all_google_labels():
    assert is_google_source("Google News: per-film") is True
    assert is_google_source("Google News: casting") is True
    assert is_google_source("Google News: release date") is True
    assert is_google_source("Google News: trailer") is True
    assert is_google_source("Google News: greenlight") is True


def test_is_google_source_false_for_trade_feeds():
    assert is_google_source("Deadline") is False
    assert is_google_source("The Hollywood Reporter") is False
    assert is_google_source("/Film") is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `task test -- tests/unit/news/test_feeds.py -v`
Expected: FAIL — `ImportError: cannot import name 'is_google_source'`

- [ ] **Step 3: Add the predicate**

In `src/upmovies/news/feeds.py`, add after the `_PER_FILM_SOURCE` constant:

```python
def is_google_source(name: str) -> bool:
    """True for any Google News feed name (per-film search + the broad queries).
    These are aggregator labels whose stories need outlet resolution."""
    return name.startswith("Google News:")
```

- [ ] **Step 4: Run to verify it passes**

Run: `task test -- tests/unit/news/test_feeds.py -v`
Expected: PASS

- [ ] **Step 5: Write the failing `parse_feed` tests**

In `tests/unit/news/test_fetcher.py`, add the import and a feed-builder helper plus three tests:

```python
from upmovies.news.fetcher import _looks_blocked, parse_feed


def _google_item(title: str, url: str, *, outlet: str | None) -> str:
    source_el = f'<source url="https://example.com">{outlet}</source>' if outlet else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0"><channel><title>Google News</title>'
        f"<item><title>{title}</title><link>{url}</link>{source_el}</item>"
        "</channel></rss>"
    )


def test_parse_feed_resolves_outlet_from_source_element():
    feed = _google_item("Spidey Lands Director - Variety", "https://news.example/a", outlet="Deadline")
    entries = parse_feed("Google News: per-film", feed)
    assert entries[0].outlet == "Deadline"  # <source> wins over the title suffix


def test_parse_feed_resolves_outlet_from_title_when_no_source_element():
    feed = _google_item("Spidey Lands Director - Variety", "https://news.example/b", outlet=None)
    entries = parse_feed("Google News: per-film", feed)
    assert entries[0].outlet == "Variety"


def test_parse_feed_leaves_outlet_none_for_trade_feeds():
    feed = _google_item("Some Headline - Deadline", "https://news.example/c", outlet="Deadline")
    entries = parse_feed("Deadline", feed)
    assert entries[0].outlet is None  # trade feeds keep their clean source label
```

- [ ] **Step 6: Run to verify they fail**

Run: `task test -- tests/unit/news/test_fetcher.py -v`
Expected: FAIL — `TypeError: StoryEntry.__init__() got an unexpected keyword argument 'outlet'` (or `AttributeError: 'StoryEntry' object has no attribute 'outlet'`)

- [ ] **Step 7: Wire outlet capture into the fetcher**

In `src/upmovies/news/fetcher.py`:

(a) Extend the feeds import to include `is_google_source` and add the resolver import:

```python
from upmovies.news.feeds import (
    FeedSource,
    feed_sources,
    is_google_source,
    per_film_google_sources,
)
from upmovies.news.outlet import outlet_from_entry
```

(b) Add `"source"` to `_RAW_KEYS`:

```python
_RAW_KEYS = ("title", "link", "summary", "published", "updated", "id", "author", "source")
```

(c) Add the `outlet` field to `StoryEntry` (after `published_at`):

```python
@dataclass
class StoryEntry:
    source: str
    url: str
    title: str
    published_at: datetime | None
    outlet: str | None
    raw: dict[str, Any]
```

(d) In `parse_feed`, compute the gate once and set `outlet` on each entry:

```python
def parse_feed(source: str, content: str | bytes) -> list[StoryEntry]:
    """Parse one feed's body into normalized entries. Tolerant of junk — feedparser
    returns no entries for unparseable content rather than raising. Entries missing a
    url or title are dropped (both are NOT NULL, and url is the dedupe key)."""
    parsed = feedparser.parse(content)
    resolve_outlet = is_google_source(source)
    entries: list[StoryEntry] = []
    for entry in parsed.entries:
        url = entry.get("link")
        title = entry.get("title")
        if not isinstance(url, str) or not isinstance(title, str) or not url or not title:
            continue
        entries.append(
            StoryEntry(
                source=source,
                url=url,
                title=title,
                published_at=_published_at(entry),
                outlet=outlet_from_entry(entry) if resolve_outlet else None,
                raw={k: entry[k] for k in _RAW_KEYS if k in entry},
            )
        )
    return entries
```

(e) In `upsert_stories`, add `outlet` to the values dict:

```python
    values = [
        {
            "source": e.source,
            "url": e.url,
            "title": e.title,
            "published_at": e.published_at,
            "outlet": e.outlet,
            "raw": e.raw,
        }
        for e in by_url.values()
    ]
```

- [ ] **Step 8: Run the unit tests to verify they pass**

Run: `task test -- tests/unit/news/test_fetcher.py tests/unit/news/test_feeds.py -v`
Expected: PASS

- [ ] **Step 9: Write the failing DB round-trip test**

In `tests/integration/news/test_fetcher.py`, add (reusing the file's existing `_xml`, `_stories`, `_seed_films`, `_run_pf` helpers and `per_film_google_sources` import):

```python
@respx.mock
async def test_per_film_story_persists_outlet_and_raw_source(session):
    await _seed_films(session, ["Spider-Man"])
    pf = per_film_google_sources(["Spider-Man"], 36500)[0]
    feed = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0"><channel><title>Google News</title>'
        "<item><title>Spidey Lands Director - Deadline</title>"
        "<link>https://news.example/spidey</link>"
        '<source url="https://deadline.com">Deadline</source></item>'
        "</channel></rss>"
    )
    respx.get(pf.url).mock(return_value=_xml(feed))

    await _run_pf(session, [])  # no Phase-A feeds, per-film only

    stories = await _stories(session)
    assert len(stories) == 1
    assert stories[0].outlet == "Deadline"
    # `<source>` is retained in raw JSONB (round-trips through Postgres cleanly).
    assert stories[0].raw["source"]["title"] == "Deadline"
```

- [ ] **Step 10: Run to verify it passes**

Run: `task test -- tests/integration/news/test_fetcher.py -v`
Expected: PASS (all existing tests in the file + the new one)

---

## Task 4: Resolve the outlet on read

**Files:**
- Modify: `src/upmovies/public/service.py` (add `outlet_label`, change both `SourceOut` call sites at ~line 125 and ~line 213)
- Modify: `tests/fixtures/public.py` (`add_event` accepts `outlet`)
- Create: `tests/unit/public/test_service.py`
- Modify: `tests/integration/routers/test_public_feed.py`
- Modify: `tests/integration/routers/test_public_films.py`

**Interfaces:**
- Consumes: `Story.outlet` (Task 2).
- Produces: `public.service.outlet_label(story: Story) -> str` — the display label (`story.outlet or story.source`).

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/public/test_service.py`:

```python
from upmovies.news.models import Story
from upmovies.public.service import outlet_label


def _story(*, outlet: str | None, source: str) -> Story:
    return Story(source=source, url="https://x", title="t", outlet=outlet)


def test_outlet_label_prefers_resolved_outlet():
    assert outlet_label(_story(outlet="Deadline", source="Google News: per-film")) == "Deadline"


def test_outlet_label_falls_back_to_source_when_outlet_none():
    assert outlet_label(_story(outlet=None, source="Deadline")) == "Deadline"
```

- [ ] **Step 2: Run to verify it fails**

Run: `task test -- tests/unit/public/test_service.py -v`
Expected: FAIL — `ImportError: cannot import name 'outlet_label' from 'upmovies.public.service'`

- [ ] **Step 3: Add the helper and wire both call sites**

In `src/upmovies/public/service.py`, add a module-level helper (place it near the top, after the imports):

```python
def outlet_label(story: Story) -> str:
    """Display label for a source: the resolved publisher when present (Google News
    rows), otherwise the stored `source` (trade feeds, or unresolved rows)."""
    return story.outlet or story.source
```

Then change **both** `SourceOut` constructions — the film-detail builder (~line 125) and the feed builder (~line 213) — from:

```python
                    source=story.source,
```

to:

```python
                    source=outlet_label(story),
```

(Both occurrences become `source=outlet_label(story),`. Indentation differs between the two sites — match each site's existing indentation.)

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `task test -- tests/unit/public/test_service.py -v`
Expected: PASS

- [ ] **Step 5: Extend the `add_event` fixture to carry `outlet`**

In `tests/fixtures/public.py`, in the `add_event` fixture's `Story(...)` construction, add the `outlet` kwarg:

```python
            story = Story(
                source=src.get("source", "Deadline"),
                url=src["url"],
                title=src.get("title", "Story title"),
                published_at=src.get("published_at"),
                outlet=src.get("outlet"),
            )
```

(`src.get("outlet")` defaults to `None`, so every existing test is unaffected.)

- [ ] **Step 6: Write the failing integration tests**

In `tests/integration/routers/test_public_feed.py`, add:

```python
async def test_feed_source_label_uses_resolved_outlet(client, make_film, add_event):
    film = await make_film(slug="resolve-feed-2026")
    await add_event(
        film=film,
        summary="Casting.",
        sources=(
            {
                "url": "https://news.google.com/rss/articles/abc",
                "source": "Google News: per-film",
                "title": "Cast Revealed - Deadline",
                "outlet": "Deadline",
            },
            {
                "url": "https://variety.com/trade",
                "source": "Variety",
                "title": "Trade story",
                "outlet": None,
            },
        ),
    )

    item = (await client.get("/feed")).json()["items"][0]
    labels = {s["source"] for s in item["sources"]}
    assert labels == {"Deadline", "Variety"}  # google resolved; trade falls back to source
```

In `tests/integration/routers/test_public_films.py`, add (the film-detail endpoint is `GET /films/{slug}`; confirm the path against the other tests in the file and match them):

```python
async def test_film_detail_source_label_uses_resolved_outlet(client, make_film, add_event):
    film = await make_film(slug="resolve-film-2026")
    await add_event(
        film=film,
        summary="Casting.",
        sources=(
            {
                "url": "https://news.google.com/rss/articles/xyz",
                "source": "Google News: per-film",
                "title": "Director Set - Variety",
                "outlet": "Variety",
            },
        ),
    )

    body = (await client.get(f"/films/{film.slug}")).json()
    assert body["events"][0]["sources"][0]["source"] == "Variety"
```

- [ ] **Step 7: Run the integration tests to verify they pass**

Run: `task test -- tests/integration/routers/test_public_feed.py tests/integration/routers/test_public_films.py -v`
Expected: PASS (existing + new tests)

---

## Final Verification & Wrap-Up

- [ ] **Step 1: Format**

Run: `task format`

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: no errors.

- [ ] **Step 3: Type-check**

Run: `task typecheck`
Expected: no errors.

- [ ] **Step 4: Full test suite**

Run: `task test`
Expected: all pass.

- [ ] **Step 5: Confirm a single migration head**

Confirm the new migration's `down_revision = 'fc07fca34f59'` and that it is the only file whose `down_revision` points at `fc07fca34f59` (guarantees one linear head). `task migrate` from Task 2 already ran clean.

- [ ] **Step 6: Commit once and open the PR** *(user step)*

```bash
git add -A
git commit -m "feat(news): resolve Google News story sources to real outlets (NEU-360)"
git push -u origin tom/neu-360-backend-resolve-google-news-source-urls-to-actual-outlets
```

Open the PR with the `localdev:pr-desc` generator; title carries the Linear ID parenthetical; append the Claude Code footer to the PR body (not the commit).

---

## Self-Review (author)

**Spec coverage:**
- Resolver prefers `<source>` then title suffix, no URL-following → Task 1 (`outlet_from_entry` order); URL-following intentionally absent. ✓
- All five Google sources, trade feeds untouched → Task 3 (`is_google_source` prefix gate; `parse_feed` gating test). ✓
- New `Story.outlet` column at ingest → Tasks 2 + 3. ✓
- `_RAW_KEYS += "source"` retained in raw → Task 3 (round-trip test asserts `raw["source"]["title"]`). ✓
- Title-suffix backfill of existing rows in the migration → Task 2 (Step 6). ✓
- Read displays `outlet or source`, DTO/frontend unchanged → Task 4 (`outlet_label`, both call sites; `SourceOut` field name unchanged). ✓
- Graceful fallback on unresolved → Task 4 (fallback test) + Task 1 (`None` cases). ✓
- Out of scope (normalization/dedupe/cap, click-through URL, href) → not implemented; noted in constraints. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows an exact command + expected result. ✓

**Type consistency:** `outlet_from_title`/`outlet_from_entry` (Task 1) used verbatim in Tasks 2–3; `is_google_source` (Task 3) name consistent; `StoryEntry.outlet` and `Story.outlet` both `str | None`; `outlet_label(story)` signature consistent across definition, unit test, and call sites. ✓
