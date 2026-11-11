// Draws the speed-up chart of the README: docs/speed-light.svg and
// docs/speed-dark.svg. The numbers are the ones in the README table.
//
// Usage: node scripts/speed-chart.ts
import { mkdirSync, writeFileSync } from 'node:fs'

interface Row {
  name: string
  files: string
  /** Speed-up with 16 vCPUs, then with 4 vCPUs. */
  speedUp: [number, number]
}

const rows: Row[] = [
  { name: 'readest', files: '1,265', speedUp: [2.47, 2.13] },
  { name: 'Vuetify', files: '81', speedUp: [1.59, 2.24] },
  { name: 'Material UI', files: '467', speedUp: [1.48, 2.01] },
  { name: 'Base UI', files: '394', speedUp: [1.42, 1.48] },
  { name: 'MUI X', files: '996', speedUp: [1.37, 1.61] },
  { name: 'Vitest (test/unit)', files: '217', speedUp: [1.18, 1.69] },
  { name: 'Instructure UI', files: '20', speedUp: [1.04, 0.96] },
]
const total: Row = { name: 'All 7 projects', files: '3,440', speedUp: [1.66, 1.7] }
const series = ['16 vCPUs (Vitest’s default workers)', '4 vCPUs (like a CI runner)']

const themes = {
  light: {
    surface: '#fcfcfb',
    primary: '#0b0b0b',
    secondary: '#52514e',
    muted: '#898781',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    border: 'rgba(11,11,11,0.10)',
    series: ['#2a78d6', '#eb6834'],
  },
  dark: {
    surface: '#1a1a19',
    primary: '#f0efec',
    secondary: '#c3c2b7',
    muted: '#898781',
    grid: '#2c2c2a',
    axis: '#383835',
    border: 'rgba(255,255,255,0.10)',
    series: ['#3987e5', '#d95926'],
  },
}

const WIDTH = 760
const PLOT_X = 200
const PLOT_WIDTH = 500
const MAX = 2.5
const TICKS = [0, 0.5, 1, 1.5, 2, 2.5]
const PLOT_TOP = 120
const ROW = 46
const BAR = 14
const GAP = 2
const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Helvetica, Arial, sans-serif'

const x = (value: number): number => PLOT_X + (value / MAX) * PLOT_WIDTH
const times = (value: number): string => `${value.toFixed(2)}×`

// A bar from the baseline, with a 4px round end at the value.
function bar(y: number, value: number, fill: string): string {
  const end = x(value)
  const r = 4
  return `<path fill="${fill}" d="M${PLOT_X} ${y}H${end - r}A${r} ${r} 0 0 1 ${end} ${y + r}V${y + BAR - r}A${r} ${r} 0 0 1 ${end - r} ${y + BAR}H${PLOT_X}Z"/>`
}

function text(
  px: number,
  py: number,
  content: string,
  { size = 13, fill = '', weight = 400, anchor = 'start', halo = '' } = {},
): string {
  // A halo in the surface color keeps a label readable over a gridline.
  const stroke = halo ? ` stroke="${halo}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"` : ''
  return `<text x="${px}" y="${py}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${stroke}>${content}</text>`
}

function draw(theme: (typeof themes)['light']): string {
  const all = [...rows, total]
  const plotBottom = PLOT_TOP + all.length * ROW + 8
  const height = plotBottom + 52
  const parts: string[] = []
  parts.push(
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="8" fill="${theme.surface}" stroke="${theme.border}"/>`,
  )
  parts.push(text(24, 36, 'Speed-up over the forks pool', { size: 17, weight: 600, fill: theme.primary }))
  parts.push(
    text(
      24,
      58,
      'Higher is better. 1× takes the same time as forks. Median of 3 runs. Both pools gave the same test results.',
      { size: 12.5, fill: theme.secondary },
    ),
  )
  let legendX = 24
  series.forEach((label, i) => {
    parts.push(`<rect x="${legendX}" y="76" width="12" height="12" rx="3" fill="${theme.series[i]}"/>`)
    parts.push(text(legendX + 18, 86.5, label, { size: 12.5, fill: theme.primary }))
    legendX += 18 + label.length * 7 + 28
  })

  for (const tick of TICKS) {
    const color = tick === 1 ? theme.axis : theme.grid
    parts.push(
      `<line x1="${x(tick)}" x2="${x(tick)}" y1="${PLOT_TOP}" y2="${plotBottom}" stroke="${color}" stroke-width="1"/>`,
    )
    parts.push(text(x(tick), plotBottom + 18, `${tick}×`, { size: 11.5, fill: theme.muted, anchor: 'middle' }))
  }
  parts.push(text(x(1), PLOT_TOP - 8, 'forks', { size: 11.5, fill: theme.secondary, anchor: 'middle' }))

  all.forEach((row, i) => {
    const top = PLOT_TOP + i * ROW + (row === total ? 8 : 0)
    if (row === total) {
      parts.push(`<line x1="24" x2="${WIDTH - 24}" y1="${top - 4}" y2="${top - 4}" stroke="${theme.axis}"/>`)
    }
    const weight = row === total ? 600 : 400
    parts.push(text(24, top + 20, row.name, { size: 13, weight, fill: theme.primary }))
    parts.push(text(24, top + 36, `${row.files} test files`, { size: 11.5, fill: theme.muted }))
    row.speedUp.forEach((value, s) => {
      const y = top + 8 + s * (BAR + GAP)
      parts.push(bar(y, value, theme.series[s]!))
      parts.push(
        text(x(value) + 6, y + BAR - 2.5, times(value), { size: 12, weight, fill: theme.primary, halo: theme.surface }),
      )
    })
  })

  const description = all
    .map((row) => `${row.name}: ${times(row.speedUp[0])} with 16 vCPUs, ${times(row.speedUp[1])} with 4 vCPUs`)
    .join('. ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" font-family="${FONT}">
<title>Speed-up over the forks pool</title>
<desc>${description}.</desc>
${parts.join('\n')}
</svg>
`
}

const dir = new URL('../docs/', import.meta.url)
mkdirSync(dir, { recursive: true })
for (const [name, theme] of Object.entries(themes)) {
  writeFileSync(new URL(`speed-${name}.svg`, dir), draw(theme))
}
