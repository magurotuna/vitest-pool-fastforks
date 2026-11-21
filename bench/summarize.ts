// Summarizes bench runs: the median wall time of each pool, and the speed-up.
// Usage: node bench/summarize.ts <run directory>... > results.json
// With more than one directory, a later directory replaces the projects of an
// earlier one, for example after one project ran again.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/** The format of results.json, which scripts/results-chart.ts reads. */
export interface Project {
  name: string
  url: string
  scope?: string
  synthetic?: boolean
  workers?: string
  files: number
  vitest: string
  /** All CPUs, then fewer CPUs. Wall times in seconds. */
  results: { cpus: number; forks: number; fastforks: number; speedUp: number; walls?: Record<string, number[]> }[]
}

export interface Results {
  machine: {
    description: string
    cpu: string
    smt: boolean
    cpus: number
    memoryGiB: number
    os: string
    node: string
    package?: string
    date?: string
  }
  runs: number
  projects: Project[]
}

/** machine.json, written by bench.sh. */
interface Machine {
  model: string
  cpus: number
  threadsPerCore: number
  memKiB: number
  virt: string
  node: string
  package: string
  commit: string
  date: string
}

interface Run {
  label: string
  pool: string
  /** `all`, or the CPU list of taskset. */
  cpus: string
  exit: number
  wall: number
  vitest: string
}

interface Meta {
  name: string
  url: string
  /** The part of the project that runs, if not all of it. */
  scope?: string
  synthetic?: boolean
  /** Why the project does not use Vitest's default number of workers. */
  workers?: string
}

// The projects in the order of the README.
const META: Record<string, Meta> = {
  readest: { name: 'readest', url: 'https://github.com/readest/readest', workers: 'whose config sets `maxWorkers: 4`' },
  vuetify: { name: 'Vuetify', url: 'https://github.com/vuetifyjs/vuetify' },
  'material-ui': { name: 'Material UI', url: 'https://github.com/mui/material-ui' },
  'base-ui': { name: 'Base UI', url: 'https://github.com/mui/base-ui' },
  'mui-x': { name: 'MUI X', url: 'https://github.com/mui/mui-x' },
  vitest: { name: 'Vitest', url: 'https://github.com/vitest-dev/vitest', scope: '`test/unit`' },
  'instructure-ui': {
    name: 'Instructure UI',
    url: 'https://github.com/instructure/instructure-ui',
    scope: 'Node tests',
  },
  'js-test-runner-competition': {
    name: 'js-test-runner-competition',
    url: 'https://github.com/ubugeeei-reproductions/js-test-runner-competition',
    synthetic: true,
  },
}
const ROUNDS = 3
const LIMITED = 4

const dirs = process.argv.slice(2)
if (dirs.length === 0) {
  console.error('Usage: node bench/summarize.ts <run directory>...')
  process.exit(2)
}

const median = (values: number[]): number => {
  const s = values.toSorted((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

const machines = dirs.map((dir): Machine => JSON.parse(readFileSync(join(dir, 'machine.json'), 'utf8')))
const machine = machines.at(-1)!
for (const [i, m] of machines.entries()) {
  if ((['model', 'cpus', 'node', 'commit'] as const).some((k) => m[k] !== machine[k])) {
    console.error(`warning: ${dirs[i]} ran on another machine or build than ${dirs.at(-1)}`)
  }
}
const latest = new Map<string, string>()
for (const dir of dirs) {
  for (const key of Object.keys(META)) {
    if (existsSync(join(dir, key, 'runs.jsonl'))) latest.set(key, join(dir, key))
  }
}
const projects = new Map([...latest].map(([key, dir]) => [key, project(dir, key)]))
const missing = Object.keys(META).filter((key) => !projects.has(key))
if (missing.length) console.error(`warning: no runs of ${missing.join(', ')}`)

function project(dir: string, key: string): Project {
  // A label that ran again has more than one line: the last one counts.
  const byLabel = new Map<string, Run>()
  for (const line of readFileSync(join(dir, 'runs.jsonl'), 'utf8').trim().split('\n')) {
    const run: Run = JSON.parse(line)
    byLabel.set(run.label, run)
  }
  const files = new Set<number>()
  const results = ['all', String(LIMITED)].map((cpus) => {
    const walls: Record<string, number[]> = {}
    const failed: Record<string, Set<string>> = {}
    for (const pool of ['forks', 'fastforks']) {
      walls[pool] = []
      failed[pool] = new Set()
      for (let round = 1; round <= ROUNDS; round++) {
        const label = `${cpus}-r${round}-${pool}`
        const run = byLabel.get(label)
        const report = join(dir, `${label}.json.gz`)
        // Vitest exits with 1 if a test fails. A timeout gives 124 or 137.
        if (!run || run.exit > 1 || !existsSync(report)) {
          throw new Error(`${key} ${label}: ${run ? `exit code ${run.exit}` : 'no run'}`)
        }
        // A run of the label by hand can have other conditions.
        if (run.pool !== pool || (run.cpus === 'all') !== (cpus === 'all')) {
          throw new Error(`${key} ${label}: ran with ${run.pool} and CPUs ${run.cpus}`)
        }
        walls[pool]!.push(run.wall)
        const { numTotalTests, testResults } = JSON.parse(gunzipSync(readFileSync(report)).toString())
        if (numTotalTests === 0) throw new Error(`${key} ${label}: no tests ran`)
        files.add(testResults.length)
        for (const file of testResults) if (file.status === 'failed') failed[pool]!.add(file.name)
        if (run.exit === 1 && !testResults.some((f: { status: string }) => f.status === 'failed')) {
          console.error(`warning: ${key} ${label}: exit code 1, but no file failed (see ${label}.err)`)
        }
      }
    }
    // The README says that both pools give the same results.
    for (const [a, b] of [
      ['forks', 'fastforks'],
      ['fastforks', 'forks'],
    ] as const) {
      const only = [...failed[a]!].filter((f) => !failed[b]!.has(f))
      if (only.length) console.error(`warning: ${key} ${cpus}: failed only with ${a}:\n  ${only.join('\n  ')}`)
    }
    const forks = median(walls.forks!)
    const fastforks = median(walls.fastforks!)
    return {
      cpus: cpus === 'all' ? machine.cpus : LIMITED,
      forks: round(forks, 3),
      fastforks: round(fastforks, 3),
      speedUp: round(forks / fastforks, 4),
      walls,
    }
  })
  if (files.size > 1) console.error(`warning: ${key}: the runs have different file counts: ${[...files].join(', ')}`)
  return { ...META[key]!, files: Math.max(...files), vitest: [...byLabel.values()][0]!.vitest, results }
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits))
}

const results: Results = {
  machine: {
    description: machine.virt && machine.virt !== 'none' ? 'a virtual machine' : 'a machine',
    cpu: machine.model,
    smt: machine.threadsPerCore > 1,
    cpus: machine.cpus,
    memoryGiB: Math.round(machine.memKiB / 1024 / 1024),
    os: 'Linux',
    node: machine.node,
    package: machine.package,
    date: machine.date,
  },
  runs: ROUNDS,
  projects: Object.keys(META).flatMap((key) => projects.get(key) ?? []),
}
console.log(JSON.stringify(results, null, 2))
