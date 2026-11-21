import { writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

// test/run.mjs writes this file before Vitest starts, so the pool keeps it. A
// hot reload removes it from the module cache and requires it again.
test("requires a file in node_modules again after it changed, if it existed before the run", () => {
  const path = fileURLToPath(new URL("./generated/node_modules/existing/index.cjs", import.meta.url))
  const require = createRequire(import.meta.url)
  expect(require(path)).toBe("old")
  writeFileSync(path, 'module.exports = "new"\n')
  delete require.cache[path]
  expect(require(path)).toBe("new")
})
