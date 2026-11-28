import { fileURLToPath } from "node:url"
import { pool } from "../pool.mjs"

export default {
  test: {
    pool: pool(),
    execArgv: [
      "--require", fileURLToPath(new URL("./setup.cjs", import.meta.url)),
      // On Windows, --import takes a file: URL, not an absolute path.
      "--import", new URL("./setup.mjs", import.meta.url).href,
      "--expose-gc",
      "--conditions=custom",
    ],
  },
}
