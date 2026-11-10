// Entry script for `node --build-snapshot`. Loads the built-in modules and
// the lazy globals that vitest's worker uses, so that each Environment that
// is restored from the snapshot does not load them again.
//
// It uses require() and not import, so that the console module below is the
// module object itself and not a copy.

// A user-land snapshot loses console.Console: when the snapshot is built,
// initializeGlobalConsole() treats every console property that V8's console
// and Console.prototype do not have as an inspector method, and sets it to
// undefined. Vitest's worker uses Console, so put it back.
const consoleModule: Record<string, unknown> = require('node:console')
const v8: typeof import('node:v8') = require('node:v8')
const Console = consoleModule.Console
v8.startupSnapshot.addDeserializeCallback(() => {
  if (consoleModule.Console === undefined) consoleModule.Console = Console
})

// http, https, tls, and http2 cannot be in a snapshot ("global handle not
// serialized").
for (const name of [
  'module',
  'os',
  'readline',
  'fs/promises',
  'worker_threads',
  'timers/promises',
  'assert',
  'net',
  'zlib',
  'util',
  'crypto',
]) {
  require(`node:${name}`)
}
for (const name of ['fetch', 'navigator', 'Temporal']) Reflect.get(globalThis, name)
void globalThis.crypto.subtle
