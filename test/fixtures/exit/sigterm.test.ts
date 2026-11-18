import { expect, test } from "vitest"

// For example, a test of a shutdown hook. On Windows, process.kill() ends the
// process for every signal.
test.skipIf(process.platform === "win32")("SIGTERM to the own process", async () => {
  const received = new Promise((resolve) => process.once("SIGTERM", resolve))
  process.kill(process.pid, "SIGTERM")
  expect(await received).toBe("SIGTERM")
})
