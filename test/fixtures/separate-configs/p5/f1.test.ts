import { expect, test } from "vitest"

test("p5 file 1", () => {
  expect(process.env.PROJECT).toBe("5")
})
