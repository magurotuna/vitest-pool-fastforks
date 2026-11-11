import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, test } from 'vite-plus/test'
import { Host } from '../../src/pool.ts'

// A child process can close its channel before it exits: on Windows, the
// pipe breaks while the child process exits. A request must then reject, and
// must not become an 'error' event that nobody listens to.
test('a request to a child process that closed its channel rejects', async () => {
  const child = spawn(process.execPath, ['-e', 'process.disconnect(); setTimeout(() => {}, 10_000)'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  try {
    await once(child, 'disconnect')
    const host = new Host(child, 'key', { hosts: new Set(), idle: [], waiters: [], limit: 1, memoryLimit: 0 })
    await expect(host.request('free', 1, 'freed')).rejects.toMatchObject({ code: 'ERR_IPC_CHANNEL_CLOSED' })
  } finally {
    child.kill()
  }
})
