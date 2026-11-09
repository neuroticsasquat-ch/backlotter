# NEU-455 URL-Resolution Throughput Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the NEU-442 Google-News URL resolver actually clear its backlog — generalize eligibility so every *displayed* Google-News story becomes resolvable, and parameterize/raise the per-run drain cap so the once-daily synthesize run keeps up.

**Architecture:** Three focused edits to the existing synthesize pipeline: (1) new env-aliased config knobs; (2) rework `synthesize/url_resolution.py` so eligibility is an ongoing sweep of all displayed Google-News `none` stories and the drain caps/attempts are caller-injected; (3) thread the config values from the synthesize trigger through the pipeline and surface a "marked" count in the run detail. No schema change, no new dependency, single backend PR.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async, pydantic-settings, httpx, pytest + pytest-asyncio (auto mode) + respx. Everything runs in the container via `task`.

## Global Constraints

- **Container-only.** Run tests/lint/typecheck via `task test` / `task lint` / `task typecheck` (they `docker compose exec` into `upmovies-backend`). Never run host `python`/`pytest`/`ruff`/`pyright`. Keep the container up (`task up`).
- **TDD.** Write the failing test first, watch it fail, then implement. pytest-asyncio is in `auto` mode — no `@pytest.mark.asyncio`.
- **No live network in tests.** Resolver is injected/stubbed; never hit Google.
- **Single integration test file in isolation errors** (known pytest-asyncio quirk) — scope to a directory (`task test -- tests/integration/synthesize`) or run the whole suite.
- **Type hints:** modern `X | None`, no `from __future__ import annotations`. ruff line length 100.
- **No migration** — `resolved_url` / `resolve_state` / `resolve_attempts` already exist (NEU-442).
- **No git commits inside tasks.** The user commits once at the end. Before that final commit: `task format`, then `task test`, `task lint`, `task typecheck` must all be green.
- **Config defaults (verbatim):** `URL_RESOLVE_PER_RUN=500`, `URL_RESOLVE_MAX_ATTEMPTS=3`, `URL_RESOLVE_DELAY_SECONDS=1.0`.

---

### Task 1: Add URL-resolution config knobs

**Files:**
- Modify: `src/upmovies/config.py` (add three fields to `Settings`, after `summary_prompt_version`)
- Test: `tests/unit/test_config.py`

**Interfaces:**
- Produces: `Settings.url_resolve_per_run: int` (default 500), `Settings.url_resolve_max_attempts: int` (default 3), `Settings.url_resolve_delay_seconds: float` (default 1.0), aliased `URL_RESOLVE_PER_RUN` / `URL_RESOLVE_MAX_ATTEMPTS` / `URL_RESOLVE_DELAY_SECONDS`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/test_config.py`:

```python
def test_settings_has_url_resolve_defaults(monkeypatch):
    _set_required(monkeypatch)
    for key in (
        "URL_RESOLVE_PER_RUN",
        "URL_RESOLVE_MAX_ATTEMPTS",
        "URL_RESOLVE_DELAY_SECONDS",
    ):
        monkeypatch.delenv(key, raising=False)
    s = Settings()  # type: ignore[call-arg]
    assert s.url_resolve_per_run == 500
    assert s.url_resolve_max_attempts == 3
    assert s.url_resolve_delay_seconds == 1.0


def test_settings_reads_url_resolve_overrides(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.setenv("URL_RESOLVE_PER_RUN", "120")
    monkeypatch.setenv("URL_RESOLVE_MAX_ATTEMPTS", "5")
    monkeypatch.setenv("URL_RESOLVE_DELAY_SECONDS", "0.25")
    s = Settings()  # type: ignore[call-arg]
    assert s.url_resolve_per_run == 120
    assert s.url_resolve_max_attempts == 5
    assert s.url_resolve_delay_seconds == 0.25
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/test_config.py`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'url_resolve_per_run'`.

- [ ] **Step 3: Add the fields**

In `src/upmovies/config.py`, immediately after the line `summary_prompt_version: str = Field(default="4", alias="SUMMARY_PROMPT_VERSION")`, add:

```python
    url_resolve_per_run: int = Field(default=500, alias="URL_RESOLVE_PER_RUN")
    url_resolve_max_attempts: int = Field(default=3, alias="URL_RESOLVE_MAX_ATTEMPTS")
    url_resolve_delay_seconds: float = Field(default=1.0, alias="URL_RESOLVE_DELAY_SECONDS")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `task test -- tests/unit/test_config.py`
Expected: PASS.

- [ ] **Step 5: Green bar**

Run: `task lint` and `task typecheck`
Expected: no errors.

---

### Task 2: Rework `url_resolution.py` — generalized eligibility, parameterized drain, marked count

This task keeps `url_resolution.py` internally consistent: it renames eligibility, drops the `event_ids` coupling, injects `per_run`/`max_attempts`/`delay_seconds`, and adds `marked` to the result — updating the module's own tests in the same task so the suite stays green.

**Files:**
- Modify: `src/upmovies/synthesize/url_resolution.py`
- Test: `tests/integration/synthesize/test_url_resolution.py`

**Interfaces:**
- Consumes: `Story`, `EventStory` (`upmovies.news.models`); `is_google_news_url`, `resolve_google_news_url` (`upmovies.news.resolve`).
- Produces:
  - `mark_displayed_eligible(session: AsyncSession) -> int` — flips every displayed (has an `EventStory` row) Google-News story in `resolve_state='none'` to `'pending'`; returns count marked. Caller commits.
  - `ResolveResult(marked: int, resolved: int, failed: int, pending: int)`.
  - `run_url_resolution(*, session_factory, resolver=resolve_google_news_url, per_run: int = 500, max_attempts: int = 3, delay_seconds: float = 1.0) -> ResolveResult` — **no `event_ids` param**.

- [ ] **Step 1: Rewrite the module's tests to the new interface (failing)**

Replace the entire contents of `tests/integration/synthesize/test_url_resolution.py` with:

```python
from datetime import UTC, datetime

from sqlalchemy import func, select

from upmovies.catalog.models import Film
from upmovies.news.models import Event, EventStory, Story
from upmovies.synthesize.url_resolution import mark_displayed_eligible, run_url_resolution

_FILM_SEQ = 0


async def _google_story(session, *, url, event=None):
    """Create a Story at `url` attached to an event (creating a Film+Event if none given).
    Returns (event, story)."""
    global _FILM_SEQ
    if event is None:
        _FILM_SEQ += 1
        film = Film(tmdb_id=1000 + _FILM_SEQ, title=f"Film {_FILM_SEQ}")
        session.add(film)
        await session.flush()
        event = Event(
            film_id=film.id,
            event_type="casting",
            confidence="confirmed",
            occurred_at=datetime.now(UTC),
        )
        session.add(event)
        await session.flush()
    story = Story(
        source="Google News: per-film", url=url, title="Headline", published_at=datetime.now(UTC)
    )
    session.add(story)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=story.id))
    await session.flush()
    return event, story


async def _unattached_story(session, *, url):
    """A Story with NO EventStory row (not displayed)."""
    story = Story(
        source="Google News: per-film", url=url, title="Headline", published_at=datetime.now(UTC)
    )
    session.add(story)
    await session.flush()
    return story


async def test_mark_displayed_eligible_flips_all_displayed_google_news(session):
    _, s1 = await _google_story(session, url="https://news.google.com/rss/articles/CBMiaaa")
    _, s2 = await _google_story(session, url="https://news.google.com/rss/articles/CBMibbb")
    n = await mark_displayed_eligible(session)
    await session.commit()
    r1 = await session.get(Story, s1.id, execution_options={"populate_existing": True})
    r2 = await session.get(Story, s2.id, execution_options={"populate_existing": True})
    assert n == 2
    assert r1.resolve_state == "pending"
    assert r2.resolve_state == "pending"


async def test_mark_displayed_eligible_skips_non_displayed_and_non_google(session):
    _, trade_story = await _google_story(session, url="https://variety.com/2026/film/x")
    undisplayed = await _unattached_story(
        session, url="https://news.google.com/rss/articles/CBMiundisplayed"
    )
    await session.commit()
    n = await mark_displayed_eligible(session)
    await session.commit()
    trade = await session.get(Story, trade_story.id, execution_options={"populate_existing": True})
    und = await session.get(Story, undisplayed.id, execution_options={"populate_existing": True})
    assert n == 0
    assert trade.resolve_state == "none"  # displayed but not a Google News URL
    assert und.resolve_state == "none"  # Google News URL but not displayed


async def test_mark_displayed_eligible_is_idempotent(session):
    await _google_story(session, url="https://news.google.com/rss/articles/CBMiidem")
    assert await mark_displayed_eligible(session) == 1
    await session.commit()
    assert await mark_displayed_eligible(session) == 0  # already pending → nothing to mark
    await session.commit()


async def test_run_resolution_marks_then_resolves(session):
    _, gn_story = await _google_story(
        session, url="https://news.google.com/rss/articles/CBMisuccess"
    )
    await session.commit()

    async def fake_resolver(client, url):
        return "https://variety.com/real-article"

    result = await run_url_resolution(
        session_factory=lambda: session,
        resolver=fake_resolver,
        delay_seconds=0.0,
    )

    refreshed = await session.get(Story, gn_story.id, execution_options={"populate_existing": True})
    assert result.marked == 1
    assert result.resolved == 1
    assert result.failed == 0
    assert result.pending == 0
    assert refreshed.resolve_state == "resolved"
    assert refreshed.resolved_url == "https://variety.com/real-article"
    assert refreshed.resolve_attempts == 1


async def test_run_resolution_caps_retries_then_fails(session):
    _, gn_story = await _google_story(session, url="https://news.google.com/rss/articles/CBMifail")
    await session.commit()

    async def always_none(client, url):
        return None

    for _ in range(3):
        await run_url_resolution(
            session_factory=lambda: session,
            resolver=always_none,
            delay_seconds=0.0,
        )
    refreshed = await session.get(Story, gn_story.id, execution_options={"populate_existing": True})
    assert refreshed.resolve_attempts == 3
    assert refreshed.resolve_state == "failed"
    assert refreshed.resolved_url is None


async def test_run_resolution_per_run_cap_leaves_remainder_pending(session):
    event, _ = await _google_story(session, url="https://news.google.com/rss/articles/CBMicap0")
    await _google_story(session, url="https://news.google.com/rss/articles/CBMicap1", event=event)
    await _google_story(session, url="https://news.google.com/rss/articles/CBMicap2", event=event)
    await session.commit()

    async def always_none(client, url):
        return None

    result = await run_url_resolution(
        session_factory=lambda: session,
        resolver=always_none,
        per_run=2,
        delay_seconds=0.0,
    )
    assert result.marked == 3  # all 3 displayed Google News stories marked eligible
    assert result.pending == 3  # none resolved; all remain pending
    attempted = (
        await session.execute(
            select(func.count()).select_from(Story).where(Story.resolve_attempts == 1)
        )
    ).scalar_one()
    assert attempted == 2  # exactly 2 attempted this run (per_run cap)


async def test_run_resolution_honors_custom_max_attempts(session):
    _, gn_story = await _google_story(session, url="https://news.google.com/rss/articles/CBMimax1")
    await session.commit()

    async def always_none(client, url):
        return None

    result = await run_url_resolution(
        session_factory=lambda: session,
        resolver=always_none,
        max_attempts=1,
        delay_seconds=0.0,
    )
    refreshed = await session.get(Story, gn_story.id, execution_options={"populate_existing": True})
    assert result.failed == 1
    assert refreshed.resolve_state == "failed"  # cap of 1 → failed after a single miss
    assert refreshed.resolve_attempts == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/integration/synthesize/test_url_resolution.py`
Expected: FAIL — `ImportError: cannot import name 'mark_displayed_eligible'`.

- [ ] **Step 3: Rewrite the module**

Edit `src/upmovies/synthesize/url_resolution.py`:

(a) Delete the three module constants (`MAX_ATTEMPTS`, `RESOLVE_PER_RUN`, `POLITENESS_DELAY_SECONDS` at lines 28-30).

(b) Add `marked` to the result dataclass:

```python
@dataclass
class ResolveResult:
    marked: int
    resolved: int
    failed: int
    pending: int
```

(c) Replace `mark_eligible` with `mark_displayed_eligible` (drop the `event_ids` scope; sweep all displayed Google-News `none` stories):

```python
async def mark_displayed_eligible(session: AsyncSession) -> int:
    """Flip every DISPLAYED Google News story still in 'none' to 'pending'. 'displayed'
    = attached to an event via news.event_story. Idempotent: only touches 'none' rows,
    so 'resolved'/'failed' stay terminal. Caller commits."""
    rows = (
        (
            await session.execute(
                select(Story)
                .join(EventStory, EventStory.story_id == Story.id)
                .where(Story.resolve_state == "none")
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    eligible_ids = [s.id for s in rows if is_google_news_url(s.url)]
    if not eligible_ids:
        return 0
    await session.execute(
        update(Story).where(Story.id.in_(eligible_ids)).values(resolve_state="pending")
    )
    return len(eligible_ids)
```

(d) Rewrite `run_url_resolution` — drop `event_ids`, add `max_attempts`, inline the defaults, capture `marked`, use `max_attempts` in the cap check, and populate `ResolveResult(marked=...)`:

```python
async def run_url_resolution(
    *,
    session_factory: SessionFactory,
    resolver: Resolver = resolve_google_news_url,
    per_run: int = 500,
    max_attempts: int = 3,
    delay_seconds: float = 1.0,
) -> ResolveResult:
    async with _owned_session(session_factory) as s:
        marked = await mark_displayed_eligible(s)
        await s.commit()

    async with _owned_session(session_factory) as s:
        rows = (
            await s.execute(
                select(Story.id, Story.url)
                .where(Story.resolve_state == "pending")
                .order_by(Story.id)
                .limit(per_run + 1)
            )
        ).all()
    truncated = len(rows) > per_run
    rows = rows[:per_run]
    if truncated:
        log.info("url-resolution: per-run cap %d hit; more stories remain pending", per_run)

    resolved = failed = 0
    async with httpx.AsyncClient() as client:
        for story_id, url in rows:
            real: str | None = None
            try:
                real = await resolver(client, url)
            except Exception:
                log.exception("url-resolution decode crashed for story %s", story_id)
            async with _owned_session(session_factory) as s:
                story = await s.get(Story, story_id)
                if story is None:
                    continue
                story.resolve_attempts += 1
                if real:
                    story.resolved_url = real
                    story.resolve_state = "resolved"
                    resolved += 1
                elif story.resolve_attempts >= max_attempts:
                    story.resolve_state = "failed"
                    failed += 1
                await s.commit()
            if delay_seconds:
                await asyncio.sleep(delay_seconds)

    async with _owned_session(session_factory) as s:
        still = (
            await s.execute(
                select(func.count()).select_from(Story).where(Story.resolve_state == "pending")
            )
        ).scalar_one()
    return ResolveResult(marked=marked, resolved=resolved, failed=failed, pending=still)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `task test -- tests/integration/synthesize/test_url_resolution.py`
Expected: PASS (all seven tests).

- [ ] **Step 5: Green bar**

Run: `task lint` and `task typecheck`
Expected: no errors. (`UP`/`F` rules will flag the now-unused `UUID` import in this module if `event_ids` was its only user — remove it if so.)

---

### Task 3: Thread config through the pipeline + trigger, and surface `marked` in run detail

**Files:**
- Modify: `src/upmovies/synthesize/pipeline.py` (`run_synthesize_ingest`, ~lines 232-280)
- Modify: `src/upmovies/routers/ingest_admin.py` (`_background_synth`, ~lines 143-153)
- Test: `tests/integration/synthesize/test_pipeline.py`

**Interfaces:**
- Consumes: `run_url_resolution`, `ResolveResult` (Task 2); `Settings.url_resolve_*` (Task 1).
- Produces: `run_synthesize_ingest(..., url_resolve_per_run: int = 500, url_resolve_max_attempts: int = 3, url_resolve_delay_seconds: float = 1.0)`; run detail string format `"summarized N (X new, Y refreshed); F failed; urls marked M, resolved R, failed FF, pending P"`.

- [ ] **Step 1: Update the existing detail assertion + add a marked-count test (failing)**

In `tests/integration/synthesize/test_pipeline.py`, update the assertion in `test_sequential_summarizes_new_event_and_finalizes` (currently ~line 241-244) to the new format:

```python
    assert (
        run.detail
        == "summarized 1 (1 new, 0 refreshed); 0 failed; "
        "urls marked 0, resolved 0, failed 0, pending 0"
    )
```

Then add this test to the same file (it needs a Google-News story on the summarized event; reuse the file's existing `_film` / `_create_run` helpers and attach a Google-News `Story`):

```python
async def test_detail_reports_marked_google_news_story(session):
    from datetime import UTC, datetime

    from upmovies.news.models import Event, EventStory, Story

    film = await _film(session)
    event = Event(
        film_id=film.id,
        event_type="casting",
        confidence="confirmed",
        occurred_at=datetime.now(UTC),
    )
    session.add(event)
    await session.flush()
    story = Story(
        source="Google News: per-film",
        url="https://news.google.com/rss/articles/CBMipipe",
        title="Star cast.",
        published_at=datetime.now(UTC),
    )
    session.add(story)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=story.id))
    await session.commit()

    run_id = await _create_run(session, kind="synthesize")
    await session.commit()

    async def fake_resolver(client, url):
        return "https://variety.com/real"

    await run_synthesize_ingest(
        session_factory=lambda: session,
        client=FakeSummaryClient(),
        run_id=run_id,
        model="claude-haiku-4-5",
        prompt_version="1",
        use_batches=False,
        url_resolve_delay_seconds=0.0,
        url_resolve_resolver=fake_resolver,
    )

    run = (
        await session.execute(
            select(IngestRun).where(IngestRun.id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert "urls marked 1, resolved 1" in run.detail
```

> Note: this test passes a `url_resolve_resolver` injection so it never hits Google. `run_synthesize_ingest` must accept and forward it (Step 3).

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/integration/synthesize/test_pipeline.py`
Expected: FAIL — the updated equality assertion fails on the old detail string, and the new test fails with `TypeError: run_synthesize_ingest() got an unexpected keyword argument 'url_resolve_resolver'`.

- [ ] **Step 3: Update `run_synthesize_ingest`**

In `src/upmovies/synthesize/pipeline.py`, change the signature and the resolution call. New signature:

```python
async def run_synthesize_ingest(
    *,
    session_factory: SessionFactory,
    client: SummaryClient,
    run_id: UUID,
    model: str,
    prompt_version: str,
    use_batches: bool = True,
    url_resolve_per_run: int = 500,
    url_resolve_max_attempts: int = 3,
    url_resolve_delay_seconds: float = 1.0,
    url_resolve_resolver: Resolver = resolve_google_news_url,
) -> SynthesizeResult:
```

Add the imports near the existing `url_resolution` import at the top of the file:

```python
from upmovies.news.resolve import resolve_google_news_url
from upmovies.synthesize.url_resolution import ResolveResult, Resolver, run_url_resolution
```

Replace the resolution call block (currently ~lines 259-266, the `event_ids = [...]` line and the `run_url_resolution(...)` call) with:

```python
    try:
        resolve_result = await run_url_resolution(
            session_factory=session_factory,
            resolver=url_resolve_resolver,
            per_run=url_resolve_per_run,
            max_attempts=url_resolve_max_attempts,
            delay_seconds=url_resolve_delay_seconds,
        )
    except Exception:
        log.exception("url-resolution stage failed")
        resolve_result = ResolveResult(marked=0, resolved=0, failed=0, pending=0)
```

Update the `detail=` f-string in `finalize_run` (currently ~lines 273-277) to include the marked count:

```python
            detail=(
                f"summarized {new + refreshed} ({new} new, {refreshed} refreshed); {failed} failed"
                f"; urls marked {resolve_result.marked}, resolved {resolve_result.resolved},"
                f" failed {resolve_result.failed}, pending {resolve_result.pending}"
            ),
```

> If `Resolver` is not already exported from `url_resolution.py`, it is defined there (`Resolver = Callable[[httpx.AsyncClient, str], Awaitable[str | None]]`) — import it as shown.

- [ ] **Step 4: Thread settings from the trigger**

In `src/upmovies/routers/ingest_admin.py`, update `_background_synth` to pass the config values:

```python
async def _background_synth(run_id: UUID, settings: Settings) -> None:
    try:
        async with AnthropicClient(api_key=settings.anthropic_api_key) as client:
            await run_synthesize_ingest(
                session_factory=_session_factory,
                client=client,
                run_id=run_id,
                model=settings.summary_model,
                prompt_version=settings.summary_prompt_version,
                use_batches=settings.summary_use_batches,
                url_resolve_per_run=settings.url_resolve_per_run,
                url_resolve_max_attempts=settings.url_resolve_max_attempts,
                url_resolve_delay_seconds=settings.url_resolve_delay_seconds,
            )
    except Exception as e:
        log.exception("background synthesize ingest crashed")
        await _finalize_failed(run_id, str(e))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `task test -- tests/integration/synthesize/test_pipeline.py`
Expected: PASS (updated assertion + new marked test).

- [ ] **Step 6: Full green bar**

Run: `task test` then `task lint` then `task typecheck`
Expected: whole suite green (this catches any other caller of the old `mark_eligible` / `event_ids` signature or the old `ResolveResult` constructor). `task format` before the final commit.

---

## Self-Review

**Spec coverage:**
- Generalized eligibility (spec §Key decisions #1, §Eligibility) → Task 2 (`mark_displayed_eligible`, drop `event_ids`).
- Parameterized knobs into env config (§Config) → Task 1 + Task 2 (signature) + Task 3 (threading).
- Keep drain posture / cap-truncation log (§Drain) → Task 2 (unchanged loop + log line).
- `marked` in `ingest_run.detail` (§Observability) → Task 2 (`ResolveResult.marked`) + Task 3 (detail string + test).
- Rate-limit safety / tunable via env (§Rate-limit safety, Rollout) → Task 1 defaults + Task 3 threading; 1s delay preserved as default.
- No migration, no new infra (§Migration, Out of scope) → confirmed; no schema/endpoint/cron changes in any task.
- Terminal `failed` never re-marked (§Eligibility) → Task 2 `mark_displayed_eligible` only touches `'none'`; covered by `test_mark_displayed_eligible_is_idempotent`.

**Placeholder scan:** none — every code and test step shows full content.

**Type consistency:** `mark_displayed_eligible(session) -> int`, `ResolveResult(marked, resolved, failed, pending)`, and `run_url_resolution(*, session_factory, resolver, per_run, max_attempts, delay_seconds)` are used identically in Tasks 2 and 3 and in all tests. `run_synthesize_ingest` gains `url_resolve_*` params consumed by `_background_synth`.
