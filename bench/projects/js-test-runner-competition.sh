# The synthetic suite of js-test-runner-competition: the postinstall writes
# 500 files of 10 tests to fixture/tests/nomock/ (with a fixed seed). They run
# with happy-dom (REPRO_ENV=happy-dom; without it, the config uses browser mode).
setup_js_test_runner_competition() {
  local d=$R/js-test-runner-competition
  clone $d https://github.com/ubugeeei-reproductions/js-test-runner-competition.git \
    fb868f3754aecfa995d252e78992f6331d6617e5
  if ! grep -q "fastforks-bench" $d/pnpm-workspace.yaml; then
    # The patches are for 5.0.3, and pnpm fails on a patch that it cannot
    # apply. The browser patches are for browser mode. The mocker patch changes
    # the code only if REPRO_EXP_PARALLEL_IMPORTS is set.
    sed -i -E '/^  "@vitest\/(browser|browser-playwright|mocker)@5\.0\.3": /d' $d/pnpm-workspace.yaml
    add_overrides $d/pnpm-workspace.yaml $VITEST_VERSION vitest @vitest/browser @vitest/browser-playwright \
      @vitest/browser-preview @vitest/ui
  fi
  installed $d || install $d
  config js-test-runner-competition.vitest.bench.config.mts $d/vitest.bench.config.mts
}
proj_js_test_runner_competition() {
  DIR=$R/js-test-runner-competition
  VITEST_BIN=$DIR/node_modules/vitest/vitest.mjs
  ARGS=(--config vitest.bench.config.mts --configLoader runner fixture/tests/nomock/)
  ENVS=(REPRO_ENV=happy-dom)
  ENV_FILE=
}
