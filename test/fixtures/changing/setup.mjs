import { mkdirSync, writeFileSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"

// A package in node_modules that exists before the run. The pool keeps a file
// that did not change in the 2 seconds before the run, so wait longer.
export default async function setup() {
  const dir = new URL("./generated/node_modules/existing/", import.meta.url)
  mkdirSync(dir, { recursive: true })
  writeFileSync(new URL("index.cjs", dir), 'module.exports = "old"\n')
  await delay(2100)
}
