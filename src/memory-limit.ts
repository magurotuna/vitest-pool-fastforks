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

/**
 * The memory that the child processes share: the memory of the system, or
 * the limit of the process if it is lower. On Linux,
 * process.constrainedMemory() returns UINT64_MAX if the cgroup of the process
 * sets no limit, so the limit can be larger than the memory of the system.
 * Each value is 0 if Node.js does not know it.
 */
export function availableMemory(constrained: number | undefined, total: number): number {
  if (!constrained) return total
  if (!total) return constrained
  return Math.min(constrained, total)
}

/** The memory of a child process after it freed the Environment of a test file. */
export interface MemoryUse {
  rss?: number
  heap?: { used: number; limit: number }
}

/**
 * Whether the pool stops a child process after a test file. A leak in the
 * JavaScript heap, such as a native addon that keeps the contexts of freed
 * Environments, can reach the heap limit of V8 before the RSS reaches
 * memoryLimit. V8 then aborts the child process during a later file. So the
 * pool also stops a child process if its heap uses more than half of the heap
 * limit (heap_size_limit). The child process reads its heap after the full
 * GC that it runs if the heap grew by 128 MiB, so the heap in use counts at
 * most about 128 MiB of garbage, unless a flag blocks the GC. The heap limit
 * also counts the young generation, so with a small old generation
 * (--max-old-space-size), the check comes late or never.
 */
export function overMemoryLimit(use: MemoryUse, memoryLimit: number): boolean {
  if ((use.rss ?? 0) > memoryLimit) return true
  return use.heap !== undefined && use.heap.used > use.heap.limit / 2
}
