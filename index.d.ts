import type { PoolRunnerInitializer } from 'vitest/node'

export interface FastForksOptions {
  /**
   * What to do if this Node.js cannot run the pool (older than v26.11.0, or
   * no native addon for this platform).
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
   * `'10%'`.
   * @default half of the system memory divided by twice the number of workers
   */
  memoryLimit?: number | string
}

export declare function fastForks(options?: FastForksOptions): PoolRunnerInitializer
