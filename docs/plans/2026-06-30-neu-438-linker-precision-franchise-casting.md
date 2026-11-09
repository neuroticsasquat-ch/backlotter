# NEU-438 — Linker precision: untracked-franchise casting traps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the LLM linker from attaching franchise-generic casting stories (e.g. "the next Batman", actually about untracked *Batman: Knightfall*) to the wrong tracked film.

**Architecture:** Prompt tuning, not code logic. Strengthen `_INSTRUCTIONS` in `link/linker.py` and add labeled regression rows to the validation set. Verification is the `diagnose_linking.py` harness (an LLM run — probabilistic, not a deterministic unit test).

**Tech Stack:** Python 3.13, pytest, Anthropic Messages API (Haiku), the existing `link/` module and `tests/fixtures/link/validation_set.json`.

## Global Constraints

- Everything runs in the container via `task` — never run `pytest`/`ruff`/`pyright`/`python` on the host.
- `task test`, `task lint`, `task typecheck` must be green before done; `task format` reformats.
- Modern type hints (`X | None`); no `from __future__ import annotations`. ruff line length 100.
- Commits: Conventional Commits subject, no Linear ID in subject (optional `Refs NEU-438.` in body), no Claude footer, no `Co-Authored-By`.
- Branch: `tom/neu-438-improve-linker-precision-against-untracked-franchise-casting`.
- `ValidationItem` (`link/validation.py`) ignores unknown JSON keys; a no-match row is `relation: "none"` with **no** `expected_film_tmdb_id`. `untracked_film` may be added as a human annotation but is not validated.

---

### Task 1: Capture the real offending story + siblings into the validation set

**Files:**
- Modify: `tests/fixtures/link/validation_set.json`
- Test: `tests/unit/link/test_validation.py` (existing — confirms the set still loads)

**Interfaces:**
- Consumes: `load_validation_set(path)` → `list[ValidationItem]` (already exists).
- Produces: new `relation: "none"` rows used by `diagnose_linking.py` in Task 3.

- [ ] **Step 1: Pull the real story text from prod** (the dev DB may not hold the exact item). On the VM, in the backend container:

```bash
docker exec -i <upmovies-backend-container> python - <<'PY'
import asyncio, json
from sqlalchemy import select
from upmovies.db import SessionLocal
from upmovies.news.models import Story

async def main():
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(Story).where(Story.title.ilike("%the next batman%")
                                 | Story.title.ilike("%knightfall%"))
        )).scalars().all()
        for st in rows:
            summary = (st.raw or {}).get("summary", "") if isinstance(st.raw, dict) else ""
            print(json.dumps({"url": st.url, "source": st.source,
                              "title": st.title, "summary": summary[:500]}))
asyncio.run(main())
PY
```

Copy the row for "Warner Bros. Officially Casts The Next Batman" plus one or two genuinely
franchise-generic siblings (a casting/announcement headline that does **not** name the exact
tracked film). Skip headlines that literally contain "Knightfall" — those already classify as
no-match and don't exercise the regression.

- [ ] **Step 2: Append the rows as no-match** to the end of the JSON array in
`tests/fixtures/link/validation_set.json` (use the real `url`/`source`/`title`/`summary` from
Step 1; the example below shows the shape, including the optional human annotation):

```json
  {
    "url": "<real google-news url>",
    "source": "ScreenRant",
    "title": "Warner Bros. Officially Casts The Next Batman",
    "summary": "<real dek captured in Step 1>",
    "relation": "none",
    "untracked_film": true
  }
```

- [ ] **Step 3: Confirm the set still parses** (schema + the `_check_consistency` validator):

Run: `task test -- tests/unit/link/test_validation.py -v`
Expected: PASS (all rows load; the new `none` rows carry no `expected_film_tmdb_id`).

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/link/validation_set.json
git commit -m "test: add untracked-franchise casting no-match cases to link validation set"
```

---

### Task 2: Tighten the linker prompt against franchise-generic casting

**Files:**
- Modify: `src/upmovies/link/linker.py` (the `_INSTRUCTIONS` string, the "Be strict about
  same-titled / substring traps" paragraph)

**Interfaces:**
- Consumes: nothing new.
- Produces: a revised system prompt; the prompt-cache prefix length changes, which is expected
  and harmless (the cache key is content-addressed).

- [ ] **Step 1: Extend the substring-trap paragraph.** Replace the existing paragraph:

```python
Be strict about same-titled / substring traps: the tracked film "Runner" is not \
"showrunner" or "Blade Runner". Use the year, original title, genres, and overview to \
disambiguate.
```

with:

```python
Be strict about same-titled / substring traps: the tracked film "Runner" is not \
"showrunner" or "Blade Runner". Use the year, original title, genres, and overview to \
disambiguate.

Be strict about franchise-generic casting/announcement traps: a story that refers to a \
franchise only generically — "the next Batman", "a new Spider-Man", "the next James Bond" — \
is NOT necessarily about the tracked film that happens to share that franchise. Studios run \
multiple films per franchise, and many are not tracked here. Link such a story only when it \
unambiguously identifies the exact roster film (its distinct subtitle, year, or director). \
When the only roster candidate is a DIFFERENT entry in the same franchise, return no-match — \
do not force a nearest-match.
```

- [ ] **Step 2: Lint/format/typecheck** (no behavioral test here — the change is prompt text):

Run: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 3: Run the existing linker unit tests** (they use a fake completer and must be
unaffected by prompt wording):

Run: `task test -- tests/unit/link/test_linker.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/upmovies/link/linker.py
git commit -m "feat: guard linker against franchise-generic casting traps"
```

---

### Task 3: Verify against the diagnose harness (manual, LLM run)

**Files:** none (verification only).

**Interfaces:**
- Consumes: `scripts/diagnose_linking.py`, `tests/fixtures/link/validation_set.json`, the live
  catalog roster (the script reads `catalog.film` from the configured DB), `ANTHROPIC_API_KEY`.

> This step makes real (cheap) Haiku calls and reads the roster from the DB the container is
> pointed at. It is a measurement, not a CI gate — the linker's output is probabilistic.

- [ ] **Step 1: Run the diagnosis** inside the container:

```bash
task shell
python scripts/diagnose_linking.py
```

- [ ] **Step 2: Read the output and confirm the fix.** Verify:
  - Under **FALSE POSITIVES**, the "Warner Bros. Officially Casts The Next Batman" row no
    longer appears linked to *The Batman: Part II*.
  - Under **FALSE NEGATIVES**, no genuine Part II story (logo reveal, Penguin confirmation,
    Charles Dance casting, etc.) has newly regressed to wrong-film/declined.
  - The **FLOOR SWEEP** precision at the current floor did not drop.

- [ ] **Step 3: If a genuine Part II story regressed to no-match,** the new paragraph is too
broad. Soften the final sentence to require the candidate be a *different* entry **with its own
distinct title** before declining, re-run Step 1. Do not add a third fix without re-reading the
output (see superpowers:systematic-debugging).

- [ ] **Step 4: Record the result** in the PR description (paste the before/after FP and FN
lines from the diagnosis). No commit.

---

## Self-Review

- **Spec coverage:** validation rows (Task 1) ✓, prompt rule (Task 2) ✓, diagnose verification
  with no-regression check (Task 3) ✓. Out-of-scope (tracking Knightfall) correctly excluded.
- **Placeholders:** the only "fill in" is real story text, captured by an exact command in
  Task 1 Step 1 — not a placeholder.
- **Consistency:** `relation: "none"` rows match `ValidationItem`'s validator (no
  `expected_film_tmdb_id`).

## Execution Handoff

This is a 3-task, mostly-manual tuning plan. Recommend **inline execution** (the diagnose step
is interactive and needs the API key), with the PR capturing the before/after diagnosis.
