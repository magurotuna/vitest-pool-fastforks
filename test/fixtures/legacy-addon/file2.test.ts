import { test } from "vitest"
import { loadAddon } from "./load.ts"

test("file 2 loads the addon, or gets an error that contains the cause", () => {
  loadAddon()
})
