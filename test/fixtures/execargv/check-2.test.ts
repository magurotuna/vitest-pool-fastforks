import { expect, test } from "vitest"

test("execArgv 2", () => {
  expect({
    required: (globalThis as any).__required,
    imported: (globalThis as any).__imported,
    gc: typeof (globalThis as any).gc,
    execArgv: process.execArgv.map((a) => a.split("/").pop()),
  }).toMatchInlineSnapshot(`
    {
      "execArgv": [
        "--experimental-import-meta-resolve",
        "--require",
        "suppress-warnings.cjs",
        "--conditions",
        "node",
        "--conditions",
        "development",
        "--require",
        "setup.cjs",
        "--import",
        "setup.mjs",
        "--expose-gc",
        "--conditions=custom",
      ],
      "gc": "function",
      "imported": 1,
      "required": 1,
    }
  `)
})
