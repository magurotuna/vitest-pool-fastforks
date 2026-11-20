#!/usr/bin/env bash
# Measures each project with forks and with this pool, with all CPUs and with
# 4 CPUs (taskset -c 0-3), and writes results.json. Run bench/setup.sh first.
# Usage: bash bench/bench.sh [project...]   (default: every project, about 6 hours)
#   RUN: the name of the output directory $BENCH/raw/<RUN> (default: the UTC time).
# For each project and CPU count: a warm-up run of each pool (it fills the
# caches of Vite, Vitest, and the pool), then 3 runs of each pool. The order
# alternates the pool that runs first.
set -u
source "$(dirname "$0")/lib.sh"
out=$BENCH/raw/${RUN:-$(date -u +%Y%m%dT%H%M%SZ)}
mkdir -p "$out"
projects=("$@")
[ ${#projects[@]} -gt 0 ] || projects=(mui-x readest material-ui vitest vuetify base-ui instructure-ui js-test-runner-competition)
n=$BENCH/node_modules/vitest-pool-fastforks
jq -n --arg model "$(lscpu | sed -n 's/^Model name: *//p')" --argjson cpus "$(nproc)" \
  --argjson threads "$(lscpu | sed -n 's/^Thread(s) per core: *//p')" \
  --argjson memKiB "$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)" \
  --arg virt "$(systemd-detect-virt 2>/dev/null || true)" --arg node "$(node --version)" \
  --arg package "$(jq -r .version $n/package.json)" --arg commit "$(cat $n/COMMIT)" --arg date "$(date -u +%F)" \
  '{model: $model, cpus: $cpus, threadsPerCore: $threads, memKiB: $memKiB, virt: $virt, node: $node,
    package: $package, commit: $commit, date: $date}' > "$out/machine.json"
steps=(warm-forks warm-fastforks r1-forks r1-fastforks r2-fastforks r2-forks r3-forks r3-fastforks)
for p in "${projects[@]}"; do
  for cpus in all 4; do
    if [ $cpus = 4 ]; then export CPUSET=0-3; else unset CPUSET; fi
    for s in "${steps[@]}"; do bash "$B/run.sh" "$p" "${s#*-}" "$cpus-$s" "$out/$p"; done
    # Files that the tests wrote into the checkout.
    (proj_${p//-/_}; git -C "$DIR" status --short) > "$out/$p/git-status-$cpus.txt"
  done
done
node "$B/summarize.ts" "$out" > "$out/results.json" && log "wrote $out/results.json"
