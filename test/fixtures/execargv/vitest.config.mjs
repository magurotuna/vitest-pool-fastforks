import { fileURLToPath } from "node:url"
import { pool } from "../pool.mjs"

export default {
  test: {
    pool: pool(),
    execArgv: [
      "--require", fileURLToPath(new URL("./setup.cjs", import.meta.url)),
      "--import", fileURLToPath(new URL("./setup.mjs", import.meta.url)),
      "--expose-gc",
      "--conditions=custom",
    ],
  },
}
