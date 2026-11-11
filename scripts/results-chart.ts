// Draws the results chart of the README: docs/results-light.svg and
// docs/results-dark.svg. The numbers are the ones in the README table.
//
// Usage: node scripts/results-chart.ts
import { mkdirSync, writeFileSync } from 'node:fs'

interface Run {
  /** Wall time in seconds with forks, then with this pool. */
  seconds: [number, number]
  /** forks time / this pool time, from the unrounded medians. */
  speedUp: number
}

interface Row {
  name: string
  files: string
  /** 16 vCPUs, then 4 vCPUs. */
  runs: [Run, Run]
}

const rows: Row[] = [
  {
    name: 'readest',
    files: '1,265',
    runs: [
      { seconds: [351.8, 142.3], speedUp: 2.47 },
      { seconds: [423.0, 198.5], speedUp: 2.13 },
    ],
  },
  {
    name: 'Vuetify',
    files: '81',
    runs: [
      { seconds: [9.6, 6.1], speedUp: 1.59 },
      { seconds: [31.8, 14.2], speedUp: 2.24 },
    ],
  },
  {
    name: 'Material UI',
    files: '467',
    runs: [
      { seconds: [64.2, 43.5], speedUp: 1.48 },
      { seconds: [222.8, 110.6], speedUp: 2.01 },
    ],
  },
  {
    name: 'Base UI',
    files: '394',
    runs: [
      { seconds: [91.3, 64.3], speedUp: 1.42 },
      { seconds: [325.7, 219.6], speedUp: 1.48 },
    ],
  },
  {
    name: 'MUI X',
    files: '996',
    runs: [
      { seconds: [420.8, 306.7], speedUp: 1.37 },
      { seconds: [1254.2, 781.2], speedUp: 1.61 },
    ],
  },
  {
    name: 'Vitest (test/unit)',
    files: '217',
    runs: [
      { seconds: [6.6, 5.6], speedUp: 1.18 },
      { seconds: [23.1, 13.7], speedUp: 1.69 },
    ],
  },
  {
    name: 'Instructure UI',
    files: '20',
    runs: [
      { seconds: [4.6, 4.4], speedUp: 1.04 },
      { seconds: [3.8, 4.0], speedUp: 0.96 },
    ],
  },
]
const total: Row = {
  name: 'All 7 projects',
  files: '3,440',
  runs: [
    { seconds: [948.9, 572.9], speedUp: 1.66 },
    { seconds: [2284.4, 1341.8], speedUp: 1.7 },
  ],
}
const columns = [
  ['16 vCPUs', 'Vitest’s default workers'],
  ['4 vCPUs', 'like a CI runner'],
]

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
  const all = [...rows, total]
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
    text(MARGIN, 58, 'Shorter is better. Each project has its own time scale. Median of 3 runs.', {
      size: 12.5,
      fill: theme.secondary,
    }),
  )
  parts.push(`<rect x="${MARGIN}" y="74" width="12" height="12" rx="3" fill="${theme.forks}"/>`)
  parts.push(text(MARGIN + 18, 84.5, 'forks', { size: 12.5, fill: theme.primary }))
  parts.push(`<rect x="${MARGIN + 70}" y="74" width="12" height="12" rx="3" fill="${theme.pool}"/>`)
  parts.push(text(MARGIN + 88, 84.5, 'vitest-pool-fastforks', { size: 12.5, weight: 600, fill: theme.primary }))

  columns.forEach(([title, note], c) => {
    parts.push(text(CELL_X[c]!, 124, title!, { size: 13.5, weight: 600, fill: theme.primary }))
    parts.push(text(CELL_X[c]! + title!.length * 8 + 8, 124, note!, { size: 12.5, fill: theme.muted }))
  })
  parts.push(`<line x1="${MARGIN}" x2="${WIDTH - MARGIN}" y1="${TOP - 10}" y2="${TOP - 10}" stroke="${theme.axis}"/>`)

  all.forEach((row, i) => {
    const top = TOP + i * ROW
    if (i > 0) {
      const color = row === total ? theme.axis : theme.rule
      parts.push(`<line x1="${MARGIN}" x2="${WIDTH - MARGIN}" y1="${top - 6}" y2="${top - 6}" stroke="${color}"/>`)
    }
    const weight = row === total ? 600 : 400
    parts.push(text(MARGIN, top + 22, row.name, { size: 14, weight: 600, fill: theme.primary }))
    parts.push(text(MARGIN, top + 40, `${row.files} test files`, { size: 12, fill: theme.muted }))
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
            weight: s === 1 ? 600 : weight,
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
            `${row.name}, ${columns[c]![0]}: forks ${seconds(run.seconds[0])}, this pool ${seconds(run.seconds[1])}, ${ratio(run.speedUp)}`,
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
