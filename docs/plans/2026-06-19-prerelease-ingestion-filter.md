# Pre-release Ingestion Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict TMDB ingestion to future-dated, still-pre-release films — popularity ≥ 1.0, status ∉ {Released, Canceled}.

**Architecture:** Three code changes plus a data refresh. (1) `config.py`: change product defaults (past window 30→0, floor 10.0→1.0) and add a `tmdb_excluded_statuses` setting. (2) `ingest/tmdb/service.py`: skip films whose details status is excluded, after the details fetch and before the upsert. (3) `routers/ingest_admin.py`: pass the configured set through; revert the temporary dev compose override. No DB schema change / no Alembic migration.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 (async), pydantic-settings, pytest + respx. Everything runs in the container via `task` (no host Python).

**Spec:** `docs/specs/2026-06-19-prerelease-ingestion-filter-design.md`
**Branch:** `feat/prerelease-ingestion-filter` (already checked out)

**Execution notes:**
- All test/lint/typecheck commands run via `task` (they `docker compose exec` into `upmovies-backend`).
- **Integration tests cannot be run as a single file in isolation** (pytest-asyncio session-loop quirk) — scope to a directory or run the whole suite.
- The status-skip defaults to **off** at the service layer (empty set) so the existing service tests stay green; production supplies the real set via config.
- Commit/PR cadence follows the user's established workflow (per-task commits shown below are natural TDD checkpoints; the user drives final commit/PR structure — likely a single PR for this small change).

---

### Task 1: Config — product defaults + excluded-statuses setting

**Files:**
- Modify: `src/upmovies/config.py`
- Test: `tests/unit/test_config.py`

- [ ] **Step 1: Update the config tests for the new defaults + setting**

In `tests/unit/test_config.py`, replace the whole `test_settings_has_sensible_ingestion_defaults` function with:

```python
def test_settings_has_sensible_ingestion_defaults(monkeypatch):
    _set_required(monkeypatch)
    for key in (
        "TMDB_RELEASE_WINDOW_PAST_DAYS",
        "TMDB_RELEASE_WINDOW_FUTURE_DAYS",
        "TMDB_MIN_POPULARITY",
        "TMDB_REGION",
        "TMDB_ORIGINAL_LANGUAGE",
        "TMDB_EXCLUDED_STATUSES",
        "INGEST_CONSECUTIVE_FAILURE_THRESHOLD",
        "INGEST_STALE_RUN_MINUTES",
    ):
        monkeypatch.delenv(key, raising=False)
    s = Settings()  # type: ignore[call-arg]
    assert s.tmdb_release_window_past_days == 0
    assert s.tmdb_release_window_future_days == 1095
    assert s.tmdb_min_popularity == 1.0
    assert s.tmdb_region == "US"
    assert s.tmdb_original_language == "en"
    assert s.tmdb_excluded_statuses == frozenset({"Released", "Canceled"})
    assert s.ingest_consecutive_failure_threshold == 10
    assert s.ingest_stale_run_minutes == 15
```

Then add this new test directly below it:

```python
def test_settings_excluded_statuses_parsed_and_overridable(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.setenv("TMDB_EXCLUDED_STATUSES", "Released, Canceled , Rumored")
    s = Settings()  # type: ignore[call-arg]
    assert s.tmdb_excluded_statuses == frozenset({"Released", "Canceled", "Rumored"})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `task test -- tests/unit/test_config.py -v`
Expected: FAIL — `assert 30 == 0`, `assert 10.0 == 1.0`, and `AttributeError: 'Settings' object has no attribute 'tmdb_excluded_statuses'`.

- [ ] **Step 3: Update `config.py`**

Change the past-window default (currently line ~21) from `default=30` to `default=0`:

```python
    tmdb_release_window_past_days: int = Field(default=0, alias="TMDB_RELEASE_WINDOW_PAST_DAYS")
```

Change the popularity default (currently line ~25) from `default=10.0` to `default=1.0`:

```python
    tmdb_min_popularity: float = Field(default=1.0, alias="TMDB_MIN_POPULARITY")
```

Immediately after the `tmdb_original_language` field, add the new raw setting:

```python
    tmdb_excluded_statuses_raw: str = Field(
        default="Released,Canceled", alias="TMDB_EXCLUDED_STATUSES"
    )
```

Add this property next to the existing `cors_allowed_origins` property:

```python
    @property
    def tmdb_excluded_statuses(self) -> frozenset[str]:
        return frozenset(
            s.strip() for s in self.tmdb_excluded_statuses_raw.split(",") if s.strip()
        )
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `task test -- tests/unit/test_config.py -v`
Expected: PASS (all config tests).

- [ ] **Step 5: Commit**

```bash
git add src/upmovies/config.py tests/unit/test_config.py
git commit -m "feat: default TMDB ingest to pre-release window (floor 1.0, future-only, exclude Released/Canceled)"
```

---

### Task 2: Service — skip excluded statuses

**Files:**
- Modify: `src/upmovies/ingest/tmdb/service.py`
- Test: `tests/integration/ingest/tmdb/test_service.py`

- [ ] **Step 1: Extend the test helper and add the failing tests**

In `tests/integration/ingest/tmdb/test_service.py`, replace the `_run` helper with this version (adds the `excluded_statuses` parameter and threads it through):

```python
async def _run(
    session,
    *,
    min_popularity: float = 10.0,
    failure_threshold: int = 10,
    excluded_statuses: frozenset[str] = frozenset(),
):
    run_id = await create_run(session, kind="tmdb")
    await session.commit()
    async with _client() as c:
        result = await run_tmdb_ingest(
            session_factory=lambda: session,
            client=c,
            run_id=run_id,
            release_date_gte=GTE,
            release_date_lte=LTE,
            min_popularity=min_popularity,
            region="US",
            original_language="en",
            failure_threshold=failure_threshold,
            excluded_statuses=excluded_statuses,
        )
    return run_id, result
```

Then append these two tests to the end of the file:

```python
@respx.mock
async def test_ingest_skips_excluded_statuses(session):
    _discover(page="1").mock(
        return_value=httpx.Response(
            200,
            json=make_discover_page(
                page=1,
                total_pages=1,
                results=[make_summary(1), make_summary(2), make_summary(3)],
            ),
        )
    )
    _details(1).mock(return_value=httpx.Response(200, json=make_details(1, status="Released")))
    _details(2).mock(return_value=httpx.Response(200, json=make_details(2, status="Planned")))
    _details(3).mock(return_value=httpx.Response(200, json=make_details(3, status="Canceled")))

    _, result = await _run(session, excluded_statuses=frozenset({"Released", "Canceled"}))

    assert result.films_processed == 1
    assert result.films_skipped == 2
    assert {f.tmdb_id for f in await _films(session)} == {2}


@respx.mock
async def test_ingest_skip_resets_consecutive_failure_counter(session):
    # threshold=2: fail (cf=1), skip (cf reset to 0), fail (cf=1), process.
    # If a skip did NOT reset the counter, the second failure would abort before film 4.
    _discover(page="1").mock(
        return_value=httpx.Response(
            200,
            json=make_discover_page(
                page=1,
                total_pages=1,
                results=[make_summary(1), make_summary(2), make_summary(3), make_summary(4)],
            ),
        )
    )
    _details(1).mock(return_value=httpx.Response(404))
    _details(2).mock(return_value=httpx.Response(200, json=make_details(2, status="Released")))
    _details(3).mock(return_value=httpx.Response(404))
    _details(4).mock(return_value=httpx.Response(200, json=make_details(4, status="Planned")))

    _, result = await _run(
        session, failure_threshold=2, excluded_statuses=frozenset({"Released"})
    )

    assert (result.films_processed, result.films_failed, result.films_skipped) == (1, 2, 1)
    assert {f.tmdb_id for f in await _films(session)} == {4}
```

- [ ] **Step 2: Run the service tests, verify they fail**

Run: `task test -- tests/integration/ingest/tmdb/`
Expected: FAIL — `run_tmdb_ingest() got an unexpected keyword argument 'excluded_statuses'` (and `films_skipped` missing).

- [ ] **Step 3: Implement the filter in `service.py`**

Add `films_skipped` to the result dataclass:

```python
@dataclass
class IngestResult:
    films_processed: int
    films_failed: int
    films_skipped: int = 0
```

Add the `excluded_statuses` parameter to `run_tmdb_ingest`, immediately after `failure_threshold: int = 10,`:

```python
    failure_threshold: int = 10,
    excluded_statuses: frozenset[str] = frozenset(),
```

Initialize the counter alongside `processed`/`failed`:

```python
    processed = 0
    failed = 0
    skipped = 0
    consecutive_failures = 0
```

Inside the `for tmdb_id in candidate_ids:` loop, immediately after `details = await client.movie_details(tmdb_id)`, insert the skip check (before the `async with _owned_session(...)` upsert block):

```python
            details = await client.movie_details(tmdb_id)
            if details.status in excluded_statuses:
                skipped += 1
                consecutive_failures = 0  # a successful fetch, just not wanted
                continue
            async with _owned_session(session_factory) as s:
```

Change the consecutive-failure abort return to include `skipped`:

```python
            return IngestResult(processed, failed, skipped)
```

Change the success finalize + return to record the skipped count in `detail` and return it:

```python
    async with _owned_session(session_factory) as s:
        await finalize_run(
            s,
            run_id,
            status="succeeded",
            detail=f"upserted {processed}, skipped {skipped} (excluded status)",
        )
        await s.commit()
    return IngestResult(processed, failed, skipped)
```

- [ ] **Step 4: Run the service tests, verify they pass**

Run: `task test -- tests/integration/ingest/tmdb/`
Expected: PASS (new tests plus all existing service tests — the existing ones pass `excluded_statuses` defaulting to the empty set, so nothing is skipped).

- [ ] **Step 5: Commit**

```bash
git add src/upmovies/ingest/tmdb/service.py tests/integration/ingest/tmdb/test_service.py
git commit -m "feat: skip excluded statuses during TMDB ingest"
```

---

### Task 3: Wire the filter through the trigger + revert dev override

**Files:**
- Modify: `src/upmovies/routers/ingest_admin.py`
- Modify: `docker-compose.yml` (revert the temporary override)
- Test: `tests/integration/routers/test_ingest_admin.py`

- [ ] **Step 1: Add the failing wiring test**

Append to `tests/integration/routers/test_ingest_admin.py` (the imports `create_run`, `get_settings`, and `ingest_admin` already exist in this file):

```python
async def test_background_tmdb_passes_excluded_statuses(session, monkeypatch):
    captured: dict = {}

    async def fake(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr("upmovies.routers.ingest_admin.run_tmdb_ingest", fake)
    run_id = await create_run(session, kind="tmdb")
    await session.commit()

    await ingest_admin._background_tmdb(run_id, get_settings())

    assert captured["excluded_statuses"] == frozenset({"Released", "Canceled"})
```

- [ ] **Step 2: Run the router tests, verify the new one fails**

Run: `task test -- tests/integration/routers/`
Expected: FAIL — `KeyError: 'excluded_statuses'` (the router does not pass it yet).

- [ ] **Step 3: Pass the configured set in `_background_tmdb`**

In `src/upmovies/routers/ingest_admin.py`, add the `excluded_statuses` argument to the `run_tmdb_ingest(...)` call inside `_background_tmdb`, immediately after `failure_threshold=...`:

```python
                failure_threshold=settings.ingest_consecutive_failure_threshold,
                excluded_statuses=settings.tmdb_excluded_statuses,
            )
```

- [ ] **Step 4: Run the router tests, verify they pass**

Run: `task test -- tests/integration/routers/`
Expected: PASS.

- [ ] **Step 5: Revert the temporary dev compose override**

The `TMDB_MIN_POPULARITY: "${TMDB_MIN_POPULARITY:-0}"` line in `docker-compose.yml` was a temporary dev override and is now superseded by the `config.py` default. Remove it.

```bash
# If it's still an uncommitted working-tree change, discard it:
git checkout -- docker-compose.yml
# Otherwise edit the line out manually. Then verify it's gone:
grep -n "TMDB_MIN_POPULARITY" docker-compose.yml || echo "override removed (good)"
```

Expected: the grep prints nothing (so the `|| echo` prints `override removed (good)`), and `git status --short` shows no pending `docker-compose.yml` change.

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/routers/ingest_admin.py tests/integration/routers/test_ingest_admin.py
git commit -m "feat: wire excluded-status filter through ingest trigger"
```

---

### Task 4: Full CI gate + dev data refresh

**Files:** none (verification + operational).

- [ ] **Step 1: Run the full CI pipeline locally, confirm green**

```bash
task format && task lint && task typecheck && task test
```
Expected: ruff clean, pyright clean, full pytest suite green. If `task format` changes any file, re-stage and amend the relevant task's commit.

- [ ] **Step 2: Recreate the container so the new config defaults load**

```bash
task up
docker compose exec -T upmovies-backend printenv TMDB_MIN_POPULARITY || echo "unset (using config default 1.0) — good"
```
Expected: `TMDB_MIN_POPULARITY` is unset in the container (the compose override is gone), so the app uses the `config.py` default of `1.0`.

- [ ] **Step 3: Clear the old floor-0 corpus**

```bash
docker exec tbc_postgresql_db psql -U root -d upmovies -c "TRUNCATE catalog.film;"
```

- [ ] **Step 4: Trigger a fresh ingest and poll to completion**

```bash
RESP=$(curl -sk -X POST https://api.upmovies.localhost/admin/ingest/tmdb -H "Authorization: Bearer dev-secret-change-me")
echo "$RESP"
RID=$(echo "$RESP" | sed -E 's/.*"run_id":"([^"]+)".*/\1/')
# poll (zsh-safe: do NOT use a variable named `status`)
for i in $(seq 1 40); do
  S=$(curl -sk https://api.upmovies.localhost/admin/ingest/$RID -H "Authorization: Bearer dev-secret-change-me")
  echo "$S"
  echo "$S" | grep -q '"status":"running"' || break
  sleep 15
done
```
Expected: terminal `"status":"succeeded"`, `items_failed":0`, and a `detail` like `"upserted ~155, skipped ~40 (excluded status)"`.

- [ ] **Step 5: Verify the corpus matches the spec**

```bash
docker exec tbc_postgresql_db psql -U root -d upmovies -c "select count(*) films, count(*) filter (where status in ('Released','Canceled')) banned, count(*) filter (where release_date < current_date) already_released, min(release_date) earliest, max(release_date) latest from catalog.film;"
docker exec tbc_postgresql_db psql -U root -d upmovies -c "select coalesce(status,'(null)') status, count(*) from catalog.film group by 1 order by 2 desc;"
```
Expected: ~150–160 films; `banned == 0`; `already_released == 0`; `earliest >= today`; status mix is In Production / Post Production / Planned / (a few) Rumored only.

---

## Self-review (completed by plan author)

- **Spec coverage:** config defaults → Task 1; `tmdb_excluded_statuses` setting → Task 1; service status skip → Task 2; router wiring → Task 3; revert dev override → Task 3; lifecycle (no code) → N/A; tests → Tasks 1–3; no migration → confirmed; data refresh → Task 4. All covered.
- **Placeholders:** none — every code/command step is concrete.
- **Type consistency:** `excluded_statuses: frozenset[str]` is consistent across the config property, the service parameter, the router call, and the tests; `films_skipped` is defined on `IngestResult` (Task 2) before being asserted (Tasks 2) — consistent.
