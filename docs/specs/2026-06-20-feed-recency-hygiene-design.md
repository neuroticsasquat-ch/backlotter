# Feed Recency Hygiene — Design

- **Date:** 2026-06-20
- **Status:** Approved (pending implementation)
- **Component:** `upcoming-movies-backend` — `news` feeds pipeline (`feeds.py`, `fetcher.py`)
- **Linear:** project *Movies: Ingestion & Feeds*; ticket NEU-283
- **Surfaced during:** the Entity Linking spike — [2026-06-19-entity-linking-clustering-design.md](2026-06-19-entity-linking-clustering-design.md)

## What this is

Source-side recency hygiene for the feeds pipeline. Old/evergreen articles currently land
in `news.story` (the corpus has stories dated back to 2015) because Google News
relevance-ranks and resurfaces them, and the trade RSS feeds recirculate evergreen content.

This is **corpus hygiene, not a linking fix** — the link step already windows by
`coalesce(published_at, fetched_at) >= cutoff`, so stale stories never get linked. The goal
is a cleaner `news.story` table (and a cleaner validation-set export), achieved with two
complementary filters driven by one knob.

## The knob

A single env setting is the source of truth for both filters:

```python
feed_recency_days: int = Field(default=14, alias="FEED_RECENCY_DAYS")
```

**Why 14:** tight enough to keep the corpus lean; the daily cron gives a comfortable buffer
(a 14-day window tolerates ~13 days of missed runs before data is lost). It is deliberately
*tighter* than the linker's `link_recency_days=45` — the stored dated corpus simply becomes
a subset of what the link step considers. The linker window is **not** changed by this work
(see Out of scope).

## Empirical validation of `when:Nd` (ticket prerequisite)

The ticket requires validating the Google News `when:Nd` operator empirically before relying
on it. Probed live against `news.google.com/rss/search?q=movie trailer` (same httpx +
feedparser path as prod) on 2026-06-20:

| Query | entries | undated | max article age | older than 30d |
|---|---|---|---|---|
| `movie trailer` (no operator) | 102 | 0 | **94 days** | 2 |
| `movie trailer when:7d` | 100 | 0 | 5 days | 0 |
| `movie trailer when:14d` | 100 | 0 | 11 days | 0 |
| `movie trailer when:30d` | 100 | 0 | 25 days | 0 |

**Conclusions:** (1) `when:Nd` is a hard, reliable upper bound on article age. (2) Without it,
Google resurfaces a long evergreen tail (up to 94 days). (3) Every Google News entry is dated
(`undated=0`), so `when:Nd` is the effective lever for that source; the null-dated safety net
in the fetcher gate matters mainly for the trade RSS feeds.

## Design

One env knob (`FEED_RECENCY_DAYS`, default 14) feeds two filters.

### 1. Config — `src/upmovies/config.py`

Add a "feed ingestion" field:

```python
feed_recency_days: int = Field(default=14, alias="FEED_RECENCY_DAYS")
```

### 2. Google News `when:Nd` — `src/upmovies/news/feeds.py`

The four Google queries must carry `when:{N}d`, built from the configured window — so the
static `FEED_SOURCES` tuple becomes a small builder. Trade RSS/Atom feeds stay static:

```python
_TRADE_FEEDS: tuple[FeedSource, ...] = (
    FeedSource("Deadline", "https://deadline.com/feed/"),
    ...  # unchanged
)
_GOOGLE_QUERIES: tuple[tuple[str, str], ...] = (
    ("Google News: casting", "movie casting"),
    ("Google News: release date", "movie release date"),
    ("Google News: trailer", "movie trailer"),
    ("Google News: greenlight", "movie greenlight"),
)

def feed_sources(recency_days: int) -> tuple[FeedSource, ...]:
    google = tuple(
        FeedSource(name, _google_news(f"{q} when:{recency_days}d"))
        for name, q in _GOOGLE_QUERIES
    )
    return _TRADE_FEEDS + google
```

### 3. `published_at` gate — `src/upmovies/news/fetcher.py`

A pure, unit-testable helper applied between `parse_feed` and `upsert_stories`. Null-dated
entries always pass (safety net):

```python
def drop_stale(entries: Sequence[StoryEntry], *, cutoff: datetime) -> list[StoryEntry]:
    return [e for e in entries if e.published_at is None or e.published_at >= cutoff]
```

`run_feeds_ingest` changes:
- Gains a required keyword arg `recency_days: int`.
- `sources` default becomes `None`; when omitted, build `sources = feed_sources(recency_days)`.
- Compute `cutoff = datetime.now(UTC) - timedelta(days=recency_days)` once, up front.
- After parsing each feed: `entries = drop_stale(entries, cutoff=cutoff)` before upsert.

(`timedelta` is added to the existing `datetime`/`UTC` import.)

### 4. Wiring — `src/upmovies/routers/ingest_admin.py`

`_background_feeds` (which already receives `settings`) passes
`recency_days=settings.feed_recency_days` into `run_feeds_ingest`.

## Data flow

```
fetch feed → parse_feed (pure) → drop_stale(cutoff) → upsert_stories (ON CONFLICT DO NOTHING)
                                       ▲
Google queries pre-filtered at source via when:Nd; gate is the universal post-filter
(authoritative for the trade RSS feeds, which have no when operator).
```

## Testing

- **Unit** (`tests/unit/news/`):
  - `drop_stale`: keeps null-dated, keeps `published_at >= cutoff`, drops `published_at < cutoff`.
  - `feed_sources(14)`: each Google URL contains the (url-encoded) `when:14d` operator; trade
    feeds carry no `when` operator and are returned unchanged.
- **Integration** (`tests/integration/news/test_fetcher.py`):
  - Add the now-required `recency_days=` to the existing `run_feeds_ingest` call.
  - New case: a feed carrying one stale-dated, one recent-dated, and one null-dated entry →
    only the stale one is dropped; recent + null-dated are inserted.
- Confirm the monkeypatched fake pipeline in
  `tests/integration/routers/test_ingest_admin.py` tolerates the new `recency_days` kwarg.

CI gate before done: `task test`, `task lint`, `task typecheck`, `task format` all green.

## Out of scope (follow-ups)

- **Linker window unchanged.** `link_recency_days=45` stays as-is; a 14-day feed gate makes
  the dated corpus a subset of the link window. Tightening the link window is a separate
  decision.
- **Per-film targeted fetching → its own spike.** Replacing the broad Google queries with
  one query per tracked film (from the catalog roster) is an architecture change — ~216
  requests/run to an undocumented endpoint (rate-limit/block risk), couples `news` → `catalog`
  at fetch time, and still relies on the linker for precision. It buys guaranteed per-film
  recall and a leaner corpus. Captured as a separate Linear ticket in the *Ingestion & Feeds*
  project; the fetcher gate here ships regardless (the trade-feed firehoses always need it).
- **No backfill.** This filters new ingests only; existing stale rows in `news.story` are left
  as-is (harmless — the linker already ignores them).
