import { FastForksPoolWorker } from './pool.mjs'
import { detect } from './support.mjs'

let warned = false

/**
 * @param {{ fallback?: 'forks' | 'error', snapshot?: boolean }} [options]
 */
export function fastForks(options = {}) {
  const support = detect()
  if ('reason' in support) {
    const message = `[vitest-pool-fastforks] ${support.reason}.`
    if (options.fallback === 'error') throw new Error(message)
    if (!warned && process.env.VITEST_POOL_FASTFORKS !== '0') {
      warned = true
      console.warn(`${message} Using the "forks" pool instead.`)
    }
    // Vitest uses its built-in pool for the name "forks".
    return { name: 'forks', createPoolWorker: () => undefined }
  }
  const context = { addon: support.addon, snapshot: options.snapshot ?? true }
  return {
    name: 'fastforks',
    createPoolWorker: (poolOptions) => new FastForksPoolWorker(poolOptions, context),
  }
}
