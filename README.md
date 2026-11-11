# vitest-pool-fastforks

A [Vitest](https://vitest.dev/) pool that isolates every test file like the [`forks` pool](https://vitest.dev/config/pool#forks), and runs faster.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/results-dark.svg">
  <img alt="Bar charts of the wall time with forks and with this pool, one for each project and one for a synthetic suite, with 16 vCPUs and with 4 vCPUs. With 16 vCPUs, this pool is 1.04× to 2.47× faster per project. With 4 vCPUs, it is 1.04× slower to 2.24× faster per project. On the synthetic suite of 500 test files, it is 2.62× faster with 16 vCPUs and 3.43× faster with 4 vCPUs. The Results section has the same numbers in a table." src="docs/results-light.svg" width="800">
</picture>

> [!WARNING]
> This pool is experimental. Use it with Vitest's `forks` pool as the reference: if a test behaves differently, please report it.

## How it works

The `forks` pool starts a new Node.js process for every test file. This pool starts fewer processes and reuses them. In a process, each test file runs in a new [Node.js environment](https://nodejs.org/api/embedding.html): a second instance of Node.js in the same process, with its own global object, module cache, `process` object, and timers. When the file ends, the pool frees the environment and resets the working directory, the environment variables, and the umask. The next file starts in a new environment.

A new environment is faster to create than a new process, and the process keeps the compiled code of Vitest and of your dependencies.

## Requirements

- Node.js v26.11.0 or later. Earlier versions cannot run more than one environment in a process ([nodejs/node#65977](https://github.com/nodejs/node/pull/65977), [nodejs/node#66239](https://github.com/nodejs/node/pull/66239)).
- Vitest 4.0 or later, before 6.0.
- A prebuilt [native addon](https://nodejs.org/api/addons.html) for your platform: Linux (x64 and arm64, glibc and musl), macOS (arm64 and x64), and Windows (x64).

If one of these is missing, the pool prints a warning and uses Vitest's `forks` pool instead, so your tests still run.

## Usage

```sh
npm install --save-dev vitest-pool-fastforks
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { fastForks } from 'vitest-pool-fastforks'

export default defineConfig({
  test: {
    pool: fastForks(),
  },
})
```

### Projects with their own config files

If [`test.projects`](https://vitest.dev/guide/projects) lists config files, for example `projects: ['packages/*/vitest.config.ts']`, Vitest does not apply the `pool` of the root config to those projects. Set `pool: fastForks()` in each project config file. Inline projects with `extends: true` use the `pool` of the root config.

## Options

```ts
fastForks({
  fallback: 'forks',
  snapshot: true,
  memoryLimit: '10%',
})
```

| Option        | Default                                                                                                                                                        | Description                                                                                                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fallback`    | `'forks'`                                                                                                                                                      | What to do when this pool cannot run (see [Requirements](#requirements)). `'forks'` prints a warning and uses the `forks` pool. `'error'` throws an error.                                                                                                                                          |
| `snapshot`    | `true`                                                                                                                                                         | Start the child processes from a [startup snapshot](https://nodejs.org/api/v8.html#startup-snapshot-api) that has the Node.js built-in modules that Vitest uses. The pool builds the snapshot on the first run (about 0.4 seconds) and keeps it in the temporary directory of the operating system. |
| `memoryLimit` | The memory of the system (half of it in watch mode) divided by the number of workers, like Vitest's [`vmMemoryLimit`](https://vitest.dev/config/vmmemorylimit) | When a child process uses more memory (RSS) than this after a test file, the pool stops it and starts a new one. Bytes, or a percentage of the memory of the system, such as `'10%'`.                                                                                                               |

To use the `forks` pool without changing the config, set the environment variable `VITEST_POOL_FASTFORKS=0`.

## Results

Seven open source projects and one synthetic suite, run with the `forks` pool and with this pool. Both pools gave the same test results. The only differences were tests that are flaky with both pools, and two tests in Vitest's own suite that run only when the pool is named `forks`.

- Machine: a virtual machine with 16 vCPUs (AMD EPYC, no SMT) and 31 GiB of memory, Linux.
- Software: Node.js v26.13.0. Vitest 5.1.0, except mui-x (5.0.5).
- Method: the median wall time of 3 runs, in seconds.
- Conditions: "16 vCPUs" uses all CPUs. "4 vCPUs" limits the run to 4 CPUs (`taskset -c 0-3`), like a common CI runner. Both use Vitest's default number of workers (15 and 3), except readest, whose config sets `maxWorkers: 4`.

| Project                                                                                                        | Test files | 16 vCPUs: forks → this pool | Speed-up | 4 vCPUs: forks → this pool | Speed-up |
| -------------------------------------------------------------------------------------------------------------- | ---------: | --------------------------: | -------: | -------------------------: | -------: |
| [readest](https://github.com/readest/readest)                                                                  |      1,265 |               351.8 → 142.3 |    2.47× |              423.0 → 198.5 |    2.13× |
| [Vuetify](https://github.com/vuetifyjs/vuetify)                                                                |         81 |                   9.6 → 6.1 |    1.59× |                31.8 → 14.2 |    2.24× |
| [Material UI](https://github.com/mui/material-ui)                                                              |        467 |                 64.2 → 43.5 |    1.48× |              222.8 → 110.6 |    2.01× |
| [Base UI](https://github.com/mui/base-ui)                                                                      |        394 |                 91.3 → 64.3 |    1.42× |              325.7 → 219.6 |    1.48× |
| [MUI X](https://github.com/mui/mui-x)                                                                          |        996 |               420.8 → 306.7 |    1.37× |            1,254.2 → 781.2 |    1.61× |
| [Vitest](https://github.com/vitest-dev/vitest) (`test/unit`)                                                   |        217 |                   6.6 → 5.6 |    1.18× |                23.1 → 13.7 |    1.69× |
| [Instructure UI](https://github.com/instructure/instructure-ui) (Node tests)                                   |         20 |                   4.6 → 4.4 |    1.04× |                  3.8 → 4.0 |    0.96× |
| [js-test-runner-competition](https://github.com/ubugeeei-reproductions/js-test-runner-competition) (synthetic) |        500 |                 29.1 → 11.1 |    2.62× |               109.3 → 31.9 |    3.43× |

The speed-up is largest when a project has many small test files, because then the start of each file takes most of the time. The synthetic suite is an example: [js-test-runner-competition](https://github.com/ubugeeei-reproductions/js-test-runner-competition) (commit `fb868f3`) generates 500 test files with 10 tests each in `fixture/tests/nomock/`, and they run with [happy-dom](https://github.com/capricorn86/happy-dom).

## What stays the same as `forks`

- Each test file gets new globals, a new module graph, and a new `process` object.
- Changes to `process.env`, the working directory, and the umask do not leak into the next test file.
- `process.exit()` in a test, a crash of the process, and unhandled errors are reported the same way.
- `process.argv`, `process.execArgv`, `process.send`, and `worker_threads.isMainThread` and `threadId` have the same values.
- [`execArgv`](https://vitest.dev/config/execargv) (including `--require` and `--import`), `env`, and the other per-project options.
- Watch mode, and [coverage](https://vitest.dev/guide/coverage) with the `v8` and `istanbul` providers (the same coverage data).

## Differences from `forks`

- Test files that run in the same child process see the same `process.pid`.
- Modules that you load with `--require` or `--import` in `execArgv` also run once when a child process starts, before its first test file.
- `--cpu-prof` and `--heap-prof` write one profile per child process, not one per test file.
- The test files in a child process share its memory, its garbage collection, `process.uptime()`, and the V8 flags that a test sets with `v8.setFlagsFromString()`.
- For the files in `node_modules` that Node.js loads (not the files that Vite transforms), the pool keeps the source in memory for all test files in a child process. If a test changes a file in `node_modules` and loads it again, it gets the earlier content.

## Limitations

- **Coverage with the `v8` provider is not faster than `forks`.** The environments share compiled code, and coverage counts would be wrong, so the pool turns off the V8 compilation cache when the `v8` provider is on. The `istanbul` provider is not affected.
- **Debugging** (`--inspect`, `--inspect-brk`) uses a new process for each test file, like `forks`, because an environment has no debugger connection.
- **Few, long test files** gain little. In Instructure UI above (20 files), the run time is mostly the tests themselves.
- **Native addons** that do not support more than one context in a process (addons that use `NODE_MODULE()` instead of [`NODE_MODULE_INIT()`](https://nodejs.org/api/addons.html#context-aware-addons)) may fail to load in the second test file of a child process.
- The [`threads`](https://vitest.dev/config/pool#threads), [`vmThreads`](https://vitest.dev/config/pool#vmthreads), and [`vmForks`](https://vitest.dev/config/pool#vmforks) pools are not changed. This pool replaces only `forks`.

## Choosing a pool

`vmForks` and [`isolate: false`](https://vitest.dev/config/isolate) can be faster than this pool. They run the test files in a way that differs from `forks`, and in the projects above, some tests that pass with `forks` failed with them (for example, 83 and 537 test files in readest). Use this pool if you want the results of `forks` in less time.

## Troubleshooting

- **The pool prints `Using the "forks" pool instead`.** The message tells you which requirement is missing. Use `fallback: 'error'` to make it an error, for example in CI.
- **A test fails only with this pool.** Run it with the `forks` pool (`VITEST_POOL_FASTFORKS=0`) to confirm, and report it with the test and the error.
- **`A child process exited ... Starting the file in a new child process.`** A child process stopped before a test file started (for example, it crashed because of an earlier file). The pool runs the file in a new child process, so the result is not lost.

## Development

You need Node.js v26.11.0 or later, Python, a C++ compiler (for the native addon), and clang-format 21 (to format the addon). If you use Nix with direnv, run `direnv allow` to get them from `flake.nix`.

```sh
npm ci
npm run build:js      # Build dist/ with vp pack.
npm run build         # Build the native addon with node-gyp.
npm run check         # Format, lint, and type check with vp check.
npm run check:cc      # Check the format of the addon with clang-format.
npm run test:unit     # Unit tests with vp test.
npm test              # Run each fixture with forks and with this pool, and compare.
node test/watch.mjs   # Compare watch mode.
```

The chart at the top of this README comes from `scripts/results-chart.ts`. After you change the numbers in it, run `node scripts/results-chart.ts`.

## License

MIT
