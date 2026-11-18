// Checks the addon without Vitest. Each check runs in its own child process:
// - free() from a thread pool callback of the host, when a request of the
//   Environment completes in the same batch of thread pool callbacks. When
//   free() freed the Environment inside the callback, this check hung: the
//   inner uv_run() did not see the completion of that request.
// - A normal exit after free(). When the addon destroyed its v8::Global
//   handles after Node.js disposed the isolate, this check crashed.
//
// Usage: node test/addon.mjs
import { spawnSync } from 'node:child_process'
import { stat } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const addonPath = fileURLToPath(new URL('../build/Release/fastforks.node', import.meta.url))
// EnvironmentFlags: kOwnsProcessState and kNoCreateInspector, as in host.cts.
const FLAGS = (1 << 1) | (1 << 9)

// Creates an Environment, and returns its id and its fs.stat().
function create(addon) {
  const id = addon.create(FLAGS, [process.execPath, self], [])
  return { id, guestStat: addon.load(id, `return require('node:fs').stat`) }
}

function busyWait(ms) {
  const end = performance.now() + ms
  while (performance.now() < end);
}

// Each check runs in a child process. The check passes only if the child
// process exits with code 0, and the done callback of free() sets that code.
const CHECKS = {
  'free() from a thread pool callback'(addon) {
    const { id, guestStat } = create(addon)
    stat(self, () => addon.free(id, () => process.exit(0)))
    guestStat(self, () => {})
    // The child process has one thread pool thread, so the two requests
    // complete in this order. The busy wait gives the thread time to complete
    // both before the event loop polls, so that their callbacks come in one
    // batch.
    busyWait(100)
  },
  'a normal exit after free()'(addon) {
    const guest = create(addon)
    // Keep the context reachable, so that the addon still holds a handle to it
    // at the exit.
    globalThis.guest = guest
    addon.free(guest.id, () => {
      process.exitCode = 0
    })
    // The child process exits when the event loop has no more work.
  },
}

function describe(child) {
  if (child.error?.code === 'ETIMEDOUT') return 'did not exit in 10 seconds'
  if (child.error) return `failed to run: ${child.error.message}`
  if (child.signal) return `was killed by ${child.signal}`
  return `exited with code ${child.status}`
}

const [check] = process.argv.slice(2)
if (check !== undefined) {
  process.exitCode = 1
  CHECKS[check](createRequire(import.meta.url)(addonPath))
} else {
  let failed = 0
  for (const name of Object.keys(CHECKS)) {
    const child = spawnSync(process.execPath, [self, name], {
      encoding: 'utf8',
      env: { ...process.env, UV_THREADPOOL_SIZE: '1' },
      timeout: 10_000,
      killSignal: 'SIGKILL',
    })
    if (!child.error && child.status === 0) {
      console.log(`ok: ${name}`)
      continue
    }
    failed++
    console.error(`failed: ${name}: the child process ${describe(child)}\n${child.stdout}${child.stderr}`)
  }
  process.exitCode = failed > 0 ? 1 : 0
}
