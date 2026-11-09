import { createRequire } from 'node:module'
import { totalmem } from 'node:os'
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
 * @param {{ fallback?: 'forks' | 'error', snapshot?: boolean, memoryLimit?: number | string }} [options]
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
  const context = {
    addon: support.addon,
    snapshot: options.snapshot ?? true,
    memoryLimit: parseMemoryLimit(options.memoryLimit),
  }
  return {
    name: 'fastforks',
    createPoolWorker: (poolOptions) =>
      usesDebugger(poolOptions) ? createDebugPoolWorker(poolOptions) : new FastForksPoolWorker(poolOptions, context),
  }
}

// Bytes, or a percentage of the system memory such as '10%'.
function parseMemoryLimit(value) {
  if (value === undefined) return undefined
  if (typeof value === 'number') return value
  const match = /^(\d+(?:\.\d+)?)%$/.exec(value)
  if (!match) throw new Error(`[vitest-pool-fastforks] memoryLimit must be a number of bytes or a percentage: ${value}`)
  return (totalmem() * Number(match[1])) / 100
}
