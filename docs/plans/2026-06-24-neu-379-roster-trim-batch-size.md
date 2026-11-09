# NEU-379 — Cut Link Input Tokens: Roster Trim + Larger Batch Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 1 and 4 are **owner/manual** steps (real Anthropic key + tokens) — they are NOT CI and NOT done by the implementing agent; they bracket the code tasks as the quality gate.

**Goal:** Cut the link stage's per-run **input** tokens by trimming the cached film roster (the per-film 240-char overview dominates its size) and raising `LINK_BATCH_SIZE` (=15) so the whole-catalog roster ships fewer times per run — **without regressing link accuracy** measured by `scripts/validate_linking.py` against a captured baseline.

**Architecture:** Two small, surgical levers in the existing link path, each TDD'd in isolation, each measured:
1. **Roster trim** — `link/roster.py`: lower `_OVERVIEW_MAX` (240 → a smaller cap) and/or drop the lowest-value field from `_render`. The overview text is the bulk of every roster line; shrinking it shrinks the cached prefix that re-ships on every chunk. The linker prompt explicitly leans on *year / original title / genres / overview* to resolve substring traps ("Runner" vs "Blade Runner"), so the disambiguation fields **must stay present** — only the overview length (the least information-dense per character) is the safe primary lever.
2. **Batch size bump** — `config.py`: raise `link_batch_size` default. The roster is re-sent once per `LINK_BATCH_SIZE`-story chunk; larger chunks ⇒ fewer roster repetitions. Output is one small JSON object per story and `_MAX_TOKENS=2048` comfortably holds a larger chunk's array, and `_chunks` / the `range(0, len, batch_size)` slicing already handles arbitrary sizes — so no logic change is needed, only the default.

No schema change, no migration. The only production code touched is `link/roster.py` and `config.py` (plus their tests). The accuracy measurement lives entirely in the existing eval harness (`scripts/validate_linking.py`), run by the owner.

**Tech Stack:** Python 3.13, FastAPI, pydantic-settings, SQLAlchemy 2 (async), pytest (pytest-asyncio **auto** mode — no `@pytest.mark.asyncio`). **All tooling runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python` on the host.

## Global Constraints

- **One backend PR**, on branch `tom/neu-379-backend-cut-link-input-tokens-roster-trim-larger-batch-size`.
- **Container-only tooling:** `task test` (`task test -- tests/unit/...` to scope), `task lint`, `task typecheck`, `task format` — they `docker compose exec` into `upmovies-backend`. Keep the container up (`task up`). Use `task shell` to run the eval scripts inside the container (they need DB + the real key from `.env`).
- **Pre-commit hooks delegate into Docker** — commit normally, **no `--no-verify`**. Run `task format` *before* staging so the format-check hook passes.
- **Modern type hints** (`X | None`, `X | Y`); **NO** `from __future__ import annotations`. ruff line length **100** (rules E,F,W,I,B,UP).
- **TDD:** write the failing test first, watch it fail, then make it pass.
- **Before claiming code-side done:** `task test`, `task lint`, `task typecheck` all green (and `task format` applied).
- **Commit message:** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-379.` in body), **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. Prefer `/commit-msg`.
- **HARD QUALITY GATE (no merge without it):** This ticket is **quality-gated**. The PR may **not** merge until the owner has produced a **no-regression** result from `scripts/validate_linking.py` run *after* the code changes, compared against a baseline captured *before* any change (Task 1). If link accuracy (precision / recall / F1) or the news-value axis regresses materially vs baseline, the offending change is **reverted or retuned** (Task 4) — the trim/bump is not shipped on token savings alone. Before/after **token counts** (from NEU-375's `run_llm_usage` / the `/admin/runs` `llm_usage[]` link-stage input + cache tokens) **and** accuracy numbers are recorded in the milestone spec.
- **Dependency:** the token-measurement half of the gate relies on **NEU-375** (per-stage `run_llm_usage` + `/admin/runs` `llm_usage[]`) already being merged and present in the running stack. If NEU-375 is not yet deployed, the *accuracy* gate (Task 1/Task 4 `validate_linking.py`) is still fully runnable and is the **merge-blocking** half; the token delta is recorded as soon as NEU-375 telemetry is available (see Task 4 note).

---

### Task 1 — Capture the link-accuracy baseline (OWNER / MANUAL — not CI, not the implementing agent)

**Purpose:** Establish the **before** numbers the gate compares against. Run on the **current, unmodified** config (`_OVERVIEW_MAX=240`, `link_batch_size=15`, `link_model=claude-haiku-4-5`, `link_confidence_floor=0.7`). This costs a small amount of real Anthropic tokens — it is a deliberate owner step, not part of CI.

**Files (read-only):** `scripts/validate_linking.py`, `tests/fixtures/link/validation_set.json` (the committed ground truth — currently **286 items, 85 `about`/linkable**), `scripts/diagnose_linking.py` (optional, for explaining misses).

**Interfaces:**
- Consumes: the committed `validation_set.json` fixture (already present — built via the `export_link_validation_draft.py` → `propose_validation_labels.py` → review-HTML → curated `validation_set.json` workflow described in `tests/fixtures/link/README.md`; **no need to rebuild it** unless it is missing or stale).
- Produces: a recorded baseline block (precision / recall / F1 + TP/FP/FN/TN, plus the news-value axis numbers) pasted into the milestone spec.

- [ ] **Step 1: Confirm the fixture exists and is the committed ground truth**

  ```bash
  cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
  ls -l tests/fixtures/link/validation_set.json
  ```

  Expected: the file exists (it is committed; `validation_candidates.json` / `validation_review.html` are regenerable intermediates and gitignored). If it is **missing**, rebuild it per `tests/fixtures/link/README.md` (export draft → propose candidates with Sonnet → review in the HTML → curate ~150–200 rows) *before* proceeding — the gate is meaningless without it.

- [ ] **Step 2: Bring up the container with a real key**

  ```bash
  task up
  ```

  Expected: `upmovies-backend` running. `.env` must carry a real `ANTHROPIC_API_KEY` (the script reads `settings.anthropic_api_key`) and a `DATABASE_URL` pointing at a DB whose `catalog.film` roster covers the fixture's `expected_film_tmdb_id`s. The roster is built live from the DB (`build_roster`), so the **same DB / roster must be used for baseline and re-test** — otherwise the comparison is invalid.

- [ ] **Step 3: Run the baseline accuracy measurement**

  ```bash
  task shell
  # now inside the container:
  python scripts/validate_linking.py
  # (equivalent to: python scripts/validate_linking.py tests/fixtures/link/validation_set.json)
  ```

  The script: builds the live roster, replays the fixture stories through `link_story_batch` in `settings.link_batch_size` chunks at the real model + floor, then scores. Expected stdout shape (numbers illustrative — **record the real ones**):

  ```
  fixture: 286 items total, 85 'about' (linkable), 201 mention/none
  n=286  floor=0.7  model=claude-haiku-4-5
  TP=.. FP=.. FN=.. TN=..
  precision=0.xxx  recall=0.xxx  f1=0.xxx

  === NEWS-VALUE (production-news axis, 'about' rows) ===
  kept-real=.. kept-excluded(leak)=.. dropped-real=.. dropped-excluded=..
  precision=0.xxx  recall=0.xxx
  leaks by category: reaction=.., roundup=.., ...
  ```

  If the script warns `WARNING: N expected film(s) are not in the current roster`, the DB roster is incomplete for the fixture — fix the DB before trusting the baseline (those expected films can never be linked, depressing recall artificially).

- [ ] **Step 4: Record the baseline in the milestone spec**

  Paste the full output block (link precision/recall/F1 + confusion counts **and** the news-value axis) into `docs/specs/2026-06-24-llm-cost-token-efficiency-design.md` under a new "NEU-379 measurements" subsection, labeled **BASELINE (240-char overview, batch=15)**. This is the number the gate in Task 4 compares against. Optionally also run `python scripts/diagnose_linking.py` and save its false-negative/false-positive breakdown + floor sweep — it makes "did accuracy regress, and *where*" answerable after the change.

---

### Task 2 — Trim the roster (overview cap) — CODE + TDD

**Files:**
- Modify: `src/upmovies/link/roster.py` (`_OVERVIEW_MAX`, and the `_render` shape if a field is dropped)
- Modify: `tests/integration/link/test_roster.py` (assert the trimmed shape + that the disambiguation fields are still rendered)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: no new public symbols. `_OVERVIEW_MAX` value changes; `RosterEntry`, `Roster`, `build_roster`, `_render` signatures are **unchanged**. (`RosterEntry.overview` stays `str | None`; only the slice length differs.)

**Decision — what to trim (keep it small and measured):**
- **Primary lever: lower `_OVERVIEW_MAX` from `240` to `120`.** The overview is the longest part of each line and the least information-dense per character for disambiguation; year / original title / genres are short, high-signal, and the prompt names all four as the substring-trap discriminators — so halving the overview is the lowest-risk meaningful cut. Do **not** drop year, original title, or genres in this first pass — they are cheap and load-bearing.
- **Keep the overview field itself** (do not drop it to `None`): the prompt relies on it for plot-level disambiguation. Only its length is reduced. If Task 4 shows accuracy holds at 120 and more headroom is wanted, a *follow-up* could push lower or drop the single lowest-value field — but that is out of scope here unless the gate forces a retune.

- [ ] **Step 1: Create the work branch**

  ```bash
  cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
  git checkout main && git pull
  git checkout -b tom/neu-379-backend-cut-link-input-tokens-roster-trim-larger-batch-size
  ```

- [ ] **Step 2: Confirm the container is up**

  ```bash
  task up
  ```

  Expected: `upmovies-backend` running (needed for every `task` target).

- [ ] **Step 3: Write the failing roster-trim test**

  In `tests/integration/link/test_roster.py`, add a test that builds a film with an overview **longer than the new cap** and asserts the rendered text is truncated to the new length while the disambiguation fields survive. Add this after the existing `test_build_roster_includes_title_year_genre_and_index`:

  ```python
  async def test_overview_is_capped_but_disambiguation_fields_survive(session):
      from upmovies.link.roster import _OVERVIEW_MAX

      long_overview = "X" * 500
      film = Film(
          tmdb_id=2,
          title="Runner",
          original_title="Coureur",
          release_date=date(2026, 7, 15),
          overview=long_overview,
      )
      session.add(film)
      await session.flush()
      session.add(Genre(id=18, name="Drama"))
      await session.flush()
      session.add(FilmGenre(film_id=film.id, genre_id=18))
      await session.commit()

      roster = await build_roster(session)
      entry = roster.entries[0]

      # Overview is trimmed to the (newly reduced) cap.
      assert _OVERVIEW_MAX == 120
      assert entry.overview == "X" * 120
      assert ("X" * 120) in roster.text
      assert ("X" * 121) not in roster.text

      # The substring-trap discriminators the linker prompt relies on still render.
      assert "(2026)" in roster.text           # year
      assert "[orig: Coureur]" in roster.text  # original title
      assert "genres: Drama" in roster.text     # genres
  ```

- [ ] **Step 4: Run the new test and watch it fail**

  ```bash
  task test -- tests/integration/link/test_roster.py
  ```

  Expected: FAIL — `assert _OVERVIEW_MAX == 120` fails (`240 == 120`) and/or the `"X" * 121 not in roster.text` assertion fails because the source still slices to 240. (If you hit the known single-integration-file asyncio-loop quirk noted in CLAUDE.md, scope to the directory instead: `task test -- tests/integration/link`.)

- [ ] **Step 5: Lower the overview cap in `src/upmovies/link/roster.py`**

  Change line 14:

  ```python
  _OVERVIEW_MAX = 240
  ```

  to:

  ```python
  _OVERVIEW_MAX = 120
  ```

  Leave `_render` and `build_roster` otherwise unchanged — the slice `f.overview[:_OVERVIEW_MAX]` already applies the cap.

- [ ] **Step 6: Run the roster tests to confirm green**

  ```bash
  task test -- tests/integration/link/test_roster.py
  ```

  Expected: PASS — both `test_build_roster_includes_title_year_genre_and_index` (unaffected; its overview `"Epic."` is < 120) and the new `test_overview_is_capped_but_disambiguation_fields_survive` are green.

---

### Task 3 — Raise `LINK_BATCH_SIZE` default — CONFIG + TDD

**Files:**
- Modify: `src/upmovies/config.py:35` (`link_batch_size` default)
- Modify: `tests/unit/test_config.py` (add a default + env-override pair, mirroring the existing `link_use_batches` tests)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Settings.link_batch_size` default changes `15` → `30`. No new symbols. The chunking call sites (`validate_linking.py`, `diagnose_linking.py`, and the production `link/pipeline.py` chunker) all read `settings.link_batch_size` and slice with `range(0, len, batch_size)` / `_chunks`, which handle any positive size — **no call-site change needed**.

**Decision — new default:** raise `15` → `30`. This halves the number of roster repetitions per run (the roster ships once per chunk). The chunk's output is one small JSON object per story; even 30 objects sit far under `_MAX_TOKENS=2048`, so there is no truncation risk. 30 is a measured-conservative doubling rather than an aggressive jump — if Task 4 shows accuracy holds and the model handles the larger per-call story payload cleanly, a follow-up could push higher; if accuracy regresses, retune down (Task 4).

- [ ] **Step 1: Write the failing config tests**

  In `tests/unit/test_config.py`, add this pair after `test_settings_link_use_batches_override_from_env` (line ~89). It mirrors the existing `link_use_batches` default/override pattern and the `_set_required` helper already in the file:

  ```python
  def test_settings_link_batch_size_default(monkeypatch):
      _set_required(monkeypatch)
      monkeypatch.delenv("LINK_BATCH_SIZE", raising=False)
      s = Settings()  # type: ignore[call-arg]
      assert s.link_batch_size == 30


  def test_settings_link_batch_size_override_from_env(monkeypatch):
      _set_required(monkeypatch)
      monkeypatch.setenv("LINK_BATCH_SIZE", "10")
      s = Settings()  # type: ignore[call-arg]
      assert s.link_batch_size == 10
  ```

- [ ] **Step 2: Run the new config tests and watch the default test fail**

  ```bash
  task test -- tests/unit/test_config.py
  ```

  Expected: `test_settings_link_batch_size_default` FAILS (`assert 15 == 30`); `test_settings_link_batch_size_override_from_env` already PASSES (the env override works against the current default). This confirms the override path is intact and only the default needs bumping.

- [ ] **Step 3: Bump the config default in `src/upmovies/config.py`**

  Change line 35:

  ```python
  link_batch_size: int = Field(default=15, alias="LINK_BATCH_SIZE")
  ```

  to:

  ```python
  link_batch_size: int = Field(default=30, alias="LINK_BATCH_SIZE")
  ```

- [ ] **Step 4: Run the config tests to confirm green**

  ```bash
  task test -- tests/unit/test_config.py
  ```

  Expected: PASS — both new tests green; the rest of the file unaffected (no other test asserts `link_batch_size`).

- [ ] **Step 5: Run the full suite + lint + typecheck + format**

  ```bash
  task format
  task test
  task lint
  task typecheck
  ```

  Expected: all green. `task test` exercises the roster + config changes and the existing linker unit tests (`tests/unit/link/test_linker.py`) — none of which assert `_OVERVIEW_MAX` or `link_batch_size` values directly, so nothing else should break. If `task format` rewrites anything, re-run `task lint`.

- [ ] **Step 6: Commit (single commit for both code levers)**

  Generate the message with `/commit-msg`, or use:

  ```bash
  git add src/upmovies/link/roster.py src/upmovies/config.py \
          tests/integration/link/test_roster.py tests/unit/test_config.py
  git commit -m "perf: trim link roster overview and raise link batch size

  Halve the cached-roster per-film overview cap (240->120) and double
  LINK_BATCH_SIZE (15->30) so the whole-catalog roster ships fewer times
  per run, cutting link-stage input tokens. Disambiguation fields (year,
  original title, genres) are kept; the overview is only shortened.
  Gated on scripts/validate_linking.py: no link-accuracy regression vs the
  captured baseline (see milestone spec).

  Refs NEU-379."
  git push -u origin tom/neu-379-backend-cut-link-input-tokens-roster-trim-larger-batch-size
  ```

  (No `🤖` footer, no `Co-Authored-By` — repo convention. The footer belongs only in the PR body, via `/pr-desc`.)

---

### Task 4 — Re-measure & gate (OWNER / MANUAL — merge blocker)

**Purpose:** Prove the change does not regress accuracy and quantify the input-token win. This is the gate that decides whether the PR merges as-is, retunes, or reverts.

**Files (read-only):** `scripts/validate_linking.py`, `scripts/diagnose_linking.py`, and (for the token delta) the `/admin/runs` response / `run_llm_usage` table from **NEU-375**.

**Interfaces:**
- Consumes: the Task 1 baseline block in the milestone spec; the merged Task 2/3 code on the branch.
- Produces: an **AFTER (120-char overview, batch=30)** block in the milestone spec with link + news-value accuracy and the link-stage input/cache token delta; a go / retune / revert decision.

- [ ] **Step 1: Re-run the accuracy measurement on the branch**

  With the branch checked out and the container rebuilt off it (`task up`), against the **same DB/roster used for the baseline**:

  ```bash
  task shell
  python scripts/validate_linking.py
  ```

  Compare to the Task 1 baseline. **Pass condition:** link `precision`, `recall`, `f1` and the news-value `precision` / `recall` are **no worse than baseline** within noise (treat a drop greater than ~1–2 points on F1, or any new wrong-film false positive on a substring-trap case, as a regression). Run `python scripts/diagnose_linking.py` if F1 moved, to see whether new misses are below-floor, wrong-film, or declined — wrong-film misses on look-alike titles are the signal that the overview trim went too far.

- [ ] **Step 2: Measure the input-token delta (needs NEU-375 telemetry)**

  Trigger a real link ingest (e.g. `POST /admin/ingest/link` per the localdev notes) on the **old** config and the **new** config (or read a pre-change run vs a post-change run), then read the link stage's `llm_usage[]` from `GET /admin/runs*` (or the `ingest.run_llm_usage` row for the link stage). Record the **input** + **cache_read** + **cache_creation** token counts before vs after. The expected direction: lower per-run link input tokens (shorter roster × fewer roster repetitions). If NEU-375 is not yet deployed, mark the token delta **pending** and merge on the accuracy gate alone — but the spec must note the token number is still owed.

- [ ] **Step 3: Record AFTER numbers and decide**

  In the milestone spec's "NEU-379 measurements" subsection, add the **AFTER** block (accuracy + token delta) beside the baseline. Then:
  - **No regression** → the gate passes; the PR is mergeable. Note the measured input-token reduction.
  - **Accuracy regressed** → do **not** merge as-is. Retune on the branch (raise `_OVERVIEW_MAX` partway back toward 240, e.g. 180; and/or lower `link_batch_size` back toward 15), re-run Step 1, and re-record. If no setting both reduces tokens *and* holds accuracy, **revert** the offending lever (keep the one that passed; e.g. ship the batch bump but not the overview trim, or vice-versa) and document the rejection with evidence in the spec. The token win is never shipped at the cost of the quality bar this milestone exists to protect.

---

## Self-review

- **Spec coverage (T5 in `2026-06-24-llm-cost-token-efficiency-design.md`):**
  - "trim the roster (shorten `_OVERVIEW_MAX`, and/or drop low-value fields)" → Task 2 (lower `_OVERVIEW_MAX` 240→120; disambiguation fields explicitly kept, per the prompt's reliance on year/orig-title/genres/overview for substring traps).
  - "raise `LINK_BATCH_SIZE` so the roster ships fewer times" → Task 3 (15→30; `_MAX_TOKENS=2048` holds the larger output; chunkers already size-agnostic).
  - "gated on `validate_linking.py` (no link-accuracy regression vs baseline)" → Tasks 1 (baseline) + 4 (re-measure + decision), encoded as the HARD QUALITY GATE in Global Constraints.
  - "measured for input-token reduction via T1 [NEU-375]" → Task 4 Step 2 (read link-stage `llm_usage[]` / `run_llm_usage`), with the explicit fallback if NEU-375 telemetry isn't deployed yet.
  - "changes documented with before/after token + accuracy numbers" → Task 1 Step 4 + Task 4 Step 3 (BASELINE / AFTER blocks in the spec).
- **What `validate_linking.py` actually does (gate reality check):** real CLI is `python scripts/validate_linking.py [path]`, default path `tests/fixtures/link/validation_set.json`. It builds the live DB roster, replays each fixture story through `link_story_batch` at `settings.link_model` / `link_confidence_floor` / `link_batch_size`, and prints **two** metric blocks: link precision/recall/F1 + TP/FP/FN/TN (`compute_link_metrics`), and a news-value axis over `about` rows (`compute_news_value_metrics`). It is a clean pass/fail-able numeric gate. It needs a real `ANTHROPIC_API_KEY` and a DB whose roster covers the fixture's films (it warns when films are missing). The fixture is committed (currently 286 items / 85 `about`).
- **Placeholder scan:** none. Illustrative metric values in Task 1 Step 3 are clearly marked "record the real ones"; the `_OVERVIEW_MAX` (240→120) and `link_batch_size` (15→30) targets are concrete; all file paths, line numbers, and commands are real and were read from the source.
- **Type consistency:** no new symbols; `RosterEntry.overview` stays `str | None`, `Settings.link_batch_size` stays `int`. No cross-task signature drift.
- **Owner vs agent boundary:** Tasks 1 and 4 are explicitly OWNER/MANUAL (real key + tokens, not CI); Tasks 2 and 3 are the agent's code+TDD work and are fully CI-verifiable. The merge blocker is the owner's no-regression result, called out in Global Constraints and Task 4.
