# Instructure UI, the "node" project (the tests in __node_tests__). The
# "browser" project uses browser mode.
setup_instructure_ui() {
  local d=$R/instructure-ui
  clone $d https://github.com/instructure/instructure-ui.git 83cae29e8004d669a8d3d662e3fa545b895ce242
  add_overrides $d/pnpm-workspace.yaml $VITEST_VERSION vitest @vitest/browser @vitest/browser-playwright @vitest/ui
  has_vitest $d $VITEST_VERSION || install $d
  # vitest.config.mts needs the es/ builds of ui-icons and ui-themes.
  [ -f $d/packages/ui-themes/es/index.js ] && [ -f $d/packages/ui-icons/es/index.js ] \
    || (cd $d && pnpmv "$(pinned_pnpm $d)" run bootstrap)
  config instructure-ui.vitest.bench.config.mts $d/vitest.bench.config.mts
}
proj_instructure_ui() {
  DIR=$R/instructure-ui
  VITEST_BIN=$DIR/node_modules/vitest/vitest.mjs
  ARGS=(--project node --config vitest.bench.config.mts --configLoader runner)
  ENVS=(TZ=UTC)
  ENV_FILE=
}
