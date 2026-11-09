import inspector from "node:inspector"
import { expect, test } from "vitest"

test("the debugger is listening", () => {
  expect(inspector.url()).toMatch(/^ws:\/\/127\.0\.0\.1:9339\//)
})
