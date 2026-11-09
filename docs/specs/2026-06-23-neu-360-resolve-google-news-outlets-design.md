# NEU-360 — Resolve Google News sources to real outlets

- **Ticket:** [NEU-360](https://linear.app/neuroticsasquatch/issue/NEU-360/backend-resolve-google-news-source-urls-to-actual-outlets) `[backend]`
- **Project / milestone:** Movies: Content Quality / MVP Quality Bar
- **Blocks:** NEU-361 (cap per-event source citations at 3–4 — needs real outlet names to dedupe-by-outlet)
- **Branch:** `tom/neu-360-backend-resolve-google-news-source-urls-to-actual-outlets`
- **Shape:** single backend PR

## Problem

Stories discovered via Google News RSS are stored with the *feed name* as `story.source` — for per-film search that is the constant `"Google News: per-film"` (`news/feeds.py:55`), and for the four broad queries it is `"Google News: casting"`, `"Google News: release date"`, `"Google News: trailer"`, `"Google News: greenlight"` (`news/feeds.py:39`). Google News is a search aggregator, not a publication. That label flows straight through `public/service.py` → `SourceOut.source` → the UI, so an event renders:

```
Google News: per-film
Google News: per-film
... (×19)
```

instead of the actual outlets (Deadline, Variety, The Hollywood Reporter, …).

Trade-feed stories (Deadline, Variety, THR, Collider, /Film, Empire, ScreenRant) already store a clean publication name in `story.source`, so they are **not** affected.

## Goal

For stories sourced via Google News, display the actual publisher. Acquire it with **zero extra network calls** by reading the publisher feedparser already parses out of each RSS item, with a title-suffix fallback. Resolution failures degrade gracefully to the existing label.

This unblocks NEU-361, which dedupes by outlet and caps the source list — impossible while every citation reads "Google News: …".

## Key decisions (settled in brainstorming)

1. **Storage = new `Story.outlet` column, resolved at ingest** (not derive-on-read). Reads become a trivial `story.outlet or story.source`; NEU-361 gets a stable field to dedupe on; resolution cost is paid once at ingest.
2. **Scope = all five Google News sources**, gated by the `"Google News:"` prefix — not only per-film. The broad-query feeds have the identical problem and the identical RSS shape. Trade feeds are deliberately untouched.
3. **Backfill existing rows** via the pure title-suffix parser inside the migration (no network, deterministic). Existing `raw` predates the `<source>` capture, so backfill is title-suffix only.
4. **No URL-redirect-following.** Google encodes `news.google.com/rss/articles/…` redirects (since ~2024); `httpx` `follow_redirects` will not reliably reach the publisher. Not implemented, not even as a runtime last resort.
5. **Verbatim outlet string.** Store `entry.source.title` as-is. Normalization / dedupe / capping belong to NEU-361.

## Design

### Pure resolver — new module `src/upmovies/news/outlet.py`

Two pure, independently testable functions:

```python
def outlet_from_title(title: str) -> str | None:
    """'Headline - Publisher' -> 'Publisher'. Takes the last ' - ' segment.
    Returns None when there is no separator or the trailing segment is empty."""
    _head, sep, tail = title.rpartition(" - ")
    if not sep:
        return None
    return tail.strip() or None


def outlet_from_entry(entry) -> str | None:
    """Prefer the RSS <source> element (entry.source.title); fall back to the
    title suffix. `entry` is a feedparser entry (dict-like)."""
    src = (entry.get("source") or {}).get("title")
    if isinstance(src, str) and src.strip():
        return src.strip()
    return outlet_from_title(entry.get("title", ""))
```

`outlet_from_title` is shared by `outlet_from_entry` (as its fallback) and by the migration backfill (which only has the stored `title`).

### Aggregator predicate — `src/upmovies/news/feeds.py`

So the gate is defined once rather than as a scattered string literal:

```python
def is_google_source(name: str) -> bool:
    return name.startswith("Google News:")
```

This matches all five Google labels (per-film + four broad queries).

### Capture at ingest — `src/upmovies/news/fetcher.py`

- `StoryEntry` gains `outlet: str | None`.
- `_RAW_KEYS` gains `"source"` so new rows also retain the raw `<source>` element in `raw` JSONB — cheap insurance for a future re-resolve. The `outlet` column remains the source of truth.
- `parse_feed` resolves the outlet **only when `is_google_source(source)`**; trade-feed entries get `outlet=None` (their `source` already *is* the outlet, and gating prevents the title-suffix parser mangling a legitimate trade headline that happens to contain `" - "`, e.g. `"Dune: Part Three - Everything We Know"`).
- `upsert_stories` writes the new `outlet` value into the INSERT. The statement is already `ON CONFLICT DO NOTHING` on `url`, so `outlet` is written exactly once at insert — no update-set / re-resolution concern.

### Schema + migration

- Model: `outlet: Mapped[str | None] = mapped_column(Text, nullable=True)` on `Story` (schema `news`). **No index** — NEU-361 reads `outlet` in memory off already-loaded rows, not as a query filter.
- Alembic migration:
  1. `add_column` `news.story.outlet TEXT NULL`.
  2. **Python-driven backfill** (mirrors the NEU-308 slug-backfill pattern of reusing a pure helper): select `(id, title)` where `source LIKE 'Google News:%' AND outlet IS NULL`, compute `outlet_from_title(title)`, and bulk-update the non-NULL results. Order is irrelevant (no uniqueness on the column). Rows whose title has no parseable suffix stay NULL and keep the old label.

### Read / display — `src/upmovies/public/service.py`

The DTO is unchanged: `SourceOut.source` keeps its name and type; it now simply carries the resolved outlet. **No frontend changes** — the FE already renders `source`.

A single shared helper holds the fallback rule:

```python
def outlet_label(story: Story) -> str:
    return story.outlet or story.source
```

Both source-assembly sites — the feed feed (`service.py:125`) and the film-detail timeline (`service.py:213`) — call `source=outlet_label(story)`. A NULL `outlet` (trade feeds, or a Google row whose suffix was unparseable) falls back to `story.source`.

## Testing (TDD)

Inside-out:

- **`outlet.py` units:** `<source>` present → its title; `<source>` absent → title suffix; multiple `" - "` → last segment; no separator → None; empty / whitespace-only → None; non-string `entry.source`/`title` guarded.
- **`feeds.is_google_source`:** true for all five Google labels (incl. broad queries), false for every trade-feed name.
- **`parse_feed`:** Google entry with `<source>` → outlet set from the element; Google entry without `<source>` but `"Headline - Publisher"` title → outlet from suffix; trade-feed entry → `outlet is None`.
- **`upsert_stories`:** persists the `outlet` column value.
- **Migration backfill:** the pure helper over representative titles — Google rows backfilled, trade rows untouched, unparseable → NULL.
- **`public/service.py`:** `outlet` set → `SourceOut.source` equals the outlet; `outlet` NULL → falls back to `story.source`. Assert at **both** the feed and film-detail sites.

## Acceptance criteria (ticket) → coverage

- *Stories sourced via Google News display the resolved outlet name, not "Google News: per-film".* → `outlet` resolved at ingest for all `Google News:` sources + migration backfill for existing rows; `outlet_label` surfaces it.
- *Resolution prefers the RSS `<source>` element (no network); the title `" - Publisher"` suffix is a fallback; URL-following is a last resort.* → `outlet_from_entry` order; URL-following intentionally **not** implemented (see decision 4).
- *Failure to resolve falls back gracefully.* → `outlet_label` returns `story.source` when `outlet` is NULL.

## Out of scope

- **Outlet normalization, dedupe, and capping** → NEU-361 (this ticket blocks it). NEU-360 stores `entry.source.title` verbatim.
- **Making the click-through link land on the publisher** — the stored `url` stays the Google redirect; the ticket flags this as a separate, harder problem.
- **URL-redirect-following** to resolve outlets — fragile, not implemented.
- **Storing `entry.source.href`** (outlet homepage) — YAGNI; display needs only the name.
