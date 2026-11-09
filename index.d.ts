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
}

export declare function fastForks(options?: FastForksOptions): PoolRunnerInitializer
