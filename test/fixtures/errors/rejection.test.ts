import { test } from "vitest"

test("unhandled rejection", async () => {
  Promise.reject(new Error("boom-rejection"))
  await new Promise((resolve) => setTimeout(resolve, 20))
})
