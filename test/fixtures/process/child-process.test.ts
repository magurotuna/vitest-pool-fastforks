import { isMainThread, threadId } from "node:worker_threads"
import { expect, test } from "vitest"

// Like vitest's test/unit/test/child-specific.child_process.test.ts.
test("looks like a child process", () => {
  expect({ send: typeof process.send, connected: process.connected, isMainThread, threadId }).toEqual({
    send: "function",
    connected: true,
    isMainThread: true,
    threadId: 0,
  })
})
