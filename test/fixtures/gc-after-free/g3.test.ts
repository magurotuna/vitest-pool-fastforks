import { getHeapStatistics } from "node:v8"
import { runInNewContext } from "node:vm"
import { expect, test } from "vitest"

// Each file makes about 320 MiB of garbage, more than the heap growth that
// makes the child process run a GC after a free (128 MiB). So each file starts
// with a small heap. Without the GC, a file can start with the garbage of the
// earlier files (more than 300 MiB).
test("file 3 starts with a small heap, and gc is not visible", () => {
  expect(getHeapStatistics().used_heap_size).toBeLessThan(64 * 1024 * 1024)
  let garbage: number[][] | undefined = []
  for (let i = 0; i < 160; i++) garbage.push(new Array(262_144).fill(i))
  garbage = undefined
  expect({
    global: typeof (globalThis as any).gc,
    bare: typeof gc,
    context: runInNewContext("typeof gc"),
  }).toEqual({ global: "undefined", bare: "undefined", context: "undefined" })
})
