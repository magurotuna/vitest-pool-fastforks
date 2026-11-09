import { test } from "vitest"

test("exit", () => {
  process.exit(1)
})
test("after exit", () => {})
