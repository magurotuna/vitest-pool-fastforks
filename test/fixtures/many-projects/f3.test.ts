import { expect, test } from "vitest"

test("file 3", () => {
  expect(process.env.PROJECT).toBeDefined()
})
