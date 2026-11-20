# Base UI, the Node.js projects @base-ui/react and @base-ui/utils (jsdom) and
# docs (node). VITEST_ENV=jsdom turns off browser mode in vitest.shared.mts.
setup_base_ui() {
  local d=$R/base-ui
  clone $d https://github.com/mui/base-ui.git cf696d6f6e08c699c5bda24d5a033430909f2285
  add_overrides $d/pnpm-workspace.yaml $VITEST_VERSION vitest @vitest/browser-playwright \
    @vitest/coverage-istanbul @vitest/ui
  has_vitest $d $VITEST_VERSION || install $d
  config base-ui.vitest.bench.config.mts $d/vitest.bench.config.mts
}
proj_base_ui() {
  DIR=$R/base-ui
  VITEST_BIN=$DIR/node_modules/vitest/vitest.mjs
  ARGS=(--project @base-ui/react --project @base-ui/utils --project docs
    --config vitest.bench.config.mts --configLoader runner)
  ENVS=(TZ=UTC VITEST_ENV=jsdom)
  ENV_FILE=
}
