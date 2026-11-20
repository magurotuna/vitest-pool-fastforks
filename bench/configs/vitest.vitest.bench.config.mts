// vitest's test/unit config, with the pool from BENCH_POOL and the caches
// outside the git-tracked tree.
import { mergeConfig } from 'vitest/config'
import base from './vite.config.ts'
import { benchPool } from '@BENCH@/configs/bench-pool.mjs'

const cache = '@BENCH@/cache/vitest'
const config = mergeConfig(base, {
  cacheDir: cache,
  test: {
    // The default is <workspace root>/node_modules/.vitest-cache.
    fsModuleCachePath: `${cache}/fs-module-cache`,
    // tsc writes its build info into the dist directory of the Vitest that
    // runs. Type tests do not use a pool.
    typecheck: { enabled: false },
  },
})

// Each project (threads, forks, vmThreads) sets its own pool, which wins over
// the root pool, so set the pool in each project. The projects keep their
// names (the forks project stays "forks"). They extend this file so that they
// share its Vite server and cacheDir. Assign the array: mergeConfig would
// concatenate it.
config.test.projects = base.test.projects.map((project) => ({
  ...project,
  extends: true,
  test: { ...project.test, ...benchPool() },
}))

export default config
