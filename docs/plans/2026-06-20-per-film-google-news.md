# Per-film Google News Fetching (Hybrid) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project workflow (overrides the skill's per-task commit step):** This entire plan is **one PR** (NEU-288). Implementers do **NOT** commit per task. Run the full CI gate once at the end (Task 6); the user then commits once via `/commit-msg` and opens the PR via `/pr-desc`. All commands run in Docker via `task` (no host Python) — keep the `upmovies-backend` container up.

**Goal:** Add per-film targeted Google News queries alongside the four broad queries (hybrid) so low-profile tracked films get news coverage.

**Architecture:** A pure roster→sources builder in `news/feeds.py`; a second, serialized, block-aware fetch phase in `news/fetcher.py` driven by two new config flags; wiring through `routers/ingest_admin.py`. Fetch-side only — no schema change, no linker change, precision stays the linker's job.

**Tech Stack:** Python 3.13, async SQLAlchemy 2 + asyncpg, httpx, feedparser, FastAPI, pytest + respx. Spec: `docs/specs/2026-06-20-per-film-google-news-implementation-design.md`.

---

### Task 1: Confirm query form (build-time A/B — research gate)

The spike defaulted to **unquoted** `<title> when:Nd`. Confirm against a fresh sample before coding; only change the Task 2 default if results clearly differ. No code change expected.

**Files:** none (research; record the outcome in the eventual PR description).

- [ ] **Step 1: Run the A/B probe in the container**

Run (keep it polite — ~1.2s throttle, prod UA):

```bash
docker compose exec -T upmovies-backend python - <<'PY'
import asyncio, time
from urllib.parse import quote
import httpx, feedparser
from sqlalchemy import select
from upmovies.db import SessionLocal
from upmovies.catalog.models import Film

UA = "UpcomingMoviesBot/1.0 (+https://github.com/neuroticsasquat-ch/upcoming-movies-backend)"
def url(q): return f"https://news.google.com/rss/search?q={quote(q)}&hl=en-US&gl=US&ceid=US:en"

async def main():
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(Film.title, Film.original_title, Film.original_language)
            .order_by(Film.popularity.desc().nullslast()).limit(12))).all()
    print("title\tmode\tentries")
    async with httpx.AsyncClient(timeout=12, follow_redirects=True, headers={"User-Agent":UA}) as c:
        for title, orig, lang in rows:
            for mode, q in [("unquoted", f"{title} when:14d"), ("quoted", f'"{title}" when:14d')]:
                r = await c.get(url(q)); f = feedparser.parse(r.content)
                print(f"{title[:28]!r}\t{mode}\t{len(f.entries)}")
                await asyncio.sleep(1.2)
            if lang and lang != "en" and orig and orig != title:
                r = await c.get(url(f"{orig} when:14d")); f = feedparser.parse(r.content)
                print(f"{title[:28]!r}\torig:{orig[:18]!r}\t{len(f.entries)}")
                await asyncio.sleep(1.2)

asyncio.run(main())
PY
```

Expected: unquoted returns ≥ as many relevant entries as quoted (matching the spike). Decision: keep **unquoted** as the Task 2 default. If `original_title` adds meaningful coverage for non-EN films, note it as a fast-follow (a second source per film) — out of scope for this PR unless trivial.

---

### Task 2: `per_film_google_sources` builder (`news/feeds.py`)

**Files:**
- Modify: `src/upmovies/news/feeds.py`
- Test: `tests/unit/news/test_feeds.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/news/test_feeds.py`:

```python
from upmovies.news.feeds import per_film_google_sources


def test_per_film_sources_one_per_title_unquoted_with_when():
    sources = per_film_google_sources(["A Film", "Other Movie"], 14)
    assert len(sources) == 2
    assert all(s.name == "Google News: per-film" for s in sources)
    # quote() encodes "when:14d" as "when%3A14d"; unquoted => no encoded quote char
    assert all("when%3A14d" in s.url for s in sources)
    assert all("%22" not in s.url for s in sources)


def test_per_film_sources_empty_roster_is_empty():
    assert per_film_google_sources([], 14) == ()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/news/test_feeds.py -v`
Expected: FAIL — `ImportError: cannot import name 'per_film_google_sources'`.

- [ ] **Step 3: Implement the builder**

In `src/upmovies/news/feeds.py`, add `from collections.abc import Sequence` to the imports, then append:

```python
_PER_FILM_SOURCE = "Google News: per-film"  # constant story.source for every per-film hit


def per_film_google_sources(
    titles: Sequence[str], recency_days: int
) -> tuple[FeedSource, ...]:
    """One Google News source per tracked film, unquoted `<title> when:Nd`. Unquoted
    maximizes recall (Google quoting is fuzzy relevance-matching, not strict phrase);
    the entity linker owns precision downstream."""
    return tuple(
        FeedSource(_PER_FILM_SOURCE, _google_news(f"{title} when:{recency_days}d"))
        for title in titles
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/news/test_feeds.py -v`
Expected: PASS (all tests in the file).

---

### Task 3: `_looks_blocked` helper (`news/fetcher.py`)

**Files:**
- Modify: `src/upmovies/news/fetcher.py`
- Test: `tests/unit/news/test_fetcher.py` (new file)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/news/test_fetcher.py`:

```python
import httpx

from upmovies.news.fetcher import _looks_blocked


def _resp(status, content_type):
    return httpx.Response(status, headers={"Content-Type": content_type})


def test_blocked_on_429_and_403():
    assert _looks_blocked(_resp(429, "text/html")) is True
    assert _looks_blocked(_resp(403, "text/html")) is True


def test_blocked_on_200_html_interstitial():
    # A throttle/captcha page is HTML, not the RSS XML feed.
    assert _looks_blocked(_resp(200, "text/html; charset=utf-8")) is True


def test_not_blocked_on_200_xml():
    assert _looks_blocked(_resp(200, "application/xml")) is False
    assert _looks_blocked(_resp(200, "text/xml; charset=UTF-8")) is False
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/unit/news/test_fetcher.py -v`
Expected: FAIL — `ImportError: cannot import name '_looks_blocked'`.

- [ ] **Step 3: Implement the helper**

In `src/upmovies/news/fetcher.py`, add after the `_USER_AGENT` constant:

```python
def _looks_blocked(resp: httpx.Response) -> bool:
    """True when Google is throttling/captcha-ing us rather than serving the RSS feed."""
    if resp.status_code in (403, 429):
        return True
    if resp.status_code == 200 and "xml" not in resp.headers.get("content-type", "").lower():
        return True
    return False
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `task test -- tests/unit/news/test_fetcher.py -v`
Expected: PASS.

---

### Task 4: Phase B — per-film fetch in `run_feeds_ingest`

Adds the two config settings, a lightweight title query, the new kwargs, the serialized per-film loop with block-abort, and failed-on-block finalize.

**Files:**
- Modify: `src/upmovies/config.py:36` (after `feed_recency_days`)
- Modify: `src/upmovies/news/fetcher.py`
- Test: `tests/integration/news/test_fetcher.py`

- [ ] **Step 1: Add the config settings**

In `src/upmovies/config.py`, immediately after the `feed_recency_days` line:

```python
    feeds_per_film_enabled: bool = Field(default=True, alias="FEEDS_PER_FILM_ENABLED")
    feeds_per_film_throttle_seconds: float = Field(
        default=1.0, alias="FEEDS_PER_FILM_THROTTLE_SECONDS"
    )
```

- [ ] **Step 2: Write the failing integration tests**

Append to `tests/integration/news/test_fetcher.py`. (Reuses the file's existing `_xml`, `_rss`, `_stories`, `RSS_URL` helpers and the `session` fixture.)

```python
import asyncio as _asyncio

from upmovies.catalog.models import Film
from upmovies.news.feeds import per_film_google_sources


async def _seed_films(session, titles):
    for i, t in enumerate(titles, start=1):
        session.add(Film(tmdb_id=i, title=t))
    await session.commit()


async def _run_pf(session, base_sources, *, recency_days=36500, throttle=0.0):
    run_id = await create_run(session, kind="feeds")
    await session.commit()
    result = await run_feeds_ingest(
        session_factory=lambda: session,
        run_id=run_id,
        recency_days=recency_days,
        per_film_enabled=True,
        per_film_throttle=throttle,
        sources=base_sources,
    )
    return run_id, result


@respx.mock
async def test_flag_off_does_not_query_roster_or_fetch_per_film(session):
    await _seed_films(session, ["Spider-Man"])
    respx.get(RSS_URL).mock(return_value=_xml(RSS_FEED))
    # per_film defaults off at the function level — no per-film route is registered,
    # so if Phase B fired it would raise (respx blocks unmocked requests).
    _, result = await _run(session, [FeedSource("Deadline", RSS_URL)])
    assert result.films_queried == 0
    assert result.blocked is False


@respx.mock
async def test_flag_on_fetches_per_film_and_dedupes_by_url(session):
    await _seed_films(session, ["Spider-Man"])
    pf = per_film_google_sources(["Spider-Man"], 36500)[0]
    respx.get(RSS_URL).mock(return_value=_xml(RSS_FEED))
    respx.get(pf.url).mock(return_value=_xml(_rss(
        [("Spidey news", "https://news.example/spidey", None)]
    )))

    run_id, result = await _run_pf(session, [FeedSource("Deadline", RSS_URL)])

    assert result.films_queried == 1
    assert result.blocked is False
    urls = {s.url for s in await _stories(session)}
    assert "https://news.example/spidey" in urls
    row = (await session.execute(
        select(IngestRun).where(IngestRun.id == run_id),
        execution_options={"populate_existing": True})).scalar_one()
    assert row.status == "succeeded"


@respx.mock
async def test_block_signal_aborts_phase_b_and_fails_run(session):
    # Queried title-sorted: "Shrek 5" sorts before "Spider-Man", so the first lands a
    # story and the second triggers the block/abort.
    await _seed_films(session, ["Shrek 5", "Spider-Man"])
    first = per_film_google_sources(["Shrek 5"], 36500)[0]
    blocked_src = per_film_google_sources(["Spider-Man"], 36500)[0]
    respx.get(RSS_URL).mock(return_value=_xml(RSS_FEED))
    respx.get(first.url).mock(return_value=_xml(_rss(
        [("Shrek news", "https://news.example/shrek", None)]
    )))
    respx.get(blocked_src.url).mock(return_value=httpx.Response(429))

    run_id, result = await _run_pf(session, [FeedSource("Deadline", RSS_URL)])

    assert result.blocked is True
    # Phase-A + the pre-block per-film story survive.
    assert "https://news.example/shrek" in {s.url for s in await _stories(session)}
    row = (await session.execute(
        select(IngestRun).where(IngestRun.id == run_id),
        execution_options={"populate_existing": True})).scalar_one()
    assert row.status == "failed"
    assert row.error and "blocked" in row.error.lower()


@respx.mock
async def test_ordinary_per_film_error_isolates_and_run_succeeds(session):
    await _seed_films(session, ["Spider-Man"])
    pf = per_film_google_sources(["Spider-Man"], 36500)[0]
    respx.get(RSS_URL).mock(return_value=_xml(RSS_FEED))
    respx.get(pf.url).mock(return_value=httpx.Response(500))  # transient, not a block signal

    run_id, result = await _run_pf(session, [FeedSource("Deadline", RSS_URL)])

    assert result.blocked is False
    assert result.feeds_failed == 1
    row = (await session.execute(
        select(IngestRun).where(IngestRun.id == run_id),
        execution_options={"populate_existing": True})).scalar_one()
    assert row.status == "succeeded"


@respx.mock
async def test_throttle_is_applied_between_per_film_requests(session, monkeypatch):
    await _seed_films(session, ["Spider-Man", "Shrek 5"])
    for t in ["Spider-Man", "Shrek 5"]:
        respx.get(per_film_google_sources([t], 36500)[0].url).mock(
            return_value=_xml(_rss([("x", f"https://news.example/{t}", None)])))
    respx.get(RSS_URL).mock(return_value=_xml(RSS_FEED))

    sleeps: list[float] = []

    async def fake_sleep(secs):
        sleeps.append(secs)

    monkeypatch.setattr("upmovies.news.fetcher.asyncio.sleep", fake_sleep)
    await _run_pf(session, [FeedSource("Deadline", RSS_URL)], throttle=1.0)
    assert sleeps and all(s == 1.0 for s in sleeps)  # one sleep per per-film request
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `task test -- tests/integration/news/test_fetcher.py -v`
Expected: FAIL — `TypeError: run_feeds_ingest() got an unexpected keyword argument 'per_film_enabled'` (and `AttributeError` on `result.films_queried`).

- [ ] **Step 4: Implement Phase B**

In `src/upmovies/news/fetcher.py`:

(a) Extend imports — add `import asyncio` at the top; add `from sqlalchemy import select`; change the feeds import to `from upmovies.news.feeds import FeedSource, feed_sources, per_film_google_sources`; add `from upmovies.catalog.models import Film`.

(b) Extend the result dataclass:

```python
@dataclass
class FeedsIngestResult:
    feeds_processed: int
    feeds_failed: int
    stories_inserted: int
    films_queried: int = 0
    blocked: bool = False
```

(c) Add the title-query helper (after `drop_stale`):

```python
async def _film_titles(session_factory: SessionFactory) -> list[str]:
    """Lightweight roster read for per-film queries — the deliberate news→catalog
    coupling. Title column only (not link.roster.build_roster's heavier rows)."""
    async with _owned_session(session_factory) as s:
        rows = await s.execute(select(Film.title).order_by(Film.title))
        return list(rows.scalars().all())
```

(d) Replace `run_feeds_ingest` with:

```python
async def run_feeds_ingest(
    *,
    session_factory: SessionFactory,
    run_id: UUID,
    recency_days: int,
    per_film_enabled: bool = False,
    per_film_throttle: float = 1.0,
    sources: Sequence[FeedSource] | None = None,
    timeout: float = 30.0,
) -> FeedsIngestResult:
    if sources is None:
        sources = feed_sources(recency_days)
    cutoff = datetime.now(UTC) - timedelta(days=recency_days)
    feeds_processed = 0
    feeds_failed = 0
    stories_inserted = 0
    films_queried = 0
    blocked = False
    block_reason = ""

    async def _ingest_entries(source: FeedSource, content: bytes) -> int:
        entries = drop_stale(parse_feed(source.name, content), cutoff=cutoff)
        async with _owned_session(session_factory) as s:
            inserted = await upsert_stories(s, entries)
            await record_progress(s, run_id, processed_delta=inserted)
            await s.commit()
        return inserted

    async def _record_failure() -> None:
        async with _owned_session(session_factory) as s:
            await record_progress(s, run_id, failed_delta=1)
            await s.commit()

    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=True, headers={"User-Agent": _USER_AGENT}
    ) as client:
        # Phase A — trade + broad feeds (per-feed isolation; one bad feed never aborts).
        for source in sources:
            try:
                resp = await client.get(source.url)
                resp.raise_for_status()
                stories_inserted += await _ingest_entries(source, resp.content)
                feeds_processed += 1
            except Exception:
                log.exception("feed ingest failed for %s (%s)", source.name, source.url)
                feeds_failed += 1
                await _record_failure()

        # Phase B — per-film Google queries (serialized; abort the phase on a block).
        if per_film_enabled:
            titles = await _film_titles(session_factory)
            for source in per_film_google_sources(titles, recency_days):
                try:
                    resp = await client.get(source.url)
                    if _looks_blocked(resp):
                        blocked = True
                        block_reason = f"HTTP {resp.status_code}"
                        log.error(
                            "per-film fetch blocked after %d films (%s)",
                            films_queried, block_reason,
                        )
                        break
                    resp.raise_for_status()
                    stories_inserted += await _ingest_entries(source, resp.content)
                    films_queried += 1
                except Exception:
                    log.exception("per-film feed failed (%s)", source.url)
                    feeds_failed += 1
                    await _record_failure()
                await asyncio.sleep(per_film_throttle)

    run_status = "failed" if blocked else "succeeded"
    if blocked:
        detail = (
            f"{feeds_processed} feeds ok, {feeds_failed} failed, "
            f"blocked after {films_queried} films, {stories_inserted} stories inserted"
        )
    else:
        detail = (
            f"{feeds_processed} feeds ok, {feeds_failed} failed, "
            f"{films_queried} films queried, {stories_inserted} stories inserted"
        )
    async with _owned_session(session_factory) as s:
        await finalize_run(
            s,
            run_id,
            status=run_status,
            detail=detail,
            error=(f"per-film fetch blocked ({block_reason})" if blocked else None),
        )
        await s.commit()

    return FeedsIngestResult(feeds_processed, feeds_failed, stories_inserted, films_queried, blocked)
```

> Note: the `_ingest_entries` / `_record_failure` closures de-duplicate the identical
> Phase-A/Phase-B body (DRY). `finalize_run(..., *, status, error=None, detail=None)` ignores a
> `None` error, so passing `error=None` on the success branch is a no-op.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/integration/news/test_fetcher.py -v`
Expected: PASS (new tests + all pre-existing ones in the file — the function-level `per_film_enabled=False` default keeps the old `_run` helper's behavior unchanged).

---

### Task 5: Wire the settings through (`routers/ingest_admin.py`)

**Files:**
- Modify: `src/upmovies/routers/ingest_admin.py:65-74` (`_background_feeds`)
- Test: `tests/integration/routers/test_ingest_admin.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/routers/test_ingest_admin.py` (mirrors `test_background_tmdb_passes_excluded_statuses`):

```python
async def test_background_feeds_passes_per_film_settings(session, monkeypatch):
    captured: dict = {}

    async def fake(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr("upmovies.routers.ingest_admin.run_feeds_ingest", fake)
    run_id = await create_run(session, kind="feeds")
    await session.commit()

    await ingest_admin._background_feeds(run_id, get_settings())

    assert captured["per_film_enabled"] is True   # config default
    assert captured["per_film_throttle"] == 1.0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/routers/test_ingest_admin.py::test_background_feeds_passes_per_film_settings -v`
Expected: FAIL — `KeyError: 'per_film_enabled'` (the wrapper doesn't pass it yet).

- [ ] **Step 3: Update the wrapper**

In `src/upmovies/routers/ingest_admin.py`, change the `run_feeds_ingest` call inside `_background_feeds`:

```python
        await run_feeds_ingest(
            session_factory=_session_factory,
            run_id=run_id,
            recency_days=settings.feed_recency_days,
            per_film_enabled=settings.feeds_per_film_enabled,
            per_film_throttle=settings.feeds_per_film_throttle_seconds,
        )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/routers/test_ingest_admin.py -v`
Expected: PASS.

---

### Task 6: Full CI gate + handoff to commit

**Files:** none (verification).

- [ ] **Step 1: Format, then run the full gate**

Run, in order (all in the container):

```bash
task format
task lint
task typecheck
task test
```

Expected: `lint`, `typecheck` clean; `task test` — entire suite green. (No Alembic migration: this PR adds no schema. If `task test` errors only when a single integration file is run in isolation, that's the known pytest-asyncio quirk — run the whole suite.)

- [ ] **Step 2: Hand off for commit (user action)**

Do **not** commit as an implementer. Report green CI to the user, who commits the whole change once via `/commit-msg` (Conventional Commits subject, no Linear ID in the subject, optional `Refs NEU-288.` in the body, no co-author/footer) and opens the PR via `/pr-desc` (title carries `(NEU-288)`). Include the Task 1 A/B outcome in the PR body. The GitHub↔Linear connector moves NEU-288's status automatically.

---

## Notes for the implementer

- **No host Python.** Everything is `task ...` (Docker). Keep the container up; `task build` only if `pyproject.toml` changes (it doesn't here).
- **respx blocks unmocked requests** — that's why the flag-off test proves Phase B didn't fire (an unmocked per-film GET would raise).
- **Films are queried title-sorted** (`order_by(Film.title)`): `"Shrek 5"` sorts before `"Spider-Man"`, so the block test lets `"Shrek 5"` land a story, then mocks the 429 on `"Spider-Man"` to trigger the abort.
- **Out of scope:** linker changes, schema/migrations, a separate `ingest_run` kind, DB-backed source config, dropping the broad/trade feeds.
