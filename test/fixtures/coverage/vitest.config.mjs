import { pool } from "../pool.mjs"

export default { test: { pool: pool(), coverage: { include: ["src/**"], reporter: ["json-summary", "json"] } } }
