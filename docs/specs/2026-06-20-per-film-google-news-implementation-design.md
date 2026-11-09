# Per-film Google News Fetching (Hybrid) — Implementation Design

- **Date:** 2026-06-20
- **Status:** Approved (pending implementation)
- **Component:** `upcoming-movies-backend` — `news` feeds pipeline (`config.py`, `news/feeds.py`,
  `news/fetcher.py`, `routers/ingest_admin.py`)
- **Linear:** project *Movies: Ingestion & Feeds*; ticket NEU-288
- **Builds on:** [2026-06-20-per-film-google-news-spike.md](2026-06-20-per-film-google-news-spike.md)
  (NEU-287, the spike this implements), [2026-06-20-feed-recency-hygiene-design.md](2026-06-20-feed-recency-hygiene-design.md) (NEU-283)

## What this is

Add **per-film** targeted Google News queries *alongside* the four broad queries (a hybrid,
not a replacement). The NEU-287 spike established that the broad, ~100-result,
relevance-ranked queries structurally miss low-profile tracked films, while one targeted
query per roster film closes that tail-recall gap (empirically, films like *Lilo & Stitch 2*,
*The Truthers*, and *Ebenezer* surfaced under per-film queries but never under broad ones).
The head is already covered by the broad queries, so the marginal value is the mid/tail.

This is **fetch-side only**: precision remains the entity linker's job (per-film targeting
raises recall, not precision — common-word titles like `Runner`/`Dragon` still return noise
that only the linker filters). **Backend, one PR, no schema change.**

## Decisions

| Question | Decision |
|---|---|
| Replace vs. augment | **Hybrid** — trade RSS + the 4 broad Google queries stay exactly as-is; per-film is added. |
| Query form | **Unquoted** `<title> when:{recency}d`. Google News quoting is fuzzy relevance-matching, not strict phrase; unquoted maximizes recall and the linker owns precision. |
| Recency window | **Reuse `FEED_RECENCY_DAYS` (14).** A 2-day window has no cron buffer (one missed daily run = a permanent gap); URL-dedup (`ON CONFLICT DO NOTHING`) makes a wide window free. |
| Rollout | `FEEDS_PER_FILM_ENABLED` **default `true`** — adopt immediately; the flag is an instant kill switch. |
| Pacing | **Serialized, ~1 req/s** (`FEEDS_PER_FILM_THROTTLE_SECONDS` default `1.0`) ⇒ ≈ 6 min for the ~216-film roster — exactly the cadence the spike measured clean. |
| On block (4xx/captcha) | **Abort the per-film phase and finalize the run `failed`** (loud/observable). Stories already landed are kept. |
| `story.source` label | Constant **`"Google News: per-film"`** — keeps source analytics clean and the broad-vs-per-film split countable; the title lives in the (logged) query URL for debugging. |

## Config (`config.py`)

Two new env-aliased settings alongside the existing `feed_recency_days`:

```python
feeds_per_film_enabled: bool = Field(default=True, alias="FEEDS_PER_FILM_ENABLED")
feeds_per_film_throttle_seconds: float = Field(default=1.0, alias="FEEDS_PER_FILM_THROTTLE_SECONDS")
```

## Source construction (`news/feeds.py`)

`feed_sources(recency_days)` stays **pure and unchanged** (trade feeds + the 4 broad Google
queries). Add a sibling pure builder:

```python
_PER_FILM_SOURCE = "Google News: per-film"  # constant story.source for every per-film hit

def per_film_google_sources(
    titles: Sequence[str], recency_days: int
) -> tuple[FeedSource, ...]:
    return tuple(
        FeedSource(_PER_FILM_SOURCE, _google_news(f"{title} when:{recency_days}d"))
        for title in titles
    )
```

- **Unquoted** query string (no surrounding `"`), reusing the existing `_google_news()` URL
  builder (which `quote()`s the whole query, so the space and `when:` colon are encoded).
- Empty `titles` → empty tuple (no per-film work).

## Fetcher (`news/fetcher.py`)

`run_feeds_ingest` gains two keyword args, defaulted so existing callers/tests are
unaffected except the wrapper:

```python
async def run_feeds_ingest(
    *, session_factory, run_id, recency_days,
    per_film_enabled: bool = False,
    per_film_throttle: float = 1.0,
    sources: Sequence[FeedSource] | None = None,  # test override of the base feeds
    timeout: float = 30.0,
) -> FeedsIngestResult: ...
```

Within the single existing `httpx.AsyncClient` (same prod `User-Agent`, `follow_redirects`),
run **two phases**, then finalize once:

**Phase A — base feeds (unchanged).** Iterate the base sources (keeping today's
`sources is None → feed_sources(recency_days)` default) with per-feed isolation (one bad feed
increments `feeds_failed` and never aborts the run). Exactly today's loop.

**Phase B — per-film (new, only when `per_film_enabled`).**
1. Load titles via a lightweight query — `select(Film.title).order_by(Film.title)` (this is
   the deliberate `news` → `catalog` coupling; use the column query, **not** the heavier
   `link.roster.build_roster`, which pulls genres/overview we don't need).
2. `per_film = per_film_google_sources(titles, recency_days)`.
3. For each source, serialized: `GET`, then branch on the response (see Block detection),
   else `parse_feed` → `drop_stale(cutoff)` → `upsert_stories` → `record_progress` → commit
   (same per-item commit discipline as Phase A). `await asyncio.sleep(per_film_throttle)`
   between requests.

**Two distinct Phase-B failure modes:**
- *Block signal* (see helper) → set `blocked = True`, **`break`** out of Phase B immediately.
  No point hammering a throttling endpoint.
- *Ordinary error* (timeout, parse failure, lone 404/5xx) → log, `record_progress(failed_delta=1)`,
  **continue** (per-source isolation, exactly like trade feeds).

**Finalize (once, by the fetcher itself).**
- `blocked` → `finalize_run(status="failed", detail=<counts>, error="per-film fetch blocked after N films (HTTP …)")`.
- otherwise → `finalize_run(status="succeeded", detail=<counts>)`.

`_background_feeds`'s `try/except` → `_finalize_failed` stays as the crash safety net; the
block path returns normally (no raise), so there is no double-finalize.

Example detail: `"11 feeds ok, 0 failed, 204/216 films queried, 73 stories inserted"` — or on
block, `"11 feeds ok, 0 failed, blocked after 96/216 films, 41 stories inserted"`.

### Block detection helper

```python
def _looks_blocked(resp: httpx.Response) -> bool:
    if resp.status_code in (403, 429):
        return True
    # A throttle/captcha interstitial is HTML, not the RSS XML feed.
    if resp.status_code == 200 and "xml" not in resp.headers.get("content-type", "").lower():
        return True
    return False
```

Checked **before** `raise_for_status()` so a 429 is treated as a block (abort), not an
ordinary error (isolate). Transient 5xx fall through to the ordinary-error path and isolate.

## Wiring (`routers/ingest_admin.py`)

`_background_feeds` passes the two new settings through:

```python
await run_feeds_ingest(
    session_factory=_session_factory,
    run_id=run_id,
    recency_days=settings.feed_recency_days,
    per_film_enabled=settings.feeds_per_film_enabled,
    per_film_throttle=settings.feeds_per_film_throttle_seconds,
)
```

No change to the trigger endpoint, the daily cron, or the admin runs UI (kind stays `feeds`).

## Data flow

```
Phase A: trade RSS + 4 broad Google (when:Nd)  ──┐
                                                  ├─→ parse_feed → drop_stale(cutoff) → upsert (ON CONFLICT DO NOTHING)
Phase B: per-film Google (<title> when:Nd),      │       (one news.story table, deduped by url; film_id stays null)
         serialized @ ~1 req/s, abort on block ──┘
                                                  ▼
                       finalize_run: succeeded, or failed if Phase B hit a block
```

Downstream is unchanged: the `link` pipeline windows and links `pending` stories regardless
of which phase fetched them.

## Testing (TDD, respx)

Unit (`tests/unit/news/`):
- `per_film_google_sources(["A Film", "Other"], 14)` → 2 sources, each `source == "Google News: per-film"`,
  url contains the encoded `when:14d` and **no** `%22` (unquoted); empty titles → `()`.
- `_looks_blocked`: true for 429, 403, and a 200 with `text/html`; false for a 200 `application/xml`.

Integration (`tests/integration/news/test_fetcher.py`):
- **Flag off:** only base sources fetched; the roster is **not** queried (no per-film GETs).
- **Flag on:** seed a couple of `catalog.film` rows; respx mocks the per-film GETs; their
  stories upsert and dedupe by url against Phase-A stories.
- **Block aborts + fails loud:** respx returns a 429 (and separately, an HTML 200) on a
  per-film GET → Phase B stops at that point, Phase-A + earlier per-film stories remain, the
  run finalizes `failed` with the block recorded in `error`.
- **Ordinary error isolates:** a single per-film timeout/parse failure increments failed and
  the run still finalizes `succeeded`.
- **Throttle:** inject `per_film_throttle=0` (or patch `asyncio.sleep`) so tests stay fast;
  assert the sleep is invoked between per-film requests.
- Confirm the monkeypatched fake pipeline in `tests/integration/routers/test_ingest_admin.py`
  tolerates the two new kwargs.

No Alembic migration (no schema change).

CI gate before done: `task test`, `task lint`, `task typecheck`, `task format` all green.

## Build-time validation (fold in, not a separate spike)

Before finalizing the query string, run a quick A/B (the spike's open item): unquoted vs.
quoted, and whether adding an `original_title` query helps non-English films. Default to
**unquoted** unless the A/B clearly says otherwise; if `original_title` proves worthwhile it
is a trivial extension of `per_film_google_sources` (emit a second source per film). Record
the outcome in the PR description.

## Residual risk & ops

- **Sustained daily volume** is the one unquantified risk (the spike measured a one-off
  48-request burst, not ~216/day indefinitely). Mitigations are in the design: the
  `FEEDS_PER_FILM_ENABLED` kill switch and fail-loud-on-block. Watch run status after rollout.
- **Noise volume:** per-film roughly doubles raw-story inflow from common-word titles; the
  recency gate + linker absorb it. Watch `news.story` growth and the linker reject rate.

## Out of scope

- Any change to the entity linker (precision is its job).
- Any schema change, or a separate `ingest_run` kind (per-film is part of the `feeds` run).
- DB-backed source config (`news.feed_source`) — the static + roster-built list is enough
  until per-source tuning is actually needed.
- Dropping or tuning the broad/trade feeds (they stay; this is additive).
