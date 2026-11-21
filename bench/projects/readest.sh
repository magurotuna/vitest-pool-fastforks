# readest, apps/readest-app (jsdom). Its config sets maxWorkers: 4. 6 files
# fail with both pools: 2 need the tauri-plugin-turso submodule (Rust), and 4
# need the pdfjs build output.
setup_readest() {
  local d=$R/readest a=$R/readest/apps/readest-app
  clone $d https://github.com/readest/readest.git c46730772847d5d551e73aa1b2adebff339f634c
  (cd $d && git submodule update --init --depth 1 packages/foliate-js packages/js-mdict \
    packages/simplecc-wasm packages/qcms)
  # @vitest/browser-webdriverio has no 5.1.0 release. It is for browser mode only.
  add_overrides $d/pnpm-workspace.yaml $VITEST_VERSION vitest @vitest/browser-playwright
  installed $d || install $d
  # --configLoader runner does not define __dirname.
  sed -i "s|path.resolve(__dirname, |path.resolve('$a', |g" $a/vitest.config.mts
  config readest.vitest.bench.config.mts $a/vitest.bench.config.mts
}
proj_readest() {
  DIR=$R/readest/apps/readest-app
  VITEST_BIN=$DIR/node_modules/vitest/vitest.mjs
  ARGS=(--config vitest.bench.config.mts --configLoader runner)
  # CI=true: a missing snapshot fails instead of being written by the first run.
  ENVS=(CI=true TZ=UTC)
  ENV_FILE=.env
}
