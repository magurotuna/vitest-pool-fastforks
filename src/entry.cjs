'use strict';
// Runs inside each test file's Environment, loaded by the Environment's own
// CommonJS loader (host.cjs). Loads vitest's worker and connects it to the
// bridge that the host put on the global object.
const bridge = globalThis.__vitestPoolFastForks;
delete globalThis.__vitestPoolFastForks;

// Every Environment starts with empty module caches, so Node.js would resolve
// and read the same files again for each test file. The host keeps one cache
// for all Environments: resolved URLs, and the sources of ES modules and
// CommonJS modules (when a load hook returns the source, the CommonJS loader
// does not read the file). The cache never sees file changes.
const { resolve: resolved, load: loaded } = bridge.moduleCache;
require('node:module').registerHooks({
  resolve(specifier, context, nextResolve) {
    const key = `${context.parentURL}\0${specifier}\0${context.conditions}\0${JSON.stringify(context.importAttributes)}`;
    const hit = resolved.get(key);
    if (hit !== undefined) return { url: hit.url, format: hit.format, shortCircuit: true };
    const result = nextResolve(specifier, context);
    resolved.set(key, { url: result.url, format: result.format });
    return result;
  },
  load(url, context, nextLoad) {
    const hit = loaded.get(url);
    if (hit !== undefined) return { format: hit.format, source: hit.source, shortCircuit: true };
    const result = nextLoad(url, context);
    // A .js file without a "type" in its package.json has no format yet, and
    // the CommonJS loader handles JSON itself; neither is cached.
    const cacheable = result.format === 'module' || result.format === 'commonjs';
    if (cacheable && url.startsWith('file:') && result.source != null) {
      // Keep a string, not this realm's Buffer, so the cache does not keep
      // this Environment's context alive.
      const source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source);
      loaded.set(url, { format: result.format, source });
    }
    return result;
  },
});

module.exports = import('./import-flags.mjs')
  .then(({ importFlagModules }) => importFlagModules())
  .then(() => import(bridge.workerUrl))
  .then(({ init, runBaseTests, setupEnvironment }) => {
  init({
    post: (v) => bridge.post(v),
    on: (cb) => bridge.on(cb),
    off: (cb) => bridge.off(cb),
    teardown: () => bridge.teardown(),
    // Messages arrive as host objects; copy them into this realm.
    deserialize: (v) => structuredClone(v),
    runTests: (state, traces) => runBaseTests('run', state, traces),
    collectTests: (state, traces) => runBaseTests('collect', state, traces),
    setup: setupEnvironment,
  });
});
