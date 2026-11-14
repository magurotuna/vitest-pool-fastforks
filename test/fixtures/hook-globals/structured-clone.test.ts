// The pool copies each message from the main process into the realm of the
// tests with structuredClone(), and a test can replace this global. The
// import below needs a message from the main process: Vitest gets the
// transformed module from the main process with a remote procedure call.
// If the pool reads the global when the message arrives, the message is lost.
// Then the test times out, and the run does not end, because Vitest waits
// for the message.
import { expect, test } from "vitest"

test("gets messages from the main process after a test replaces globalThis.structuredClone", async () => {
  Reflect.set(globalThis, "structuredClone", undefined)
  const { value } = await import("./local-module.ts")
  expect(value).toBe("local")
})
