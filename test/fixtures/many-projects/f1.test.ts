import { expect, test } from "vitest"

test("file 1", () => {
  expect(process.env.PROJECT).toBeDefined()
})
