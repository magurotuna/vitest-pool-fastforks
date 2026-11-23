import { expect, test } from "vitest"
import "./registry"

test("file 5", () => {
  expect(typeof FinalizationRegistry).toBe("function")
})
