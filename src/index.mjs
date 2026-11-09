import { ForksPoolWorker } from 'vitest/node'
import { FastForksPoolWorker } from './pool.mjs'
import { detect } from './support.mjs'

// The Environments of this pool have no debugger connection, so a run with
// --inspect or --inspect-brk uses a fork for each test file.
class DebugPoolWorker extends ForksPoolWorker {
  name = 'fastforks'
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
      usesDebugger(poolOptions) ? new DebugPoolWorker(poolOptions) : new FastForksPoolWorker(poolOptions, context),
  }
}
