// Runs Vitest through its API with each pool, as a program can: a run, a
// collect, and two more runs, with a change in node_modules (a source, and an
// export of a package) before each of the last two runs. Each run must get the
// files as they are on disk.
//
// Usage: node test/api.mjs [--pools a,b]
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { pools: { type: 'string', default: 'forks,fastforks' }, child: { type: 'string' } },
})
const root = dirname(fileURLToPath(import.meta.url))

const TEST = `import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { expect, test } from "vitest"

const require = createRequire(import.meta.url)
// At the top level, so that a collect loads them too.
const actual = { dep: require("dep"), outer: require("outer") }

test("gets the files in node_modules as they are on disk", () => {
  expect(actual).toEqual(JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8")))
})
`

// Step 1 before Vitest starts, steps 2 and 3 before the last two runs.
function write(dir, step) {
  const pkg = step % 2 === 0 ? 'b' : 'a'
  writeFileSync(join(dir, 'node_modules/dep/index.cjs'), `module.exports = ${step}\n`)
  writeFileSync(join(dir, 'node_modules/pkg/package.json'), JSON.stringify({ exports: `./${pkg}.cjs` }))
  writeFileSync(join(dir, 'expected.json'), JSON.stringify({ dep: step, outer: pkg }))
}

if (values.child) {
  const { createVitest } = await import('vitest/node')
  const { fastForks } = await import('vitest-pool-fastforks')
  const [dir] = positionals
  const vitest = await createVitest('test', {
    root: dir,
    config: false,
    watch: false,
    reporters: [],
    maxWorkers: 1,
    pool: values.child === 'fastforks' ? fastForks({ fallback: 'error' }) : values.child,
  })
  const specs = await vitest.globTestSpecifications()
  const failed = []
  for (const step of [1, 2, 3]) {
    // After the first run, the child processes are warm, so the workers of the
    // collect can still be stopping when the next run starts.
    if (step === 2) await vitest.collectTests(specs)
    if (step > 1) write(dir, step)
    const { testModules } = await vitest.runTestSpecifications(specs)
    const bad = testModules.filter((m) => !m.ok())
    for (const m of bad) {
      const errors = [...m.children.allTests()].flatMap((t) => t.result().errors ?? [])
      console.error(`run ${step}: ${m.moduleId}: ${errors.map((e) => e.message).join('\n')}`)
    }
    failed.push(bad.length)
  }
  await vitest.close()
  console.log(JSON.stringify(failed))
} else {
  const pools = values.pools.split(',')
  let failed = false
  for (const pool of pools) {
    const dir = join(root, 'fixtures', `.api-${pool}`)
    rmSync(dir, { recursive: true, force: true })
    for (const name of ['dep', 'outer', 'pkg']) mkdirSync(join(dir, 'node_modules', name), { recursive: true })
    for (const name of ['dep', 'outer']) {
      writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ main: 'index.cjs' }))
    }
    writeFileSync(join(dir, 'node_modules/outer/index.cjs'), 'module.exports = require("pkg")\n')
    writeFileSync(join(dir, 'node_modules/pkg/a.cjs'), 'module.exports = "a"\n')
    writeFileSync(join(dir, 'node_modules/pkg/b.cjs'), 'module.exports = "b"\n')
    for (let i = 1; i <= 4; i++) writeFileSync(join(dir, `t${i}.test.ts`), TEST)
    write(dir, 1)
    // This pool keeps a file in node_modules that did not change in the 2
    // seconds before Vitest started, so wait longer.
    await delay(2100)
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', pool, dir], {
      encoding: 'utf8',
    })
    const result = child.stdout.trim().split('\n').at(-1)
    console.log(`${pool}: failed test files in each run: ${result}`)
    if (child.status !== 0 || result !== '[0,0,0]') {
      console.log(child.stderr)
      failed = true
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
  console.log(`${failed ? 'FAIL' : 'same'} api (${pools.join(' vs ')})`)
  process.exitCode = failed ? 1 : 0
}
