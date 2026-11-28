import { fileURLToPath } from "node:url"
import { pool } from "../pool.mjs"

export default {
  test: {
    pool: pool(),
    execArgv: [
      "--require", fileURLToPath(new URL("./setup.cjs", import.meta.url)),
      // --import takes a URL: on Windows, an absolute path is not one.
      "--import", new URL("./setup.mjs", import.meta.url).href,
      "--expose-gc",
      "--conditions=custom",
    ],
  },
}
