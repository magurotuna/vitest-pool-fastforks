# Vuetify v4.3.2, packages/vuetify, the unit project (jsdom).
setup_vuetify() {
  local d=$R/vuetify
  clone $d https://github.com/vuetifyjs/vuetify.git f607e153ab06201e2f856c64e5413737bef9aba6
  if ! grep -q "fastforks-bench" $d/pnpm-workspace.yaml; then
    # The patch is for @vitest/browser 4.1.11, and pnpm fails on a patch that it
    # cannot apply. Browser mode is not measured.
    sed -i "/^  '@vitest\/browser': patches\/@vitest__browser.patch$/d" $d/pnpm-workspace.yaml
    add_overrides $d/pnpm-workspace.yaml $VITEST_VERSION vitest @vitest/browser @vitest/browser-playwright \
      @vitest/coverage-istanbul @vitest/ui
  fi
  has_vitest $d $VITEST_VERSION || install $d
  config vuetify.vitest.bench.config.mts $d/packages/vuetify/vitest.bench.config.mts
}
proj_vuetify() {
  DIR=$R/vuetify/packages/vuetify
  VITEST_BIN=$R/vuetify/node_modules/vitest/vitest.mjs
  ARGS=(--project unit --config vitest.bench.config.mts --configLoader runner)
  ENVS=(TZ=UTC)
  ENV_FILE=
}
