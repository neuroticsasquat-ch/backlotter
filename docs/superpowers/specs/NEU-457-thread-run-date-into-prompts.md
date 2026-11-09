# NEU-457 — Thread current run date into LINK / CLUSTER / SUMMARIZE prompts

- **Ticket:** [NEU-457](https://linear.app/neuroticsasquatch/issue/NEU-457/thread-current-run-date-into-link-cluster-summarize-prompts) `[backend]` (enabler)
- **Project / milestone:** backlotter: Maintenance
- **Related (this enables):** [NEU-453](https://linear.app/neuroticsasquatch/issue/NEU-453) (synthesis confused trailer vs. film release date — tense), [NEU-449](https://linear.app/neuroticsasquatch/issue/NEU-449) (old casting resurfaced as new — staleness), [NEU-451](https://linear.app/neuroticsasquatch/issue/NEU-451) (already-scheduled film given a release-day event — recency).
- **Shape:** single backend PR. No migration, no DTO/public-shape change, no frontend change. One config default bump (`SUMMARY_PROMPT_VERSION`).

## Problem

None of the three LLM prompts (LINK, CLUSTER, SUMMARIZE) knows "today's date." Their system instructions are static constants and their user payloads carry only story/event content — no temporal anchor. So the model cannot reason about whether a date is in the future, whether an article is stale, or whether a film is already scheduled. This is the shared root gap behind three temporal bugs (NEU-453/449/451).

This ticket is the **enabler**: make the pipeline run date present in each prompt so those three bugs can build their behavioral fixes on top of it. The behavioral prompt-tuning (tense rules, staleness thresholds, already-scheduled logic) belongs to the downstream tickets and is **out of scope here** — see Scope boundaries.

## Chosen approach

Locked in brainstorming:

1. **Value.** Capture `run_date = datetime.now(UTC).date()` once at the top of each orchestrator (`run_link_ingest`, `run_synthesize_ingest`) — the same clock already used for the recency `cutoff` (`link/pipeline.py:293`), so no extra DB read. Day granularity is enough for recency / tense / future reasoning. Thread it down as a `date` and render it as an ISO `"YYYY-MM-DD"` string at the payload boundary.
   - LINK and CLUSTER both run inside `run_link_ingest`, so they share one `run_date`.
   - SUMMARIZE gets its own `run_date` from `run_synthesize_ingest`.
   - Rejected: loading `IngestRun.started_at` (an extra DB read for a value within seconds of `now(UTC)`); threading a full datetime (more precision than temporal reasoning needs).

2. **Injection point — `as_of_date` in the user payload (all three).** Each prompt's user-message JSON gains an `as_of_date` field; each system `_INSTRUCTIONS` gains one static sentence pointing at it. This keeps every system block **byte-stable**, so LINK's prompt-cached system block (`link/linker.py:135`, `cached_system_block`) is fully preserved. It is consistent across all three modules and trivially assertable in the existing capture-based tests.
   - Rejected: putting a daily-changing date string into the (cached) system text; a per-prompt hybrid.

3. **Scope — plumbing + one neutral instruction line per prompt.** No bug-specific reasoning wording lives here.

## The change

`run_date` is baked into the prompt at **build time**, which is correct for both the sequential path and the batched path (the batch API processes submissions later, but the prompt string is fixed at submission).

### SUMMARIZE — `synthesize/summarizer.py` + `synthesize/pipeline.py`

- `_event_payload(event)` (`summarizer.py:126`) — add `"as_of_date": run_date.isoformat()` to the returned dict. The payload is already a JSON object, so this is a single new key.
- `build_summary_request(event, run_date)` (`:195`) — accept `run_date: date`, pass to `_event_payload`.
- `build_summary_batch_request(*, custom_id, model, event, run_date)` (`:209`) — accept and forward `run_date`.
- `summarize_event(*, client, model, prompt_version, event, run_date)` (`:218`) — accept and forward `run_date`.
- `_INSTRUCTIONS` (`:38`) — append the SUMMARIZE line (below).
- `synthesize/pipeline.py`:
  - `run_synthesize_ingest` (`:233`) — capture `run_date = datetime.now(UTC).date()`; thread into both stages.
  - `_summary_stage_sequential` (`:139`) — accept `run_date`, pass to `summarize_event`.
  - `_summary_stage_batched` (`:173`) — accept `run_date`, pass to `build_summary_batch_request`.

**Prompt version bump (required).** `_select_pending` re-summarizes events whose stored `prompt_version` differs from the current one (`synthesize/pipeline.py:71`); the current value is the config default `summary_prompt_version = "4"` (`config.py:46`, env `SUMMARY_PROMPT_VERSION`), passed at `routers/ingest_admin.py:154`. Because we are changing the SUMMARIZE prompt contract, bump the **default** from `"4"` to `"5"` in `config.py` so existing summaries get regenerated with the date-aware prompt on the next synthesize run.

### LINK — `link/linker.py` + `link/pipeline.py`

- `build_link_request(roster, stories, run_date)` (`:128`) — today the user message is a **bare JSON array** of stories (`_story_payload`, `:109`). Wrap it into an object:
  ```python
  payload = {"as_of_date": run_date.isoformat(), "stories": _story_payload(stories)}
  messages = [{"role": "user", "content": json.dumps(payload)}]
  ```
  The cached system block (`cached_system_block(_INSTRUCTIONS + roster)`, `:135`) is **unchanged** except for the new instruction sentence baked into the `_INSTRUCTIONS` constant.
- `build_batch_request(..., run_date)` (`:140`) — accept and forward `run_date` to `build_link_request`.
- `link_story_batch(*, client, model, roster, stories, floor, run_date)` (`:211`) — accept and forward `run_date`.
- `_INSTRUCTIONS` (`:22`) — describe the new payload shape (object with `as_of_date` + `stories`) and append the LINK line (below).

### CLUSTER — `link/cluster.py` + `link/pipeline.py`

- `assemble_cluster_payload(film_title, film_year, existing_payload, new_payload, run_date)` (`:176`) — the `user` dict is already an object (`film`/`existing_events`/`new_stories`); add `"as_of_date": run_date.isoformat()`.
- `build_cluster_request(session, film_id, attach_limit, run_date)` (`:196`) — accept and forward `run_date`.
- `build_cluster_batch_request(..., run_date)` (`:399`) — accept and forward `run_date`.
- `cluster_film_events(session, *, client, model, film_id, attach_limit, max_tokens, unresolved_tier, run_date)` (`:425`) — accept and forward `run_date`.
- `_INSTRUCTIONS` (`:63`) — append the CLUSTER line (below).

### LINK/CLUSTER orchestration — `link/pipeline.py`

- `run_link_ingest` (`:272`) — capture `run_date = datetime.now(UTC).date()` alongside the existing `cutoff` computation (`:293`); thread the single value into all four stage helpers.
- `_link_stage_sequential` (`:57`) / `_link_stage_batched` (`:92`) — accept `run_date`, pass to `link_story_batch` / `build_batch_request`.
- `_cluster_stage_sequential` (`:164`) / `_cluster_stage_batched` (`:202`) — accept `run_date`, pass to `cluster_film_events` / `build_cluster_batch_request`.

## The three neutral instruction lines

Generic pointers only — no bug-specific thresholds or logic:

- **LINK** `_INSTRUCTIONS`: *"The input includes `as_of_date`, the date this run executed (UTC). Treat it as 'today' when judging how recent or stale a story is."* (Also update the sentence that currently describes the input as a JSON array of stories to describe the wrapping object.)
- **CLUSTER** `_INSTRUCTIONS`: *"The payload includes `as_of_date`, today's date (UTC). Use it to reason about whether an event is recent, upcoming, or already past."*
- **SUMMARIZE** `_INSTRUCTIONS`: *"The payload includes `as_of_date`, today's date (UTC). Use it to get tense and relative dates right — do not describe something that happened on or before this date as if it were in the future."* (Acceptance explicitly calls out SUMMARIZE tense — this line is generic framing, the specific NEU-453 fix stays in that ticket.)

## Scope boundaries

**In scope:**

- Threading `run_date` (as above) through both stages' sequential and batched paths.
- `as_of_date` in all three user payloads; the LINK payload array→object wrap.
- One neutral instruction sentence per prompt.
- `SUMMARY_PROMPT_VERSION` default bump `"4"` → `"5"`.
- Tests (below).

**Out of scope (deliberate — owned by the downstream tickets):**

- SUMMARIZE tense/date correctness fix — NEU-453.
- LINK staleness rules (old news resurfacing) — NEU-449.
- CLUSTER already-scheduled / release-day reasoning — NEU-451.
- Any staleness thresholds, cutoffs, or per-event temporal logic beyond making the date available.
- LINK/CLUSTER prompt versioning (no persisted version exists; they run fresh each pipeline run).
- Any migration, DTO/public-shape change, or frontend change.

## Testing (TDD — failing test first)

Existing unit tests use capture-based fakes (`FakeClient` in `tests/unit/link/test_linker.py`; pure assembly in `tests/unit/link/test_cluster_pure.py`; `FakeCompleter` / `FakeBatchCompleter` in `tests/unit/synthesize/test_summarizer.py`) that assert on the built `(system, messages)`. Run integration tests as a directory/suite, not a single file (known pytest-asyncio quirk).

- **SUMMARIZE** (`test_summarizer.py`): pass a known `run_date` into `build_summary_request`; assert the user payload JSON contains `"as_of_date": "YYYY-MM-DD"` matching it. Assert the SUMMARIZE instruction sentence is present in `_INSTRUCTIONS`.
- **LINK** (`test_linker.py`): update `test_build_link_request_uses_cached_roster_and_story_payload` for the new wrapped object shape (`{"as_of_date", "stories"}`); assert `as_of_date` matches a known `run_date`. Confirm `test_roster_is_sent_as_cached_system_block` still passes unchanged (system block byte-stable apart from the constant's new sentence).
- **CLUSTER** (`test_cluster_pure.py`): assert `assemble_cluster_payload` includes `as_of_date` in the user object; the existing `system == [{"type": "text", "text": _INSTRUCTIONS}]` assertion stays valid (only the constant's text changed).
- **Threading**: a light check that each orchestrator passes today's date through to the builder (either an integration assertion on the captured payload, or a stage-level unit test feeding a fixed `run_date`).
- **Prompt-version regression**: assert the effective default `summary_prompt_version` is `"5"` (guards against forgetting the bump, which would leave old summaries un-regenerated).

## Definition of done

- `run_date` (= `datetime.now(UTC).date()`, ISO-rendered) present as `as_of_date` in the LINK, CLUSTER, and SUMMARIZE user payloads, via both sequential and batched paths.
- One neutral instruction sentence added to each of the three `_INSTRUCTIONS`; LINK's payload-shape sentence updated for the array→object wrap.
- `SUMMARY_PROMPT_VERSION` default bumped `"4"` → `"5"`.
- New/updated tests green; `task test`, `task lint`, `task typecheck` all green (`task format` applied).
- One backend PR on the `tom/neu-457-…` branch.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
