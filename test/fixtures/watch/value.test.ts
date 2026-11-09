import { expect, test } from "vitest"
import { value } from "./src/value"

test("value", () => {
  expect(value).toBe(1)
})
