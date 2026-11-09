import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest"

// Like vitest's test/unit/test/stubbed-process.test.ts: the worker must keep
// talking to the main process when a test replaces globalThis.process.
describe("undefined process", () => {
  it("imports a file while process is undefined", async () => {
    const realProcess = globalThis.process
    onTestFinished(() => {
      globalThis.process = realProcess
    })
    globalThis.process = undefined as any
    const mod = await import("./fixture-math")
    expect(mod.sum(2, 3)).toBe(5)
  })
})

describe("stubbed process", () => {
  beforeAll(() => {
    vi.stubGlobal("process", { badMock: true })
    return () => {
      vi.unstubAllGlobals()
    }
  })

  it("imports a file while process is stubbed", async () => {
    await import("./fixture-math?stubbed")
  })
})
