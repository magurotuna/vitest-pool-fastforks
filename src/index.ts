import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { PoolOptions, PoolRunnerInitializer, PoolWorker } from 'vitest/node'
import { parseMemoryLimit } from './memory-limit.ts'
import { FastForksPoolWorker } from './pool.ts'
import { detect, isAtLeast } from './support.ts'

export interface FastForksOptions {
  /**
   * What to do if the pool cannot run: Node.js older than v26.11.0, Vitest
   * older than v4.0.10, or no native addon for this platform.
   * - `'forks'`: print a warning and use the `forks` pool.
   * - `'error'`: throw an error.
   * @default 'forks'
   */
  fallback?: 'forks' | 'error'
  /**
   * Start the child processes from a startup snapshot that has the Node.js
   * built-in modules that Vitest uses. The pool builds the snapshot on the
   * first run and caches it in the temporary directory.
   * @default true
   */
  snapshot?: boolean
  /**
   * A child process runs many test files, one after another. When its
   * memory (RSS) after a test file is above this limit, the pool stops it and
   * starts a new one. Bytes, or a percentage of the system memory such as
   * `'10%'`. Apart from this limit, the pool also stops a child process when
   * its JavaScript heap, with garbage that the GC did not collect yet, uses
   * more than half of the heap limit of V8 (`heap_size_limit`).
   * @default the system memory, or the memory limit that Node.js reports for
   * the process (`process.constrainedMemory()`) if it is lower (half of it in
   * watch mode), divided by the number of workers
   */
  memoryLimit?: number | string
  /**
   * Create each test file's environment with a V8 inspector, so that tests
   * can use `node:inspector`. The pool always does this for coverage with the
   * `v8` provider. Like that coverage, it turns off the V8 compilation cache,
   * so the run is slower.
   * @default false
   */
  inspector?: boolean
}

const require = createRequire(import.meta.url)

// Vitest before v4.0.10 sends v8.serialize() buffers to a fork, and this
// pool sends objects (vitest-dev/vitest#8999).
const MINIMUM_VITEST = [4, 0, 10]

let warned = false
let warnedVitest = false

/**
 * A Vitest pool that isolates every test file like the `forks` pool: each
 * file runs in a new Node.js environment, in child processes that the pool
 * reuses.
 */
export function fastForks(options: FastForksOptions = {}): PoolRunnerInitializer {
  const support = detect()
  if ('reason' in support) {
    const message = `[vitest-pool-fastforks] ${support.reason}.`
    if (options.fallback === 'error') throw new Error(message)
    if (!warned && process.env.VITEST_POOL_FASTFORKS !== '0') {
      warned = true
      console.warn(`${message} Using the "forks" pool instead.`)
    }
    // Vitest uses its built-in pool for the name "forks", and does not call
    // createPoolWorker().
    return {
      name: 'forks',
      createPoolWorker: () => {
        throw new Error('[vitest-pool-fastforks] Vitest runs the "forks" pool itself.')
      },
    }
  }
  const context = {
    addon: support.addon,
    snapshot: options.snapshot ?? true,
    memoryLimit: parseMemoryLimit(options.memoryLimit),
    inspector: options.inspector ?? false,
  }
  return {
    name: 'fastforks',
    createPoolWorker: (poolOptions) => {
      const { version } = poolOptions.project.vitest
      if (!isAtLeast(version, MINIMUM_VITEST)) {
        const message = `[vitest-pool-fastforks] Vitest v${MINIMUM_VITEST.join('.')} or later is required (current: v${version}).`
        if (options.fallback === 'error') throw new Error(message)
        if (!warnedVitest) {
          warnedVitest = true
          console.warn(`${message} Using the "forks" pool instead.`)
        }
        return createForksPoolWorker(poolOptions)
      }
      // The Environments of this pool have no debugger connection, so a run
      // with --inspect or --inspect-brk uses a fork for each test file.
      if (usesDebugger(poolOptions)) return createForksPoolWorker(poolOptions)
      return new FastForksPoolWorker(poolOptions, context)
    },
  }
}

// Take the forks worker from the Vitest that runs, which has already loaded
// it.
function createForksPoolWorker(poolOptions: PoolOptions): PoolWorker {
  const { ForksPoolWorker } = require(join(poolOptions.distPath, 'node.js')) as typeof import('vitest/node')
  const worker = new ForksPoolWorker(poolOptions)
  Object.defineProperty(worker, 'name', { value: 'fastforks' })
  return worker
}

function usesDebugger(poolOptions: PoolOptions): boolean {
  return Boolean(
    poolOptions.project.config.inspector?.enabled ||
    poolOptions.execArgv.some((arg) => /^--inspect(-brk|-wait)?(=|$)/.test(arg)),
  )
}
