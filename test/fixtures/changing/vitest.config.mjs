import { pool } from "../pool.mjs"

export default { test: { pool: pool(), globalSetup: "./setup.mjs" } }
