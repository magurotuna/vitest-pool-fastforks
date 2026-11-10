import { expect, test } from "vitest"

test("p1 file 1", () => {
  expect(process.env.PROJECT).toBe("1")
})
