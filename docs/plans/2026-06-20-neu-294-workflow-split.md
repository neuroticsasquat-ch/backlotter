# Workflow Split — hourly-feeds + daily-pipeline (NEU-294) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single daily GitHub Actions ingest workflow into two cron jobs: an **hourly** feed-only job (`hourly-feeds.yml`, Phase A — trade + broad queries, `per_film=false`) that beats the ~10–20-item trade-feed rotation cap, and the **daily** full pipeline (renamed `daily-ingest.yml` → `daily-pipeline.yml`, `tmdb → feeds?per_film=true → link`). A shared Actions `concurrency` group serialises the 09:00 overlap so two feed ingests never run at once.

**Architecture:** Both jobs are trigger-then-poll shells against the prod API — identical mechanics to today's `daily-ingest.yml` (POST `/admin/ingest/<pipeline>`, then poll `GET /admin/ingest/<run_id>` every 30s to a terminal state). The only API-shape dependency is the `per_film` query param on `POST /admin/ingest/feeds`, **already shipped in NEU-292** (PR #23, merged) — the hourly job passes `?per_film=false`, the daily job `?per_film=true`. Idempotency is free: the `news.story` unique-`url` index + `ON CONFLICT DO NOTHING` makes overlapping hourly re-pulls of the same `when:Nd` Google window insert only genuinely new URLs. **This ticket is `.github/workflows/` only — no backend code, no tests, no schema, no config.**

**Tech Stack:** GitHub Actions YAML + bash (`set -uo pipefail`) + `curl`/`jq`. Verification is `actionlint` run via its official Docker image (host has no actionlint; Docker-only per repo convention). The Python `task` targets are **not** involved here.

**Spec:** `docs/specs/2026-06-20-ingestion-cadence-recency-architecture-design.md` (section "Architecture — two scheduled jobs"). Parent story: NEU-289. Milestone: *Cadence split (hourly ingest / daily link)*. **Blocker NEU-292 is Done** — this ticket is unblocked.

---

## Execution notes (this repo / user)

- **Branch:** do all work on `tom/neu-294-be-split-daily-cron-into-hourly-feeds-daily-pipeline` (the Linear branch), cut from `main`. Verify branch + clean tree before starting.
- **Single PR for the whole ticket** (the third of three child PRs under NEU-289). Each task committed separately on the branch.
- **Subagents do NOT commit.** The orchestrator/user commits at each task boundary and opens the one PR at the end (use `/commit-msg` and `/pr-desc`).
- **Pre-commit hooks won't fire.** The hooks are scoped to `files: \.py$`; a YAML-only commit triggers no ruff/pyright/pytest and needs no running container. Commit normally (no `--no-verify`).
- **No migration, no `task test`.** Nothing in `src/` or `tests/` changes.
- **CI note:** `test.yml` runs only on `pull_request` and only lints/tests Python — it does **not** validate workflow YAML. The plan's `actionlint` step is the real gate; run it before pushing.
- **Preserve git history on the rename:** use `git mv daily-ingest.yml daily-pipeline.yml` *before* editing, so the diff reads as rename+modify.
- **Reusable-workflow / composite-action extraction is out of scope.** The `trigger_and_wait` helper is duplicated across the two files on purpose (simplicity over DRY for two small ops files); revisit only if a third consumer appears.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `.github/workflows/daily-ingest.yml` → `daily-pipeline.yml` | Daily full pipeline | `git mv` + retarget: add `concurrency` group; feeds call → `?per_film=true`; rename `name:`/job id |
| `.github/workflows/hourly-feeds.yml` | Hourly feed-only ingest | **New** — cron `0 * * * *` + `workflow_dispatch`; `feeds?per_film=false`; short poll budget; same `concurrency` group |

---

## Task 1: Rename + retarget `daily-ingest.yml` → `daily-pipeline.yml`

Rename the existing workflow, add the shared concurrency group, and make `per_film` explicit on the feeds call. The trigger-then-poll mechanics are unchanged; `trigger_and_wait` gains an optional second arg for the query string.

**Files:**
- Rename: `.github/workflows/daily-ingest.yml` → `.github/workflows/daily-pipeline.yml`
- Modify: the renamed file

- [ ] **Step 1: Rename the file (preserve history)**

```bash
cd upcoming-movies-backend
git mv .github/workflows/daily-ingest.yml .github/workflows/daily-pipeline.yml
```

- [ ] **Step 2: Replace the file contents**

Write `.github/workflows/daily-pipeline.yml` so it reads exactly:

```yaml
name: Daily pipeline

# Triggers the full daily pipeline (TMDB → per-film feeds → link) against the prod API
# once a day and waits for each run to reach a terminal state, failing the job on
# failed/cancelled or timeout.
#
# Light feed ingestion runs hourly in hourly-feeds.yml (Phase A only). This daily run
# does the TMDB refresh, the per-film feed pass (Phase A + B, per_film=true), and the
# LLM link pass. Both workflows share the `upmovies-ingest` concurrency group so the
# 09:00 overlap queues instead of running two feed ingests at once.
#
# Required configuration (repo Settings → Secrets and variables → Actions):
#   secret    UPMOVIES_ADMIN_TOKEN     — must match the API's ADMIN_TOKEN
#   variable  UPMOVIES_API_BASE_URL    — prod API base URL, e.g. https://api.upmovies.example.com
#                                        (no trailing slash)

on:
  schedule:
    - cron: '0 9 * * *' # 09:00 UTC daily
  workflow_dispatch:

concurrency:
  group: upmovies-ingest
  cancel-in-progress: false

jobs:
  pipeline:
    runs-on: ubuntu-latest
    timeout-minutes: 150
    env:
      ADMIN_TOKEN: ${{ secrets.UPMOVIES_ADMIN_TOKEN }}
      API_BASE_URL: ${{ vars.UPMOVIES_API_BASE_URL }}
    steps:
      - name: Trigger and await ingestion pipelines
        run: |
          set -uo pipefail
          : "${ADMIN_TOKEN:?UPMOVIES_ADMIN_TOKEN secret is required}"
          : "${API_BASE_URL:?UPMOVIES_API_BASE_URL variable is required}"

          # trigger_and_wait <pipeline> [query]: POST /admin/ingest/<pipeline><query>,
          # then poll GET /admin/ingest/<run_id> every 30s until terminal. Returns
          # non-zero on failed/cancelled, a missing run_id, or timeout (~60 min).
          trigger_and_wait() {
            local pipeline="$1"
            local query="${2:-}"
            local response run_id body status i

            echo "::group::Trigger ${pipeline}${query}"
            response=$(curl -fsS -X POST \
              -H "Authorization: Bearer ${ADMIN_TOKEN}" \
              "${API_BASE_URL}/admin/ingest/${pipeline}${query}") || {
                echo "::endgroup::"
                echo "failed to trigger ${pipeline} ingestion"
                return 1
              }
            run_id=$(echo "${response}" | jq -r '.run_id')
            echo "run_id=${run_id}"
            echo "::endgroup::"

            if [ -z "${run_id}" ] || [ "${run_id}" = "null" ]; then
              echo "no run_id returned for ${pipeline}"
              return 1
            fi

            echo "::group::Await ${pipeline} run ${run_id}"
            for i in $(seq 1 120); do
              body=$(curl -fsS \
                -H "Authorization: Bearer ${ADMIN_TOKEN}" \
                "${API_BASE_URL}/admin/ingest/${run_id}") || {
                  echo "[${i}] ${pipeline} poll request failed; retrying"
                  sleep 30
                  continue
                }
              status=$(echo "${body}" | jq -r '.status')
              echo "[${i}] ${pipeline} status=${status}"
              case "${status}" in
                succeeded)
                  echo "${body}" | jq .
                  echo "::endgroup::"
                  return 0
                  ;;
                failed | cancelled)
                  echo "${body}" | jq .
                  echo "::endgroup::"
                  echo "${pipeline} run ${run_id} ended: ${status}"
                  return 1
                  ;;
              esac
              sleep 30
            done
            echo "::endgroup::"
            echo "timed out waiting for ${pipeline} run ${run_id}"
            return 1
          }

          # Run all pipelines; fail the job if any did not succeed. feeds runs with
          # per_film=true (Phase A + per-film Phase B); link runs after feeds (it
          # consumes freshly-fetched stories).
          rc=0
          trigger_and_wait tmdb || rc=1
          trigger_and_wait feeds "?per_film=true" || rc=1
          trigger_and_wait link || rc=1
          exit "${rc}"
```

What changed vs. the original `daily-ingest.yml`:
- `name:` `Daily ingestion` → `Daily pipeline`; job id `ingest` → `pipeline` (cosmetic — no required-check references it, it's a scheduled workflow).
- Added the top-level `concurrency` block.
- `trigger_and_wait` gains `local query="${2:-}"` and appends it to the POST URL; the `::group::` label includes `${query}` for log clarity.
- `trigger_and_wait feeds` → `trigger_and_wait feeds "?per_film=true"`. `tmdb` and `link` calls are unchanged (no query → omitted).

- [ ] **Step 3: Checkpoint (orchestrator commits)**

```bash
git add -A && git commit -m "ci: rename daily-ingest to daily-pipeline with explicit per_film and concurrency group"
```

---

## Task 2: Add `hourly-feeds.yml`

A new feed-only workflow on an hourly cron. Same trigger-then-poll helper, but it calls `feeds?per_film=false` (Phase A only) and uses a **shorter** poll budget (the Phase-A pull is ~11 requests). Shares the `upmovies-ingest` concurrency group with the daily job.

**Files:**
- Create: `.github/workflows/hourly-feeds.yml`

- [ ] **Step 1: Create the file**

Write `.github/workflows/hourly-feeds.yml` so it reads exactly:

```yaml
name: Hourly feeds

# Triggers the light feed ingest (Phase A only — trade category feeds + broad Google
# queries, per_film=false) against the prod API every hour and waits for the run to
# reach a terminal state. Beats the ~10–20-item trade-feed rotation cap that a 24h pull
# structurally drops; dedup-on-url makes overlapping hourly re-pulls idempotent.
#
# The per-film feed pass and the LLM link pass run once a day in daily-pipeline.yml.
# Both workflows share the `upmovies-ingest` concurrency group so the 09:00 overlap
# queues instead of running two feed ingests at once.
#
# Required configuration (repo Settings → Secrets and variables → Actions):
#   secret    UPMOVIES_ADMIN_TOKEN     — must match the API's ADMIN_TOKEN
#   variable  UPMOVIES_API_BASE_URL    — prod API base URL, e.g. https://api.upmovies.example.com
#                                        (no trailing slash)

on:
  schedule:
    - cron: '0 * * * *' # top of every hour
  workflow_dispatch:

concurrency:
  group: upmovies-ingest
  cancel-in-progress: false

jobs:
  feeds:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      ADMIN_TOKEN: ${{ secrets.UPMOVIES_ADMIN_TOKEN }}
      API_BASE_URL: ${{ vars.UPMOVIES_API_BASE_URL }}
    steps:
      - name: Trigger and await feed ingest
        run: |
          set -uo pipefail
          : "${ADMIN_TOKEN:?UPMOVIES_ADMIN_TOKEN secret is required}"
          : "${API_BASE_URL:?UPMOVIES_API_BASE_URL variable is required}"

          # trigger_and_wait <pipeline> [query]: POST /admin/ingest/<pipeline><query>,
          # then poll GET /admin/ingest/<run_id> every 30s until terminal. Returns
          # non-zero on failed/cancelled, a missing run_id, or timeout (~15 min — the
          # hourly Phase-A pull is light, ~11 requests).
          trigger_and_wait() {
            local pipeline="$1"
            local query="${2:-}"
            local response run_id body status i

            echo "::group::Trigger ${pipeline}${query}"
            response=$(curl -fsS -X POST \
              -H "Authorization: Bearer ${ADMIN_TOKEN}" \
              "${API_BASE_URL}/admin/ingest/${pipeline}${query}") || {
                echo "::endgroup::"
                echo "failed to trigger ${pipeline} ingestion"
                return 1
              }
            run_id=$(echo "${response}" | jq -r '.run_id')
            echo "run_id=${run_id}"
            echo "::endgroup::"

            if [ -z "${run_id}" ] || [ "${run_id}" = "null" ]; then
              echo "no run_id returned for ${pipeline}"
              return 1
            fi

            echo "::group::Await ${pipeline} run ${run_id}"
            for i in $(seq 1 30); do
              body=$(curl -fsS \
                -H "Authorization: Bearer ${ADMIN_TOKEN}" \
                "${API_BASE_URL}/admin/ingest/${run_id}") || {
                  echo "[${i}] ${pipeline} poll request failed; retrying"
                  sleep 30
                  continue
                }
              status=$(echo "${body}" | jq -r '.status')
              echo "[${i}] ${pipeline} status=${status}"
              case "${status}" in
                succeeded)
                  echo "${body}" | jq .
                  echo "::endgroup::"
                  return 0
                  ;;
                failed | cancelled)
                  echo "${body}" | jq .
                  echo "::endgroup::"
                  echo "${pipeline} run ${run_id} ended: ${status}"
                  return 1
                  ;;
              esac
              sleep 30
            done
            echo "::endgroup::"
            echo "timed out waiting for ${pipeline} run ${run_id}"
            return 1
          }

          trigger_and_wait feeds "?per_film=false"
```

Notes:
- The poll loop is `seq 1 30` (~15 min) vs. the daily job's `seq 1 120` (~60 min) — the only intentional divergence in the duplicated helper, matching the spec's "short timeout".
- A single `trigger_and_wait` call ends the script; with `set -uo pipefail` (no `-e`) the step's exit status is that function's return, so a failed feeds run fails the job. No `rc`/`exit` accumulator needed (only one pipeline).

- [ ] **Step 2: Checkpoint (orchestrator commits)**

```bash
git add -A && git commit -m "ci: add hourly feed-ingest workflow (Phase A, per_film=false)"
```

---

## Wrap-up

- [ ] **Lint both workflows with actionlint (Docker)**

```bash
cd upcoming-movies-backend
docker run --rm -v "$(pwd)":/repo -w /repo rhysd/actionlint:latest -color
```

Expected: clean exit. actionlint validates Actions schema, the `cron` expressions, `${{ }}` expressions, and runs **shellcheck** on the `run:` scripts. Fix any *new* warning the change introduces; warnings on patterns carried over unchanged from the original `daily-ingest.yml` (already in prod) are acceptable to leave.

- [ ] **Sanity-check the rename in the diff**

```bash
git diff --stat main...HEAD
```

Expected: `daily-pipeline.yml` shown as a rename of `daily-ingest.yml` (modified), plus a new `hourly-feeds.yml`. No `src/`, `tests/`, or `config.py` changes.

- [ ] **Open the single PR for NEU-294**

Use `/commit-msg` (if squashing) and `/pr-desc`. PR title carries the Linear ID parenthetical, e.g. `ci: split daily cron into hourly-feeds + daily-pipeline workflows (NEU-294)`. Push the branch and open the PR against `main`. The GitHub↔Linear connector moves the ticket status — don't touch it.

- [ ] **(Post-merge, prod-touching — user's call) Smoke-test via `workflow_dispatch`**

After merge to `main`, the user can manually run each workflow once from the Actions tab ("Run workflow") to confirm both trigger-then-poll against prod cleanly before relying on the crons. This hits prod, so leave it to the user rather than doing it from the implementation session.

---

## Self-Review (author check)

- **Spec/ticket coverage:** ✅ New `hourly-feeds.yml` — cron `0 * * * *` + `workflow_dispatch`, `feeds?per_film=false`, trigger-then-poll with a short (~15 min) budget, trade+broad only (Phase A) (T2). `daily-ingest.yml` renamed → `daily-pipeline.yml`, cron `0 9 * * *`, sequence `tmdb → feeds?per_film=true → link` with `per_film` explicit (T1). Shared `concurrency: { group: upmovies-ingest, cancel-in-progress: false }` on **both** workflows (T1 + T2). Every bullet in the NEU-294 description and the spec's "two scheduled jobs" section is mapped to a step.
- **Blocker satisfied:** ✅ `?per_film=true|false` relies on NEU-292 (Done, PR #23 merged) — the live API accepts the query param.
- **No over-reach:** ✅ `.github/workflows/` only — no backend code, tests, schema, or `config.py` (the recency retune is the sibling ticket NEU-293; feed-source swap is M1; Batches is M3). Reusable-workflow extraction explicitly deferred.
- **Idempotency / overlap:** ✅ 09:00 collision serialised by the shared concurrency group (queues, never two feed runs at once); even a double-run is safe via the `news.story` unique-`url` index + `ON CONFLICT DO NOTHING`. Overrun protection is a bonus: a slow hourly run makes the next hourly queue rather than stack.
- **Verification realism:** ✅ pre-commit hooks are `\.py$`-scoped (won't fire on YAML); `test.yml` doesn't lint workflows — so actionlint-via-Docker is named as the gate, with the prod-touching `workflow_dispatch` smoke test left to the user.
- **Placeholder scan:** ✅ none — both workflow files are given in full, ready to write verbatim.
