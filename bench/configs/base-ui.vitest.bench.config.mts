// The project's config, with the pool from BENCH_POOL in every project and
// the caches in @BENCH@/cache.
import { mergeConfig } from 'vitest/config'
import base from './vitest.config.mts'
import { benchPool } from '@BENCH@/configs/bench-pool.mjs'
import { withOptions } from '@BENCH@/configs/bench-projects.mjs'

const cache = '@BENCH@/cache/base-ui'
// fsModuleCache is on by default and writes to node_modules/.vitest-cache.
const test = { ...benchPool(), fsModuleCachePath: `${cache}/vitest-cache` }
const top = { cacheDir: cache }

const config = mergeConfig(base, { ...top, test })
// The projects come from config files, which do not get the options above.
config.test.projects = await withOptions(base.test.projects, {
  root: import.meta.dirname,
  importConfig: (file) => import(/* @vite-ignore */ file),
  test,
  top,
  exclude: process.env.BENCH_EXCLUDE ? process.env.BENCH_EXCLUDE.split(',') : [],
})

export default config
