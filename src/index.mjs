import { createRequire } from 'node:module'
import { join } from 'node:path'
import { FastForksPoolWorker } from './pool.mjs'
import { detect } from './support.mjs'

const require = createRequire(import.meta.url)

// The Environments of this pool have no debugger connection, so a run with
// --inspect or --inspect-brk uses a fork for each test file. Take the forks
// worker from the Vitest that runs, which has already loaded it.
function createDebugPoolWorker(poolOptions) {
  const { ForksPoolWorker } = require(join(poolOptions.distPath, 'node.js'))
  const worker = new ForksPoolWorker(poolOptions)
  Object.defineProperty(worker, 'name', { value: 'fastforks' })
  return worker
}

function usesDebugger(poolOptions) {
  return (
    poolOptions.project.config.inspector?.enabled ||
    poolOptions.execArgv.some((arg) => /^--inspect(-brk|-wait)?(=|$)/.test(arg))
  )
}

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
    createPoolWorker: (poolOptions) =>
      usesDebugger(poolOptions) ? createDebugPoolWorker(poolOptions) : new FastForksPoolWorker(poolOptions, context),
  }
}
