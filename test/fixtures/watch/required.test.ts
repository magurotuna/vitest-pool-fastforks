import { createRequire } from "node:module"
import { expect, test } from "vitest"

test("required", () => {
  expect(createRequire(import.meta.url)("./lib/required.cjs")).toBe(1)
})
