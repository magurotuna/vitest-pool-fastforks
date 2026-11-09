import { test } from "vitest"

test("SIGKILL", () => {
  process.kill(process.pid, "SIGKILL")
})
