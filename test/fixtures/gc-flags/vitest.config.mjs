import { pool } from "../pool.mjs"

// With these flags, the child process must not turn --expose-gc on and off:
// V8 aborts or exits, or the function of --expose-gc-as disappears. Each flag
// has its own project, so each one gets its own child process.
const flags = {
  freeze: "--freeze-flags-after-init",
  abort: "--abort-on-contradictory-flags",
  exit: "--exit-on-contradictory-flags",
  "expose-gc-as": "--expose-gc-as=collect",
}

export default {
  test: {
    pool: pool(),
    projects: Object.entries(flags).map(([name, flag]) => ({
      extends: true,
      test: { name, execArgv: [flag], env: { EXPOSED_AS: name === "expose-gc-as" ? "collect" : "" } },
    })),
  },
}
