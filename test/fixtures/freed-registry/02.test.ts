import { expect, test } from "vitest"
import "./registry"

test("file 2", () => {
  expect(typeof FinalizationRegistry).toBe("function")
})
