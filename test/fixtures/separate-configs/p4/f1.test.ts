import { expect, test } from "vitest"

test("p4 file 1", () => {
  expect(process.env.PROJECT).toBe("4")
})
