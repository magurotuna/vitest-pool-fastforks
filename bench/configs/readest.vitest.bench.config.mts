// The project's config, with the pool from BENCH_POOL and the caches in
// @BENCH@/cache. bench/projects/readest.sh replaces __dirname in
// vitest.config.mts with the absolute path (--configLoader runner does not
// define __dirname).
//
import { mergeConfig } from 'vitest/config'
import base from './vitest.config.mts'
import { benchPool } from '@BENCH@/configs/bench-pool.mjs'

const cache = '@BENCH@/cache/readest'
export default mergeConfig(base, {
  cacheDir: cache,
  test: {
    ...benchPool(),
    // The default is <workspace root>/node_modules/.vitest-cache.
    fsModuleCachePath: `${cache}/fs-module-cache`,
  },
})
