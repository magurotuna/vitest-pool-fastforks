import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

// For example, a fixture package, or a hot reload.
test("requires a file in node_modules again after it changed", () => {
  const dir = new URL("./generated/node_modules/rewritten/", import.meta.url)
  const file = new URL("index.cjs", dir)
  const path = fileURLToPath(file)
  const require = createRequire(import.meta.url)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, 'module.exports = "old"\n')
  expect(require(path)).toBe("old")
  writeFileSync(file, 'module.exports = "new"\n')
  delete require.cache[path]
  expect(require(path)).toBe("new")
})
