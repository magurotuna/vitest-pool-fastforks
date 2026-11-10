import { expect, test } from "vitest"

test("p2 file 1", () => {
  expect(process.env.PROJECT).toBe("2")
})
