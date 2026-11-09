import { expect, test } from "vitest"
import { sign } from "./src/math"
import { double } from "./src/other"

test("negative", () => {
  expect(sign(-1)).toBe("negative")
  expect(double(2)).toBe(4)
})
