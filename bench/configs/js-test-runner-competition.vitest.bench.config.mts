// The js-test-runner-competition config, with the pool from BENCH_POOL and the
// caches in @BENCH@/cache.
import { mergeConfig } from 'vitest/config'
import base from './vitest.config.ts'
import { benchPool } from '@BENCH@/configs/bench-pool.mjs'

const cache = '@BENCH@/cache/js-test-runner-competition'
export default mergeConfig(base, {
  cacheDir: cache,
  test: {
    ...benchPool(),
    // The default is node_modules/.vitest-cache.
    fsModuleCachePath: `${cache}/vitest-cache`,
  },
})
