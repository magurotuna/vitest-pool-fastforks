// Runs inside each test file's Environment, loaded by the Environment's own
// CommonJS loader (host.cts). Runs Vitest's fork entry and connects it to the
// bridge that the host put on the global object.
import { statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TextDecoder } from 'node:util'
import type { Bridge } from './protocol.ts'

const bridge = Reflect.get(globalThis, '__vitestPoolFastForks') as Bridge
Reflect.deleteProperty(globalThis, '__vitestPoolFastForks')

// The hooks and the callbacks below run in the same realm as the tests, and
// they run after the tests start. A test can replace a global or a method of
// a built-in object. For example, a setup file can set globalThis.TextDecoder
// to undefined. So save the values here, before the --import modules and the
// tests run. Node.js does the same with its primordials. A --require module
// runs before this file: if it replaces one of these values, this code saves
// the replacement. startsWith(s, x) calls the saved
// String.prototype.startsWith with s as `this`. The lint rule unbound-method
// does not know that uncurryThis() gives `this` to each method.
/* oxlint-disable typescript/unbound-method */
const uncurryThis = Function.prototype.bind.bind(Function.prototype.call) as <T, A extends unknown[], R>(
  fn: (this: T, ...args: A) => R,
) => (self: T, ...args: A) => R
const startsWith = uncurryThis(String.prototype.startsWith)
const includes = uncurryThis(String.prototype.includes)
const arrayJoin = uncurryThis(Array.prototype.join)
const arrayFind = uncurryThis(Array.prototype.find)
const setHas = uncurryThis(Set.prototype.has)
const setAdd = uncurryThis(Set.prototype.add)
const decode = uncurryThis(TextDecoder.prototype.decode)
const decoder = new TextDecoder()
const { stringify } = JSON
const { apply } = Reflect
const clone = structuredClone
const stat = statSync
const toPath = fileURLToPath
/* oxlint-enable typescript/unbound-method */

// Every Environment starts with empty module caches, so Node.js would resolve
// and read the same files again for each test file. The host keeps one cache
// for all Environments: resolved URLs, and the sources of ES modules and
// CommonJS modules (when a load hook returns the source, the CommonJS loader
// does not read the file). The cache keeps only files in node_modules: a test
// can write a file and require it, and a linked package can be rebuilt
// between runs in watch mode.
const cache = bridge.moduleCache
// A file in node_modules can change too. The cache keeps a file only if it
// did not change after the main process started, and each run starts with an
// empty cache. So a file that a test writes is read from disk each time. If an
// Environment loads a file a second time, for example after a test removed it
// from a module cache, the pool checks that the file is still the kept one.
// Returns the inode and the change time of a file that did not change.
const identify = (url: string): string | undefined => {
  try {
    const { ino, ctimeMs } = stat(toPath(url))
    return ctimeMs < cache.since ? `${ino} ${ctimeMs}` : undefined
  } catch {
    return undefined
  }
}
const loadedHere = new Set<string>()
const inNodeModules = (url: string | undefined): boolean =>
  url !== undefined && startsWith(url, 'file:') && includes(url, '/node_modules/')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!inNodeModules(context.parentURL)) return nextResolve(specifier, context)
    const key = `${context.parentURL}\0${specifier}\0${arrayJoin(context.conditions, ',')}\0${stringify(context.importAttributes)}`
    const hit = cache.getResolved(key)
    if (hit !== undefined) return { url: hit.url, format: hit.format, shortCircuit: true }
    const result = nextResolve(specifier, context)
    if (startsWith(result.url, 'node:') || inNodeModules(result.url)) {
      cache.setResolved(key, result.url, result.format)
    }
    return result
  },
  load(url, context, nextLoad) {
    if (!inNodeModules(url)) return nextLoad(url, context)
    const again = setHas(loadedHere, url)
    setAdd(loadedHere, url)
    const hit = cache.getLoaded(url)
    if (hit !== undefined && (!again || identify(url) === hit.file)) {
      return { format: hit.format, source: hit.source, shortCircuit: true }
    }
    const result = nextLoad(url, context)
    // A .js file without a "type" in its package.json has no format yet, and
    // the CommonJS loader handles JSON itself; neither is cached. The check
    // runs after the read, so that a change during the read is not kept.
    const format = result.format
    if ((format === 'module' || format === 'commonjs') && result.source != null) {
      const file = identify(url)
      if (file === undefined) return result
      // A string, not this realm's Buffer.
      const source = typeof result.source === 'string' ? result.source : decode(decoder, result.source as Uint8Array)
      cache.setLoaded(url, format, source, file)
    }
    return result
  },
})

// Run Vitest's own fork entry, as the forks pool does. It talks to the main
// process with process.send() and process.on('message'), which a fork has and
// this Environment does not, so connect them to the host. Keep the process
// object and its methods: tests can replace globalThis.process.
const processObject = process
const emit = process.emit.bind(process) as (event: string, ...args: unknown[]) => boolean
const nextTick = process.nextTick.bind(process)
processObject.send = (message: unknown, ...args: unknown[]): boolean => {
  bridge.post(message)
  const callback = arrayFind(args, (arg) => typeof arg === 'function') as ((error: Error | null) => void) | undefined
  if (callback) nextTick(callback, null)
  return true
}
Reflect.set(processObject, 'connected', true)

// Node.js does not unload a native addon when an Environment of this process
// ends. An addon that is not context-aware (for example, an addon that uses
// NODE_MODULE()) registers itself only when the process loads it for the
// first time. So if an earlier test file in this child process loaded such an
// addon, a later file gets "Module did not self-register", although the file
// passes with the forks pool. Add the cause and a workaround to this error.
// require() of a .node file also calls process.dlopen().
const addons = bridge.addons
const addonsHere = new Set<string>()
const ADDON_HINT =
  '\n[vitest-pool-fastforks] This child process loaded this native addon before, for an earlier test file or an earlier run. ' +
  'Node.js can load an addon that is not context-aware (for example, an addon that uses NODE_MODULE()) ' +
  "only once in a process. Run the test files that use this addon in a separate project with pool: 'forks'. " +
  'See https://github.com/magurotuna/vitest-pool-fastforks#limitations'
const loaded = (filename: unknown): void => {
  if (typeof filename !== 'string') return
  setAdd(addonsHere, filename)
  addons.add(filename)
}
// apply() below gives `this` to it.
// oxlint-disable-next-line typescript/unbound-method
const nodeDlopen = processObject.dlopen
processObject.dlopen = function dlopen(this: unknown, ...args: unknown[]): void {
  // Pass the arguments as they are: Node.js reads the flags only if there are
  // three arguments.
  const filename = args[1]
  try {
    apply(nodeDlopen, this, args)
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
    if (code !== 'ERR_DLOPEN_FAILED') {
      // The initializer of the addon threw, after Node.js registered the addon.
      loaded(filename)
    } else if (
      typeof filename === 'string' &&
      typeof (error as Error).message === 'string' &&
      includes((error as Error).message, 'did not self-register') &&
      !setHas(addonsHere, filename) &&
      addons.has(filename)
    ) {
      ;(error as Error).message += ADDON_HINT
    }
    throw error
  }
  loaded(filename)
}

async function start(): Promise<void> {
  // A computed path, so that the bundler leaves this import alone.
  const flags: typeof import('./import-flags.ts') = await import(
    pathToFileURL(join(__dirname, 'import-flags.mjs')).href
  )
  await flags.importFlagModules()
  await import(bridge.forksUrl)
  // Messages arrive as host objects; copy them into this realm, as the IPC
  // channel of a fork does.
  bridge.ready((message) => emit('message', clone(message)))
}

void start()
