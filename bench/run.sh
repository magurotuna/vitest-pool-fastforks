#!/usr/bin/env bash
# Runs a project once with one pool, and adds a line to <out>/runs.jsonl.
# Usage: bash bench/run.sh <project> <forks|fastforks> <label> <out>
#   CPUSET: the CPUs for the run (taskset -c), for example 0-3. Default: all.
# Before the run, it waits (at most 10 minutes) until no other Vitest process
# runs, the CPUs are at least 98 % idle for 5 seconds, and the 1-minute load
# average is below 2.0.
set -u
source "$(dirname "$0")/lib.sh"
project=$1 pool=$2 label=$3
TIMEOUT=1800
"proj_${project//-/_}"
out=$(mkdir -p "$4" && cd "$4" && pwd)
# A report from an earlier run must not count for this run.
rm -f "$out/$label.json" "$out/$label.json.gz"
HOSTS='vitest-pool-fastforks/dist/host[.]cjs'

# idle_pct <seconds>: the idle share of all CPUs in that time, in percent.
idle_pct() {
  local a b total=0 i
  a=($(head -1 /proc/stat)); sleep "$1"; b=($(head -1 /proc/stat))
  for i in 1 2 3 4 5 6 7 8; do total=$((total + b[i] - a[i])); done
  echo $((100 * (b[4] - a[4] + b[5] - a[5]) / (total > 0 ? total : 1)))
}
waited=0
while true; do
  idle=$(idle_pct 5); waited=$((waited + 5))
  if ! pgrep -f "vitest.mjs|$HOSTS" >/dev/null && [ "$idle" -ge 98 ] \
    && awk '{ exit !($1 < 2.0) }' /proc/loadavg; then break; fi
  [ $waited -ge 600 ] && { echo "run.sh: still busy after 600 s: idle $idle %, load $(cut -d' ' -f1 /proc/loadavg)" >&2; break; }
done

pin=()
[ -n "${CPUSET:-}" ] && pin=(taskset -c "$CPUSET")
start=$(date -u +%FT%TZ)
t0=$(date +%s.%N)
(
  cd "$DIR"
  for kv in "${ENVS[@]}"; do export "$kv"; done
  export BENCH_POOL=$pool
  exec "${pin[@]}" timeout -k 10 "$TIMEOUT" node ${ENV_FILE:+--env-file="$ENV_FILE"} "$VITEST_BIN" run "${ARGS[@]}" \
    --reporter=dot --reporter=json --outputFile.json="$out/$label.json" > "$out/$label.log" 2> "$out/$label.err"
)
code=$?
t1=$(date +%s.%N)
# Stop the child processes of this pool that are left, by PID: pkill -f could
# also match this script.
for _ in $(seq 40); do pgrep -f "$HOSTS" >/dev/null || break; sleep 0.5; done
left=$(pgrep -f "$HOSTS" | tr '\n' ' ')
[ -n "$left" ] && kill -9 $left
[ -f "$out/$label.json" ] && gzip -f "$out/$label.json"
wall=$(LC_ALL=C awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.3f", b - a }')
vitest=$(node -p "require('$(dirname "$VITEST_BIN")/package.json').version")
printf '{"project":"%s","label":"%s","pool":"%s","cpus":"%s","exit":%d,"wall":%s,"killed":%d,"waitedIdle":%d,"vitest":"%s","start":"%s"}\n' \
  "$project" "$label" "$pool" "${CPUSET:-all}" "$code" "$wall" "$(echo $left | wc -w)" "$waited" "$vitest" "$start" \
  | tee -a "$out/runs.jsonl"
