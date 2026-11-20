// Bench options for one MUI X config: the pool from BENCH_POOL, and the Vite
// cache directory and the Vitest module cache in @BENCH@/cache. Each project config file has its own Vite
// server, so each gets its own Vite cache directory. The module cache
// (fsModuleCache, on by default in Vitest 5) is one directory for all
// projects, like its default (node_modules/.vitest-cache at the root).
//
// isolate: vitest.shared.mts sets `isolate: false` for every jsdom project.
// The bench compares isolated runs (a new fork or Environment for each test
// file), so both pools use `isolate: true`.
//
// BENCH_EXCLUDE (comma-separated globs, set in bench/projects/mui-x.sh) adds
// files to the exclude list of every project. The --exclude CLI option does
// not reach projects that are separate config files.
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configDefaults, mergeConfig } from 'vitest/config'
import { benchPool } from '@BENCH@/configs/bench-pool.mjs'

const ROOT = '@BENCH@/repos/mui-x'
const CACHE = '@BENCH@/cache/mui-x'

export function benchProject(config: any, configUrl: string) {
  const dir = relative(ROOT, dirname(fileURLToPath(configUrl))) || 'root'
  const merged = mergeConfig(config, {
    cacheDir: `${CACHE}/${dir.replaceAll('/', '_')}`,
    test: { fsModuleCachePath: `${CACHE}/vitest-cache`, isolate: true, ...benchPool() },
  })
  const exclude = process.env.BENCH_EXCLUDE?.split(',').filter(Boolean) ?? []
  if (exclude.length > 0) {
    // A project without its own exclude list uses Vitest's default list.
    merged.test.exclude = [...(config.test?.exclude ?? configDefaults.exclude), ...exclude]
  }
  return merged
}
