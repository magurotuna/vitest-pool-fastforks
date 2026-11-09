'use strict';
// Entry script for `node --build-snapshot`. Loads the built-in modules and
// the lazy globals that vitest's worker uses, so that each Environment that
// is restored from the snapshot does not load them again.

// A user-land snapshot loses console.Console: when the snapshot is built,
// initializeGlobalConsole() treats every console property that V8's console
// and Console.prototype do not have as an inspector method, and sets it to
// undefined. Vitest's worker uses Console, so put it back.
const Console = require('node:console').Console;
require('node:v8').startupSnapshot.addDeserializeCallback(() => {
  if (require('node:console').Console === undefined) require('node:console').Console = Console;
});

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
  require(`node:${name}`);
}
void globalThis.fetch;
void globalThis.navigator;
void globalThis.Temporal;
void globalThis.crypto.subtle;
