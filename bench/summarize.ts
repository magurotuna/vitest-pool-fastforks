// Summarizes bench runs: the median wall time of each pool, and the speed-up.
// Usage: node bench/summarize.ts <run directory>... > results.json
// With more than one directory, a later directory replaces the projects of an
// earlier one, for example after one project ran again.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

interface Run {
  label: string
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

let machine: any
const projects = new Map<string, object>()
for (const dir of dirs) {
  const m = JSON.parse(readFileSync(join(dir, 'machine.json'), 'utf8'))
  if (machine && (machine.model !== m.model || machine.cpus !== m.cpus)) {
    console.error(`warning: ${dir} ran on another machine (${m.model}, ${m.cpus} CPUs)`)
  }
  machine = m
  for (const key of Object.keys(META)) {
    const file = join(dir, key, 'runs.jsonl')
    if (existsSync(file)) projects.set(key, project(join(dir, key), key, readFileSync(file, 'utf8')))
  }
}

function project(dir: string, key: string, jsonl: string): object {
  // A label that ran again has more than one line: the last one counts.
  const byLabel = new Map<string, Run>()
  for (const line of jsonl.trim().split('\n')) {
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
        walls[pool]!.push(run.wall)
        const { testResults } = JSON.parse(gunzipSync(readFileSync(report)).toString())
        files.add(testResults.length)
        for (const file of testResults) if (file.status === 'failed') failed[pool]!.add(file.name)
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
  return { ...META[key], files: Math.max(...files), vitest: [...byLabel.values()][0]!.vitest, results }
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits))
}

console.log(
  JSON.stringify(
    {
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
      projects: Object.keys(META)
        .filter((key) => projects.has(key))
        .map((key) => projects.get(key)),
    },
    null,
    2,
  ),
)
