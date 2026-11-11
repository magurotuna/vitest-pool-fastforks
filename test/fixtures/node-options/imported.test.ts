import { expect, test } from "vitest"

test("NODE_OPTIONS --import with double quotes", () => {
  expect((globalThis as any).__imported).toBe(1)
})
