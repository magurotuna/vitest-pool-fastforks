// Starts Vitest with this pool twice in one process, as a program can, and
// checks that no child process of the pool is left after each close.
//
// Usage: node test/close.mjs
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVitest } from 'vitest/node'

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'basic')
process.env.POOL = 'fastforks'
process.env.FASTFORKS_FALLBACK = 'error'

for (let run = 1; run <= 2; run++) {
  const vitest = await createVitest('test', { root, watch: false, reporters: [] })
  await vitest.start()
  const hosts = globalThis[Symbol.for('vitest-pool-fastforks')]?.allHosts
  if (!hosts || hosts.size === 0) {
    console.error(`run ${run}: the pool did not start a child process`)
    process.exit(1)
  }
  const pids = [...hosts].map((host) => host.child.pid)
  await vitest.close()
  const alive = pids.filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
  if (alive.length > 0) {
    console.error(`run ${run}: ${alive.length} child processes are alive after close: ${alive.join(', ')}`)
    for (const pid of alive) process.kill(pid)
    process.exit(1)
  }
}
console.log('same close (no child process left after 2 runs)')
// The fixture has a failing test, so Vitest set the exit code to 1.
process.exitCode = 0
