// The module hooks of the pool run in the same realm as the tests. In the
// refine repository (refinedev/refine), a setup file of packages/core sets
// globalThis.TextDecoder to undefined. After that, the load hook failed for
// the ES modules in node_modules that were not in the module cache of the
// pool yet. The packages are in the node_modules of this fixture, and no
// other test file imports them, so the cache does not have them.
import { expect, test } from "vitest"

test("imports new modules from node_modules after a test replaces globalThis.TextDecoder", async () => {
  Reflect.set(globalThis, "TextDecoder", undefined)
  const esm = await import("hook-globals-esm")
  const cjs = await import("hook-globals-cjs")
  expect(esm.value).toBe("esm")
  expect(cjs.value).toBe("cjs")
})
