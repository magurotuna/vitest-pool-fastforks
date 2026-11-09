import { expect, test } from "vitest"

test("pass", () => {
  expect(process.argv.length).toBeGreaterThan(1)
  console.log(JSON.stringify({ argv1: process.argv[1].split("/").slice(-2).join("/"), execArgv: process.execArgv.map((a) => a.split("/").pop()) }))
})
