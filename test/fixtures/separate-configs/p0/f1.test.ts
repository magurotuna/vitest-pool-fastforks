import { expect, test } from "vitest"

test("p0 file 1", () => {
  expect(process.env.PROJECT).toBe("0")
})
