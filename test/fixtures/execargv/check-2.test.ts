import { expect, test } from "vitest"

test("execArgv 2", () => {
  expect({
    required: (globalThis as any).__required,
    imported: (globalThis as any).__imported,
    gc: typeof (globalThis as any).gc,
    flags: process.execArgv.filter((a) => a === "--expose-gc" || a.startsWith("--conditions=")),
  }).toMatchInlineSnapshot(`
    {
      "flags": [
        "--expose-gc",
        "--conditions=custom",
      ],
      "gc": "function",
      "imported": 1,
      "required": 1,
    }
  `)
})
