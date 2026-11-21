// The test options for the pool in BENCH_POOL: forks or fastforks. The pool
// comes from @BENCH@/node_modules (bench/setup.sh), as after npm install. Do
// not import it by an absolute path: then Vite's config loader puts a copy of
// the pool into each project config file (MUI X), and each copy starts its
// own child processes.
import { fastForks } from 'vitest-pool-fastforks'

export function benchPool() {
  const pool = process.env.BENCH_POOL || 'forks'
  return { pool: pool === 'fastforks' ? fastForks({ fallback: 'error' }) : pool }
}
