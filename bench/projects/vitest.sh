# Vitest's own test/unit, the forks project (node; some files use jsdom or
# happy-dom), with the workspace's own build. The project keeps the name
# "forks", so 2 tests of child-specific.child_process.test.ts run only with forks.
setup_vitest() {
  local d=$R/vitest v
  clone $d https://github.com/vitest-dev/vitest.git f21f224bad11e738840bda1f4b6d64dd7de4a425
  if [ ! -f $d/.fastforks-bench-built ]; then
    v=$(pinned_pnpm $d)
    need_pnpm $v
    (cd $d && CI=true pnpmv $v install --frozen-lockfile && pnpmv $v build)
    touch $d/.fastforks-bench-built
  fi
  config vitest.vitest.bench.config.mts $d/test/unit/vitest.bench.config.mts
}
proj_vitest() {
  DIR=$R/vitest/test/unit
  VITEST_BIN=$R/vitest/packages/vitest/vitest.mjs
  ARGS=(--project forks --config vitest.bench.config.mts --configLoader runner)
  # CI=true: the 10 s test timeout of test/unit, and a missing snapshot fails.
  ENVS=(CI=true TZ=UTC)
  ENV_FILE=
}
