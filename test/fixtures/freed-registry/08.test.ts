import { expect, test } from "vitest"
import "./registry"

test("file 8", () => {
  expect(typeof FinalizationRegistry).toBe("function")
})
