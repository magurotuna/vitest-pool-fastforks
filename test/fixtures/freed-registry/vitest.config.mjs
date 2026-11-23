import { pool } from "../pool.mjs"

// gc() runs a young-generation GC at a known point.
export default { test: { pool: pool(), execArgv: ["--expose-gc"] } }
