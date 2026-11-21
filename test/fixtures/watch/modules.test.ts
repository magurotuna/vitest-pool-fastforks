import { createRequire } from "node:module"
import { expect, test } from "vitest"

test("node_modules", () => {
  expect(createRequire(import.meta.url)("./node_modules/watched/index.cjs")).toBe(1)
})
