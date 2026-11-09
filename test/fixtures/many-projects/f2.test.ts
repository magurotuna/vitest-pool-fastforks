import { expect, test } from "vitest"

test("file 2", () => {
  expect(process.env.PROJECT).toBeDefined()
})
