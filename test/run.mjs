// Runs each fixture with the forks pool and with this pool, and checks that
// both give the same status for every file and every test, and the same
// exit code.
//
// Usage: node test/run.mjs [--out <dir>] [--pools a,b] [fixture ...]
// Without fixtures, runs all of them. The fixtures run with
// `fallback: 'error'`, so a run that cannot use this pool fails.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

// name: [fixture directory, vitest arguments]
const FIXTURES = {
  basic: ['basic', []],
  exit: ['exit', ['--maxWorkers=1']],
  'exit-parallel': ['exit', []],
  errors: ['errors', []],
  execargv: ['execargv', []],
  projects: ['projects', []],
  stdio: ['stdio', []],
  handles: ['handles', []],
  'coverage-v8': ['coverage', ['--maxWorkers=1', '--coverage.enabled', '--coverage.provider=v8']],
  'coverage-istanbul': ['coverage', ['--maxWorkers=1', '--coverage.enabled', '--coverage.provider=istanbul']],
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, pools: { type: 'string', default: 'forks,fastforks' } },
})
const root = dirname(fileURLToPath(import.meta.url))
const out = resolve(values.out ?? join(root, '.results'))
const pools = values.pools.split(',')
const vitest = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs')

let failed = false
for (const name of positionals.length ? positionals : Object.keys(FIXTURES)) {
  const [fixture, args] = FIXTURES[name]
  const dir = join(out, name)
  mkdirSync(dir, { recursive: true })
  const results = {}
  for (const pool of pools) {
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
        env: { ...process.env, POOL: pool, FASTFORKS_FALLBACK: process.env.FASTFORKS_FALLBACK ?? 'error' },
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
      for (const [stream, text] of [['stdout', 'RAW-STDOUT'], ['stderr', 'RAW-STDERR']]) {
        for (const p of [base, pool]) {
          if (!results[p][stream].includes(text)) diff.push(`${p}: ${text} is missing from ${stream}`)
        }
      }
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
