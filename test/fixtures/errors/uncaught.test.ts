import { test } from "vitest"

test("uncaught exception", async () => {
  setTimeout(() => {
    throw new Error("boom-uncaught")
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
})
