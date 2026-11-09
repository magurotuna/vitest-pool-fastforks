import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { expect, test } from "vitest"

// require() goes to Node.js, not to Vite.
test("requires the file that it wrote (3)", () => {
  mkdirSync(new URL("./generated/", import.meta.url), { recursive: true })
  writeFileSync(new URL("./generated/value.cjs", import.meta.url), "module.exports = 3\n")
  expect(createRequire(import.meta.url)("./generated/value.cjs")).toBe(3)
})
