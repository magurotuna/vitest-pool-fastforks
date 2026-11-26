import { appendFileSync } from "node:fs"
import { test } from "vitest"

test("file 10", () => {
  appendFileSync(new URL(`./pids-${process.env.POOL}`, import.meta.url), `${process.pid}\n`)
})
