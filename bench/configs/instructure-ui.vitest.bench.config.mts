// The project's config, with the pool from BENCH_POOL and the caches in
// @BENCH@/cache. The inline "node" project has no own `pool`, so it
// inherits the top-level `test.pool`.
import { fileURLToPath } from 'node:url'
import { mergeConfig } from 'vitest/config'
import { benchPool } from '@BENCH@/configs/bench-pool.mjs'

// vitest.config.mts uses __dirname, which only the default config loader
// (bundle) defines. The bench uses --configLoader runner (as on the Linux
// machine), so define __dirname while the project's config runs.
const g = globalThis as { __dirname?: string }
g.__dirname = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')
const { default: base } = await import('./vitest.config.mts')
delete g.__dirname

const cache = '@BENCH@/cache/instructure-ui'
export default mergeConfig(base, {
  cacheDir: cache,
  test: {
    ...benchPool(),
    // The default is node_modules/.vitest-cache.
    fsModuleCachePath: `${cache}/vitest-cache`,
  },
})
