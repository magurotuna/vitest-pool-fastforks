# Material UI, the Node.js projects (TEST_SCOPE=node: jsdom and node, no
# browser projects).
setup_material_ui() {
  local d=$R/material-ui
  clone $d https://github.com/mui/material-ui.git 403986ae957cea6959358fb8dbefc2178b62f2d5
  add_overrides $d/pnpm-workspace.yaml $VITEST_VERSION vitest @vitest/browser-playwright
  has_vitest $d $VITEST_VERSION || install $d
  config material-ui.vitest.bench.config.mts $d/vitest.bench.config.mts
}
proj_material_ui() {
  DIR=$R/material-ui
  VITEST_BIN=$DIR/node_modules/vitest/vitest.mjs
  ARGS=(--config vitest.bench.config.mts --configLoader runner)
  # BENCH_EXCLUDE (read by the bench config, because --exclude does not reach
  # a project that has its own config file): envinfo.test.js runs the envinfo
  # CLI, which scans every installed package for about 6 minutes and then
  # times out with both pools.
  ENVS=(TZ=UTC TEST_SCOPE=node BENCH_EXCLUDE=packages/mui-envinfo/src/envinfo.test.js)
  ENV_FILE=
}
