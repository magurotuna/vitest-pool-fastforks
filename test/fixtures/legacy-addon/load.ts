import { appendFileSync } from "node:fs"
import { createRequire } from "node:module"
import { expect } from "vitest"

const require = createRequire(import.meta.url)

// With the forks pool, each file loads the addon in a new process. With this
// pool, the files run in one child process (--maxWorkers=1), so only the first
// file can load it, and the error of a later file must contain the cause.
// test/run.mjs checks that the error happened.
export function loadAddon(): void {
  let error: Error | undefined
  try {
    require("./build/Release/legacy.node")
  } catch (thrown) {
    error = thrown as Error
  }
  if (error === undefined) return
  expect(error.message).toContain("Module did not self-register")
  expect(error.message).toContain("This child process loaded this native addon before")
  expect(error.stack).toContain("This child process loaded this native addon before")
  appendFileSync(new URL(`./hints-${process.env.POOL}`, import.meta.url), "hint\n")
}
