import { Session } from "node:inspector/promises"
import { expect, test } from "vitest"

test("a node:inspector session", async () => {
  const session = new Session()
  session.connect()
  const { result } = await session.post("Runtime.evaluate", { expression: "1 + 1" })
  session.disconnect()
  expect(result.value).toBe(2)
})
