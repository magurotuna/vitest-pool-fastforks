// Builds the startup snapshot blob for the child processes and caches it per
// Node.js binary. Node.js checks only the version, the architecture, and the
// platform of a blob, and a blob from another build of the same version can
// crash, so the cache key also has the binary's path, size, and mtime.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
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
  // userInfo() throws for a user ID without a passwd entry, as in some
  // containers. So use the user name only on Windows, which has no user IDs.
  let user = String(process.geteuid?.() ?? 'user')
  if (!process.geteuid) {
    try {
      user = userInfo().username
    } catch {}
  }
  return join(tmpdir(), `vitest-pool-fastforks-snapshot-${user}`)
}

/**
 * Returns whether the pool can keep the blob in this directory, and makes the
 * directory if it does not exist. A child process runs the code in the blob,
 * so another user must not be able to write to the directory: on a system
 * with a shared temporary directory, that user could put a blob there, or
 * replace one, and run code as the current user. This assumes a temporary
 * directory like /tmp, which root owns and which has the sticky bit, so that
 * another user cannot rename the directory after the check.
 */
export function prepareCacheDir(dir: string, uid = process.geteuid?.()): boolean {
  try {
    mkdirSync(dir, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  // lstat: a symbolic link is not a directory.
  const stat = lstatSync(dir)
  if (!stat.isDirectory()) return false
  // Windows has no user IDs here, and the temporary directory belongs to the
  // user.
  if (uid === undefined) return true
  // This fails on a file system that does not keep the owner or the mode.
  return stat.uid === uid && (stat.mode & 0o777) === 0o700
}

async function build(): Promise<string | undefined> {
  const dir = cacheDir()
  const variable = process.platform === 'win32' ? 'TEMP' : 'TMPDIR'
  let usable: boolean
  try {
    usable = prepareCacheDir(dir)
  } catch (error) {
    console.warn(
      `[vitest-pool-fastforks] The pool cannot use ${dir} (${String((error as NodeJS.ErrnoException).code ?? error)}), so it starts without the startup snapshot. Set ${variable} to a directory that only you can write to.`,
    )
    return undefined
  }
  if (!usable) {
    console.warn(
      `[vitest-pool-fastforks] ${dir} is not a directory that you own with mode 0700, so the pool starts without the startup snapshot. Remove it (if another user owns it, an administrator can), or set ${variable} to a directory that only you can write to.`,
    )
    return undefined
  }
  const blob = join(dir, `${process.version}-${cacheKey()}.blob`)
  if (existsSync(blob)) return blob
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
