import { expect, test } from "vitest"
import "./registry"

test("file 7", () => {
  expect(typeof FinalizationRegistry).toBe("function")
})
