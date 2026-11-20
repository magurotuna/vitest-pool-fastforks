import { openAsBlob, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"

// Node.js reads the file in a libuv callback that does not enter the context
// of the test file.
test("reads a Blob from fs.openAsBlob()", async () => {
  const path = join(tmpdir(), `fastforks-blob-${process.pid}.txt`)
  writeFileSync(path, "hello")
  const blob = await openAsBlob(path)
  expect(await blob.text()).toBe("hello")
})
