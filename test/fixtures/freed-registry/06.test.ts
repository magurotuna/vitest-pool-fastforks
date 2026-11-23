import { expect, test } from "vitest"
import "./registry"

test("file 6", () => {
  expect(typeof FinalizationRegistry).toBe("function")
})
