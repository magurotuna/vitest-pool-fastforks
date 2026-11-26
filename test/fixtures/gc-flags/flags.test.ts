import { expect, test } from "vitest"

// The child process started, and the test file sees the same gc as with forks.
test("gc is the same as with forks", () => {
  expect(typeof (globalThis as any).gc).toBe("undefined")
  const exposedAs = process.env.EXPOSED_AS
  if (exposedAs) expect(typeof (globalThis as any)[exposedAs]).toBe("function")
})
