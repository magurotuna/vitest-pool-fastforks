// Builds the startup snapshot blob for the child processes and caches it per
// Node.js binary. Node.js checks only the version, the architecture, and the
// platform of a blob, and a blob from another build of the same version can
// crash, so the cache key also has the binary's path, size, and mtime.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitNodeOptions } from './node-options.ts'

const entry = fileURLToPath(new URL('./snapshot-entry.cjs', import.meta.url))
const packageJson = fileURLToPath(new URL('../package.json', import.meta.url))

// Node.js runs pre-execution again after it restores a blob, but some flags
// change only what the snapshot builder sets up, for example
// --no-experimental-global-navigator and --experimental-eventsource. Use the
// blob only with the flags that behaved the same with and without it.
const SAME_WITH_BLOB = new Set([
  '--conditions',
  '-C',
  '--cpu-prof',
  '--cpu-prof-dir',
  '--cpu-prof-interval',
  '--cpu-prof-name',
  '--diagnostic-dir',
  '--disable-proto',
  '--enable-source-maps',
  '--experimental-import-meta-resolve',
  '--experimental-vm-modules',
  '--expose-gc',
  '--frozen-intrinsics',
  '--heap-prof',
  '--heap-prof-dir',
  '--heap-prof-interval',
  '--heap-prof-name',
  '--import',
  '--max-old-space-size',
  '--no-deprecation',
  '--no-experimental-strip-types',
  '--no-experimental-websocket',
  '--no-warnings',
  '--require',
  '-r',
  '--stack-size',
  '--title',
  '--trace-warnings',
])
const TAKES_VALUE = new Set([
  '--conditions',
  '-C',
  '--cpu-prof-dir',
  '--cpu-prof-interval',
  '--cpu-prof-name',
  '--diagnostic-dir',
  '--heap-prof-dir',
  '--heap-prof-interval',
  '--heap-prof-name',
  '--import',
  '--require',
  '-r',
])

/** Whether the blob behaves the same as no blob with these Node.js flags. */
export function canUseSnapshotBlob(execArgv: string[], nodeOptions = ''): boolean {
  const args = [...splitNodeOptions(nodeOptions), ...execArgv]
  for (let i = 0; i < args.length; i++) {
    const [name, value] = args[i]!.split(/=(.*)/s)
    if (!SAME_WITH_BLOB.has(name!)) return false
    if (value === undefined && TAKES_VALUE.has(name!)) i++
  }
  return true
}

let pending: Promise<string | undefined> | undefined

/** Resolves to the blob path, or undefined if the blob cannot be built. */
export function getSnapshotBlob(): Promise<string | undefined> {
  pending ??= build().catch(() => undefined)
  return pending
}

/** The blob made a child process fail to start: do not use it again. */
export function discardSnapshotBlob(path: string): void {
  rmSync(path, { force: true })
  pending = Promise.resolve(undefined)
}

function cacheKey(): string {
  const execPath = realpathSync(process.execPath)
  const stat = statSync(execPath)
  const hash = createHash('sha256')
  for (const part of [
    JSON.parse(readFileSync(packageJson, 'utf8')).version,
    readFileSync(entry, 'utf8'),
    process.version,
    process.arch,
    process.platform,
    execPath,
    stat.size,
    stat.mtimeMs,
    process.env.NODE_OPTIONS ?? '',
  ]) {
    hash.update(String(part)).update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

function cacheDir(): string {
  let user = 'user'
  try {
    user = String(userInfo().uid >= 0 ? userInfo().uid : userInfo().username)
  } catch {}
  return join(tmpdir(), `vitest-pool-fastforks-${user}`)
}

async function build(): Promise<string> {
  const dir = cacheDir()
  const blob = join(dir, `${process.version}-${cacheKey()}.blob`)
  if (existsSync(blob)) return blob
  mkdirSync(dir, { recursive: true })
  // Write to a temporary file and rename it, so that parallel runs never read
  // a half-written blob.
  const temporary = `${blob}.${process.pid}.tmp`
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, ['--snapshot-blob', temporary, '--build-snapshot', entry], (error) =>
        error ? reject(error) : resolve(),
      )
    })
    renameSync(temporary, blob)
  } finally {
    rmSync(temporary, { force: true })
  }
  return blob
}
