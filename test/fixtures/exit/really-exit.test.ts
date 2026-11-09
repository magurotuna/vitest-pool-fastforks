import { test } from "vitest"

test("reallyExit", () => {
  ;(process as any).reallyExit(5)
})
