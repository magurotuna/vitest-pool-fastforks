import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, test } from 'vite-plus/test'
import { FastForksPoolWorker, Host } from '../../src/pool.ts'

// A child process can close its channel before it exits: on Windows, the
// pipe breaks while the child process exits. A request must then reject, and
// must not become an 'error' event that nobody listens to.
test('a request to a child process that closed its channel rejects', async () => {
  const child = spawn(process.execPath, ['-e', 'process.disconnect(); setTimeout(() => {}, 10_000)'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  try {
    await once(child, 'disconnect')
    const host = new Host(child, 'key', {
      hosts: new Set(),
      idle: [],
      waiters: [],
      limit: 1,
      starting: 0,
      memoryLimit: 0,
      closed: false,
      inRun: false,
      run: 0,
    })
    await expect(host.request('free', 1, 'freed')).rejects.toMatchObject({ code: 'ERR_IPC_CHANNEL_CLOSED' })
  } finally {
    child.kill()
  }
})

// Vitest sends a cancel (for example with --bail) to every worker, also to one
// that still waits for a child process.
test('a message before the worker has a child process does not throw', () => {
  const worker = new FastForksPoolWorker({} as never, {} as never)
  expect(() => worker.send({} as never)).not.toThrow()
})
