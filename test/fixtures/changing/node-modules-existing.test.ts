import { renameSync, writeFileSync } from "node:fs"
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

// The files in a directory that moves keep their change time.
test("requires a file in node_modules again after a directory moved there", () => {
  const generated = new URL("./generated/", import.meta.url)
  const path = fileURLToPath(new URL("node_modules/moved/index.cjs", generated))
  const require = createRequire(import.meta.url)
  expect(require(path)).toBe("old")
  renameSync(new URL("node_modules/moved", generated), new URL("moved-old", generated))
  renameSync(new URL("staged", generated), new URL("node_modules/moved", generated))
  delete require.cache[path]
  expect(require(path)).toBe("new")
})
