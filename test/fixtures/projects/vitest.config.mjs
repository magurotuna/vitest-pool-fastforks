import { pool } from "../pool.mjs"

export default {
  test: {
    pool: pool(),
    projects: [
      { extends: true, test: { name: "a", env: { WHICH: "a" }, include: ["a.test.ts"] } },
      { extends: true, test: { name: "b", env: { WHICH: "b" }, execArgv: ["--expose-gc"], include: ["b.test.ts"] } },
    ],
  },
}
