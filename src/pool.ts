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
import { availableMemory, overMemoryLimit } from './memory-limit.ts'
import { canUseSnapshotBlob, discardSnapshotBlob, getSnapshotBlob } from './snapshot.ts'

export interface PoolContext {
  /** The path of the native addon. */
  addon: string
  snapshot: boolean
  memoryLimit: number | undefined
  inspector: boolean
}

interface Registry {
  hosts: Set<Host>
  /** Idle child processes, least recently used first. */
  idle: Host[]
  /** Calls waiting for a child process to become idle or to exit. */
  waiters: (() => void)[]
  /** The most child processes: hosts, together with the ones that are starting. */
  limit: number
  /** Child processes that wait for the snapshot blob, and are not in hosts yet. */
  starting: number
  /** The default memory limit of a child process. */
  memoryLimit: number
  closed: boolean
  /** From the first test file of a run until the run ends. See attach(). */
  inRun: boolean
  /** Increases at the start of each run. */
  run: number
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
  request(type: ControlType, id: number, reply: ControlType, run?: number): Promise<ControlMessage> {
    const replied = this.waitFor(reply, id)
    if (this.exited) return replied
    // The send fails if the child process closed its channel but did not exit
    // yet (EPIPE on Windows). With a callback, the error rejects the request
    // instead of becoming an 'error' event of the child process.
    const failed = new Promise<never>((_, reject) => {
      this.child.send({ __fastforks_ctl: type, id, run } satisfies ControlMessage, (error) => {
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
    inspector: needsInspector(options, context),
    cpu: process.env.VITEST_POOL_FASTFORKS_CPU,
    // 2 seconds earlier: a file system can have a coarse clock.
    since: performance.timeOrigin - 2000,
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
function needsInspector(options: PoolOptions, context: PoolContext): boolean {
  const forced = process.env.VITEST_POOL_FASTFORKS_INSPECTOR
  if (forced) return forced === '1'
  const coverage = options.project.vitest.config.coverage
  return context.inspector || Boolean(coverage?.enabled && coverage.provider !== 'istanbul')
}

// Like Vitest's forks pool: if a child process does not exit on SIGTERM, for
// example because a --require module ignores SIGTERM, send SIGKILL.
const KILL_TIMEOUT = 500
// If a child process does not free an Environment in this time, stop it.
const FREE_TIMEOUT = 10_000

function killHost(host: Host): void {
  if (host.exited || host.child.killed) return
  host.child.kill()
  const timer = setTimeout(() => host.child.kill('SIGKILL'), KILL_TIMEOUT)
  host.events.once('exit', () => clearTimeout(timer))
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
  // Count this child process while it waits for the blob, so that another
  // acquireHost() does not start one more over the limit.
  let blob: string | undefined
  registry.starting++
  try {
    blob =
      context.snapshot && canUseSnapshotBlob(options.execArgv, options.env.NODE_OPTIONS)
        ? await getSnapshotBlob()
        : undefined
  } finally {
    registry.starting--
  }
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

// The default memory limit of a child process is like the one that Vitest uses
// for the workers of vmForks and vmThreads.
function getRegistry(options: PoolOptions): Registry {
  const vitest = options.project.vitest
  let registry = registries.get(vitest)
  // Vitest closes and starts again with the same instance when its config
  // changes in watch mode.
  if (!registry || registry.closed) {
    const { maxWorkers, watch } = vitest.config
    const workers = Number.isFinite(maxWorkers) && maxWorkers > 0 ? maxWorkers : availableParallelism()
    const memory = availableMemory(process.constrainedMemory?.(), totalmem()) / (watch ? 2 : 1)
    const created: Registry = {
      hosts: new Set(),
      idle: [],
      waiters: [],
      // acquireHost() raises it.
      limit: 0,
      starting: 0,
      memoryLimit: memory / workers,
      closed: false,
      inRun: false,
      run: 0,
    }
    registries.set(vitest, created)
    // A program can close Vitest and start it again in the same process.
    vitest.onClose(() => closeRegistry(created))
    registry = created
  }
  // A registry from an older copy of this package has no starting count.
  registry.starting ??= 0
  return registry
}

// The maxWorkers that Vitest uses for the test files of a project. Vitest 5
// resolves it in the config of each project. Vitest 4 leaves it unset by
// default, and then uses the root config or a default from the CPU count.
function projectWorkers(project: PoolOptions['project']): number {
  const valid = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n > 0
  if (valid(project.config.maxWorkers)) return project.config.maxWorkers
  const { maxWorkers, watch } = project.vitest.config
  if (valid(maxWorkers)) return maxWorkers
  const cpus = availableParallelism()
  return watch ? Math.max(Math.floor(cpus / 2), 1) : Math.max(cpus - 1, 1)
}

// Vitest 5 calls this after it stopped every worker. Vitest 4 calls it while
// it closes the pool, so a child process can still run a test file. Do not
// stop that child process: releaseHost() stops it after the file.
async function closeRegistry(registry: Registry): Promise<void> {
  registry.closed = true
  // allHosts also has the child processes that were stopped but did not exit
  // yet.
  const hosts = [...allHosts].filter((host) => host.registry === registry)
  const idle = registry.idle.splice(0)
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
          if (idle.includes(host)) killHost(host)
        }),
    ),
  )
}

// At most one child process per worker. Each child process keeps the memory
// of its largest test file, so more child processes use more memory. Vitest
// starts the next test file before it stops the previous one, so this
// function waits for a child process to become idle.
async function acquireHost(options: PoolOptions, context: PoolContext, { reuse = true } = {}): Promise<Host> {
  const registry = getRegistry(options)
  // Vitest runs the projects with different maxWorkers one after another. So
  // the limit is the largest maxWorkers of the projects that ran.
  registry.limit = Math.max(registry.limit, projectWorkers(options.project))
  const key = JSON.stringify([options.execArgv, options.env, needsInspector(options, context)])
  const deadline = performance.now() + FREE_TIMEOUT
  // Vitest 4 can close during the wait below, and then Vitest waits for this
  // file. So start the file also after the close: releaseHost() stops the
  // child process after the file.
  for (;;) {
    if (reuse) {
      const index = registry.idle.findLastIndex((host) => host.key === key)
      if (index !== -1) return registry.idle.splice(index, 1)[0]!
    }
    if (registry.hosts.size + registry.starting < registry.limit) break
    if (registry.idle.length > 0) {
      // Make room: stop the child process that waited longest, whatever its
      // key.
      const oldest = registry.idle.shift()!
      registry.hosts.delete(oldest)
      killHost(oldest)
      break
    }
    // Every child process is busy. Vitest runs at most `limit` files at the
    // same time, and this file is one of them, so at least one child process
    // has a file that Vitest finished. Vitest stops that file after the
    // teardown of its test environment, and then the free takes a few
    // milliseconds. If no child process is idle at the deadline, start one
    // more: releaseHost() stops the extra one after its file.
    const left = deadline - performance.now()
    if (left <= 0) break
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, left)
      registry.waiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  return startHost(options, context, key, registry)
}

// closeRegistry() does not wait for a child process that started after it.
// Vitest 4 waits for stop() when it closes, so after the close, stop() waits
// for the exit of the child process.
function exitAfterClose(host: Host): Promise<void> {
  if (!host.registry.closed || host.exited) return Promise.resolve()
  return new Promise((resolve) => host.events.once('exit', () => resolve()))
}

function notifyWaiters(registry: Registry): void {
  for (const waiter of registry.waiters.splice(0)) waiter()
}

function releaseHost(host: Host, freed: ControlMessage, memoryLimit: number | undefined): void {
  const { registry } = host
  // Memory that a test file allocated outside the JavaScript heap, or that
  // V8 does not give back, stays in the child process. So does a leak in the
  // JavaScript heap. Start a new one when it gets large, as a fork would.
  if (
    registry.closed ||
    overMemoryLimit(freed, memoryLimit ?? registry.memoryLimit) ||
    registry.hosts.size > registry.limit
  ) {
    registry.hosts.delete(host)
    killHost(host)
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
      // The child process can also close its channel and not exit.
      host.registry.hosts.delete(host)
      killHost(host)
      await this.attach(await acquireHost(this.options, this.context, { reuse: false }))
    }
  }

  private async attach(host: Host): Promise<void> {
    // While a test file runs, the main process waits for the child process.
    setRef(host.child, true)
    this.host = host
    // A new run (or collect), for example in watch mode or through the Vitest
    // API. Vitest has no event for it, but every test file of a run starts
    // before waitForTestRunEnd() resolves. Two runs that overlap count as one.
    const { registry } = host
    if (!registry.inRun) {
      registry.inRun = true
      registry.run++
      const end = (): void => {
        registry.inRun = false
      }
      void this.options.project.vitest.waitForTestRunEnd().then(end, end)
    }
    await host.request('create', this.id, 'created', registry.run)
  }

  async stop(): Promise<void> {
    const host = this.host
    if (!host) return
    this.host = undefined
    for (const [key, callback] of this.listeners) host.events.off(key, callback)
    this.listeners = []
    if (host.exited) return
    let freed: ControlMessage | undefined
    let timer: NodeJS.Timeout | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The child process did not answer')), FREE_TIMEOUT)
      })
      freed = await Promise.race([host.request('free', this.id, 'freed'), timeout])
    } catch {
      // The child process does not answer, or it closed its channel. It exits
      // on 'disconnect', but an 'exit' listener can block it.
      killHost(host)
    } finally {
      clearTimeout(timer)
    }
    if (freed) {
      host.files++
      // The limit of this file's project: projects can set different limits.
      releaseHost(host, freed, this.context.memoryLimit)
    }
    await exitAfterClose(host)
  }

  send(message: WorkerRequest): void {
    // Vitest can cancel the run (for example with --bail) before start() has
    // a child process. The test file has not started yet, so drop the
    // message.
    this.host?.child.send({ __fastforks: this.id, msg: message } satisfies WorkerMessage)
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
