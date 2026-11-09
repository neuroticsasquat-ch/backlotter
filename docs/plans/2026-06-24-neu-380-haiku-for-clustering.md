# NEU-380 — Spike: Evaluate Haiku for Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **SPIKE**: most steps are investigation/measurement run by the **owner (Tom)** with a real Anthropic key; the only code change (Task 3) is **conditional** on the measured result. Do not write the code change unless the gate in Task 1/2 passes.

**Goal:** Decide — with evidence — whether the cluster stage can move from `claude-sonnet-4-6` to `claude-haiku-4-5`. Sonnet costs 3× Haiku on **both** input and output (Sonnet $3.00/$15.00 vs Haiku $1.00/$5.00 per Mtok). Cluster is the most reasoning-heavy stage, so Sonnet *may* be justified — but it has never been tested against Haiku. If Haiku holds clustering quality, switching saves ~3× on the cluster stage; if it doesn't, we keep Sonnet and document why. **Both outcomes are valid completions of this spike.**

**Architecture:** The spike is a measurement harness wrapped around the existing cluster stage — no new production logic. The cluster stage already reads its model from `settings.cluster_model` (env alias `CLUSTER_MODEL`) at `routers/ingest_admin.py:92` → `run_link_ingest(..., cluster_model=...)` → `_cluster_stage_*` → `cluster_film_events`/`build_cluster_batch_request`. So a Sonnet run vs a Haiku run is just two ingests with `CLUSTER_MODEL` overridden in the container env. The **only** code touched (and only if the gate passes) is the one-line default in `config.py` plus its config-test assertions, mirroring NEU-368's config-bump pattern exactly.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async), pydantic-settings, pytest. **All tooling runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python`/`alembic` on the host. The investigation/measurement steps run inside `task shell`.

## Global Constraints

- **One backend PR (only if the gate passes)**, on branch `tom/neu-380-backend-spike-evaluate-haiku-for-clustering`. If the gate fails, the spike completes with a documented decision and **no code PR** (just the spec write-up in Task 3b).
- **This is a SPIKE.** The deliverable is a **documented decision**. A code change (the `cluster_model` default swap) ships **only if clustering quality holds** under the gate defined in Task 1. **Never swap the model blind.** If no defensible gate is achievable, the recommendation is to **HOLD on Sonnet and not switch.**
- **Container-only tooling:** `task up` (keep the container up), `task test` (`task test -- tests/unit/test_config.py` to scope), `task lint`, `task typecheck`, `task format`, `task shell`. They `docker compose exec` into `upmovies-backend`.
- **Pre-commit hooks delegate into Docker** — commit normally, **no `--no-verify`**. Run `task format` *before* staging so the format-check hook passes.
- **Before claiming the code change done (Task 3a only):** `task test`, `task lint`, `task typecheck` all green (and `task format` applied).
- **Modern type hints** (`X | None`, `X | Y`); **no** `from __future__ import annotations`; ruff line length 100; pytest-asyncio in `auto` mode (no `@pytest.mark.asyncio`).
- **Commit message:** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-380.` in body), **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. Prefer `/commit-msg`.
- **Owner steps cost real money.** Steps marked **[OWNER]** run live Anthropic calls (real key in `.env`, real tokens) and must be run by Tom, not the agent. The agent prepares the harness script and the exact commands; Tom executes them and pastes the output back.
- **Dependency (NEU-375) — assumed landed before this spike runs.** NEU-375 persists per-(run, stage) token usage + `cost_usd` in `ingest.run_llm_usage` and exposes it on `GET /admin/runs*` as `llm_usage[]`, each row carrying its `stage`, `model`, and `cost_usd`. This is how the ~3× cluster saving is read directly (cluster-stage `cost_usd` on a Sonnet run vs a Haiku run). If NEU-375 has **not** landed when this spike starts, **stop and flag it** — without it the cost half of the evidence must fall back to the per-call `Usage` math in `scripts/measure_link_cost.py` (the `price(...)` helper + the Sonnet/Haiku `Rates`), which is acceptable but less direct. State which path you used in the write-up.

---

## Findings established during planning (read these first — they shape the whole spike)

These were verified against the repo at plan time. The implementing agent should re-confirm Finding A still holds (the fixture can change), but should **not** re-derive them from scratch.

- **Finding A — There is NO usable cluster-accuracy gate in the repo today.**
  - A scoring primitive exists: `cluster_purity(clusters, gold_group_by_key)` in `src/upmovies/link/metrics.py:43` (standard purity: majority gold group per predicted cluster, summed / clustered items). It is **only** exercised by its own unit tests (`tests/unit/link/test_metrics.py:35-40`). **Nothing wires it to real cluster output.**
  - The fixture schema supports it: `ValidationItem.event_group` (`src/upmovies/link/validation.py:20`) is documented as the "free-text group label for cluster scoring." But in the **committed** `tests/fixtures/link/validation_set.json` (286 items, 85 `about`), **every `event_group` is `null`** — 0 populated, 0 multi-story beats. So the ground-truth labels needed to grade clustering **do not exist**.
  - No script drives `build_cluster_request` / `cluster_film_events` / `apply_cluster_decisions` for evaluation; the only references are production code (`pipeline.py`, `__init__.py`).
  - **Conclusion:** `validate_linking.py` / `diagnose_linking.py` / `export_link_validation_draft.py` / `propose_validation_labels.py` are **all Stage-1 (link) oriented** — they score `(predicted_tmdb_id, expected_tmdb_id)` pairs via `compute_link_metrics`, never cluster decisions. **No cluster gate runs today.**
- **Finding B — Two routes to a defensible gate.** Branch (a): *build* a purity gate by labeling `event_group` for the multi-story beats already in the fixture, then reuse `cluster_purity`. Branch (b): if labeling is not worth it, run a **before/after cluster diff** on a fixed corpus (Sonnet vs Haiku) and require no material divergence. The plan specifies both and a clear decision rule for which to use.
- **Finding C — Cost is directly measurable post-NEU-375.** The cluster stage row in `llm_usage[]` carries `model` + `cost_usd`; comparing the cluster row's `cost_usd` between a Sonnet run and a Haiku run on the same corpus gives the saving directly. No need to re-derive pricing.

---

## Task 1 — Establish a cluster-accuracy gate FIRST (investigation, BLOCKING)

**This task gates everything below it.** Until there is a defined, runnable way to tell "did Haiku's clustering get materially worse," the model must not be swapped. Produce, by the end of this task, a one-paragraph written statement of *exactly which gate you will run in Task 2 and what its pass/fail threshold is.*

**Files (read-only in this task):** `src/upmovies/link/metrics.py` (`cluster_purity`), `src/upmovies/link/validation.py` (`ValidationItem`, `event_group`), `tests/fixtures/link/validation_set.json`, `tests/fixtures/link/README.md` (§Event group convention), `src/upmovies/link/cluster.py` (`build_cluster_request`, `apply_cluster_decisions` — the event schema the model emits).

- [ ] **Step 1: Re-confirm the gate inventory (Finding A) still holds.** In `task shell`:

```bash
# (a) Is event_group populated in the committed fixture? (expected: 0)
python -c "import json; d=json.load(open('tests/fixtures/link/validation_set.json')); print('items', len(d), '| non-null event_group', sum(1 for r in d if r.get('event_group')))"
# (b) Are there multi-story beats to cluster at all? Group 'about' items by (tmdb_id, event_type)
python - <<'PY'
import json
from collections import Counter
d = json.load(open('tests/fixtures/link/validation_set.json'))
about = [r for r in d if r.get('relation') == 'about' and r.get('expected_film_tmdb_id')]
beats = Counter((r['expected_film_tmdb_id'], r.get('event_type')) for r in about)
multi = {k: c for k, c in beats.items() if c > 1}
print('about items:', len(about))
print('distinct (film,event_type) beats:', len(beats))
print('beats with >1 story (clusterable):', len(multi))
print('sample multi beats:', dict(list(multi.items())[:10]))
PY
```

Expected: `non-null event_group` = 0. The second snippet tells you **how many real multi-story beats the fixture even contains** — this is the deciding number for Branch (a) vs Branch (b). If there are, say, <15 clusterable multi-story beats, hand-labeling `event_group` buys very little signal and Branch (b) is the right call. Record the count.

- [ ] **Step 2: Decide the gate branch and write it down.** Apply this decision rule:

  - **Branch (a) — purity gate (preferred IF the fixture has enough multi-story beats, roughly ≥15 from Step 1).** Build ground truth by hand-labeling `event_group` on the `about` items that share a beat, then score with `cluster_purity`. See Step 3a.
  - **Branch (b) — before/after cluster DIFF (the realistic default given Finding A).** Run the cluster stage on one fixed corpus twice — Sonnet then Haiku — and diff the resulting events for material divergence. No new ground truth required. See Step 3b. **This is the expected branch** unless Step 1 surprises us with a rich set of multi-story beats.

  Write the chosen branch + its threshold into the spike write-up scratch file (you'll fold it into the spec in Task 3). Be explicit: *"Gate = Branch (b) cluster-diff on the local corpus; PASS = no material regression per the rules in Step 3b."*

- [ ] **Step 3a: (Branch a only) Define the purity gate concretely.** If you chose Branch (a):
  1. Owner labels `event_group` on the multi-story `about` items in `validation_set.json` using the README convention (`"<film-slug>-<event>-<n>"`, e.g. `"runner-trailer-1"`); stories reporting the *same beat* share a label; standalone stories stay `null`. The labeling UI already exists (`scripts/build_review_html.py` renders an editable `group` field, line 267).
  2. Write a small runner `scripts/validate_clustering.py` (parallel to `validate_linking.py`) that: loads the fixture, takes the `about` items with a non-null `event_group`, builds throwaway `Story` rows + a temporary `Film`/`Event` graph in the **test** DB (or a scratch session) so `build_cluster_request` can run, calls `cluster_film_events` once per film with `settings.cluster_model`, reads back the resulting `EventStory` groupings as `clusters: list[set[str]]` keyed by story url, and scores them with `cluster_purity(clusters, gold_group_by_key)` where `gold_group_by_key[url] = item.event_group`. Print purity for the configured model.
  3. **Pass/fail metric:** run the runner once on Sonnet (`CLUSTER_MODEL=claude-sonnet-4-6`) to set the baseline purity `P_sonnet`, then once on Haiku (`CLUSTER_MODEL=claude-haiku-4-5`) for `P_haiku`. **PASS if `P_haiku >= P_sonnet - 0.03`** (Haiku within 3 purity points of Sonnet) **and** no Haiku-only catastrophic merge (a single predicted cluster swallowing two distinct gold beats). Record both numbers.

  Note: Branch (a) is **more work** (labeling + a new runner + a scratch event graph) and is only worth it if Step 1 found a meaningfully sized multi-story set. If labeling stalls or the set is thin, fall back to Branch (b) — do not let perfect block the spike.

- [ ] **Step 3b: (Branch b — expected) Define the cluster DIFF gate concretely.** The primary deliverable when no purity gate is defensible.

  - **Corpus:** a fixed local `pending`/`linked` corpus produced by a real `tmdb` + `feeds` ingest (same precondition `measure_link_cost.py` documents). Freeze it: do **not** re-ingest between the Sonnet and Haiku runs, so both models see the *identical* set of films + unclustered linked stories. (Practically: snapshot the relevant `news.story` / `news.event` / `news.event_story` rows, or run on a throwaway DB you can reset between the two runs — see Step 4.)
  - **What to diff:** for each film, the set of cluster decisions the stage emitted. Concretely, capture from each run, per film:
    - **counts:** number of events created, number of stories attached to existing events vs assigned to new events, number of stale-stage rejections.
    - **attach-vs-new decisions:** for every unclustered story, did the model attach it to an existing event or open a new one (and which)?
    - **new-event classification:** `type` and `confidence` for each new event.
  - **Diff procedure:** run the stage with Sonnet, dump the per-film decisions to `sonnet.json`; reset the cluster output (delete the run's `event`/`event_story` rows, leave stories `linked` + unclustered); run with Haiku, dump to `haiku.json`; diff.
  - **"No material regression" =** all of:
    1. **Granularity stable:** events-created count per film within ±1 of Sonnet for ≥90% of films, and total events-created within ±10% across the corpus. (Catches Haiku over-splitting or over-merging beats.)
    2. **Attach/new agreement:** ≥90% of stories get the same attach-vs-new decision (and same target event when attaching). (Catches Haiku failing to recognize a continued beat.)
    3. **No catastrophic merges:** zero cases where Haiku collapses two clearly-distinct Sonnet events into one (manual eyeball of the disagreements — the disagreement list will be small).
    4. **Classification agreement:** `type`/`confidence` match on ≥85% of the new events both models created for the same story group. (Type drift is lower-stakes than grouping, hence the looser bar.)
  - If all four hold → **PASS** (quality holds, proceed to Task 3a swap). If any fails materially → **FAIL** (HOLD on Sonnet, Task 3b).

- [ ] **Step 4: (Branch b) Write the diff harness `scripts/eval_cluster_diff.py` [agent writes, owner runs].** A small one-off paralleling `measure_link_cost.py` in shape (argparse, `task shell`, reads `settings`, real `AnthropicClient`). It does **not** persist to prod tables; it drives the existing cluster builders directly and records the decisions. Sketch:

```python
"""Diff the cluster stage's decisions between two models on a fixed local corpus.

Precondition: a real tmdb+feeds+LINK ingest has populated `news.story` with `linked`,
unclustered stories (link_status='linked', film_id set, no event_story row yet). Then,
in the container, run ONCE per model (resetting cluster output between runs — see --reset):

    task shell
    python scripts/eval_cluster_diff.py --model claude-sonnet-4-6 --out sonnet.json
    python scripts/eval_cluster_diff.py --reset                       # clear cluster output
    python scripts/eval_cluster_diff.py --model claude-haiku-4-5  --out haiku.json
    python scripts/eval_cluster_diff.py --diff sonnet.json haiku.json # print the diff report

Records nothing to prod run tables; it reuses build_cluster_request/apply_cluster_decisions
against the live DB so the decisions are faithful to production."""

import argparse
import asyncio
import json
from uuid import UUID

from sqlalchemy import exists, select
from upmovies.config import get_settings
from upmovies.db import SessionLocal
from upmovies.link.cluster import build_cluster_request, apply_cluster_decisions
from upmovies.llm.client import AnthropicClient
from upmovies.news.models import Event, EventStory, Story


async def _unclustered_film_ids(s) -> list[UUID]:
    clustered = exists().where(EventStory.story_id == Story.id)
    rows = await s.execute(
        select(Story.film_id)
        .where(Story.link_status == "linked", Story.film_id.is_not(None), ~clustered)
        .distinct()
    )
    return [r[0] for r in rows.all() if r[0] is not None]


async def run_model(model: str, attach_limit: int, max_tokens: int) -> dict:
    """Drive the cluster stage per film with `model`; return per-film decisions for diffing.
    Mutates the DB exactly as production would (creates events / event_story rows)."""
    settings = get_settings()
    out: dict[str, dict] = {}
    async with AnthropicClient(api_key=settings.anthropic_api_key) as client, SessionLocal() as s:
        film_ids = await _unclustered_film_ids(s)
        for fid in film_ids:
            built = await build_cluster_request(s, film_id=fid, attach_limit=attach_limit)
            if built is None:
                continue
            system, messages, plan = built
            raw = await client.complete(
                model=model, system=system, messages=messages, max_tokens=max_tokens
            )
            # Snapshot the RAW decision (model output) before applying — that's the diff unit.
            out[str(fid)] = {"raw": raw, "n_unclustered": len(plan.unclustered_story_ids)}
            await apply_cluster_decisions(s, plan=plan, raw=raw)
            await s.commit()
    return out


async def reset_cluster_output() -> None:
    """Undo a run: delete event_story + events so the next model sees the same unclustered
    corpus. Stories stay link_status='linked'. (Stale-stage rejects are NOT restored — keep
    the corpus free of stale beats, or reset from a DB snapshot instead for full fidelity.)"""
    async with SessionLocal() as s:
        await s.execute(EventStory.__table__.delete())
        await s.execute(Event.__table__.delete())
        await s.commit()


def diff(a_path: str, b_path: str) -> None:
    a, b = json.load(open(a_path)), json.load(open(b_path))
    # Parse each side's raw JSON into per-film (events_created, attach_decisions, types) and
    # apply the Step-3b rules: granularity ±1/film & ±10% total, attach/new ≥90%, no
    # catastrophic merges, type/confidence ≥85%. Print a PASS/FAIL line per rule + the
    # disagreement list (small) for manual eyeballing of catastrophic merges.
    ...  # implement the four comparisons from Step 3b here


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model")
    p.add_argument("--out")
    p.add_argument("--reset", action="store_true")
    p.add_argument("--diff", nargs=2, metavar=("SONNET", "HAIKU"))
    p.add_argument("--attach-limit", type=int, default=25)
    p.add_argument("--max-tokens", type=int, default=4096)
    a = p.parse_args()
    if a.reset:
        asyncio.run(reset_cluster_output())
    elif a.diff:
        diff(*a.diff)
    elif a.model and a.out:
        result = asyncio.run(run_model(a.model, a.attach_limit, a.max_tokens))
        json.dump(result, open(a.out, "w"), indent=2)
        print(f"wrote {a.out}: {len(result)} films")
    else:
        p.error("need --model+--out, or --reset, or --diff A B")


if __name__ == "__main__":
    main()
```

  - The agent implements the `diff(...)` body (the four Step-3b comparisons) — that is the load-bearing part, leave no `...` in the shipped script. Keep it ruff-clean (line length 100). This is a **scratch/eval script**, not production code, so it does **not** need TDD — but it must run cleanly under `task lint`/`task typecheck` since it lives in `scripts/`.
  - **Reset fidelity caveat:** `reset_cluster_output()` is a blunt instrument (it wipes ALL events). For a faithful A/B, prefer resetting from a **DB snapshot** taken right after the link stage and before clustering (e.g. `docker compose exec db pg_dump`/restore of the `news` schema, or a throwaway test DB), so stale-stage rejections and pre-existing events are identical for both models. Document whichever you used.

## Task 2 — Run the eval [OWNER, real Anthropic key, real tokens]

Run the gate chosen in Task 1 and capture **both** the accuracy signal **and** the cost signal for Sonnet and Haiku on the same corpus.

- [ ] **Step 5: [OWNER] Produce the fixed corpus.** Ensure the local DB holds a representative `linked`, unclustered corpus: run a real `tmdb` ingest, a real `feeds` ingest, then a real `link` ingest (which links Stage-1 but you want clustering to be the variable). Take a snapshot for clean A/B resets (Step 4 caveat):

```bash
# in the container / via the admin trigger endpoints, then:
docker compose exec db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -n news > /tmp/news_pre_cluster.sql
```

Record the corpus size (films with unclustered linked stories, total unclustered stories) in the write-up — that's the denominator for every percentage in Step 3b.

- [ ] **Step 6: [OWNER] Run Sonnet, then Haiku, capture decisions + cost.**

  - **Accuracy signal (Branch b):**
    ```bash
    task shell
    python scripts/eval_cluster_diff.py --model claude-sonnet-4-6 --out /tmp/sonnet.json
    # reset to the identical corpus (prefer snapshot restore over --reset for fidelity):
    docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "TRUNCATE news.event_story, news.event CASCADE;"  # or restore /tmp/news_pre_cluster.sql
    python scripts/eval_cluster_diff.py --model claude-haiku-4-5 --out /tmp/haiku.json
    python scripts/eval_cluster_diff.py --diff /tmp/sonnet.json /tmp/haiku.json   # prints PASS/FAIL per rule
    ```
    (Branch a instead: run `scripts/validate_clustering.py` once per `CLUSTER_MODEL`, capture `P_sonnet` / `P_haiku`.)

  - **Cost signal (the ~3× saving, via NEU-375):** drive the **production** link pipeline once per model so a real run row + `llm_usage[]` is persisted, then read the **cluster-stage** `cost_usd` for each:
    ```bash
    # Sonnet (current default): trigger a link ingest, then read the run's cluster cost.
    # Haiku: same corpus, with the env override on the container:
    docker compose exec -e CLUSTER_MODEL=claude-haiku-4-5 upmovies-backend python -m ...  # or restart with CLUSTER_MODEL set, then POST /admin/ingest/link
    # Read both via the admin API (NEU-375 contract):
    curl -s -H "Authorization: Bearer $ADMIN_TOKEN" .../admin/runs/<run_id> | jq '.llm_usage[] | select(.stage=="cluster") | {model, input_tokens, output_tokens, cost_usd}'
    ```
    If NEU-375 has **not** landed, fall back to `scripts/measure_link_cost.py`'s `price(...)` + add a `SONNET_4_6 = Rates(3.00, 15.00)` constant and compute cluster cost from the per-call `Usage` the harness already collects. State which path you used.

  - Record, in the write-up: corpus size; the four Step-3b rule results (or `P_sonnet`/`P_haiku`); cluster-stage `cost_usd` for Sonnet and Haiku; and the implied per-run/annual saving.

- [ ] **Step 7: [OWNER] Make the PASS/FAIL call.** Apply the Task-1 threshold to the Step-6 numbers and write a one-line verdict: **PASS** (Haiku holds quality — proceed to Task 3a) or **FAIL** (HOLD on Sonnet — proceed to Task 3b). If the gate itself proved undefensible (e.g. corpus too thin to diff meaningfully, harness unreliable), the verdict is **HOLD** by default — *do not switch on weak evidence.*

## Task 3 — Decision + conditional change

Exactly one of 3a / 3b runs, per the Step-7 verdict. Both are valid spike completions.

- [ ] **Step 3a: [PASS path] Swap the `cluster_model` default (TDD, mirrors NEU-368).** Only if Step 7 = PASS.

  1. **Create the work branch:**
     ```bash
     cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
     git checkout main && git pull
     git checkout -b tom/neu-380-backend-spike-evaluate-haiku-for-clustering
     task up
     ```
  2. **Write the failing config-default test first.** In `tests/unit/test_config.py`, add a focused test (there is no existing cluster-model assertion — `test_config.py` covers tmdb/ingestion/summary defaults but not the link/cluster models, so add one). Insert after `test_settings_summary_overrides_from_env` (line ~109):
     ```python
     def test_settings_cluster_model_defaults_to_haiku(monkeypatch):
         _set_required(monkeypatch)
         monkeypatch.delenv("CLUSTER_MODEL", raising=False)
         s = Settings()  # type: ignore[call-arg]
         assert s.cluster_model == "claude-haiku-4-5"


     def test_settings_cluster_model_override_from_env(monkeypatch):
         _set_required(monkeypatch)
         monkeypatch.setenv("CLUSTER_MODEL", "claude-sonnet-4-6")
         s = Settings()  # type: ignore[call-arg]
         assert s.cluster_model == "claude-sonnet-4-6"
     ```
  3. **Run the new tests — expect the default test to FAIL:**
     `task test -- tests/unit/test_config.py::test_settings_cluster_model_defaults_to_haiku`
     Expected: FAIL (`assert "claude-sonnet-4-6" == "claude-haiku-4-5"`); the override test already passes.
  4. **Swap the default** in `src/upmovies/config.py:32`:
     ```python
     cluster_model: str = Field(default="claude-haiku-4-5", alias="CLUSTER_MODEL")
     ```
  5. **Run the config tests — expect PASS:** `task test -- tests/unit/test_config.py`. Both new tests green.
  6. **Full gate:** `task format && task test && task lint && task typecheck` — all green. (No production-logic change, so the integration cluster tests — which use a `FakeClient` and pass `model="m"` explicitly — are unaffected.)
  7. **Record the measured cluster saving in the spec** (`docs/specs/2026-06-24-llm-cost-token-efficiency-design.md`, T6 acceptance row): the Sonnet vs Haiku cluster-stage `cost_usd`, the corpus size, the gate result, and the per-run/annual saving from Step 6.
  8. **Commit (Conventional Commits, no Linear ID in subject, no footer, no co-author):**
     ```bash
     git add src/upmovies/config.py tests/unit/test_config.py scripts/eval_cluster_diff.py
     git commit -m "feat: default the cluster stage to Haiku 4.5

     Spike NEU-380 measured claude-haiku-4-5 against claude-sonnet-4-6 on the
     cluster stage over a fixed local corpus; clustering quality held within the
     gate threshold while cutting cluster-stage cost ~3x. Switch the cluster_model
     default; CLUSTER_MODEL still overrides to Sonnet if a regression appears.

     Refs NEU-380."
     git push -u origin tom/neu-380-backend-spike-evaluate-haiku-for-clustering
     ```
     Open the PR with `/pr-desc` (title carries the Linear ID parenthetical: `feat: default the cluster stage to Haiku 4.5 (NEU-380)`; the `🤖` footer goes in the PR **body** only). Whether `scripts/eval_cluster_diff.py` is committed or kept local is the owner's call — commit it if it's clean and reusable; otherwise drop it from the staged set.

- [ ] **Step 3b: [FAIL/HOLD path] Keep Sonnet, document the evidence, close the spike.** Only if Step 7 = FAIL or HOLD. **No code PR.**

  1. **Do NOT change `config.py`.** `cluster_model` stays `claude-sonnet-4-6`.
  2. **Record the decision in the spec** (`docs/specs/2026-06-24-llm-cost-token-efficiency-design.md`, T6 acceptance row + Risks "No cluster eval gate"): state that the spike ran, the gate used (Branch a or b), the corpus size, the specific rule(s) Haiku failed (or that no defensible gate was achievable), the `P_sonnet`/`P_haiku` or diff numbers, and the cluster-stage `cost_usd` delta that was on the table but rejected. Conclude: **HOLD on Sonnet for cluster; revisit only with a stronger gate.**
  3. **Close the spike.** The Linear ticket moves on PR/branch activity automatically; for a no-code outcome, the deliverable is the spec write-up — note in the ticket (via the connector flow, not a manual status flip) that the outcome is documented in the spec. The `🤖 Generated with Claude Code` footer belongs on the Linear comment/spec, not on commits.

---

## Self-review

- **Spec coverage (T6):** "confirm a usable cluster-accuracy gate first" → Task 1 (Findings A/B + decision rule); "eval Haiku vs Sonnet on clustering" → Task 2 (Steps 5–7, OWNER, real key); "if quality holds, switch `cluster_model`; otherwise reject with documented evidence" → Task 3a / 3b (mutually exclusive, both valid). "~3× cluster saving measured via T1/NEU-375" → Step 6 cost signal (cluster-stage `cost_usd` from `llm_usage[]`, with the `measure_link_cost.py` fallback). T6 "Flag explicitly if no usable cluster gate exists" → **Finding A states it plainly: none exists today.**
- **Gate-first discipline:** the model swap (Step 3a) is unreachable unless Step 7 = PASS; the default verdict on weak/undefensible evidence is HOLD (Step 7), and Branch (b)'s four concrete rules give an auditable PASS/FAIL. No blind switch is possible by the plan's control flow.
- **House rules:** container-only `task` tooling everywhere; TDD on the only code change (failing config test before the `config.py` edit, mirroring NEU-368 Steps 3–6); modern type hints, no `from __future__`, ruff 100; Conventional-Commits subject with no Linear ID, no `🤖` footer, no `Co-Authored-By`; `task format` before staging for the Docker-delegated pre-commit hook.
- **OWNER vs agent split:** every live-token step is marked **[OWNER]**; the agent's deliverables are the harness script(s) (`eval_cluster_diff.py`, optionally `validate_clustering.py`) with the load-bearing `diff(...)` logic fully implemented, and — only on PASS — the config + test edit. No agent step spends API credits.
- **Dependency honesty:** NEU-375 is assumed landed (it carries the cluster-stage `cost_usd`); the plan states the fallback (`measure_link_cost.py` pricing + a `SONNET_4_6` rate) and tells the implementer to flag and choose if it isn't there.
- **Placeholder scan:** the `...` in the `diff(...)` sketch is explicitly called out as agent-to-implement (the four Step-3b comparisons), not a plan gap; pricing constants ($3.00/$15.00 Sonnet, $1.00/$5.00 Haiku) and the exact config line/test code are given inline.
