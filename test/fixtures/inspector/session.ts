import { Session } from "node:inspector/promises"
import { expect } from "vitest"

// Each test file compiles branch.ts again, as in a fork, so the block counts
// are the counts of this file only.
export async function checkBlockCoverage(): Promise<void> {
  const session = new Session()
  session.connect()
  await session.post("Profiler.enable")
  await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true })
  const { parity } = await import("./branch.ts")
  for (let n = 0; n < 5; n++) parity(n)
  const { result } = await session.post("Profiler.takePreciseCoverage")
  session.disconnect()
  const script = result.find((s) => s.url.includes("branch.ts"))
  const fn = script?.functions.find((f) => f.functionName === "parity")
  expect(fn?.ranges.map((r) => r.count)).toEqual([5, 2, 3])
}
