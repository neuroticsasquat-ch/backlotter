# Harden Summary JSON Parsing: recover the summary value from malformed envelopes — Design

- **Date:** 2026-06-24
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-backend` — `synthesize` pipeline (`summarizer.py` only)
- **Linear:** NEU-366 (one PR, backend) · project *Movies: Content Quality* · milestone *MVP Quality Bar* · priority Low · labels backend, Improvement
- **Related:** NEU-359 (Done — trimmed the summary prompt to 1–2 sentences; established the `{"summary": "..."}` envelope this parses) · NEU-368 (tighten summary prompt — owns prompt wording, so this stays out of the prompt)

## Problem

During a re-synthesize, **4 of 293 events (~1.4%) failed in** `parse_summary` (`src/upmovies/synthesize/summarizer.py:115`) with `JSONDecodeError: Expecting ',' delimiter` at small char offsets (42–231). This is **not** truncation — `_MAX_TOKENS = 256` is ample for a 1–2 sentence summary, and the offsets are mid-string. The model emitted an invalid `{"summary": "..."}` envelope, almost certainly an **unescaped `"`** (or a raw control char) inside the summary string value, e.g.:

```
{"summary": "Netflix calls it "the one" of the franchise."}
                               ^ unescaped quote → strict json.loads aborts here
```

`parse_summary` does `json.loads(_extract_json_object(raw))` and raises. `_extract_json_object` only trims to the outer `{...}` braces — it does nothing about bad escaping *inside* the string, so the raise propagates.

### Impact

Both summary stages catch the raise per-event (`_summary_stage_sequential` and `_summary_stage_batched` in `pipeline.py` wrap each event in `try/except`, log, bump a `failed` counter, and continue), so one bad envelope never aborts the run. But the event gets **no `event_summary` row**, and the public read endpoints **inner-join `event_summary`** — so the event is silently excluded from the feed and film pages. Low severity, but it recurs on every run, and the lost events are real content a user would want.

The failure is **non-deterministic across runs** (the model may emit a clean envelope for the same event next time), which is why a parse-failed event self-heals eventually — but "eventually" is not good enough when a permissive parse can recover the text immediately and deterministically.

## What this changes

One change, entirely within `src/upmovies/synthesize/summarizer.py`: make `parse_summary` **tolerant**. Strict `json.loads` stays the fast path for the ~98.6% of envelopes that are well-formed; a permissive **recovery fallback** runs *only* when strict parsing raises `JSONDecodeError`, salvages the `summary` value, logs a `WARNING`, and returns it.

`parse_summary(raw) -> str` keeps its **exact signature**, so **neither call site changes**: the sequential path (`summarize_event`, `summarizer.py:164`) and the batched path (`pipeline.py:207`) both inherit the fix for free. The fix is structural across both paths because they already share this one function — the established sequential/batched parity property is preserved by construction.

### Out of scope

- **An LLM retry on parse failure.** Recovery is deterministic and free; a retry adds latency + cost, is awkward in the batch path (would need a re-submit or a sequential fallback), and would re-fail if the model reliably mangles a given input. Rejected.
- **Prompt changes** (instructing the model to escape quotes). LLMs escape unreliably, so it can reduce but not eliminate the failure, and the prompt wording is NEU-368's concern. The recovery is what actually *guarantees* the fix; the prompt is left alone.
- **A run-stat `recovered` counter.** Recoveries surface at `WARNING` level only (decision below). Threading a counter through `pipeline.py` + the run-stats surface is more plumbing than a recurring-but-low-severity issue warrants.
- **Backfill migration** for the already-dropped events — not needed (see below).
- **A new JSON-tolerant dependency** (`json5`/`dirtyjson`/etc.). A dependency-free regex recovery is sufficient for this single, well-characterized failure shape and keeps the change minimal.
- **Schema / DB migration / config / FE** — none.

## Key decision — strict first, permissive only on failure

The recovery parser is deliberately *not* the primary path. Strict `json.loads` is correct and unambiguous for well-formed envelopes; running a permissive regex on every response would risk silently accepting subtly-wrong text in the common case. So strict stays first and recovery is a `except JSONDecodeError` fallback. This keeps the normal path's behavior byte-for-byte identical and confines the new, looser logic to the exact case that is otherwise a hard failure.

### No backfill

The 4 already-dropped events have **no `event_summary` row**. `_select_pending` (`pipeline.py:54`) selects every event where `EventSummary.event_id IS NULL` (in addition to stale / prompt-version-mismatched rows), so those events are re-summarized on the **next synthesize run** and recovered then. Nothing to migrate or backfill — the fix applies itself on the next cadence run.

## Architecture — `src/upmovies/synthesize/summarizer.py`

Add a module logger (`log = logging.getLogger(__name__)`) and a private recovery helper; rework `parse_summary` to orchestrate strict → recover.

**`_recover_summary(candidate: str) -> str | None`.** Given the brace-trimmed candidate (output of `_extract_json_object`), pull the `summary` value with a permissive regex rather than a JSON parser:

```
_SUMMARY_VALUE_RE = re.compile(r'"summary"\s*:\s*"(.*)"\s*}?\s*$', re.DOTALL)
```

- The greedy `(.*)` runs to the **last** `"` before the closing `}`, so a stray unescaped `"` inside the value is captured as part of the text (the intended human string), not treated as the terminator. Safe because the prompt mandates a **single-key** object (`{"summary": "..."}`) — there is no second key whose quotes could be mis-captured.
- Strip ASCII control chars (`re.sub(r'[\x00-\x1f]+', ' ', value)`) — covers the "raw control char" failure mode — then collapse runs of whitespace and `.strip()`.
- Return the cleaned text, or `None` if there is no match or the result is empty.

**`parse_summary(raw: str) -> str`.** Behavior:

```
candidate = _extract_json_object(raw)
try:
    obj = json.loads(candidate)
except json.JSONDecodeError:
    recovered = _recover_summary(candidate)
    if recovered:
        log.warning("parse_summary recovered summary from malformed JSON envelope: %r", raw[:500])
        return recovered
    raise  # unrecoverable — preserve the original JSONDecodeError contract
summary = obj.get("summary") if isinstance(obj, dict) else None
if not isinstance(summary, str) or not summary.strip():
    raise ValueError(f"no usable summary in model output: {raw!r}")
return summary.strip()
```

- **Happy path unchanged:** a well-formed envelope with a non-empty `summary` returns exactly as today; `_recover_summary` is never invoked.
- **Malformed envelope, recoverable:** the `JSONDecodeError` branch salvages the value, logs one `WARNING` carrying the raw envelope (truncated to 500 chars) so recoveries are greppable, and returns it. The event gets a normal `event_summary` row and counts as a normal success (`new`/`refreshed`).
- **Parsed-but-no-summary** (valid JSON, missing/empty/`non-str` `summary`): unchanged — raises `ValueError`, as today.
- **Unrecoverable** (`JSONDecodeError` *and* recovery yields `None`): **re-raises the original `JSONDecodeError`** — preserving the existing contract (the current `test_parse_summary_raises_on_malformed` asserts `JSONDecodeError`). The call site logs + counts the event `failed`, it gets no row, and it is retried next run — identical to today's graceful behavior. Both `JSONDecodeError` and `ValueError` are caught by the pipeline's per-event `except Exception`, so the distinction is contract hygiene, not control flow.

The contract docstring is updated to note the recovery fallback and that `WARNING` is emitted on recovery. No change to `_extract_json_object`, `summarize_event`, `build_summary_request`, the batch builders, or anything in `pipeline.py`.

### Observability decision

A recovery emits a single `WARNING` from `parse_summary` (with the raw envelope) and nothing else — no run-stat counter, no metric. This makes recoveries visible and greppable in run logs for a recurring issue, with zero plumbing or schema change. `parse_summary` does not have the event id (it only receives `raw`), but the call sites already log the event id on hard failures, and the raw envelope in the `WARNING` identifies a recovery on its own.

## Testing (TDD; pure unit tests — no DB, no LLM)

Unit tests against `parse_summary` / `_recover_summary` (the function is self-contained and synchronous, so these are plain unit tests, not the integration `session` fixture). Extend the existing `tests/unit/synthesize/test_summarizer.py`, which already covers `parse_summary`.

- **Happy path unchanged** — a well-formed `{"summary": "…"}` returns the summary; assert recovery is *not* invoked (e.g. no `WARNING` emitted).
- **Unescaped inner quote** — `{"summary": "Netflix calls it "the one"."}` recovers `Netflix calls it "the one".` and emits a `WARNING`.
- **Raw control char in value** — an envelope with a literal control char recovers with the control char stripped/collapsed.
- **Markdown-fenced + malformed** — fenced prose wrapping a malformed envelope: `_extract_json_object` trims the fence, recovery still salvages the value.
- **Valid JSON, empty/missing `summary`** — still raises `ValueError` (recovery is only for `JSONDecodeError`, not for a parsed-but-empty summary). The two existing `ValueError` tests stay green unchanged.
- **Unrecoverable garbage** — malformed *and* no extractable `summary` value → re-raises `JSONDecodeError`, so the event is counted `failed` (current behavior + the existing `test_parse_summary_raises_on_malformed` preserved).
- **Whitespace/strip parity** — recovered text is stripped and internal whitespace collapsed, matching the happy-path `.strip()`.

`task format` first; `task test` / `task lint` / `task typecheck` all green. Commit normally — the backend's pre-commit hooks delegate into the container, so no `--no-verify`; keep the container up.

## Files touched (one backend PR, branch `tom/neu-366-backend-harden-summary-json-parsing-parse_summary-drops-14`)

- `src/upmovies/synthesize/summarizer.py` — module logger; new `_recover_summary` helper; `parse_summary` reworked to strict-first with a `JSONDecodeError` recovery fallback + `WARNING`. Docstring updated.
- `tests/unit/synthesize/test_summarizer.py` — recovery + regression cases above.

No `pipeline.py` change, no config, no DB migration, no FE.

## Delivery

One backend PR on the ticket's branch. This Opus session produced the design only; implement in a Sonnet/high session per the model/effort workflow. Run the full local CI (`task format` first, then `task test` / `task lint` / `task typecheck`) before pushing.
