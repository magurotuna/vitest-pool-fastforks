import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { expect, test } from "vitest"

// require() goes to Node.js, not to Vite.
test("requires the file that it wrote (4)", () => {
  mkdirSync(new URL("./generated/", import.meta.url), { recursive: true })
  writeFileSync(new URL("./generated/value.cjs", import.meta.url), "module.exports = 4\n")
  expect(createRequire(import.meta.url)("./generated/value.cjs")).toBe(4)
})

// The pool keeps no file in node_modules that changed after Vitest started.
test("requires the package in node_modules that it wrote (4)", () => {
  const dir = new URL("./generated/node_modules/shared/", import.meta.url)
  mkdirSync(dir, { recursive: true })
  writeFileSync(new URL("index.cjs", dir), "module.exports = 4\n")
  expect(createRequire(import.meta.url)("./generated/node_modules/shared/index.cjs")).toBe(4)
})
