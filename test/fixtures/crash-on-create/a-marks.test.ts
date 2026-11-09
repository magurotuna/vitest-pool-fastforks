import { writeFileSync } from "node:fs"
import { test } from "vitest"

test("leaves a marker for the next file in this process", () => {
  writeFileSync(new URL("./.crash-next-create", import.meta.url), String(process.pid))
})
