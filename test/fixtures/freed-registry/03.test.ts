import { expect, test } from "vitest"
import "./registry"

test("file 3", () => {
  expect(typeof FinalizationRegistry).toBe("function")
})
