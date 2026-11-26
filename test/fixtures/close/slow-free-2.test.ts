import { pbkdf2 } from "node:crypto"
import { existsSync, writeFileSync } from "node:fs"
import { test } from "vitest"

// test/close.mjs runs this file and the other slow-free file with one worker.
// The file that runs first leaves a thread pool request (about 0.5 seconds on
// an Apple silicon Mac). The free of its Environment waits for this request,
// so the next file waits for the child process. test/close.mjs closes Vitest
// then.
test("slow free", () => {
  const marker = process.env.FASTFORKS_CLOSE_MARKER!
  if (existsSync(marker)) return
  writeFileSync(marker, "")
  pbkdf2("a", "b", 2_000_000, 64, "sha512", () => {})
})
