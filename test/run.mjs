// Runs each fixture with the forks pool and with this pool, and checks that
// both give the same status for every file and every test, and the same
// exit code.
//
// Usage: node test/run.mjs [--out <dir>] [--pools a,b] [fixture ...]
// Without fixtures, runs all of them. The fixtures run with
// `fallback: 'error'`, so a run that cannot use this pool fails.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

// name: [fixture directory, vitest arguments, environment variables]
const FIXTURES = {
  basic: ['basic', []],
  exit: ['exit', ['--maxWorkers=1']],
  'exit-parallel': ['exit', []],
  errors: ['errors', []],
  execargv: ['execargv', []],
  // Node.js removes the double quotes, and keeps the space in the path.
  'node-options': ['node-options', [], { NODE_OPTIONS: '--import="./setup file.mjs"' }],
  projects: ['projects', []],
  stdio: ['stdio', []],
  handles: ['handles', []],
  process: ['process', []],
  'hook-globals': ['hook-globals', []],
  callbacks: ['callbacks', []],
  'freed-registry': ['freed-registry', ['--maxWorkers=1']],
  // The child process runs a GC after each of these files, so each file starts
  // with a small heap. gc stays hidden from the files.
  'gc-after-free': ['gc-after-free', ['--maxWorkers=1']],
  // With these flags, the child process takes no gc, and does not crash.
  'gc-flags': ['gc-flags', []],
  changing: ['changing', ['--maxWorkers=1']],
  'crash-on-create': ['crash-on-create', ['--maxWorkers=1']],
  'many-projects': ['many-projects', ['--maxWorkers=2']],
  // Each file writes process.pid. This pool must run them in one child process
  // for each of the 2 workers of the project: the first two files start at the
  // same time, so fewer means that the limit is too low.
  'host-limit': ['host-limit', []],
  // Both files load an addon that is not context-aware. This pool runs them
  // in one child process, so the second file gets an error, and the error
  // must contain the cause.
  'legacy-addon': ['legacy-addon', ['--maxWorkers=1']],
  'separate-configs': ['separate-configs', ['--maxWorkers=2']],
  inspect: ['inspect', ['--inspect=127.0.0.1:9339', '--no-file-parallelism']],
  inspector: ['inspector', ['--maxWorkers=1']],
  'coverage-v8': ['coverage', ['--maxWorkers=1', '--coverage.enabled', '--coverage.provider=v8']],
  'coverage-istanbul': ['coverage', ['--maxWorkers=1', '--coverage.enabled', '--coverage.provider=istanbul']],
}

// Runs before Vitest starts with each pool.
let legacyAddonBuilt = false
const BEFORE = {
  'host-limit': (dir, pool) => rmSync(join(dir, `pids-${pool}`), { force: true }),
  'legacy-addon': (dir, pool) => {
    rmSync(join(dir, `hints-${pool}`), { force: true })
    if (legacyAddonBuilt) return
    legacyAddonBuilt = true
    const nodeGyp = createRequire(import.meta.url).resolve('node-gyp/bin/node-gyp.js')
    execFileSync(process.execPath, [nodeGyp, 'rebuild'], { cwd: dir, stdio: 'pipe' })
  },
  // Files in node_modules that exist before Vitest starts. This pool keeps a
  // file that did not change in the 2 seconds before, so wait longer.
  changing: async (dir) => {
    const generated = join(dir, 'generated')
    for (const name of ['node_modules/existing', 'node_modules/moved', 'moved-old', 'staged']) {
      rmSync(join(generated, name), { recursive: true, force: true })
    }
    for (const [file, value] of [
      ['node_modules/existing/index.cjs', 'old'],
      ['node_modules/moved/index.cjs', 'old'],
      ['staged/index.cjs', 'new'],
    ]) {
      mkdirSync(dirname(join(generated, file)), { recursive: true })
      writeFileSync(join(generated, file), `module.exports = "${value}"\n`)
    }
    await delay(2100)
  },
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, pools: { type: 'string', default: 'forks,fastforks' } },
})
const root = dirname(fileURLToPath(import.meta.url))
const out = resolve(values.out ?? join(root, '.results'))
const pools = values.pools.split(',')
const fallback = process.env.FASTFORKS_FALLBACK ?? 'error'
const vitest = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs')

let failed = false
for (const name of positionals.length ? positionals : Object.keys(FIXTURES)) {
  const [fixture, args, env = {}] = FIXTURES[name]
  const dir = join(out, name)
  mkdirSync(dir, { recursive: true })
  const results = {}
  for (const pool of pools) {
    await BEFORE[name]?.(join(root, 'fixtures', fixture), pool)
    const report = join(dir, `${pool}.json`)
    const run = spawnSync(
      process.execPath,
      [
        vitest,
        'run',
        '--configLoader',
        'runner',
        '--reporter=verbose',
        '--reporter=json',
        `--outputFile.json=${report}`,
        `--coverage.reportsDirectory=${join(dir, `${pool}-coverage`)}`,
        ...args,
      ],
      {
        cwd: join(root, 'fixtures', fixture),
        env: { ...process.env, ...env, POOL: pool, FASTFORKS_FALLBACK: fallback },
        encoding: 'utf8',
        timeout: 120_000,
      },
    )
    writeFileSync(join(dir, `${pool}.stdout`), run.stdout ?? '')
    writeFileSync(join(dir, `${pool}.stderr`), run.stderr ?? '')
    let parsed
    try {
      parsed = summarize(JSON.parse(readFileSync(report, 'utf8')))
    } catch (error) {
      parsed = { error: `no report: ${error.message}` }
    }
    results[pool] = {
      code: run.status,
      signal: run.signal,
      ...parsed,
      coverage: args.includes('--coverage.enabled') ? coverageCounts(join(dir, `${pool}-coverage`)) : undefined,
      stdout: run.stdout ?? '',
      stderr: run.stderr ?? '',
    }
  }
  const [base, ...others] = pools
  for (const pool of others) {
    const diff = compare(results[base], results[pool])
    if (name === 'stdio') {
      for (const [stream, text] of [
        ['stdout', 'RAW-STDOUT'],
        ['stderr', 'RAW-STDERR'],
      ]) {
        for (const p of [base, pool]) {
          if (!results[p][stream].includes(text)) diff.push(`${p}: ${text} is missing from ${stream}`)
        }
      }
    }
    // The pool starts a file again in a new child process if an earlier file
    // crashed the child process. It also starts again without the startup
    // snapshot if a child process that used the snapshot exited before it was
    // ready. So the results can be the same after a crash. Only the
    // crash-on-create fixture makes the pool start again on purpose. The pool
    // writes its warnings to stderr.
    if (name !== 'crash-on-create' && /\[vitest-pool-fastforks\] A child process exited/.test(results[pool].stderr)) {
      diff.push(`${pool}: a child process exited unexpectedly`)
    }
    const summary = `${results[pool].files ? Object.keys(results[pool].files).length : 0} files, exit ${results[base].code}/${results[pool].code}`
    if (diff.length) {
      failed = true
      console.log(`FAIL ${name} (${base} vs ${pool}, ${summary})`)
      for (const line of diff) console.log(`  ${line}`)
      console.log(`  stderr of ${pool}: ${results[pool].stderr.split('\n').slice(0, 15).join('\n    ')}`)
    } else {
      console.log(`same ${name} (${base} vs ${pool}, ${summary})`)
    }
  }
  // With another fallback, the forks pool can run the files instead.
  if (name === 'host-limit' && pools.includes('fastforks') && fallback === 'error') {
    let pids
    try {
      pids = new Set(
        readFileSync(join(root, 'fixtures', fixture, 'pids-fastforks'), 'utf8')
          .split('\n')
          .filter(Boolean),
      )
    } catch (error) {
      failed = true
      console.log(`FAIL ${name} (fastforks): no pids: ${error.message}`)
    }
    if (pids && pids.size !== 2) {
      failed = true
      console.log(
        `FAIL ${name} (fastforks): child processes that ran the files: ${pids.size}, not 2 (one for each worker)`,
      )
    }
  }
  // Each file that gets the error writes a line, after it checks the error.
  // With another fallback, the forks pool can run the files instead.
  if (name === 'legacy-addon') {
    for (const [pool, expected] of [
      ['forks', 0],
      ['fastforks', 1],
    ]) {
      if (!pools.includes(pool) || (pool === 'fastforks' && fallback !== 'error')) continue
      const file = join(root, 'fixtures', fixture, `hints-${pool}`)
      const count = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0
      if (count !== expected) {
        failed = true
        console.log(`FAIL ${name} (${pool}): files that got the error: ${count}, not ${expected}`)
      }
    }
  }
}
process.exitCode = failed ? 1 : 0

function summarize(report) {
  const files = {}
  const tests = {}
  for (const file of report.testResults) {
    const path = file.name.replaceAll('\\', '/')
    files[path] = file.status
    for (const test of file.assertionResults) tests[`${path} > ${test.fullName}`] = test.status
  }
  return { files, tests, success: report.success }
}

// The hit counts of every statement, branch, and function, by file name.
function coverageCounts(dir) {
  try {
    const coverage = JSON.parse(readFileSync(join(dir, 'coverage-final.json'), 'utf8'))
    const counts = {}
    for (const [file, { s, b, f }] of Object.entries(coverage)) {
      counts[file.replaceAll('\\', '/').split('/').pop()] = JSON.stringify({ s, b, f })
    }
    return counts
  } catch (error) {
    return { error: error.message }
  }
}

function compare(a, b) {
  const diff = []
  // Some Vitest versions exit without a report (vitest 4.0.15 with the exit
  // fixture and one worker). That is the same result if both runs do it.
  if (a.error && b.error) return a.code === b.code ? [] : [`exit code: ${a.code} -> ${b.code}`]
  if (a.error || b.error) return [a.error, b.error].filter(Boolean)
  for (const file of new Set([...Object.keys(a.coverage ?? {}), ...Object.keys(b.coverage ?? {})])) {
    if (a.coverage[file] !== b.coverage[file]) diff.push(`coverage ${file}: ${a.coverage[file]} -> ${b.coverage[file]}`)
  }
  if (a.code !== b.code) diff.push(`exit code: ${a.code} -> ${b.code}`)
  if (a.success !== b.success) diff.push(`success: ${a.success} -> ${b.success}`)
  for (const kind of ['files', 'tests']) {
    for (const key of new Set([...Object.keys(a[kind]), ...Object.keys(b[kind])])) {
      if (a[kind][key] !== b[kind][key]) diff.push(`${kind} ${key}: ${a[kind][key]} -> ${b[kind][key]}`)
    }
  }
  return diff
}
