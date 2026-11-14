// The module hooks of the pool run in the same realm as the tests, so a test
// can replace the built-in methods that the hooks call. When the test below
// replaces the methods, only the CommonJS loader of Node.js and the hooks run.
// Node.js uses the methods that it saved when it started (its primordials),
// so the require() works with the forks pool. The package is in the
// node_modules of this fixture, and no other test file loads it.
import { createRequire } from "node:module"
import { expect, test } from "vitest"

const requireFromHere = createRequire(import.meta.url)

test("requires new modules from node_modules while a test replaces built-in methods", () => {
  const { startsWith, includes } = String.prototype
  const { join } = Array.prototype
  const { stringify } = JSON
  const replacement = (): never => {
    throw new Error("the test replaced this method")
  }
  let loaded: unknown
  try {
    String.prototype.startsWith = replacement
    String.prototype.includes = replacement
    Array.prototype.join = replacement
    JSON.stringify = replacement
    loaded = requireFromHere("hook-globals-require")
  } finally {
    String.prototype.startsWith = startsWith
    String.prototype.includes = includes
    Array.prototype.join = join
    JSON.stringify = stringify
  }
  expect(loaded).toEqual({ value: "require" })
})
