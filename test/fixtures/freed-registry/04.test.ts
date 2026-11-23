import { expect, test } from "vitest"
import "./registry"

test("file 4", () => {
  expect(typeof FinalizationRegistry).toBe("function")
})
