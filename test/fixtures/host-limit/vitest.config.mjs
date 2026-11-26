import { pool } from "../pool.mjs"

// The project has fewer workers than the root config. test/run.mjs checks
// that this pool uses the maxWorkers of the project.
export default {
  test: {
    pool: pool(),
    maxWorkers: 4,
    projects: [{ extends: true, test: { name: "host-limit", maxWorkers: 2 } }],
  },
}
