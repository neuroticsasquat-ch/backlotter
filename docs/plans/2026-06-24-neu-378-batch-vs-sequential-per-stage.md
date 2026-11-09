# NEU-378 — Choose Batch-vs-Sequential Per Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today a **single** `link_use_batches` flag drives **both** the link stage *and* the cluster stage inside `run_link_ingest`; only `summary_use_batches` is independent. Split the path selection so each of the three LLM stages (link / cluster / summarize) is **independently** configurable batch-vs-sequential, and set each stage's default from **measured** cost numbers. The split matters because the Batch API (flat 50% off) and prompt caching partially conflict: within one batch, concurrent sub-requests can't read each other's cache writes, so the shared roster is re-**written** rather than re-**read**; the sequential path warms the cache once and reads it at ~0.10× thereafter. Which path is cheaper is therefore a **per-stage empirical** question, not a blanket default.

**Architecture:** Two small mechanical changes plus one decision-recording step.
1. **Config surface** — add one new flag `cluster_use_batches` to `Settings`, alongside the existing `link_use_batches` (link stage) and `summary_use_batches` (summarize stage). `cluster_use_batches` now owns the cluster stage's path; `link_use_batches` is narrowed to *only* the link stage.
2. **Threading** — `run_link_ingest` currently takes one `use_batches` and uses it for **both** `_link_stage_*` (line 283) **and** `_cluster_stage_*` (line 316). Add a separate `cluster_use_batches` parameter; the link-stage selector keeps reading `use_batches`, the cluster-stage selector reads the new param. Thread `settings.cluster_use_batches` through `_background_link` in `routers/ingest_admin.py`.
3. **Defaults from data (owner step)** — a clearly-marked manual measurement step (real Anthropic key) that runs `scripts/measure_link_cost.py` for the link stage and reads per-stage `cost_usd` + `batched` from `ingest.run_llm_usage` (persisted by **NEU-375**) for real link and synthesize runs, then sets the three flag defaults accordingly and records the numbers in the spec. This is decision-recording, **not** CI.

No new logic in the stages themselves, no schema change, no migration. The four `_link_stage_*` / `_cluster_stage_*` functions and the summarize pipeline are untouched in their bodies — only the *selection* of which one to call changes. Pricing and telemetry (`src/upmovies/llm/pricing.py`, `ingest.run_llm_usage`, the `/admin/runs*` `llm_usage[]` exposure) are **owned by NEU-375 — do not modify them here**; this ticket only *consumes* their output to pick defaults.

**Tech Stack:** Python 3.13, FastAPI, pydantic-settings, SQLAlchemy 2 (async), pytest (+ pytest-asyncio in `auto` mode). **All tooling runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python`/`alembic` on the host.

## Global Constraints

- **One backend PR**, on branch `tom/neu-378-backend-choose-batch-vs-sequential-per-stage-from-measured`.
- **Dependency — NEU-375 (T1) must be merged first.** This plan's Task 3 reads `ingest.run_llm_usage` per-stage `cost_usd` + `batched` and imports from `src/upmovies/llm/pricing.py`; both are delivered by NEU-375. As of writing, neither exists on `main` (no `pricing.py`, no `run_llm_usage` table). Tasks 1 and 2 (config + threading) have **no** code dependency on NEU-375 and can be written/tested immediately; only Task 3's measurement requires NEU-375 to have landed and at least one real telemetry-bearing run to exist. Branch off `main` *after* NEU-375 merges so the measurement step has its data source.
- **Container-only tooling:** `task test` / `task lint` / `task typecheck` / `task format` (they `docker compose exec` into `upmovies-backend`). Keep the container up (`task up`). Scope tests with `task test -- <path>`.
- **TDD:** write the failing test first, watch it fail, then make it pass. pytest-asyncio is `auto` mode — no `@pytest.mark.asyncio` needed.
- **Pre-commit hooks delegate into Docker** — commit normally, **no `--no-verify`**. Run `task format` *before* staging so the format-check hook passes.
- **Modern type hints** (`X | None`, `X | Y`); **no** `from __future__ import annotations`; ruff line length **100** (use `\` line-continuations in long prompt/string literals — not applicable here, but keep new code under 100 cols).
- **Before claiming done:** `task test`, `task lint`, `task typecheck` all green (and `task format` applied).
- **Commit message:** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-378.` in body), **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. Prefer `/commit-msg`.
- **Keep every path env-overridable.** All three flags stay `Field(default=..., alias="...")` so `LINK_USE_BATCHES`, `CLUSTER_USE_BATCHES`, `SUMMARY_USE_BATCHES` continue to override at runtime.
- **Do NOT touch** `src/upmovies/llm/pricing.py`, `ingest.run_llm_usage`, the telemetry capture/aggregation, or `routers/admin_runs.py` — those are NEU-375's. This ticket only reads their output.

---

### Task 1: Add the `cluster_use_batches` config flag

Add a per-stage batch flag so the cluster stage is independently configurable. `link_use_batches` stays for the link stage; `summary_use_batches` stays for summarize.

**Files:**
- Modify: `src/upmovies/config.py` (add `cluster_use_batches` field next to `link_use_batches`, line ~36).
- Modify: `tests/unit/test_config.py` (add a default assertion + an env-override assertion, mirroring the existing `link_use_batches` tests at lines 77–88).

**Interfaces:**
- Consumes: nothing new.
- Produces: `Settings.cluster_use_batches: bool` (alias `CLUSTER_USE_BATCHES`). The **default value** is set in Task 3 from measured data; this task lands it with a *provisional* default that mirrors today's behaviour (`True`, since the link flag's `True` default currently drives the cluster stage too — see "Current behaviour" note in Task 2). Task 3 may flip it.

- [ ] **Step 1: Create the work branch and bring the container up**

NEU-375 must already be on `main` (see Global Constraints). Then:

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
git checkout main && git pull
git checkout -b tom/neu-378-backend-choose-batch-vs-sequential-per-stage-from-measured
task up
```

Expected: branch created; `upmovies-backend` container running (needed for every `task` target).

- [ ] **Step 2: Write the failing config tests**

In `tests/unit/test_config.py`, immediately after `test_settings_link_use_batches_override_from_env` (line ~88), add two tests mirroring the link-flag pair. Note the **provisional** default is `True` (matches today, where `link_use_batches=True` drives the cluster stage):

```python
def test_settings_cluster_use_batches_defaults_true(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.delenv("CLUSTER_USE_BATCHES", raising=False)
    s = Settings()  # type: ignore[call-arg]
    assert s.cluster_use_batches is True


def test_settings_cluster_use_batches_override_from_env(monkeypatch):
    _set_required(monkeypatch)
    monkeypatch.setenv("CLUSTER_USE_BATCHES", "false")
    s = Settings()  # type: ignore[call-arg]
    assert s.cluster_use_batches is False
```

- [ ] **Step 3: Run the config tests to confirm they fail**

Run: `task test -- tests/unit/test_config.py`

Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'cluster_use_batches'` (the field doesn't exist yet). The existing config tests stay green.

- [ ] **Step 4: Add the `cluster_use_batches` field**

In `src/upmovies/config.py`, add the new field directly below `link_use_batches` (line 36). Place it adjacent so the link/cluster pair reads together:

```python
    link_use_batches: bool = Field(default=True, alias="LINK_USE_BATCHES")
    cluster_use_batches: bool = Field(default=True, alias="CLUSTER_USE_BATCHES")
```

(`link_use_batches` is unchanged. The `default=True` for the new flag is provisional — Task 3 sets the final value from measured cost.)

- [ ] **Step 5: Run the config tests to confirm they pass**

Run: `task test -- tests/unit/test_config.py`

Expected: PASS — both new tests green; all existing config tests still green.

---

### Task 2: Thread a separate cluster path through `run_link_ingest`

**Current behaviour (the conflation being fixed):** in `src/upmovies/link/pipeline.py`, `run_link_ingest` takes a single `use_batches: bool = False`. It is used **twice**:

- Link stage (line 283): `stage = _link_stage_batched if use_batches else _link_stage_sequential`
- Cluster stage (line 316): `cluster_stage = _cluster_stage_batched if use_batches else _cluster_stage_sequential`

So one flag forces both stages onto the same path. And the call site `_background_link` in `routers/ingest_admin.py` (lines 84–99) passes `use_batches=settings.link_use_batches`, meaning `link_use_batches` silently governs clustering too.

**Fix:** add a `cluster_use_batches` parameter to `run_link_ingest`. The link-stage selector keeps reading `use_batches`; the cluster-stage selector reads `cluster_use_batches`. Default the new param to `False` (matches the existing `use_batches: bool = False` default, preserving the all-sequential default for callers that don't pass it — e.g. tests). Thread `settings.cluster_use_batches` from `_background_link`.

**Files:**
- Modify: `src/upmovies/link/pipeline.py` — add `cluster_use_batches: bool = False` to `run_link_ingest`'s signature; change line 316's cluster selector to read it.
- Modify: `src/upmovies/routers/ingest_admin.py` — `_background_link` passes `cluster_use_batches=settings.cluster_use_batches`.
- Modify: `tests/integration/link/test_pipeline.py` — extend the `_run` helper to forward a `cluster_use_batches` kwarg; add tests asserting the two stages can take **different** paths.

**Interfaces:**
- Consumes: `Settings.cluster_use_batches` (Task 1).
- Produces: `run_link_ingest(..., cluster_use_batches: bool = False)`. The link stage's selection continues to read `use_batches` (the link flag); the cluster stage's selection reads `cluster_use_batches`. No change to the `_link_stage_*` / `_cluster_stage_*` function signatures or bodies.

- [ ] **Step 1: Write the failing pipeline tests for independent path selection**

The existing fake `FakeClient` in `tests/integration/link/test_pipeline.py` already records which surface each stage used: `client.batch_requests` is set when the **link** batch ran, `client.cluster_batch_requests` when the **cluster** batch ran, and `_stage1_complete_calls(client)` / inspecting `complete_calls` reveals sequential use. Reuse exactly those levers.

First, extend the `_run` helper (line ~74) to forward the new kwarg so existing call sites are unaffected (default `None` ⇒ don't pass it, so `run_link_ingest`'s own default applies):

```python
async def _run(
    session,
    run_id,
    *,
    recency_days=45,
    use_batches=False,
    cluster_use_batches=None,
    batch_size=10,
    client=None,
):
    kwargs = {}
    if cluster_use_batches is not None:
        kwargs["cluster_use_batches"] = cluster_use_batches
    return await run_link_ingest(
        session_factory=lambda: session,
        client=client or FakeClient(),
        run_id=run_id,
        model="link-m",
        cluster_model="cluster-m",
        recency_days=recency_days,
        batch_size=batch_size,
        floor=0.7,
        use_batches=use_batches,
        **kwargs,
    )
```

Then add two tests near the existing flag-routing tests (after `test_flag_on_uses_batch_for_stage1`, line ~376). They are the crux of this ticket — they prove the two stages are *independently* selectable:

```python
async def test_link_batched_cluster_sequential_are_independent(session):
    """link batches, cluster sequential — proves the two flags are independent."""
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all([await _story("https://e/x", published_offset_days=1)])
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    client = FakeClient()
    await _run(session, run_id, use_batches=True, cluster_use_batches=False, client=client)

    assert client.batch_requests is not None  # Stage 1 used the batch surface
    assert client.cluster_batch_requests is None  # Stage 2 did NOT use the batch surface
    # Stage 2 went through complete(): a non-link complete() call was made.
    assert any(
        "entity-linking classifier" not in c["system"][0]["text"] for c in client.complete_calls
    )


async def test_link_sequential_cluster_batched_are_independent(session):
    """link sequential, cluster batched — the mirror image."""
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    session.add_all([await _story("https://e/x", published_offset_days=1)])
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    client = FakeClient()
    await _run(session, run_id, use_batches=False, cluster_use_batches=True, client=client)

    assert client.batch_requests is None  # Stage 1 did NOT use the batch surface
    assert _stage1_complete_calls(client) == 1  # Stage 1 went through complete()
    assert client.cluster_batch_requests is not None  # Stage 2 used the batch surface
```

- [ ] **Step 2: Run the new pipeline tests to confirm they fail**

Run: `task test -- tests/integration/link/test_pipeline.py`

Expected: FAIL on the two new tests. `run_link_ingest` doesn't accept `cluster_use_batches` yet, so either a `TypeError: run_link_ingest() got an unexpected keyword argument 'cluster_use_batches'` is raised, or (if the harness swallows it) the cluster stage still follows `use_batches` and the independence assertions fail. The existing `use_batches`-parametrized tests stay green.

> Note on the single-file run quirk: per the repo CLAUDE.md, running one integration test file in isolation can emit a pytest-asyncio session-loop warning. If it errors rather than just warns, run the whole `tests/integration/link/` directory: `task test -- tests/integration/link/`.

- [ ] **Step 3: Add the `cluster_use_batches` parameter to `run_link_ingest`**

In `src/upmovies/link/pipeline.py`, add the new parameter to the signature (after `use_batches`, line 267). Keep it keyword-only (the whole signature is already `*`-prefixed) with the same `False` default for back-compat:

```python
async def run_link_ingest(
    *,
    session_factory: SessionFactory,
    client: LinkClient,
    run_id: UUID,
    model: str,
    cluster_model: str,
    recency_days: int,
    attach_limit: int = 25,
    batch_size: int,
    floor: float,
    use_batches: bool = False,
    cluster_use_batches: bool = False,
    cluster_max_tokens: int = 4096,
) -> LinkIngestResult:
```

Then change **only** the cluster-stage selector (line 316) to read the new flag. The link-stage selector at line 283 stays on `use_batches` — do not touch it:

```python
    cluster_stage = _cluster_stage_batched if cluster_use_batches else _cluster_stage_sequential
```

(Line 283's `stage = _link_stage_batched if use_batches else _link_stage_sequential` is unchanged. The `_cluster_stage_*` call block below the selector — `client=client`, `model=cluster_model`, `film_ids=...`, etc. — is unchanged.)

- [ ] **Step 4: Thread `settings.cluster_use_batches` from the router**

In `src/upmovies/routers/ingest_admin.py`, in `_background_link` (the `run_link_ingest(...)` call at lines 87–99), add the new argument next to `use_batches`:

```python
            await run_link_ingest(
                session_factory=_session_factory,
                client=client,
                run_id=run_id,
                model=settings.link_model,
                cluster_model=settings.cluster_model,
                recency_days=settings.link_recency_days,
                attach_limit=settings.link_cluster_attach_limit,
                batch_size=settings.link_batch_size,
                floor=settings.link_confidence_floor,
                use_batches=settings.link_use_batches,
                cluster_use_batches=settings.cluster_use_batches,
                cluster_max_tokens=settings.link_cluster_max_tokens,
            )
```

(`use_batches=settings.link_use_batches` stays — it now governs *only* the link stage. `cluster_use_batches=settings.cluster_use_batches` is the new line. No other change to `_background_link`.)

- [ ] **Step 5: Run the link pipeline tests to confirm they pass**

Run: `task test -- tests/integration/link/`

Expected: PASS — the two new independence tests green; every existing test (the `use_batches`-parametrized link/cluster/failure-isolation/request-mapping tests, `test_run_link_ingest_threads_cluster_max_tokens`, `test_batched_cluster_failure_is_isolated_per_film`) still green. The existing tests don't pass `cluster_use_batches`, so they exercise the `False` default — when they set `use_batches=True` and expect `cluster_batch_requests is not None` (e.g. `test_flag_on_uses_batch_for_stage1`, `test_batched_cluster_request_mapping`, `test_run_link_ingest_threads_cluster_max_tokens`) they would now drive the cluster stage *sequentially* and break.

> **Decision point — keep the existing batch-cluster tests green.** Those tests assert the cluster *batch* path while only setting `use_batches=True`. After the split, `use_batches` no longer reaches the cluster stage, so they must now **also** pass `cluster_use_batches=True`. Update each such test (and `test_run_link_ingest_threads_cluster_max_tokens`'s direct `run_link_ingest(...)` call) to add `cluster_use_batches=True` alongside `use_batches=True`. The `_run`-based tests get it via the new `cluster_use_batches=` kwarg; the direct-call test at line ~417 adds `cluster_use_batches=True,` to its kwargs. Make these edits as part of this step, then re-run until green. Do **not** weaken any assertion — only restore the intended path by passing the now-required flag.

- [ ] **Step 6: Full backend test sweep + lint + typecheck**

```bash
task test
task format
task lint
task typecheck
```

Expected: `task test` fully green (config unit tests + link pipeline integration tests + the rest of the suite). `task lint` and `task typecheck` report no errors; `task format` leaves files clean (re-run `task lint` if format rewrote anything). If a stale-container async-fixture cascade appears, `docker compose restart upmovies-backend` and re-run (known quirk, per CLAUDE.md).

- [ ] **Step 7: Commit Tasks 1–2 (the mechanical split)**

Generate the message with `/commit-msg`, or:

```bash
git add src/upmovies/config.py src/upmovies/link/pipeline.py src/upmovies/routers/ingest_admin.py tests/unit/test_config.py tests/integration/link/test_pipeline.py
git commit -m "feat: select batch-vs-sequential per stage in link ingest

Add a CLUSTER_USE_BATCHES flag and a cluster_use_batches param on
run_link_ingest so the cluster stage's batch-vs-sequential path no
longer piggybacks on the link flag. LINK_USE_BATCHES now governs only
the link stage; clustering is independently configurable.

Refs NEU-378."
git push -u origin tom/neu-378-backend-choose-batch-vs-sequential-per-stage-from-measured
```

(No `🤖` footer, no `Co-Authored-By` — repo convention. The footer belongs only in the PR body, via `/pr-desc`.)

---

### Task 3: Set the three flag defaults from measured cost — OWNER STEP (manual, real key; not CI)

This is **decision-recording**, not an automated test. It needs a **real Anthropic API key** (token spend), the **NEU-375 telemetry** (`ingest.run_llm_usage`) live on `main`, and at least one real **link** run and one real **synthesize** run captured. None of it gates CI. Do it once, set the three defaults, document the numbers, and bump the unit-test default assertions to match.

**Files:**
- Modify (decisions): `src/upmovies/config.py` — final `default=` values for `link_use_batches`, `cluster_use_batches`, `summary_use_batches`.
- Modify (if a default flips): `tests/unit/test_config.py` — the corresponding default assertion(s).
- Modify (record numbers): `docs/specs/2026-06-24-llm-cost-token-efficiency-design.md` — add the measured per-stage table + the decision under the T4 section.

**Interfaces:**
- Consumes (read-only): `scripts/measure_link_cost.py` output; `ingest.run_llm_usage` rows / `GET /admin/runs*` `llm_usage[]` (fields: `stage`, `model`, `batched`, input/output/cache_read/cache_creation tokens, `cost_usd`) — both owned by NEU-375.
- Produces: three finalized defaults + a documented decision. No new code symbols.

- [ ] **Step 1: Confirm prerequisites are live**

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
ls src/upmovies/llm/pricing.py        # must exist (NEU-375)
task migrate                          # ensure ingest.run_llm_usage exists
task up
```

Expected: `pricing.py` present; migrations at head (the `run_llm_usage` table exists). If `pricing.py` is missing, **stop** — NEU-375 has not merged; this step cannot proceed (see Global Constraints).

- [ ] **Step 2: Seed a representative corpus and measure the LINK stage**

Per `scripts/measure_link_cost.py`'s docstring, first run a real `tmdb` + `feeds` ingest so the DB holds a representative `pending` corpus, then in the container:

```bash
task shell
# inside the container:
python scripts/measure_link_cost.py --repeats 3 --limit 300   # spend-capped smoke
python scripts/measure_link_cost.py --repeats 3               # full corpus, if budget allows
```

Expected: a printed markdown table with `sequential mean $/run` vs `batched mean $/run` and a `batched vs sequential: ±X% (positive = batched cheaper)` line. **Record the sign and magnitude** — this decides `link_use_batches`. The script uses cold-cache nonces per repeat so it faithfully models the daily cron (cache warms intra-run, starts cold per run); trust its $ comparison for the link stage.

- [ ] **Step 3: Measure the CLUSTER and SUMMARIZE stages from real-run telemetry**

The measurement script only covers the link stage. For **cluster** and **summarize**, use NEU-375's persisted per-(run, stage) telemetry. Trigger one real run of each path under each flag setting and compare the recorded `cost_usd` for that stage:

```bash
# CLUSTER (part of the link run). Run once batched, once sequential, compare the cluster-stage cost.
docker exec -e CLUSTER_USE_BATCHES=true  upmovies-backend curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8000/admin/ingest/link
# ...wait for completion, then re-seed/re-link a comparable corpus and:
docker exec -e CLUSTER_USE_BATCHES=false upmovies-backend curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8000/admin/ingest/link

# SUMMARIZE.
docker exec -e SUMMARY_USE_BATCHES=true  upmovies-backend curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8000/admin/ingest/synthesize
docker exec -e SUMMARY_USE_BATCHES=false upmovies-backend curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8000/admin/ingest/synthesize
```

Then read each run's per-stage cost from the runs API (NEU-375 exposes `llm_usage[]` on `/admin/runs*`; the exact route/auth is NEU-375's — use whatever it shipped). For each stage, pick the path with the lower `cost_usd` at a comparable workload.

> **Honesty caveats to record alongside the numbers:**
> - Compare like-for-like corpora. A sequential cluster run over 5 films isn't comparable to a batched run over 50; note the film/event counts.
> - Per the spec's F2/F1 findings: the cluster cached prefix is below Sonnet's 2048-token floor (never a cache hit today — NEU-377's territory), so the cluster sequential path's *only* lever is base input cost, while batched gets the flat 50% off. Expect batched to win cluster unless NEU-377 has materially changed cluster caching. Don't assume — read the `cost_usd`.
> - The summarize prefix has no cache markers at all (spec F0/§Corrected-misconceptions), so summarize is purely batch-50%-off vs full-price sequential ⇒ batched is almost certainly cheaper; confirm from telemetry anyway.

- [ ] **Step 4: Set the three defaults from the measured winners**

In `src/upmovies/config.py`, set each flag's `default=` to the cheaper path measured above:

```python
    link_use_batches: bool = Field(default=<MEASURED>, alias="LINK_USE_BATCHES")
    cluster_use_batches: bool = Field(default=<MEASURED>, alias="CLUSTER_USE_BATCHES")
    ...
    summary_use_batches: bool = Field(default=<MEASURED>, alias="SUMMARY_USE_BATCHES")
```

Replace each `<MEASURED>` with `True` (batched cheaper) or `False` (sequential cheaper) from the data. If a measured winner differs from the provisional default landed in Task 1 (or from the current `True` on `link_use_batches`/`summary_use_batches`), this is where it flips. All three remain env-overridable.

- [ ] **Step 5: Update the unit-test default assertions to match**

For any flag whose default changed, update its assertion in `tests/unit/test_config.py`:
- `link_use_batches` → `test_settings_link_use_batches_defaults_true` (rename/retarget if it flips to `False`).
- `cluster_use_batches` → `test_settings_cluster_use_batches_defaults_true` (from Task 1).
- `summary_use_batches` → `test_settings_summary_defaults` (line ~97: `assert s.summary_use_batches is ...`).

Run: `task test -- tests/unit/test_config.py`

Expected: PASS — every default assertion matches the new config defaults.

- [ ] **Step 6: Record the decision in the spec**

In `docs/specs/2026-06-24-llm-cost-token-efficiency-design.md`, under the **T4** section (line ~122), append the measured per-stage table and the chosen defaults, e.g.:

```markdown
**T4 result (measured 2026-06-..):**

| stage | sequential $/run | batched $/run | chosen path | flag default |
|---|---|---|---|---|
| link | $… | $… | … | LINK_USE_BATCHES=… |
| cluster | $… | $… | … | CLUSTER_USE_BATCHES=… |
| summarize | $… | $… | … | SUMMARY_USE_BATCHES=… |

Notes: corpus sizes (link N stories / cluster M films / summarize K events); cache-floor
caveats per F1/F2; link figure from measure_link_cost.py, cluster/summarize from
ingest.run_llm_usage. Each path stays env-overridable.
```

Fill in the real numbers. This is the acceptance artifact ("defaults set from measured numbers and documented").

- [ ] **Step 7: Verify, format, commit the decision**

```bash
task test
task format
task lint
task typecheck
```

Expected: all green. Then commit (config defaults + test assertions + spec):

```bash
git add src/upmovies/config.py tests/unit/test_config.py ../docs/specs/2026-06-24-llm-cost-token-efficiency-design.md
git commit -m "feat: set per-stage batch defaults from measured cost

Set LINK_USE_BATCHES / CLUSTER_USE_BATCHES / SUMMARY_USE_BATCHES
defaults to the cheaper measured path per stage; document the
per-stage cost comparison in the cost-efficiency spec.

Refs NEU-378."
git push
```

> **If NEU-375 has not merged when you reach this ticket:** ship Tasks 1–2 (the mechanical split, which is fully tested and self-contained), leave the Task-1 provisional defaults in place, and defer Task 3 to a follow-up commit on the same branch once the telemetry exists. Note this in the PR description so the reviewer knows the defaults are provisional pending measurement. Do **not** guess the defaults without data — the whole point of the ticket is that the choice is empirical.

---

## Self-review

- **Spec coverage (T4 acceptance):**
  - "introduce per-stage path selection where today the link flag covers link+cluster" → Task 1 (config flag) + Task 2 (threading; cluster selector reads the new flag, link selector unchanged).
  - "each stage's default set from measured numbers and documented" → Task 3 (owner step; measure → set defaults → record in spec).
  - "the path remains overridable by config" → all three flags stay `Field(default=..., alias="...")`; Global Constraints + every task preserve env override.
  - "tests cover the new config surface" → Task 1 (config default + override tests) and Task 2 (independence tests proving link/cluster take different paths).
- **Out-of-scope respected:** pricing module, `run_llm_usage`, telemetry capture, and `/admin/runs*` are read-only consumed, never modified (Global Constraints; NEU-375 owns them).
- **TDD order:** every code change is preceded by a failing test (Task 1 Steps 2–3, Task 2 Steps 1–2) before the implementation step. Task 3 is manual measurement — its only automated artifact is the default-assertion update (Step 5), which is TDD-adjacent (assertion follows the chosen value).
- **Back-compat / no surprise regressions:** `cluster_use_batches` defaults to `False` on `run_link_ingest` (matching the existing `use_batches` default), so tests that don't pass it stay all-sequential; Task 2 Step 5 explicitly flags and fixes the existing batch-cluster tests that previously relied on `use_batches=True` reaching the cluster stage.
- **Placeholder scan:** the only intentional placeholders are `<MEASURED>` and the `$…` / `N`/`M`/`K` corpus counts in Task 3 — these are *deliberately* unfilled because they are real measured values the owner records at run time, not plan gaps. Everything in Tasks 1–2 is concrete.
- **Type consistency:** one new symbol (`Settings.cluster_use_batches: bool`) and one new parameter (`run_link_ingest(..., cluster_use_batches: bool = False)`). The `_link_stage_*` / `_cluster_stage_*` signatures and `LinkClient`/`Completer`/`BatchCompleter` protocols are untouched.
