# Synthesize pipeline + ingest kind + trigger + cron — Design

- **Date:** 2026-06-23
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-backend` — new `synthesize/pipeline.py`, `ingest` (kind constraint + migration), `routers/ingest_admin`, GitHub Actions daily cron
- **Linear:** NEU-305 (one PR, backend) · project *Movies: Synthesis & Update Log* · milestone *M1 — Summarization engine*
- **Blocked by:** NEU-304 (summarization service) — ✅ done (PR #32); NEU-303 (`news.event_summary` schema) — ✅ done (PR #31)
- **Design-of-record:** [2026-06-22-synthesis-update-log-design.md](2026-06-22-synthesis-update-log-design.md) §"Architecture". This is the per-ticket implementation design for the M1 pipeline deliverable.

## What this is

The fourth ingest stage. It wires the pure NEU-304 summarization service into a DB-backed,
idempotent, re-runnable pipeline that fills `news.event_summary`, mirroring `run_link_ingest`
structurally. Until it ships, `event_summary` is empty, and every public read endpoint
(`/feed`, `/films`, `/films/{slug}`, sitemap) inner-joins on `event_summary` — so the entire
public surface renders empty. This is the genuine last piece of MVP.

It runs after `link` in the daily cron: **tmdb → feeds → link → synthesize**.

> **Note:** NEU-305 was previously marked Done in Linear with no PR, branch, or commit (state
> jumped Backlog → Done, never started). The work below was never implemented; the ticket has
> been reopened to Todo.

```
news.event (+ event.updated_at)  ──┐
news.event_story → news.story      │  member stories (title, dek=raw["summary"], source)
catalog.film.title                 │
                                   ▼
   select events: summary missing OR event grew OR prompt_version bumped
                                   ▼
   summarize (NEU-304 service)  → upsert news.event_summary
   sequential (Messages, immediate)  OR  batched (Batches, ~50% cheaper)   ← summary_use_batches
```

## Out of scope

- Any prompt/quality change to the NEU-304 service (request builders, parser, prompt) — reused as-is.
- The public read API and SSR pages — already shipped (PRs #33–#35, M3/M4).
- Regeneration on **model** change — only a `prompt_version` bump (or event growth) triggers
  re-summary; switching `summary_model` alone does not.
- Backfill tooling / one-off scripts — the idempotent pipeline run *is* the backfill.
- No new **required** env (the three `summary_*` config fields already exist with defaults).

## Key decisions

| Question | Decision |
|---|---|
| Sequential + batched, or batched-only? | **Both**, gated on the existing `summary_use_batches` flag (default `True`), mirroring `run_link_ingest`. The flag already exists in `config`; the NEU-304 service already exposes both `summarize_event` (Messages) and `build_summary_batch_request` (Batches). Sequential gives **immediate** localdev population (`SUMMARY_USE_BATCHES=false`) — directly serving the "see data now" need — while prod keeps batched for the ~50% cost discount. |
| What triggers (re)summary? | `event_summary IS NULL` (**new**) OR `event.updated_at > event_summary.source_updated_at` (**refreshed** — event grew) OR `event_summary.prompt_version != :current` (**refreshed** — prompt bumped). The `prompt_version` clause honors the schema's documented purpose ("bump to force regeneration on prompt changes"); it's a tiny addition to the `WHERE`. |
| Recency window / per-run cap? | **Neither.** Every event needs a summary to appear in the per-movie log; a recency window would permanently strand old events. Process all missing/stale each run. The first run summarizes all ~197 existing events (cheap on Haiku batched); steady-state is a handful. Idempotent re-runs with nothing missing/stale are a no-op. |
| Sequential commit granularity | **Per event.** One event's summarization/upsert failure isolates to that event and never rolls back others. ~197 commits on the first run is acceptable. |
| Batched submission granularity | **One `BatchRequest` per event** (`custom_id = str(event_id)`); submit all in a single `complete_batch` call (no chunking — each event is already one request). Whole-batch submit/poll failure counts all events failed and leaves them un-summarized for the next run. |
| Service boundary | The pipeline owns ORM→`EventInput` mapping and the `event_summary` upsert; the NEU-304 service stays 100% DB-free (operates on `EventInput`, returns `SummaryResult`). |

## Selection query

One read-only session, before any summarization. `LEFT OUTER JOIN event_summary ON event_id`,
keep rows where:

```
event_summary.event_id IS NULL
  OR event.updated_at > event_summary.source_updated_at
  OR event_summary.prompt_version != :current_prompt_version
```

The presence/absence of the joined `event_summary` row also yields the **new vs refreshed**
flag used for the `detail` counts. The query returns the `event.id`, the data needed to build
`EventInput`, and `is_new`.

## Pipeline — `src/upmovies/synthesize/pipeline.py` (new)

Mirrors `link/pipeline.py` (the `_owned_session` helper, the sequential/batched stage split, the
`record_progress`/`finalize_run` wiring).

```python
@dataclass
class SynthesizeResult:
    new: int
    refreshed: int
    failed: int

async def run_synthesize_ingest(
    *,
    session_factory: SessionFactory,
    client: SummaryClient,        # Completer + BatchCompleter (AnthropicClient satisfies both)
    run_id: UUID,
    model: str,
    prompt_version: str,
    use_batches: bool = True,
) -> SynthesizeResult: ...
```

**ORM → `EventInput` mapping** (per selected event):
- `event_type` = `Event.event_type`
- `film_title` = `Film.title` (join `catalog.film` on `Event.film_id`)
- `source_updated_at` = `Event.updated_at` (the staleness key stored back into the summary)
- `stories` = `[StoryInput(title=s.title, dek=str((s.raw or {}).get("summary", "")), source=s.source) …]`
  for each member story via `event_story → story`. (The service truncates dek to its `_DEK_MAX`.)

**Sequential stage** (`use_batches=False`): loop events; per event `summarize_event(client, model, prompt_version, event_input)`, **upsert + `record_progress` + commit per event** in an owned session; on exception log + `record_progress(failed_delta=1)` in a fresh session (isolated).

**Batched stage** (`use_batches=True`): build one `BatchRequest` per event in a read-only session (`build_summary_batch_request(custom_id=str(event_id), model=model, event=event_input)`); keep a small in-memory `dict[custom_id → (event_id, source_updated_at, is_new)]` across the poll (the build session closes before polling — same pattern as link's `plans`); `client.complete_batch(requests)`; per result `parse_summary(result.text)` → upsert + `record_progress` + commit in a fresh session; a `None`/`not ok` result counts that event failed. Whole-call failure → `record_progress(failed_delta=len(events))`, return zeros for processed.

**Upsert** (`news.event_summary`, PK `event_id`):
```python
insert(EventSummary).values(...).on_conflict_do_update(
    index_elements=["event_id"],
    set_={summary, model, prompt_version, source_updated_at, generated_at: now()},
)
```

**Finalize:** `finalize_run(status="succeeded", detail=f"summarized {new+refreshed} ({new} new, {refreshed} refreshed); {failed} failed")`.

Re-export `run_synthesize_ingest` / `SynthesizeResult` from `synthesize/__init__.py` (the
`import x as x` pattern).

## Trigger — `src/upmovies/routers/ingest_admin.py`

Mirrors `trigger_link` / `_background_link`:

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
            )
    except Exception as e:
        log.exception("background synthesize ingest crashed")
        await _finalize_failed(run_id, str(e))

@router.post("/synthesize", status_code=status.HTTP_202_ACCEPTED)
async def trigger_synthesize(...) -> dict[str, str]:
    run_id = await create_run(session, kind="synthesize")
    await session.commit()
    asyncio.create_task(_background_synth(run_id, settings))
    return {"run_id": str(run_id)}
```

## Migration — extend the ingest-kind constraint

Update the `CheckConstraint` in `ingest/models.py`:
`"kind IN ('tmdb', 'feeds', 'link', 'synthesize')"` (name `ck_ingest_run_kind`). Tests pick this
up via `create_all`. Alembic does **not** autodetect CHECK-constraint changes, so the migration is
**hand-written**:

```python
def upgrade():
    op.drop_constraint("ck_ingest_run_kind", "ingest_run", schema="ingest")
    op.create_check_constraint(
        "ck_ingest_run_kind", "ingest_run",
        "kind IN ('tmdb', 'feeds', 'link', 'synthesize')", schema="ingest",
    )

def downgrade():
    op.drop_constraint(...); op.create_check_constraint(... "('tmdb', 'feeds', 'link')" ...)
```

Confirm `alembic heads` is single after generation; `task migrate`.

## Cron — `.github/workflows/daily-pipeline.yml`

Add one line after `link`, same trigger-then-poll `trigger_and_wait` helper:

```bash
trigger_and_wait tmdb || rc=1
trigger_and_wait feeds "?per_film=true" || rc=1
trigger_and_wait link || rc=1
trigger_and_wait synthesize || rc=1     # NEW — runs after link
```

Update the workflow's header comment (the tmdb → feeds → link → synthesize ordering). The hourly
workflow is unchanged (it only runs Phase-A feeds).

## Config & admin runs — no change

`summary_model` (default `claude-haiku-4-5`), `summary_use_batches` (default `True`), and
`summary_prompt_version` (default `"1"`) already exist in `config.py`. `admin_runs` reads runs by
`kind` data-drivenly, so `synthesize` runs surface automatically — assert it in a test, no code change.

## Testing (TDD, Anthropic mocked via fakes — never live)

- **Selection:** new selected; `updated_at`-stale selected; `prompt_version`-mismatch selected;
  up-to-date event skipped.
- **Pipeline, both paths** (fake `Completer` and fake `BatchCompleter`, mirroring link's fakes):
  fresh event → summary stored (`is_new`); grown event (bumped `updated_at`) → re-summarized
  (`refreshed`, new `source_updated_at`); `prompt_version` bump → re-summarized; no-op re-run
  (nothing missing/stale → zero processed, run still `succeeded`); idempotent upsert (running
  twice → one row, refreshed `generated_at`); per-event failure isolation (one event's failure
  doesn't roll back others; `failed` counted); `detail` counts correct.
- **Trigger:** `POST /admin/ingest/synthesize` → 202 + `run_id`; a `synthesize` run is created;
  the run appears in `/admin/runs`.
- **Migration:** `synthesize` kind accepted post-migration; round-trips.
- `task test` / `task lint` / `task typecheck` green (`task format` first).

> **Integration-test quirk (CLAUDE.md):** running a single integration file in isolation errors
> with a pytest-asyncio session-loop warning — run the whole suite or scope to a directory.

## File-by-file change summary

| File | Change |
|---|---|
| `src/upmovies/synthesize/pipeline.py` | **new** — `run_synthesize_ingest`, `SynthesizeResult`, sequential + batched stages, selection, mapping, upsert |
| `src/upmovies/synthesize/__init__.py` | re-export the two new symbols |
| `src/upmovies/ingest/models.py` | extend `ck_ingest_run_kind` to include `synthesize` |
| `migrations/versions/*` | **new** hand-written migration (drop + recreate the CHECK constraint) |
| `src/upmovies/routers/ingest_admin.py` | `_background_synth` + `POST /admin/ingest/synthesize` |
| `.github/workflows/daily-pipeline.yml` | add `synthesize` step after `link` + header comment |
| `tests/unit/synthesize/`, `tests/integration/…` | pipeline (both paths), selection, trigger, migration tests |

## Local verification (the originating goal)

After merge, against localdev (which already holds 235 films / 197 events / 0 summaries):
`task up`, then `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://…/admin/ingest/synthesize`
(set `SUMMARY_USE_BATCHES=false` in the backend `.env` for immediate results, and ensure
`ANTHROPIC_API_KEY` is set). All 197 events get summarized and the home page "Latest Updates"
populates.
