# Resolve the Google-News URL backlog: eligibility + throughput

- **Ticket:** [NEU-455](https://linear.app/neuroticsasquatch/issue/NEU-455/bug-lots-of-google-news-stories-still-using-google-news-urls-instead) `[backend]`
- **Project:** backlotter: Maintenance
- **Related / builds on:** [NEU-442](https://linear.app/neuroticsasquatch/issue/NEU-442) (Done, PR #91) shipped the Google-News → publisher URL decoder and the synthesis-pipeline resolution stage. This ticket fixes why the decoder, though working, never clears the backlog.
- **Shape:** single backend PR, no schema change, no new infra.

## Problem

NEU-442 built a working resolver (`news/resolve.py`, batchexecute decode) run as a sub-stage of the synthesize pipeline (`synthesize/url_resolution.py`). The decoder works in prod, but almost nothing gets resolved.

Prod diagnosis (2026-07-01):

- `news.story.resolve_state`: `none 17614`, `pending 1731`, `resolved 50`.
- All 1731 `pending` have `resolve_attempts = 0` — **never attempted**. The 50 `resolved` are all `attempts = 1` (clean first-try). `failed = 0` — the decoder is not the problem.
- `ingest.ingest_run` shows the resolution stage has run **once** since NEU-442 merged: a single synthesize run marked ~1781 stories eligible, drained its `RESOLVE_PER_RUN = 50` cap, and left 1731 pending.

Two root causes:

1. **Throughput.** Resolution runs only as a synthesize sub-stage, capped at a hardcoded `RESOLVE_PER_RUN = 50`. Synthesize runs **once daily**. So the ceiling is 50 resolutions/day against a backlog of 1731 that *grows* each run — it can never catch up (~35× underwater).
2. **Eligibility gap.** `mark_eligible` flips `none → pending` only for stories on *this run's* summarized events (`_select_pending`). Stable, already-displayed events never re-summarize, so their Google-News stories stay `none` forever. 892 currently-displayed stories are stuck this way.

Unresolved links are not broken — they fall back to the working `news.google.com` redirect (NEU-442). This is a trust/credibility gap, not an outage, so **resolution latency is non-urgent**.

## Goal

Every *displayed* Google-News story (linked to a film and attached to an event) resolves to its publisher URL within a few daily runs, and the mechanism keeps up with steady-state indefinitely without silently falling behind again.

## Key decisions

1. **Generalize eligibility instead of a one-time backfill.** Replace the per-run-scoped `mark_eligible` with an ongoing sweep that marks *every* displayed Google-News story still in `none`. This is self-healing — it absorbs the 892 today and any future stragglers automatically — and needs no throwaway backfill script.
   - This **deliberately reverses** NEU-442's "events synthesized after ship only" scoping. That scoping existed to avoid marking a huge backlog at once, but the marked set here is bounded and small (only *displayed* Google-News `none` stories: 892 now, ~0 steady-state once drained), so the original concern does not apply. Non-displayed stories (the 17k `none`) are never marked — they are not shown, so they never need resolving.
2. **Parameterize the resolution knobs** (currently hardcoded module constants) into env-aliased config, and raise the per-run default so the coupled daily drain both clears the backlog and keeps up.
3. **Keep resolution coupled to synthesize** (no decoupled cron). Once-daily is fine given graceful fallback; a bounded larger daily burst is simpler and adds no infra.
4. **Keep the existing rate-limit posture** (sequential, 1s politeness delay). A 500-request burst spans ~8 min. The knobs are now env-tunable so the burst can be lowered without a code change if Google throttles.

## Design

### Config — `config.py`

Add three env-aliased settings (matching the existing `Settings` pattern), replacing the hardcoded constants in `url_resolution.py`:

| Setting | Alias | Default |
|---|---|---|
| `url_resolve_per_run` | `URL_RESOLVE_PER_RUN` | `500` |
| `url_resolve_max_attempts` | `URL_RESOLVE_MAX_ATTEMPTS` | `3` |
| `url_resolve_delay_seconds` | `URL_RESOLVE_DELAY_SECONDS` | `1.0` |

### Eligibility — `synthesize/url_resolution.py`

Replace `mark_eligible(session, event_ids)` with `mark_displayed_eligible(session)`:

```python
async def mark_displayed_eligible(session: AsyncSession) -> int:
    """Flip every displayed Google-News story still in 'none' to 'pending'.
    'displayed' = attached to any event (news.event_story). Idempotent:
    only touches resolve_state='none' rows. Caller commits."""
```

- Select `Story` where `resolve_state = 'none'` and it has a matching `EventStory` row; filter to `is_google_news_url(url)`; `UPDATE ... SET resolve_state = 'pending'`.
- No `event_ids` parameter. `run_url_resolution` drops its `event_ids` parameter, and `run_synthesize_ingest` stops threading `event_ids` into the resolution stage.
- Terminal states (`resolved`, `failed`) are never re-marked, so `failed` stays terminal (no infinite retry).

### Drain — `synthesize/url_resolution.py`

`run_url_resolution` unchanged in behavior except:

- Accepts `per_run`, `max_attempts`, and `delay_seconds` (already has `per_run`/`delay_seconds`; add `max_attempts`, used in place of the `MAX_ATTEMPTS` constant in the cap-to-`failed` check).
- Still selects `pending` table-wide `ORDER BY id LIMIT per_run + 1`, logs cap truncation, commits per story, sequential with the politeness delay.
- Returns `ResolveResult` plus the marked-eligible count (see observability).

### Threading — `pipeline.py` + `routers/ingest_admin.py`

The synthesize trigger reads `Settings` and passes `url_resolve_*` values into `run_synthesize_ingest`, which forwards them to `run_url_resolution` — the same pattern already used for `model` / `prompt_version`.

### Observability

Add the marked-eligible count to the `ingest_run.detail` line, e.g.:
`... ; urls marked N, resolved X, failed Y, pending Z`.
So the first post-deploy run visibly shows the 892 sweep, and cap truncation remains logged.

## Rollout note

After deploy, watch the `failed` count over the first few daily runs. `resolved 50 → failed 0` at 50/run is our evidence the burst is safe; 500 is a 10× extrapolation. If `failed` climbs (Google throttling a larger burst), lower `URL_RESOLVE_PER_RUN` via env and `task up` — no code change. At 500/run the ~2,600 backlog (1731 pending + 892 newly-eligible) clears in ~5-6 daily runs.

## Testing (TDD, respx — never hit live Google)

- **Config:** the three aliases parse from env with the documented defaults.
- **`mark_displayed_eligible`:** flips displayed Google-News `none → pending`; leaves untouched — non-displayed `none`, non-Google-News stories, and rows already `pending`/`resolved`/`failed`; idempotent across repeated calls.
- **`run_url_resolution`:** honors injected `per_run` / `max_attempts` / `delay_seconds`; drains the whole `pending` table (not just one run's events); a backlog larger than `per_run` drains across successive runs; cap truncation logs; a `None` result increments attempts and flips to `failed` only at `max_attempts`.
- Resolver is injected/stubbed (respx): success, `None`, and cap-to-`failed` paths.

## Migration

None. `resolved_url` / `resolve_state` / `resolve_attempts` already exist (NEU-442).

## Out of scope

- Non-displayed `none` stories (not shown → never resolved).
- The decoder itself (`resolve.py`) — confirmed working, untouched.
- A decoupled/scheduled drain job (rejected: unnecessary infra for a once-daily, non-urgent link swap).
- Any frontend change; the API boundary (`SourceOut.url = resolved_url or url`) is already in place from NEU-442.
