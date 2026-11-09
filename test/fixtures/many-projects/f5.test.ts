import { expect, test } from "vitest"

test("file 5", () => {
  expect(process.env.PROJECT).toBeDefined()
})
