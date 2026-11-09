import { test } from "vitest"

test("throws after the file ends", () => {
  setTimeout(() => {
    throw new Error("boom-after-file")
  }, 300)
})
