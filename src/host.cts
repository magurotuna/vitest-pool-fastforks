// The child process. Creates one Node.js Environment per test file with the
// addon and runs Vitest's fork entry inside it (entry.cts). Messages from the
// main process are routed by worker id.
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getHeapStatistics, setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import type {
  Addon,
  Bridge,
  ControlMessage,
  HostOptions,
  LoadedModule,
  ResolvedModule,
  WorkerMessage,
} from './protocol.ts'

interface Environment {
  id: number
  /** The id of the Environment in the addon. */
  sid: number
  /** Delivers a message to Vitest's fork entry in the Environment. */
  deliver: ((message: unknown) => void) | undefined
  /** Messages that arrived before the fork entry listened. */
  queue: unknown[]
}

const options: HostOptions = JSON.parse(process.env.VITEST_POOL_FASTFORKS_HOST!)
delete process.env.VITEST_POOL_FASTFORKS_HOST
const addon: Addon = require(options.addon)

// EnvironmentFlags: kOwnsProcessState, and kNoCreateInspector unless the
// tests need node:inspector (V8 coverage). Without kOwnsProcessState,
// process.chdir() in a test fails a CHECK and aborts this process, because
// the restored context keeps the main thread's methods.
const FLAGS = (1 << 1) | (options.inspector ? 0 : 1 << 9)
if (options.inspector) {
  // V8 shares compiled functions between the Environments through its
  // compilation cache. When each test file starts and stops precise
  // coverage, the counts of the shared functions get lost, so V8 coverage
  // differs from a fork.
  setFlagsFromString('--no-compilation-cache')
}

// The Environment sees the same process.argv and process.execArgv as a fork.
const argv = [process.argv[0]!, options.argv1]
const execArgv = withoutSnapshotBlob(process.execArgv)

// Shared by all Environments in this process. See entry.cts. The entries are
// made here, not in an Environment: an object keeps the context that made it
// alive, so an entry made in an Environment would keep that whole
// Environment in memory after it is freed.
const resolved = new Map<string, ResolvedModule>()
const loaded = new Map<string, LoadedModule>()
const moduleCache: Bridge['moduleCache'] = {
  getResolved: (key) => resolved.get(key),
  setResolved: (key, url, format) => void resolved.set(key, { url, format }),
  getLoaded: (url) => loaded.get(url),
  setLoaded: (url, format, source) => void loaded.set(url, { format, source }),
}

const entry = join(__dirname, 'entry.cjs')
// The embedder main script can import only built-in modules, so it loads
// entry.cjs through the Environment's own CommonJS loader.
const LOAD = `return require('module').createRequire(${JSON.stringify(entry)})(${JSON.stringify(entry)})`

const environments = new Map<number, Environment>()

function create(id: number): void {
  const sid = addon.create(FLAGS, argv, execArgv)
  const s: Environment = { id, sid, deliver: undefined, queue: [] }
  const bridge: Bridge = {
    post: (message) => process.send!({ __fastforks: id, msg: message } satisfies WorkerMessage),
    ready: (deliver) => {
      s.deliver = deliver
      if (s.queue.length > 0) setImmediate(() => s.queue.splice(0).forEach((message) => send(s, message)))
    },
    forksUrl: options.forksUrl,
    moduleCache,
  }
  addon.global(sid).__vitestPoolFastForks = bridge
  addon.load(sid, LOAD)
  environments.set(id, s)
  reply({ __fastforks_ctl: 'created', id })
}

// Run the Environment's listener inside its callback scope, so that the
// nextTick callbacks that it schedules run now, not at the Environment's next
// timer or I/O callback.
function send(s: Environment, message: unknown): void {
  if (environments.get(s.id) === s) addon.call(s.sid, s.deliver!, message)
}

// Environments share the process: cwd, environment variables, and umask that
// a test file changes would stay for the next file. Put them back after each
// file, so that every file starts like a new fork.
const baseline = { cwd: process.cwd(), env: { ...process.env }, umask: process.umask() }
function restoreProcessState(): void {
  // Always: each Environment caches process.cwd(), so this Environment does
  // not see a chdir() in another one.
  process.chdir(baseline.cwd)
  for (const key of Object.keys(process.env)) {
    if (!Object.hasOwn(baseline.env, key)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(baseline.env)) {
    if (process.env[key] !== value) process.env[key] = value
  }
  if (process.umask() !== baseline.umask) process.umask(baseline.umask)
}

// Measurement only: how many contexts stay alive after a full GC.
const contextsLog = process.env.VITEST_POOL_FASTFORKS_CONTEXTS
let gc: (() => void) | undefined
if (contextsLog) {
  setFlagsFromString('--expose-gc')
  gc = runInNewContext('gc')
}

let freed = 0
function free(id: number): void {
  freed++
  const s = environments.get(id)
  environments.delete(id)
  if (s) {
    addon.free(s.sid)
    restoreProcessState()
  }
  if (contextsLog) {
    gc!()
    const heap = getHeapStatistics()
    appendFileSync(
      contextsLog,
      `${JSON.stringify({
        pid: process.pid,
        id,
        native: heap.number_of_native_contexts,
        detached: heap.number_of_detached_contexts,
        used: heap.used_heap_size,
        rss: process.memoryUsage.rss(),
      })}\n`,
    )
  }
  reply({ __fastforks_ctl: 'freed', id, rss: process.memoryUsage.rss() })
}

function reply(message: ControlMessage): void {
  process.send!(message)
}

function withoutSnapshotBlob(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--snapshot-blob') i++
    else if (!args[i]!.startsWith('--snapshot-blob=')) result.push(args[i]!)
  }
  return result
}

process.on('SIGTERM', () => process.exit(0))
// The main process exited without stopping this process.
process.on('disconnect', () => process.exit(0))

if (options.cpu) {
  // Measurement only: the main process does not wait for this process, so a
  // time(1) of the main process misses its CPU time.
  const prefix = options.cpu
  process.on('exit', () => {
    const { userCPUTime: user, systemCPUTime: system, maxRSS } = process.resourceUsage()
    writeFileSync(`${prefix}.${process.pid}.json`, JSON.stringify({ user, system, maxRSS, files: freed }))
  })
}

process.on('message', (m: ControlMessage | WorkerMessage) => {
  if ('__fastforks_ctl' in m) {
    if (m.__fastforks_ctl === 'create') create(m.id!)
    else if (m.__fastforks_ctl === 'free') free(m.id!)
    return
  }
  const s = environments.get(m.__fastforks)
  if (!s) return
  if (s.deliver === undefined || s.queue.length > 0) s.queue.push(m.msg)
  else send(s, m.msg)
})

reply({ __fastforks_ctl: 'ready' })
