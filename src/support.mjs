// Decides whether this Node.js can run the pool.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// Node.js v26.11.0 is the first release in which several Environments can
// share one isolate (nodejs/node#65977, nodejs/node#66239).
const MINIMUM = [26, 11, 0]

/** @returns {{ addon: string } | { reason: string }} */
export function detect() {
  if (process.env.VITEST_POOL_FASTFORKS === '0') {
    return { reason: 'VITEST_POOL_FASTFORKS=0 is set' }
  }
  const version = process.versions.node.split('.').map(Number)
  if (compare(version, MINIMUM) < 0) {
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
    return { reason: `the native addon failed to load: ${error.message}` }
  }
  return { addon }
}

// The directory of the prebuilt addon, for example linux-x64-glibc or
// darwin-arm64. On Linux, an addon built against glibc does not load with
// musl (Alpine), and the other way around.
export function platformTag() {
  if (process.platform !== 'linux') return `${process.platform}-${process.arch}`
  const glibc = process.report?.getReport().header.glibcVersionRuntime
  return `linux-${process.arch}-${glibc ? 'glibc' : 'musl'}`
}

function findAddon() {
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

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
