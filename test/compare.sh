#!/usr/bin/env bash
# Runs one fixture with several pools and keeps stdout, stderr, the exit
# code, and the JSON report of each run.
# Usage: bash test/compare.sh <fixture> <out-dir> [vitest args...]
# POOLS: the pools to run (default: "forks fastforks").
# NODE: the Node.js binary (default: the official v26.13.0).
set -u
here=$(cd "$(dirname "$0")" && pwd)
fixture=$here/fixtures/$1; out=$2; shift 2
NODE=${NODE:-$HOME/vt-perf/dl/node-v26.13.0-official/node-v26.13.0-linux-x64/bin/node}
mkdir -p "$out"
for pool in ${POOLS:-forks fastforks}; do
  (cd "$fixture" && POOL=$pool timeout 120 "$NODE" "$here/../node_modules/vitest/vitest.mjs" run --configLoader runner \
    --reporter=verbose --reporter=json --outputFile.json="$out/$pool.json" "$@" \
    > "$out/$pool.stdout" 2> "$out/$pool.stderr"; echo $? > "$out/$pool.code")
  # Durations, start times, and pids differ between runs.
  for s in stdout stderr; do
    sed -E -e "s/[0-9]+(\.[0-9]+)?m?s\b/<t>/g" -e "s/^ *(Start at|Duration) .*/\1 <t>/" -e "s/pid [0-9]+/pid <n>/g" \
      "$out/$pool.$s" > "$out/$pool.$s.norm"
  done
  echo "$pool: exit=$(cat "$out/$pool.code")"
done
