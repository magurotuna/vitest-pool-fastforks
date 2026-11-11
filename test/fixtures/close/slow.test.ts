import { writeFileSync } from "node:fs"
import { test } from "vitest"

// test/close.mjs closes Vitest while this file runs.
test("slow", async () => {
  writeFileSync(process.env.FASTFORKS_CLOSE_MARKER!, "")
  await new Promise((resolve) => setTimeout(resolve, 2000))
})
