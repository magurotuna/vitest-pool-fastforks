// Runs Vitest through its API with each pool, as a program can: a run, a
// collect, and two more runs, with a change in node_modules (a source, and an
// export of a package) before each step after the first. Each step must get
// the files as they are on disk.
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

// The name of the test has what the file got, so a collect shows it too.
const TEST = `import { createRequire } from "node:module"
import { test } from "vitest"

const require = createRequire(import.meta.url)
test(\`got \${JSON.stringify({ dep: require("dep"), outer: require("outer") })}\`, () => {})
`
// Step 1 is a run, step 2 a collect, and steps 3 and 4 are runs.
const STEPS = [1, 2, 3, 4]
const outer = (step) => (step % 2 === 0 ? 'b' : 'a')

// Step 1 before Vitest starts, the other steps before Vitest runs them.
function write(dir, step) {
  writeFileSync(join(dir, 'node_modules/dep/index.cjs'), `module.exports = ${step}\n`)
  writeFileSync(join(dir, 'node_modules/pkg/package.json'), JSON.stringify({ exports: `./${outer(step)}.cjs` }))
}

if (values.child) {
  const { createVitest } = await import('vitest/node')
  const { fastForks } = await import('vitest-pool-fastforks')
  const [dir] = positionals
  const vitest = await createVitest('test', {
    root: dir,
    config: false,
    watch: false,
    // Not []: Vitest 4 then uses its default reporter, which needs start().
    reporters: [{}],
    maxWorkers: 1,
    pool: values.child === 'fastforks' ? fastForks({ fallback: 'error' }) : values.child,
  })
  const specs = await vitest.globTestSpecifications()
  const steps = []
  // After the first run, the child processes are warm, so the workers of the
  // collect can still be stopping when the next run starts.
  for (const step of STEPS) {
    if (step > 1) write(dir, step)
    const collect = step === 2
    const { testModules, unhandledErrors } = collect
      ? await vitest.collectTests(specs)
      : await vitest.runTestSpecifications(specs)
    const tests = testModules.flatMap((m) => [...m.children.allTests()])
    steps.push([
      ...tests.map((t) => `${t.name}: ${collect ? 'collected' : t.result().state}`).sort(),
      ...unhandledErrors.map((error) => `error: ${error.message}`),
    ])
  }
  await vitest.close()
  console.log(JSON.stringify(steps))
} else {
  const pools = values.pools.split(',')
  const expected = JSON.stringify(
    STEPS.map((step) =>
      Array(4).fill(`got {"dep":${step},"outer":"${outer(step)}"}: ${step === 2 ? 'collected' : 'passed'}`),
    ),
  )
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
      timeout: 120_000,
    })
    const result = child.stdout.trim().split('\n').at(-1)
    const ok = child.status === 0 && result === expected
    console.log(
      `${pool}: ${ok ? 'each step got the files on disk' : `got ${result}\nexpected ${expected}\n${child.stderr}`}`,
    )
    failed ||= !ok
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
  console.log(`${failed ? 'FAIL' : 'same'} api (${pools.join(' vs ')})`)
  process.exitCode = failed ? 1 : 0
}
