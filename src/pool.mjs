// The main-process side. Starts child processes (host.cjs) and reuses them:
// each test file runs in a new Node.js Environment inside a child process.
// One FastForksPoolWorker is one test file, and a child process runs one
// test file at a time.
import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { availableParallelism, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { canUseSnapshotBlob, discardSnapshotBlob, getSnapshotBlob } from './snapshot.mjs'

const hostScript = fileURLToPath(new URL('./host.cjs', import.meta.url))

// The child processes of each Vitest instance. A child process keeps the
// execArgv, the env, and the output streams that it started with, so an idle
// child process runs only test files with the same key.
const registries = new WeakMap()
const allHosts = new Set()
let nextId = 0
let warnedBlob = false

process.on('exit', () => {
  for (const host of allHosts) host.child.kill()
})

class Host {
  constructor(child, key, registry) {
    this.child = child
    this.key = key
    this.registry = registry
    this.files = 0
    this.events = new EventEmitter()
    this.events.setMaxListeners(0)
    this.exited = false
    this.exitReason = ''
  }

  // Sends a control message and waits for the reply with the same id.
  request(type, id, reply) {
    const replied = this.waitFor(reply, id)
    if (!this.exited) this.child.send({ __fastforks_ctl: type, id })
    return replied
  }

  waitFor(reply, id) {
    return new Promise((resolve, reject) => {
      if (this.exited) {
        reject(new Error(`The child process exited ${this.exitReason}`))
        return
      }
      const onReply = (message) => {
        this.events.off('exit', onExit)
        resolve(message)
      }
      const onExit = () => {
        this.events.off(`${reply}:${id}`, onReply)
        reject(new Error(`The child process exited ${this.exitReason}`))
      }
      this.events.once(`${reply}:${id}`, onReply)
      this.events.once('exit', onExit)
    })
  }
}

function spawnHost(options, context, key, registry, blob) {
  const child = fork(hostScript, [], {
    execArgv: [...(blob ? ['--snapshot-blob', blob] : []), ...options.execArgv],
    env: {
      ...options.env,
      VITEST_POOL_FASTFORKS_HOST: JSON.stringify({
        addon: context.addon,
        forksUrl: pathToFileURL(resolve(options.distPath, 'workers/forks.js')).href,
        argv1: resolve(options.distPath, 'workers/forks.js'),
        inspector: needsInspector(options),
        cpu: process.env.VITEST_POOL_FASTFORKS_CPU,
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'advanced',
  })
  const host = new Host(child, key, registry)
  // `end: false`: the logger streams are shared by every worker.
  const { outputStream, errorStream } = options.project.vitest.logger
  const piped = []
  const pipe = (from, to) => {
    to.setMaxListeners(to.getMaxListeners() + 1)
    from.pipe(to, { end: false })
    piped.push([from, to])
  }
  pipe(child.stdout, outputStream)
  // Keep stderr until the child process is ready: if the blob makes it fail,
  // startHost() prints a warning instead of the crash report.
  const startupOutput = []
  const keep = (chunk) => startupOutput.push(chunk)
  child.stderr.on('data', keep)
  host.ready = host.waitFor('ready').then(() => {
    child.stderr.off('data', keep)
    for (const chunk of startupOutput) errorStream.write(chunk)
    pipe(child.stderr, errorStream)
  })
  host.printStartupOutput = () => {
    for (const chunk of startupOutput) errorStream.write(chunk)
  }
  child.on('message', (m) => {
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
function needsInspector(options) {
  if (process.env.VITEST_POOL_FASTFORKS_INSPECTOR) return process.env.VITEST_POOL_FASTFORKS_INSPECTOR === '1'
  const coverage = options.project.vitest.config.coverage
  return Boolean(coverage?.enabled && coverage.provider !== 'istanbul')
}

function setRef(child, ref) {
  for (const handle of [child, child.channel, child.stdout, child.stderr]) {
    if (ref) handle?.ref()
    else handle?.unref()
  }
}

async function startHost(options, context, key, registry) {
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
  if (!warnedBlob) {
    warnedBlob = true
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

// At most one child process more than the number of workers (Vitest starts
// the next test file before it stops the previous one), and each child
// process within its share of half of the memory, by default.
function getRegistry(options, context) {
  const vitest = options.project.vitest
  let registry = registries.get(vitest)
  if (!registry) {
    const limit = (vitest.config.maxWorkers || availableParallelism()) + 1
    registry = {
      hosts: new Set(),
      // Idle child processes, least recently used first.
      idle: [],
      limit,
      memoryLimit: context.memoryLimit ?? totalmem() / 2 / limit,
    }
    registries.set(vitest, registry)
  }
  return registry
}

async function acquireHost(options, context, { reuse = true } = {}) {
  const registry = getRegistry(options, context)
  const key = JSON.stringify([options.execArgv, options.env, needsInspector(options)])
  if (reuse) {
    const index = registry.idle.findLastIndex((host) => host.key === key)
    if (index !== -1) return registry.idle.splice(index, 1)[0]
  }
  // Make room: stop the child processes that waited longest, whatever their
  // key. A project with many test projects would keep one set per key.
  while (registry.hosts.size >= registry.limit && registry.idle.length > 0) {
    const oldest = registry.idle.shift()
    registry.hosts.delete(oldest)
    oldest.child.kill()
  }
  return startHost(options, context, key, registry)
}

function releaseHost(host, rss) {
  const { registry } = host
  // Memory that a test file allocated outside the JavaScript heap, or that
  // V8 does not give back, stays in the child process. Start a new one when
  // it gets large, as a fork would.
  if (rss > registry.memoryLimit || registry.hosts.size > registry.limit) {
    registry.hosts.delete(host)
    host.child.kill()
    return
  }
  // Let the main process exit while the child process is idle.
  setRef(host.child, false)
  registry.idle.push(host)
}

export class FastForksPoolWorker {
  name = 'fastforks'
  cacheFs = true

  constructor(options, context) {
    this.options = options
    this.context = context
    this.id = nextId++
    this.host = undefined
    this.listeners = []
  }

  async start() {
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

  async attach(host) {
    // While a test file runs, the main process waits for the child process.
    setRef(host.child, true)
    this.host = host
    await host.request('create', this.id, 'created')
  }

  async stop() {
    const host = this.host
    if (!host) return
    this.host = undefined
    for (const [key, callback] of this.listeners) host.events.off(key, callback)
    this.listeners = []
    if (host.exited) return
    let freed
    try {
      freed = await host.request('free', this.id, 'freed')
    } catch {
      return
    }
    host.files++
    releaseHost(host, freed.rss)
  }

  send(message) {
    this.host.child.send({ __fastforks: this.id, msg: message })
  }

  on(event, callback) {
    const key = event === 'message' ? `message:${this.id}` : event
    this.host.events.on(key, callback)
    this.listeners.push([key, callback])
  }

  off(event, callback) {
    const key = event === 'message' ? `message:${this.id}` : event
    this.host?.events.off(key, callback)
    this.listeners = this.listeners.filter(([k, c]) => k !== key || c !== callback)
  }

  deserialize(data) {
    return data
  }
}
