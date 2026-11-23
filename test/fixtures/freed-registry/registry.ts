import { statSync } from "node:fs"
import { afterAll, beforeAll } from "vitest"

declare const gc: (options: { type: "minor" }) => void

// The callback calls into Node.js. If it runs in the context of a freed
// Environment, the child process crashes.
const registry = new FinalizationRegistry(() => {
  statSync(".")
})

beforeAll(async () => {
  // Two young-generation GCs move the registry to the old generation, so that
  // it stays alive in a later young-generation GC. They also find dead targets
  // of the files that ran before in this child process.
  gc({ type: "minor" })
  gc({ type: "minor" })
  // Let the cleanup task of FinalizationRegistry run.
  await new Promise((resolve) => setTimeout(resolve, 10))
})

afterAll(() => {
  // Targets that die young after the file ends.
  for (let i = 0; i < 1000; i++) registry.register({ i }, i)
})
