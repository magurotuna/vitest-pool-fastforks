// Starts Vitest with this pool in one process, as a program can, and checks
// that close() returns and that no child process of the pool is left:
// - after a run, 2 times in one process
// - while a test file runs
// - when a child process does not exit on SIGTERM, also after the memory
//   limit stopped it
//
// Usage: node test/close.mjs
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createVitest } from 'vitest/node'
import { fastForks } from 'vitest-pool-fastforks'

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'close')
const shared = () => globalThis[Symbol.for('vitest-pool-fastforks')]

function start(include, options = {}) {
  return createVitest('test', {
    root,
    config: false,
    watch: false,
    reporters: [],
    include: [include],
    pool: fastForks({ fallback: 'error', ...options }),
  })
}

function fail(message) {
  console.error(message)
  for (const host of shared()?.allHosts ?? []) host.child.kill('SIGKILL')
  process.exit(1)
}

async function close(vitest, name) {
  const pids = [...(shared()?.allHosts ?? [])].map((host) => host.child.pid)
  if (pids.length === 0) fail(`${name}: the pool did not start a child process`)
  const closed = await Promise.race([vitest.close().then(() => true), delay(10_000, false)])
  if (!closed) fail(`${name}: close() did not return in 10 seconds`)
  const alive = pids.filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
  if (alive.length > 0) fail(`${name}: ${alive.length} child processes are alive after close: ${alive.join(', ')}`)
}

for (let run = 1; run <= 2; run++) {
  const vitest = await start('fast.test.ts')
  await vitest.start()
  await close(vitest, `after run ${run}`)
}

{
  const marker = join(mkdtempSync(join(tmpdir(), 'fastforks-close-')), 'started')
  process.env.FASTFORKS_CLOSE_MARKER = marker
  const vitest = await start('slow.test.ts')
  const running = vitest.start().catch(() => {})
  for (let i = 0; i < 1000 && !existsSync(marker); i++) await delay(10)
  if (!existsSync(marker)) fail('while a file runs: the test file did not start')
  await close(vitest, 'while a file runs')
  await running
}

const nodeOptions = process.env.NODE_OPTIONS
for (const memoryLimit of [undefined, 0]) {
  // Only the child processes get the preload: this process already started.
  const preload = join(root, 'blocking-exit.cjs').replaceAll('\\', '/')
  process.env.NODE_OPTIONS = `${nodeOptions ?? ''} --require="${preload}"`
  const vitest = await start('fast.test.ts', { memoryLimit })
  await vitest.start()
  await close(vitest, memoryLimit === 0 ? 'blocked exit, after the memory limit' : 'blocked exit')
  if (nodeOptions === undefined) delete process.env.NODE_OPTIONS
  else process.env.NODE_OPTIONS = nodeOptions
}

console.log('same close (no child process left in 5 runs)')
