# Harden Summary JSON Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `parse_summary` from dropping ~1.4% of summaries when the model emits a malformed `{"summary": "..."}` envelope, by adding a permissive recovery fallback that salvages the summary value.

**Architecture:** A single self-contained change in `src/upmovies/synthesize/summarizer.py`. `parse_summary` keeps strict `json.loads` as the fast path; on `json.JSONDecodeError` it calls a new `_recover_summary` helper that regex-extracts the `summary` value, logs one `WARNING`, and returns it. The function signature is unchanged, so both the sequential (`summarize_event`) and batched (`pipeline.py:207`) call sites inherit the fix with no other edits.

**Tech Stack:** Python 3.12, `json` + `re` + `logging` (stdlib only — no new dependency), pytest, go-task (`task …`) running inside the backend Docker container.

## Global Constraints

- One backend PR on branch `tom/neu-366-backend-harden-summary-json-parsing-parse_summary-drops-14`.
- Scope is **only** `src/upmovies/synthesize/summarizer.py` + `tests/unit/synthesize/test_summarizer.py`. No `pipeline.py`, config, DB migration, or FE changes.
- Python style: modern `X | None` union syntax; no `from __future__ import annotations`.
- All commands run through go-task inside the container (`task test` → `pytest` in the container). Keep the container up (`task up`).
- Pre-commit hooks delegate into the container — commit normally, **never** `--no-verify`. Run `task format` before committing.
- Conventional-commit subject with the Linear ID parenthetical; no `Co-Authored-By` trailer; no footer in the commit message.
- TDD: failing test first, minimal implementation, green, commit.

---

### Task 1: Tolerant `parse_summary` with `_recover_summary` fallback

**Files:**
- Modify: `src/upmovies/synthesize/summarizer.py` (add `import logging`, `import re`; add module logger + two regex constants; add `_recover_summary`; rework `parse_summary`)
- Test: `tests/unit/synthesize/test_summarizer.py` (add four cases; existing cases must stay green)

**Interfaces:**
- Consumes: existing `_extract_json_object(text: str) -> str` (unchanged).
- Produces:
  - `parse_summary(raw: str) -> str` — **signature unchanged.** Returns the stripped summary. Recovers via fallback on `json.JSONDecodeError` when the `summary` value is salvageable (logs `WARNING`); re-raises the original `json.JSONDecodeError` when unrecoverable; raises `ValueError` when valid JSON carries a missing/empty `summary`.
  - `_recover_summary(candidate: str) -> str | None` — permissive value extractor; `None` when nothing usable is found.

- [ ] **Step 1: Write the failing tests**

Add these four tests to `tests/unit/synthesize/test_summarizer.py` (alongside the existing `test_parse_summary_*` tests). Do **not** modify the existing tests — they encode the contract that must be preserved.

```python
def test_parse_summary_recovers_unescaped_inner_quote(caplog):
    raw = '{"summary": "Netflix calls it "the one" of the franchise."}'
    with caplog.at_level("WARNING"):
        assert parse_summary(raw) == 'Netflix calls it "the one" of the franchise.'
    assert "recovered summary from malformed" in caplog.text


def test_parse_summary_recovers_control_char_in_value():
    raw = '{"summary": "Filming\x01wrapped in Atlanta."}'
    assert parse_summary(raw) == "Filming wrapped in Atlanta."


def test_parse_summary_recovers_from_fenced_malformed_envelope():
    raw = 'Sure:\n```json\n{"summary": "She said "yes" to the role."}\n```'
    assert parse_summary(raw) == 'She said "yes" to the role.'


def test_parse_summary_happy_path_does_not_warn(caplog):
    with caplog.at_level("WARNING"):
        assert parse_summary('{"summary": "A clean update."}') == "A clean update."
    assert "recovered summary from malformed" not in caplog.text
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -v -k recover or happy_path_does_not_warn`

Expected: the three `recover` tests FAIL with `json.decoder.JSONDecodeError` raised out of `parse_summary` (the malformed envelopes are not yet salvaged). `test_parse_summary_happy_path_does_not_warn` PASSES already (no warning is emitted today) — that's fine; it guards against future regressions.

- [ ] **Step 3: Add the module logger and regex constants**

In `src/upmovies/synthesize/summarizer.py`, add `import logging` and `import re` to the import block (next to `import json`). Then, just below the existing `_DEK_MAX` / `_MAX_TOKENS` constants, add:

```python
log = logging.getLogger(__name__)

# Permissive recovery for malformed `{"summary": "..."}` envelopes (NEU-366). The greedy
# capture runs to the last quote before the closing brace, so an unescaped inner quote is
# captured as text rather than treated as the string terminator. Safe because the prompt
# mandates a single-key object.
_SUMMARY_VALUE_RE = re.compile(r'"summary"\s*:\s*"(.*)"\s*}?\s*$', re.DOTALL)
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f]+")
```

- [ ] **Step 4: Add the `_recover_summary` helper**

Add this function immediately above `parse_summary`:

```python
def _recover_summary(candidate: str) -> str | None:
    """Permissive fallback for when strict JSON parsing fails: pull the `summary` value by
    regex (greedy to the last quote before the closing brace, so an unescaped inner quote is
    captured as text), strip ASCII control chars, and collapse whitespace. Returns the cleaned
    summary, or None if nothing usable is found."""
    match = _SUMMARY_VALUE_RE.search(candidate)
    if match is None:
        return None
    value = _CONTROL_CHARS_RE.sub(" ", match.group(1))
    value = " ".join(value.split())
    return value or None
```

- [ ] **Step 5: Rework `parse_summary` to strict-first with the recovery fallback**

Replace the existing `parse_summary` body with:

```python
def parse_summary(raw: str) -> str:
    """Extract the JSON object, read its `summary`, and return it stripped. On malformed JSON
    (`json.JSONDecodeError`), fall back to a permissive recovery of the `summary` value and log
    a WARNING; if recovery also fails, the original `JSONDecodeError` propagates. Raises
    `ValueError` when valid JSON carries a missing/empty `summary`."""
    candidate = _extract_json_object(raw)
    try:
        obj = json.loads(candidate)
    except json.JSONDecodeError:
        recovered = _recover_summary(candidate)
        if recovered:
            log.warning(
                "parse_summary recovered summary from malformed JSON envelope: %r", raw[:500]
            )
            return recovered
        raise
    summary = obj.get("summary") if isinstance(obj, dict) else None
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError(f"no usable summary in model output: {raw!r}")
    return summary.strip()
```

- [ ] **Step 6: Run the full summarizer test module to verify green (new + existing)**

Run: `task test -- tests/unit/synthesize/test_summarizer.py -v`

Expected: PASS — the four new tests pass, and every pre-existing `test_parse_summary_*` test still passes, including `test_parse_summary_raises_on_malformed` (`"not json at all"` → no `summary` match → `_recover_summary` returns `None` → original `JSONDecodeError` re-raised) and the two `ValueError` cases (valid JSON path, recovery never invoked).

- [ ] **Step 7: Run the full local CI gate**

Run, in order:

```bash
task format
task lint
task typecheck
task test
```

Expected: `format` makes no/cosmetic changes, `lint` and `typecheck` clean, full `test` suite green.

- [ ] **Step 8: Commit**

```bash
task format
git add src/upmovies/synthesize/summarizer.py tests/unit/synthesize/test_summarizer.py
git commit -m "fix(synthesize): recover summary value from malformed JSON envelopes (NEU-366)"
git push
```

(`task format` is repeated immediately before `git add` so the committed tree matches what the pre-commit hook checks — avoids the "hook reformats, commit fails after push" footgun.)

---

## Self-Review

**1. Spec coverage** — every spec section maps to Task 1:
- Tolerant recovery, strict-first → Steps 4–5.
- Regex greedy-to-last-quote + control-char strip + whitespace collapse → Step 3 (`_SUMMARY_VALUE_RE`, `_CONTROL_CHARS_RE`) + Step 4.
- `WARNING`-only observability, raw truncated to 500 chars → Step 5 `log.warning(... raw[:500])`; happy-path-no-warn asserted in Step 1.
- Signature unchanged / both call paths covered / no `pipeline.py` change → "Interfaces" block + Global Constraints.
- Unrecoverable re-raises `JSONDecodeError`; valid-JSON-empty raises `ValueError` → Step 5 + Step 6 expectations.
- No backfill, no schema/config/FE → Global Constraints (out of scope by omission).
- TDD coverage cases (happy path unchanged, unescaped quote, control char, fenced+malformed, valid-empty, unrecoverable) → Steps 1 & 6.

**2. Placeholder scan** — no TBD/TODO/"handle edge cases"; all code blocks are complete and final.

**3. Type consistency** — `_recover_summary(candidate: str) -> str | None` and `parse_summary(raw: str) -> str` are referenced identically in the Interfaces block, Step 4, and Step 5. `_extract_json_object` is used unchanged with its real signature.

## Execution Handoff

This is a single-task plan → a single backend PR (per the spec's "one PR"). Implement in a **Sonnet/high** session per the model/effort workflow; this Opus session produced the plan only. Do not auto-start implementation.
