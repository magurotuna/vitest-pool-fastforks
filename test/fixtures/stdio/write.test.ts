import { test } from "vitest"

test("writes", () => {
  process.stdout.write("RAW-STDOUT\n")
  process.stderr.write("RAW-STDERR\n")
  console.log("CONSOLE-LOG")
  console.error("CONSOLE-ERROR")
})
