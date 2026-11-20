import { expect, test } from "vitest"

// V8 finishes the compile in a platform task. After the task, Node.js runs the
// nextTick queue of the Environment of the current context.
test("process.nextTick() after WebAssembly.compile()", async () => {
  await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
  const order: string[] = []
  await new Promise<void>((resolve) => {
    process.nextTick(() => order.push("nextTick"))
    setImmediate(() => {
      order.push("immediate")
      resolve()
    })
  })
  expect(order).toEqual(["nextTick", "immediate"])
})
