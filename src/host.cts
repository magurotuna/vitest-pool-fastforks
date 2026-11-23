// The child process. Creates one Node.js Environment per test file with the
// addon and runs Vitest's fork entry inside it (entry.cts). Messages from the
// main process are routed by worker id.
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getHeapStatistics, setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { splitNodeOptions } from './node-options.ts'
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
// tests need node:inspector (V8 coverage, or the inspector option). Without
// kOwnsProcessState, process.chdir() in a test fails a CHECK and aborts this
// process, because the restored context keeps the main thread's methods.
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
  setLoaded: (url, format, source, file) => void loaded.set(url, { format, source, file }),
  since: options.since,
}
let run = 0

const entry = join(__dirname, 'entry.cjs')
// The embedder main script can import only built-in modules, so it loads
// entry.cjs through the Environment's own CommonJS loader.
const LOAD = `return require('module').createRequire(${JSON.stringify(entry)})(${JSON.stringify(entry)})`

const environments = new Map<number, Environment>()

function create(id: number, nextRun: number): void {
  // A file in node_modules can change between runs.
  if (nextRun !== run) {
    run = nextRun
    resolved.clear()
    loaded.clear()
  }
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

// The Node.js flags of this process, also from NODE_OPTIONS.
const flags = [...splitNodeOptions(process.env.NODE_OPTIONS ?? ''), ...process.execArgv]

// After a free, V8 does not run a full GC soon, so the heap keeps the
// garbage of the freed Environment. The heap grows to V8's limit for the old
// generation, which can be several times the live heap, and the RSS stays
// high. So after a free, run a full GC if the heap grew by GC_GROWTH since
// the start of this process or the last GC. A GC after every free takes about
// 30-60 ms for each file: on 4 busy CPUs, that made runs of short test files
// up to 17% slower. With the threshold, a child process with little garbage
// per file runs few GCs.
const GC_GROWTH = 128 * 1024 * 1024
const gc = takeGc()
// The heap after the last GC, or when this process started. If V8 collected
// the garbage itself, the lowest heap after a free.
let heapBase = heapInUse()

// Test files must not see gc, as with forks, unless the flags expose it.
// V8 adds gc to a context only if --expose-gc is on when the context is
// made. So if a new context has no gc, turn the flag on for one context and
// off again.
function takeGc(): (() => void) | undefined {
  try {
    const exposed: unknown = runInNewContext('typeof gc === "function" ? gc : undefined')
    if (typeof exposed === 'function') return exposed as () => void
    // With --expose-gc-as, gc has another name, and turning the flag off
    // would hide it. With the other flags, V8 aborts or exits when a flag
    // changes.
    const blocked =
      /^--?(expose[-_]gc[-_]as|freeze[-_]flags[-_]after[-_]init|(abort|exit)[-_]on[-_]contradictory[-_]flags)/
    if (flags.some((arg) => blocked.test(arg))) return undefined
    setFlagsFromString('--expose-gc')
    try {
      return runInNewContext('gc')
    } finally {
      setFlagsFromString('--no-expose-gc')
    }
  } catch {
    return undefined
  }
}

function heapInUse(): number {
  const heap = getHeapStatistics()
  return heap.used_heap_size + heap.external_memory
}

function collectGarbage(): void {
  if (!gc) return
  const used = heapInUse()
  heapBase = Math.min(heapBase, used)
  if (used - heapBase < GC_GROWTH) return
  gc()
  heapBase = heapInUse()
}

// Measurement only: how many contexts stay alive after a full GC.
const contextsLog = process.env.VITEST_POOL_FASTFORKS_CONTEXTS

let freed = 0
function free(id: number): void {
  freed++
  const s = environments.get(id)
  environments.delete(id)
  if (!s) {
    replyFreed(id)
    return
  }
  // The Environment can run callbacks, and change the process state, until the
  // addon frees it. So restore the process state and reply after the free.
  addon.free(s.sid, () => {
    restoreProcessState()
    replyFreed(id)
  })
}

function replyFreed(id: number): void {
  if (contextsLog && gc) {
    gc()
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
  } else {
    collectGarbage()
  }
  const heap = getHeapStatistics()
  reply({
    __fastforks_ctl: 'freed',
    id,
    rss: process.memoryUsage.rss(),
    heap: { used: heap.used_heap_size, limit: heap.heap_size_limit },
  })
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

// Exit on SIGTERM only if something writes a file at exit: the flags that
// Vitest's fork entry checks (here also from NODE_OPTIONS), V8 coverage, and
// the CPU time measurement. Otherwise a SIGTERM that a test sends to its own
// process would end this process.
if (
  options.cpu ||
  process.env.NODE_V8_COVERAGE ||
  flags.some((arg) => /^--(prof|cpu-prof|heap-prof|diagnostic-dir)/.test(arg))
) {
  process.on('SIGTERM', () => process.exit(0))
}
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
    if (m.__fastforks_ctl === 'create') create(m.id!, m.run!)
    else if (m.__fastforks_ctl === 'free') free(m.id!)
    return
  }
  const s = environments.get(m.__fastforks)
  if (!s) return
  if (s.deliver === undefined || s.queue.length > 0) s.queue.push(m.msg)
  else send(s, m.msg)
})

reply({ __fastforks_ctl: 'ready' })
