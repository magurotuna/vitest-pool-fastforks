import { expect, test } from "vitest"

test.each([1, 2, 3, 4])("project b %i", () => {
  expect([process.env.WHICH, typeof (globalThis as any).gc]).toEqual(["b", "function"])
})
