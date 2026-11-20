// Writes the results from docs/results.json (bench/summarize.ts) into the
// README: the chart (docs/results-light.svg and docs/results-dark.svg), its
// alt text, and the part of the Results section between the results markers.
//
// Usage: node scripts/results-chart.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

interface Project {
  name: string
  url: string
  scope?: string
  synthetic?: boolean
  workers?: string
  files: number
  vitest: string
  /** All CPUs, then fewer CPUs. Wall times in seconds. */
  results: { cpus: number; forks: number; fastforks: number; speedUp: number }[]
}

interface Results {
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

interface Run {
  /** Wall time in seconds with forks, then with this pool. */
  seconds: [number, number]
  /** forks time / this pool time, from the unrounded medians. */
  speedUp: number
}

interface Row {
  name: string
  /** A second line under the name. */
  note?: string
  files: string
  runs: [Run, Run]
}

const results: Results = JSON.parse(readFileSync(new URL('../docs/results.json', import.meta.url), 'utf8'))
const toRow = (p: Project): Row => ({
  name: p.synthetic ? 'Synthetic suite' : p.scope ? `${p.name} (${p.scope.replaceAll('`', '')})` : p.name,
  note: p.synthetic ? p.name : undefined,
  files: p.files.toLocaleString('en-US'),
  runs: p.results.map((r) => ({ seconds: [r.forks, r.fastforks], speedUp: r.speedUp })) as [Run, Run],
})
const rows = results.projects.filter((p) => !p.synthetic).map(toRow)
const synthetic = results.projects.filter((p) => p.synthetic).map(toRow)
const columns = results.projects[0]!.results.map((r) => `${r.cpus} vCPUs`)

const themes = {
  light: {
    surface: '#fcfcfb',
    primary: '#0b0b0b',
    secondary: '#52514e',
    muted: '#898781',
    rule: '#e1e0d9',
    axis: '#c3c2b7',
    border: 'rgba(11,11,11,0.10)',
    forks: '#898781',
    pool: '#2a78d6',
  },
  dark: {
    surface: '#1a1a19',
    primary: '#f0efec',
    secondary: '#c3c2b7',
    muted: '#898781',
    rule: '#2c2c2a',
    axis: '#383835',
    border: 'rgba(255,255,255,0.10)',
    forks: '#6b6a65',
    pool: '#3987e5',
  },
}
type Theme = (typeof themes)['light']

const WIDTH = 800
const MARGIN = 24
const CELL_X = [210, 510]
const BAR_MAX = 200
const BAR = 14
const GAP = 4
const TOP = 150
const ROW = 84
const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Helvetica, Arial, sans-serif'

const seconds = (value: number): string =>
  `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
const ratio = (speedUp: number): string =>
  speedUp >= 1 ? `${speedUp.toFixed(2)}× faster` : `${(1 / speedUp).toFixed(2)}× slower`

// A bar from the baseline, with a 4px round end at the value.
function bar(x: number, y: number, length: number, fill: string): string {
  const end = x + length
  const r = Math.min(4, length / 2)
  return `<path fill="${fill}" d="M${x} ${y}H${end - r}A${r} ${r} 0 0 1 ${end} ${y + r}V${y + BAR - r}A${r} ${r} 0 0 1 ${end - r} ${y + BAR}H${x}Z"/>`
}

function text(
  x: number,
  y: number,
  content: string,
  { size = 13, fill = '', weight = 400, anchor = 'start' } = {},
): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${content}</text>`
}

function draw(theme: Theme): string {
  const all = [...rows, ...synthetic]
  const bottom = TOP + all.length * ROW + 8
  const height = bottom + 16
  const parts: string[] = []
  parts.push(
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="8" fill="${theme.surface}" stroke="${theme.border}"/>`,
  )
  parts.push(
    text(MARGIN, 36, 'Wall time of the test run: forks and this pool', { size: 17, weight: 600, fill: theme.primary }),
  )
  parts.push(
    text(MARGIN, 58, `Shorter is better. Median of ${results.runs} runs.`, {
      size: 12.5,
      fill: theme.secondary,
    }),
  )
  parts.push(`<rect x="${MARGIN}" y="74" width="12" height="12" rx="3" fill="${theme.forks}"/>`)
  parts.push(text(MARGIN + 18, 84.5, "forks (Vitest's default)", { size: 12.5, fill: theme.primary }))
  parts.push(`<rect x="${MARGIN + 166}" y="74" width="12" height="12" rx="3" fill="${theme.pool}"/>`)
  parts.push(text(MARGIN + 184, 84.5, 'vitest-pool-fastforks', { size: 12.5, weight: 600, fill: theme.primary }))

  columns.forEach((title, c) => {
    parts.push(text(CELL_X[c]!, 124, title, { size: 13.5, weight: 600, fill: theme.primary }))
  })
  parts.push(`<line x1="${MARGIN}" x2="${WIDTH - MARGIN}" y1="${TOP - 10}" y2="${TOP - 10}" stroke="${theme.axis}"/>`)

  all.forEach((row, i) => {
    const top = TOP + i * ROW
    if (i > 0) {
      const color = row === synthetic[0] ? theme.axis : theme.rule
      parts.push(`<line x1="${MARGIN}" x2="${WIDTH - MARGIN}" y1="${top - 6}" y2="${top - 6}" stroke="${color}"/>`)
    }
    parts.push(text(MARGIN, top + 22, row.name, { size: 14, weight: 600, fill: theme.primary }))
    if (row.note) {
      parts.push(text(MARGIN, top + 40, row.note, { size: 12, fill: theme.secondary }))
    }
    parts.push(text(MARGIN, top + (row.note ? 57 : 40), `${row.files} test files`, { size: 12, fill: theme.muted }))
    // One time scale per project, so that both columns of a row compare.
    const max = Math.max(...row.runs.flatMap((run) => run.seconds))
    row.runs.forEach((run, c) => {
      const x = CELL_X[c]!
      parts.push(`<line x1="${x}" x2="${x}" y1="${top + 6}" y2="${top + 12 + 2 * BAR + GAP}" stroke="${theme.axis}"/>`)
      run.seconds.forEach((value, s) => {
        const y = top + 9 + s * (BAR + GAP)
        const length = (value / max) * BAR_MAX
        parts.push(bar(x, y, length, s === 0 ? theme.forks : theme.pool))
        parts.push(
          text(x + length + 6, y + BAR - 2.5, seconds(value), {
            size: 12,
            weight: s === 1 ? 600 : 400,
            fill: s === 1 ? theme.primary : theme.secondary,
          }),
        )
      })
      parts.push(text(x, top + 66, ratio(run.speedUp), { size: 13, weight: 600, fill: theme.primary }))
    })
  })

  const description = all
    .map((row) =>
      row.runs
        .map(
          (run, c) =>
            `${row.note ? `${row.name} (${row.note})` : row.name}, ${columns[c]}: forks ${seconds(run.seconds[0])}, this pool ${seconds(run.seconds[1])}, ${ratio(run.speedUp)}`,
        )
        .join('. '),
    )
    .join('. ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" font-family="${FONT}">
<title>Wall time of the test run: forks and this pool</title>
<desc>${description}.</desc>
${parts.join('\n')}
</svg>
`
}

const dir = new URL('../docs/', import.meta.url)
mkdirSync(dir, { recursive: true })
for (const [name, theme] of Object.entries(themes)) {
  writeFileSync(new URL(`results-${name}.svg`, dir), draw(theme))
}

// The README: the alt text of the chart, and the part between the markers.
const range = (values: number[]): string => {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const low = min >= 1 ? min.toFixed(2) : `${(1 / min).toFixed(2)}× slower`
  return min >= 1 ? `${low}× to ${max.toFixed(2)}× faster` : `${low} to ${max.toFixed(2)}× faster`
}
const real = results.projects.filter((p) => !p.synthetic)
const synth = results.projects.filter((p) => p.synthetic)
const alt = [
  `Bar charts of the wall time with forks and with this pool, one for each project${synth.length ? ' and one for a synthetic suite' : ''}, with ${columns.join(' and with ')}.`,
  ...columns.map(
    (column, c) =>
      `With ${column}, ${c === 0 ? 'this pool' : 'it'} is ${range(real.map((p) => p.results[c]!.speedUp))} per project.`,
  ),
  ...synth.map(
    (p) =>
      `On the synthetic suite of ${p.files.toLocaleString('en-US')} test files, it is ${columns.map((column, c) => `${p.results[c]!.speedUp.toFixed(2)}× faster with ${column}`).join(' and ')}.`,
  ),
  'The Results section has the same numbers in a table.',
].join(' ')

const { machine } = results
const [all, limited] = results.projects[0]!.results.map((r) => r.cpus) as [number, number]
const versions = new Map<string, string[]>()
for (const p of results.projects) versions.set(p.vitest, [...(versions.get(p.vitest) ?? []), p.name])
const [common] = [...versions].sort((a, b) => b[1].length - a[1].length)[0]!
const others = [...versions].filter(([v]) => v !== common).map(([v, names]) => `${names.join(', ')}: ${v}`)
const workers = results.projects.filter((p) => p.workers).map((p) => `${p.name}, ${p.workers}`)
const list = (items: string[]): string =>
  items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
const setup = [
  `- Machine: ${machine.description} with ${all} vCPUs (${machine.cpu}${machine.smt ? '' : ', no SMT'}) and ${machine.memoryGiB} GiB of memory, ${machine.os}.`,
  `- Software: ${list([...(machine.package ? [`vitest-pool-fastforks ${machine.package}`] : []), `Node.js ${machine.node}`, `Vitest ${common}${others.length ? ` (${others.join('; ')})` : ''}`])}.`,
  `- Method: the median wall time of ${results.runs} runs, in seconds${machine.date ? `, measured on ${machine.date}` : ''}.`,
  `- Conditions: "${all} vCPUs" uses all CPUs. "${limited} vCPUs" limits the run to ${limited} CPUs (\`taskset -c 0-${limited - 1}\`), like a common CI runner. Both use Vitest's default number of workers (${all - 1} and ${limited - 1})${workers.length ? `, except ${workers.join(', and ')}` : ''}.`,
]
const seconds1 = (value: number): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const table = [
  ['Project', 'Test files', ...columns.flatMap((column) => [`${column}: forks → this pool`, 'Speed-up'])],
  ...results.projects.map((p) => [
    `[${p.name}](${p.url})${p.scope ? ` (${p.scope})` : ''}${p.synthetic ? ' (synthetic)' : ''}`,
    p.files.toLocaleString('en-US'),
    ...p.results.flatMap((r) => [`${seconds1(r.forks)} → ${seconds1(r.fastforks)}`, `${r.speedUp.toFixed(2)}×`]),
  ]),
]
// Padded as the formatter of vp check pads a table: the first column to the
// left, the others to the right.
const width = table[0]!.map((_, c) => Math.max(...table.map((cells) => cells[c]!.length)))
const pad = (cell: string, c: number): string =>
  c === 0 ? cell + ' '.repeat(width[c]! - cell.length) : ' '.repeat(width[c]! - cell.length) + cell
const line = (cells: string[]): string => `| ${cells.map(pad).join(' | ')} |`
const markdown = [
  ...setup,
  '',
  line(table[0]!),
  `| ${width.map((w, c) => (c === 0 ? '-'.repeat(w) : `${'-'.repeat(w - 1)}:`)).join(' | ')} |`,
  ...table.slice(1).map(line),
].join('\n')

const readmeUrl = new URL('../README.md', import.meta.url)
let readme = readFileSync(readmeUrl, 'utf8')
const START = '<!-- results:start -->'
const END = '<!-- results:end -->'
if (!readme.includes(START) || !readme.includes(END)) throw new Error(`README.md needs ${START} and ${END}`)
readme =
  readme.slice(0, readme.indexOf(START) + START.length) + `\n\n${markdown}\n\n` + readme.slice(readme.indexOf(END))
readme = readme.replace(/(<img alt=")[^"]*(" src="docs\/results-light\.svg")/, (_, a, b) => `${a}${alt}${b}`)
writeFileSync(readmeUrl, readme)
