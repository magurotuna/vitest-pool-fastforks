// Runs inside each test file's Environment, loaded by the Environment's own
// CommonJS loader (host.cts). Runs Vitest's fork entry and connects it to the
// bridge that the host put on the global object.
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Bridge } from './protocol.ts'

const bridge = Reflect.get(globalThis, '__vitestPoolFastForks') as Bridge
Reflect.deleteProperty(globalThis, '__vitestPoolFastForks')

// Every Environment starts with empty module caches, so Node.js would resolve
// and read the same files again for each test file. The host keeps one cache
// for all Environments: resolved URLs, and the sources of ES modules and
// CommonJS modules (when a load hook returns the source, the CommonJS loader
// does not read the file). The cache never sees file changes, so it keeps
// only files in node_modules: a test can write a file and require it, and a
// linked package can be rebuilt between runs in watch mode.
const cache = bridge.moduleCache
const inNodeModules = (url: string | undefined): boolean =>
  url !== undefined && url.startsWith('file:') && url.includes('/node_modules/')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!inNodeModules(context.parentURL)) return nextResolve(specifier, context)
    const key = `${context.parentURL}\0${specifier}\0${context.conditions.join(',')}\0${JSON.stringify(context.importAttributes)}`
    const hit = cache.getResolved(key)
    if (hit !== undefined) return { url: hit.url, format: hit.format, shortCircuit: true }
    const result = nextResolve(specifier, context)
    if (result.url.startsWith('node:') || inNodeModules(result.url)) {
      cache.setResolved(key, result.url, result.format)
    }
    return result
  },
  load(url, context, nextLoad) {
    if (!inNodeModules(url)) return nextLoad(url, context)
    const hit = cache.getLoaded(url)
    if (hit !== undefined) return { format: hit.format, source: hit.source, shortCircuit: true }
    const result = nextLoad(url, context)
    // A .js file without a "type" in its package.json has no format yet, and
    // the CommonJS loader handles JSON itself; neither is cached.
    const format = result.format
    if ((format === 'module' || format === 'commonjs') && result.source != null) {
      // A string, not this realm's Buffer.
      const source =
        typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source as Uint8Array)
      cache.setLoaded(url, format, source)
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
  const callback = args.find((arg) => typeof arg === 'function') as ((error: Error | null) => void) | undefined
  if (callback) nextTick(callback, null)
  return true
}
Reflect.set(processObject, 'connected', true)

async function start(): Promise<void> {
  // A computed path, so that the bundler leaves this import alone.
  const flags: typeof import('./import-flags.ts') = await import(
    pathToFileURL(join(__dirname, 'import-flags.mjs')).href
  )
  await flags.importFlagModules()
  await import(bridge.forksUrl)
  // Messages arrive as host objects; copy them into this realm, as the IPC
  // channel of a fork does.
  bridge.ready((message) => emit('message', structuredClone(message)))
}

void start()
