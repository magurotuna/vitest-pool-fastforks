import { test } from "vitest"

test("ok", async () => {
  await new Promise((resolve) => setTimeout(resolve, 500))
})
