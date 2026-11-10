import { totalmem } from 'node:os'

/** Bytes, or a percentage of the memory of the system such as '10%'. */
export function parseMemoryLimit(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return value
  const match = /^(\d+(?:\.\d+)?)%$/.exec(value)
  if (!match) {
    throw new Error(`[vitest-pool-fastforks] memoryLimit must be a number of bytes or a percentage: ${value}`)
  }
  return (totalmem() * Number(match[1])) / 100
}
