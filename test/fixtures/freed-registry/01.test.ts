import { expect, test } from "vitest"
import "./registry"

test("file 1", () => {
  expect(typeof FinalizationRegistry).toBe("function")
})
