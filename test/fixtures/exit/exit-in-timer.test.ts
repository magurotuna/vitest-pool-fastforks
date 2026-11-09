import { test } from "vitest"

test("exit in a timer", async () => {
  setTimeout(() => process.exit(2), 0)
  await new Promise((resolve) => setTimeout(resolve, 50))
})
