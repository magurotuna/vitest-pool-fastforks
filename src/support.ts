// Decides whether this Node.js can run the pool.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// Node.js v26.11.0 is the first release in which several Environments can
// share one isolate (nodejs/node#65977, nodejs/node#66239).
const MINIMUM = [26, 11, 0]

export function detect(): { addon: string } | { reason: string } {
  if (process.env.VITEST_POOL_FASTFORKS === '0') {
    return { reason: 'VITEST_POOL_FASTFORKS=0 is set' }
  }
  if (!isAtLeast(process.versions.node, MINIMUM)) {
    return { reason: `Node.js v${MINIMUM.join('.')} or later is required (current: ${process.version})` }
  }
  const addon = findAddon()
  if (!addon) {
    return {
      reason: `no native addon for ${platformTag()} and Node.js ABI ${process.versions.modules}`,
    }
  }
  try {
    require(addon)
  } catch (error) {
    return { reason: `the native addon failed to load: ${(error as Error).message}` }
  }
  return { addon }
}

/**
 * The directory of the prebuilt addon, for example linux-x64-glibc or
 * darwin-arm64. On Linux, an addon built against glibc does not load with
 * musl (Alpine), and the other way around.
 */
export function platformTag(): string {
  if (process.platform !== 'linux') return `${process.platform}-${process.arch}`
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
  return `linux-${process.arch}-${report?.header?.glibcVersionRuntime ? 'glibc' : 'musl'}`
}

/** Whether the version (for example '26.13.0') is the minimum or later. */
export function isAtLeast(version: string, minimum: number[]): boolean {
  const parts = version.split('.').map(Number)
  for (let i = 0; i < minimum.length; i++) {
    const part = parts[i] ?? 0
    if (part !== minimum[i]) return part > minimum[i]!
  }
  return true
}

function findAddon(): string | undefined {
  const candidates = [
    `../prebuilds/${platformTag()}/node.abi${process.versions.modules}.node`,
    '../build/Release/fastforks.node',
  ]
  for (const candidate of candidates) {
    const path = fileURLToPath(new URL(candidate, import.meta.url))
    if (existsSync(path)) return path
  }
  return undefined
}
