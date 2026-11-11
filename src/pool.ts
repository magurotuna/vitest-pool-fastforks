// The main-process side. Starts child processes (host.cts) and reuses them:
// each test file runs in a new Node.js Environment inside a child process.
// One FastForksPoolWorker is one test file, and a child process runs one
// test file at a time.
import { fork, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { availableParallelism, totalmem } from 'node:os'
import { resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { PoolOptions, PoolWorker, WorkerRequest } from 'vitest/node'
import type { ControlMessage, ControlType, HostOptions, WorkerMessage } from './protocol.ts'
import { canUseSnapshotBlob, discardSnapshotBlob, getSnapshotBlob } from './snapshot.ts'

export interface PoolContext {
  /** The path of the native addon. */
  addon: string
  snapshot: boolean
  memoryLimit: number | undefined
}

interface Registry {
  hosts: Set<Host>
  /** Idle child processes, least recently used first. */
  idle: Host[]
  /** Calls waiting for a child process to become idle or to exit. */
  waiters: (() => void)[]
  limit: number
  /** The default memory limit of a child process. */
  memoryLimit: number
  closed: boolean
}

interface SharedState {
  registries: WeakMap<object, Registry>
  allHosts: Set<Host>
  nextId: number
  warnedBlob: boolean
  exitHook?: boolean
}

const hostScript = fileURLToPath(new URL('./host.cjs', import.meta.url))

// The child processes of each Vitest instance. A child process keeps the
// execArgv, the env, and the output streams that it started with, so an idle
// child process runs only test files with the same key.
//
// Vite can load this module once per config file (a project config that
// imports the pool from outside node_modules). Keep one state per process,
// so that the limits hold for all copies.
const sharedKey = Symbol.for('vitest-pool-fastforks')
const shared: SharedState = ((globalThis as Record<symbol, SharedState>)[sharedKey] ??= {
  registries: new WeakMap(),
  allHosts: new Set(),
  nextId: 0,
  warnedBlob: false,
})
const { registries, allHosts } = shared

if (!shared.exitHook) {
  shared.exitHook = true
  process.on('exit', () => {
    for (const host of allHosts) host.child.kill()
  })
}

export class Host {
  readonly events = new EventEmitter()
  files = 0
  exited = false
  exitReason = ''
  ready!: Promise<void>
  printStartupOutput!: () => void

  constructor(
    readonly child: ChildProcess,
    readonly key: string,
    readonly registry: Registry,
  ) {
    this.events.setMaxListeners(0)
  }

  /** Sends a control message and waits for the reply with the same id. */
  request(type: ControlType, id: number, reply: ControlType): Promise<ControlMessage> {
    const replied = this.waitFor(reply, id)
    if (this.exited) return replied
    // The send fails if the child process closed its channel but did not exit
    // yet (EPIPE on Windows). With a callback, the error rejects the request
    // instead of becoming an 'error' event of the child process.
    const failed = new Promise<never>((_, reject) => {
      this.child.send({ __fastforks_ctl: type, id } satisfies ControlMessage, (error) => {
        if (error) reject(error)
      })
    })
    return Promise.race([replied, failed])
  }

  waitFor(reply: ControlType, id?: number): Promise<ControlMessage> {
    return new Promise((resolve, reject) => {
      if (this.exited) {
        reject(new Error(`The child process exited ${this.exitReason}`))
        return
      }
      const onReply = (message: ControlMessage): void => {
        this.events.off('exit', onExit)
        resolve(message)
      }
      const onExit = (): void => {
        this.events.off(`${reply}:${id}`, onReply)
        reject(new Error(`The child process exited ${this.exitReason}`))
      }
      this.events.once(`${reply}:${id}`, onReply)
      this.events.once('exit', onExit)
    })
  }
}

function spawnHost(
  options: PoolOptions,
  context: PoolContext,
  key: string,
  registry: Registry,
  blob: string | undefined,
): Host {
  const hostOptions: HostOptions = {
    addon: context.addon,
    forksUrl: pathToFileURL(resolve(options.distPath, 'workers/forks.js')).href,
    argv1: resolve(options.distPath, 'workers/forks.js'),
    inspector: needsInspector(options),
    cpu: process.env.VITEST_POOL_FASTFORKS_CPU,
  }
  const child = fork(hostScript, [], {
    execArgv: [...(blob ? ['--snapshot-blob', blob] : []), ...options.execArgv],
    env: { ...options.env, VITEST_POOL_FASTFORKS_HOST: JSON.stringify(hostOptions) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'advanced',
  })
  const host = new Host(child, key, registry)
  // `end: false`: the logger streams are shared by every worker.
  const { outputStream, errorStream } = options.project.vitest.logger
  const piped: [Readable, Writable][] = []
  const pipe = (from: Readable, to: Writable): void => {
    to.setMaxListeners(to.getMaxListeners() + 1)
    from.pipe(to, { end: false })
    piped.push([from, to])
  }
  pipe(child.stdout!, outputStream)
  // Keep stderr until the child process is ready: if the blob makes it fail,
  // startHost() prints a warning instead of the crash report.
  const startupOutput: Buffer[] = []
  const keep = (chunk: Buffer): void => void startupOutput.push(chunk)
  child.stderr!.on('data', keep)
  host.ready = host.waitFor('ready').then(() => {
    child.stderr!.off('data', keep)
    for (const chunk of startupOutput) errorStream.write(chunk)
    pipe(child.stderr!, errorStream)
  })
  host.printStartupOutput = () => {
    for (const chunk of startupOutput) errorStream.write(chunk)
  }
  child.on('message', (m: Partial<ControlMessage & WorkerMessage> | null) => {
    if (m?.__fastforks !== undefined) host.events.emit(`message:${m.__fastforks}`, m.msg)
    else if (m?.__fastforks_ctl) host.events.emit(`${m.__fastforks_ctl}:${m.id}`, m)
  })
  child.on('error', (error) => host.events.emit('error', error))
  child.on('exit', (code, signal) => {
    host.exited = true
    host.exitReason = signal ? `with signal ${signal}` : `with exit code ${code}`
    allHosts.delete(host)
    registry.hosts.delete(host)
    const index = registry.idle.indexOf(host)
    if (index !== -1) registry.idle.splice(index, 1)
    notifyWaiters(registry)
    for (const [from, to] of piped) {
      from.unpipe(to)
      to.setMaxListeners(to.getMaxListeners() - 1)
    }
    host.events.emit('exit', code, signal)
  })
  allHosts.add(host)
  registry.hosts.add(host)
  return host
}

// The V8 coverage provider reads coverage through node:inspector in each
// test file's Environment. Like Vitest, treat every provider other than
// istanbul as one that may need it.
function needsInspector(options: PoolOptions): boolean {
  const forced = process.env.VITEST_POOL_FASTFORKS_INSPECTOR
  if (forced) return forced === '1'
  const coverage = options.project.vitest.config.coverage
  return Boolean(coverage?.enabled && coverage.provider !== 'istanbul')
}

function setRef(child: ChildProcess, ref: boolean): void {
  const handles: ({ ref(): unknown; unref(): unknown } | null | undefined)[] = [
    child,
    child.channel,
    child.stdout as { ref(): unknown; unref(): unknown } | null,
    child.stderr as { ref(): unknown; unref(): unknown } | null,
  ]
  for (const handle of handles) {
    if (ref) handle?.ref()
    else handle?.unref()
  }
}

async function startHost(options: PoolOptions, context: PoolContext, key: string, registry: Registry): Promise<Host> {
  const blob =
    context.snapshot && canUseSnapshotBlob(options.execArgv, options.env.NODE_OPTIONS)
      ? await getSnapshotBlob()
      : undefined
  const host = spawnHost(options, context, key, registry, blob)
  try {
    await host.ready
    return host
  } catch (error) {
    if (!blob) {
      host.printStartupOutput()
      throw error
    }
  }
  // A blob from another build of the same Node.js version can make the
  // child process fail before it is ready. Start again without the blob.
  discardSnapshotBlob(blob)
  if (!shared.warnedBlob) {
    shared.warnedBlob = true
    options.project.vitest.logger.warn(
      `[vitest-pool-fastforks] A child process exited ${host.exitReason} with the cached startup snapshot ${blob}. Starting without it.`,
    )
  }
  const retry = spawnHost(options, context, key, registry, undefined)
  try {
    await retry.ready
    return retry
  } catch (error) {
    retry.printStartupOutput()
    throw error
  }
}

// At most two child processes per worker: Vitest starts the next test file
// before the previous one is stopped, and freeing an Environment takes time.
// The default memory limit of a child process is the one that Vitest uses for
// the workers of vmForks and vmThreads.
function getRegistry(options: PoolOptions): Registry {
  const vitest = options.project.vitest
  let registry = registries.get(vitest)
  if (!registry) {
    const { maxWorkers, watch } = vitest.config
    const workers = Number.isFinite(maxWorkers) && maxWorkers > 0 ? maxWorkers : availableParallelism()
    const memory = (process.constrainedMemory?.() || totalmem()) / (watch ? 2 : 1)
    const created: Registry = {
      hosts: new Set(),
      idle: [],
      waiters: [],
      limit: 2 * workers,
      memoryLimit: memory / workers,
      closed: false,
    }
    registries.set(vitest, created)
    // A program can close Vitest and start it again in the same process.
    vitest.onClose(() => closeRegistry(created))
    registry = created
  }
  return registry
}

// Vitest calls this after it stopped every worker.
async function closeRegistry(registry: Registry): Promise<void> {
  registry.closed = true
  const hosts = [...registry.hosts]
  registry.hosts.clear()
  registry.idle.length = 0
  notifyWaiters(registry)
  await Promise.all(
    hosts.map(
      (host) =>
        new Promise<void>((resolve) => {
          if (host.exited) return resolve()
          host.events.once('exit', () => resolve())
          // An idle child process does not keep the main process alive.
          // Wait for its exit.
          setRef(host.child, true)
          host.child.kill()
        }),
    ),
  )
}

async function acquireHost(options: PoolOptions, context: PoolContext, { reuse = true } = {}): Promise<Host> {
  const registry = getRegistry(options)
  const key = JSON.stringify([options.execArgv, options.env, needsInspector(options)])
  for (let waited = false; ; waited = true) {
    if (reuse) {
      const index = registry.idle.findLastIndex((host) => host.key === key)
      if (index !== -1) return registry.idle.splice(index, 1)[0]!
    }
    if (registry.hosts.size < registry.limit) break
    if (registry.idle.length > 0) {
      // Make room: stop the child process that waited longest, whatever its
      // key.
      const oldest = registry.idle.shift()!
      registry.hosts.delete(oldest)
      oldest.child.kill()
      break
    }
    if (waited) break
    // Every child process is busy, most of them freeing the Environment of
    // a finished file. Waiting for one is faster than starting a new one,
    // but do not wait long: a busy one may be running a long test file.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000)
      registry.waiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  return startHost(options, context, key, registry)
}

function notifyWaiters(registry: Registry): void {
  for (const waiter of registry.waiters.splice(0)) waiter()
}

function releaseHost(host: Host, rss: number, memoryLimit: number | undefined): void {
  const { registry } = host
  // Memory that a test file allocated outside the JavaScript heap, or that
  // V8 does not give back, stays in the child process. Start a new one when
  // it gets large, as a fork would.
  if (registry.closed || rss > (memoryLimit ?? registry.memoryLimit) || registry.hosts.size > registry.limit) {
    registry.hosts.delete(host)
    host.child.kill()
  } else {
    // Let the main process exit while the child process is idle.
    setRef(host.child, false)
    registry.idle.push(host)
  }
  notifyWaiters(registry)
}

export class FastForksPoolWorker implements PoolWorker {
  readonly name = 'fastforks'
  readonly cacheFs = true
  private readonly id = shared.nextId++
  private host: Host | undefined
  private listeners: [string, (...args: any[]) => void][] = []

  constructor(
    private readonly options: PoolOptions,
    private readonly context: PoolContext,
  ) {}

  async start(): Promise<void> {
    const host = await acquireHost(this.options, this.context)
    try {
      await this.attach(host)
    } catch (error) {
      if (host.files === 0) throw error
      // A child process that crashes before the test file starts was broken
      // by an earlier file. Start the file in a new child process, so that it
      // runs as in a fork, and is not missing from the results.
      this.options.project.vitest.logger.warn(
        `[vitest-pool-fastforks] A child process exited ${host.exitReason} after ${host.files} test files, before the next file started. Starting the file in a new child process.`,
      )
      await this.attach(await acquireHost(this.options, this.context, { reuse: false }))
    }
  }

  private async attach(host: Host): Promise<void> {
    // While a test file runs, the main process waits for the child process.
    setRef(host.child, true)
    this.host = host
    await host.request('create', this.id, 'created')
  }

  async stop(): Promise<void> {
    const host = this.host
    if (!host) return
    this.host = undefined
    for (const [key, callback] of this.listeners) host.events.off(key, callback)
    this.listeners = []
    if (host.exited) return
    let freed: ControlMessage
    try {
      freed = await host.request('free', this.id, 'freed')
    } catch {
      return
    }
    host.files++
    // The limit of this file's project: projects can set different limits.
    releaseHost(host, freed.rss ?? 0, this.context.memoryLimit)
  }

  send(message: WorkerRequest): void {
    this.host!.child.send({ __fastforks: this.id, msg: message } satisfies WorkerMessage)
  }

  on(event: string, callback: (...args: any[]) => void): void {
    const key = event === 'message' ? `message:${this.id}` : event
    this.host!.events.on(key, callback)
    this.listeners.push([key, callback])
  }

  off(event: string, callback: (...args: any[]) => void): void {
    const key = event === 'message' ? `message:${this.id}` : event
    this.host?.events.off(key, callback)
    this.listeners = this.listeners.filter(([k, c]) => k !== key || c !== callback)
  }

  deserialize(data: unknown): unknown {
    return data
  }
}
