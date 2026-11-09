import { pool } from "../pool.mjs"

// 8 projects with different env, so each needs its own child processes.
export default {
  test: {
    pool: pool(),
    projects: Array.from({ length: 8 }, (_, i) => ({
      extends: true,
      test: { name: "p" + i, env: { PROJECT: String(i) }, include: ["*.test.ts"] },
    })),
  },
}
