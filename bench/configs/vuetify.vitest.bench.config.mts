// The project's config, with the pool from BENCH_POOL and the caches in
// @BENCH@/cache.
import { mergeConfig } from 'vitest/config'
import base from './vitest.config'
import { benchPool } from '@BENCH@/configs/bench-pool.mjs'

const cache = '@BENCH@/cache/vuetify'
export default (env: any) =>
  mergeConfig(base(env), {
    cacheDir: cache,
    test: {
      ...benchPool(),
      // The default is node_modules/.vitest-cache.
      fsModuleCachePath: `${cache}/vitest-cache`,
    },
  })
