// The project's root config. The projects are separate config files, and the
// root `test.pool` does not reach them, so each one has a bench variant next
// to it (vitest.bench.config.*, made by bench/projects/mui-x.sh) that sets the pool
// from BENCH_POOL. The root config selects the projects from BROWSER: without
// BROWSER=true, it lists the jsdom and node projects (no browser projects).
import base from './vitest.config.mts'
import { benchProject } from './vitest.bench.shared.mts'

const config = benchProject(base, import.meta.url)
config.test.projects = base.test.projects.map((p: string) => p.replace('/vitest.config.', '/vitest.bench.config.'))

export default config
