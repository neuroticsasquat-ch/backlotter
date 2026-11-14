#!/usr/bin/env bash
#
# `task bench:load -- <args>` (NEU-2286): run scripts/bench_public_burst.py in the dev container
# against the bench stack's bench-api, and report around it what the script can't see from
# inside its container:
#
# - CPU, in cores: the cgroup's `usage_usec` delta over the whole run (warm-up included, at the
#   same load) divided by wall time, for bench-api, for Postgres and for the load generator (the
#   dev container), so a run the load generator limits shows as one.
# - Docker's health-status changes for bench-api during the run. They fire only on a transition,
#   and Docker Desktop's event buffer is too short to replay a several-minute run afterwards, so
#   they are captured live.
#
# A script rather than inline in the Taskfile: Task's built-in shell can't end the background
# `docker events` watcher.

set -euo pipefail

BENCH=(docker compose -f docker-compose.bench.yml)
DEV=(docker compose)

usage_usec() { docker exec "$1" cat /sys/fs/cgroup/cpu.stat | awk '/^usage_usec/ {print $2}'; }
now() { perl -MTime::HiRes=time -e 'printf "%.3f", time'; }

api=$("${BENCH[@]}" ps -q bench-api)
gen=$("${DEV[@]}" ps -q upmovies-backend)
if [[ -z "$api" || -z "$gen" ]]; then
  echo "bench-api or the dev backend container is not running (task bench:up, task up)" >&2
  exit 1
fi

events=$(mktemp)
docker events --filter container="$api" --filter event=health_status > "$events" &
watcher=$!
trap 'kill "$watcher" 2>/dev/null || true; rm -f "$events"' EXIT

a0=$(usage_usec "$api"); p0=$(usage_usec tbc_postgresql_db); g0=$(usage_usec "$gen"); t0=$(now)
status=0
"${DEV[@]}" exec upmovies-backend python scripts/bench_public_burst.py \
  --base-url http://bench-api:8000 "$@" || status=$?
a1=$(usage_usec "$api"); p1=$(usage_usec tbc_postgresql_db); g1=$(usage_usec "$gen"); t1=$(now)

awk -v a="$((a1 - a0))" -v p="$((p1 - p0))" -v g="$((g1 - g0))" -v t0="$t0" -v t1="$t1" 'BEGIN {
  w = t1 - t0
  printf "cpu: bench-api %.2f cores, postgres %.2f cores, load generator %.2f cores over %.1fs\n",
    a / 1e6 / w, p / 1e6 / w, g / 1e6 / w, w
}'
kill "$watcher" 2>/dev/null || true
wait "$watcher" 2>/dev/null || true
if [[ -s "$events" ]]; then
  sed 's/^/docker: /' "$events"
else
  echo "docker: no health-status change during the run"
fi
exit "$status"
