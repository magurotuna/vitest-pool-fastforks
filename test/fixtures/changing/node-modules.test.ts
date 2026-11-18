import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

// For example, a fixture package, or a hot reload. The pool does not keep a
// file that changed in the last 2 seconds, so wait longer before each load.
test("requires a file in node_modules again after it changed", async () => {
  const dir = new URL("./generated/node_modules/rewritten/", import.meta.url)
  const file = new URL("index.cjs", dir)
  const path = fileURLToPath(file)
  const require = createRequire(import.meta.url)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, 'module.exports = "old"\n')
  await delay(2100)
  expect(require(path)).toBe("old")
  writeFileSync(file, 'module.exports = "new"\n')
  await delay(2100)
  delete require.cache[path]
  expect(require(path)).toBe("new")
}, 10_000)
