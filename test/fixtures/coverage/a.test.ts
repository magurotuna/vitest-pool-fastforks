import { expect, test } from "vitest"
import { sign } from "./src/math"

test("positive", () => {
  expect(sign(1)).toBe("positive")
})
