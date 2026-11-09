// Starts Vitest in watch mode with each pool, changes a source file and a
// file that a test requires, and checks that every rerun reports the same
// result as with forks.
//
// Usage: node test/watch.mjs [--pools a,b]
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { pools: { type: 'string', default: 'forks,fastforks' } } })
const root = dirname(fileURLToPath(import.meta.url))
const vitest = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs')

// [[file to write, content], ...], and the summary line that the run after
// the writes prints. Vitest reruns only the affected test files, and it does
// not watch files that a test reads with require(), so the steps that change
// lib/required.cjs also change the test file.
const STEPS = [
  [[], 'Tests  2 passed'],
  [[['src/value.ts', 'export const value = 2\n']], 'Tests  1 failed'],
  [[['src/value.ts', 'export const value = 1\n']], 'Tests  1 passed'],
  [[['lib/required.cjs', 'module.exports = 2\n'], ['required.test.ts', requiredTest(2)]], 'Tests  1 failed'],
  [[['lib/required.cjs', 'module.exports = 1\n'], ['required.test.ts', requiredTest(1)]], 'Tests  1 passed'],
]

function requiredTest(step) {
  return `import { createRequire } from "node:module"
import { expect, test } from "vitest"

// step ${step}
test("required", () => {
  expect(createRequire(import.meta.url)("./lib/required.cjs")).toBe(1)
})
`
}

const results = {}
for (const pool of values.pools.split(',')) {
  results[pool] = await run(pool)
  console.log(`${pool}: ${results[pool].join(' / ')}`)
}
const [base, ...others] = Object.keys(results)
let failed = false
for (const pool of others) {
  const same = JSON.stringify(results[base]) === JSON.stringify(results[pool])
  const expected = JSON.stringify(results[pool]) === JSON.stringify(STEPS.map((s) => s[1]))
  console.log(`${same && expected ? 'same' : 'FAIL'} watch (${base} vs ${pool})`)
  failed ||= !(same && expected)
}
process.exitCode = failed ? 1 : 0

async function run(pool) {
  // A copy, so that the test never changes the committed fixture.
  const dir = join(root, 'fixtures', `.watch-${pool}`)
  rmSync(dir, { recursive: true, force: true })
  cpSync(join(root, 'fixtures', 'watch'), dir, { recursive: true })
  mkdirSync(join(dir, 'lib'), { recursive: true })
  const child = spawn(process.execPath, [vitest, '--configLoader', 'runner', '--watch'], {
    cwd: dir,
    env: { ...process.env, POOL: pool, FASTFORKS_FALLBACK: 'error', CI: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const seen = []
  try {
    for (const [writes] of STEPS) {
      output = ''
      for (const [file, content] of writes) writeFileSync(join(dir, file), content)
      seen.push(await waitForSummary(() => output))
    }
  } finally {
    // Windows cannot delete the directory while a process uses it, so wait
    // for Vitest to exit, and retry while its child processes exit.
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
    await exited
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
  return seen
}

async function waitForSummary(read) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const text = read().replace(/\x1B\[[0-9;]*m/g, '')
    const match = /Tests {2}[^\n]*?(?=\s*\(\d+\))/.exec(text)
    if (match && /(Waiting|Watching) for file changes/.test(text)) return match[0].trim()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return `timeout: ${read().slice(-500)}`
}
