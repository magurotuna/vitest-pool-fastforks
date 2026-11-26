# vitest-pool-fastforks

A [Vitest](https://vitest.dev/) pool that isolates every test file like the [`forks` pool](https://vitest.dev/config/pool#forks), and runs faster.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/results-dark.svg">
  <img alt="Bar charts of the wall time with forks and with this pool, one for each project and one for a synthetic suite, with 16 vCPUs and with 4 vCPUs. With 16 vCPUs, this pool is 1.07× slower to 2.27× faster per project. With 4 vCPUs, it is 1.02× to 1.95× faster per project. On the synthetic suite of 500 test files, it is 2.28× faster with 16 vCPUs and 2.73× faster with 4 vCPUs. The Results section has the same numbers in a table." src="docs/results-light.svg" width="800">
</picture>

> [!WARNING]
> This pool is experimental. Use it with Vitest's `forks` pool as the reference: if a test behaves differently, please report it.

## How it works

The `forks` pool starts a new Node.js process for every test file. This pool starts fewer processes and reuses them, usually one for each worker. In a process, each test file runs in a new [Node.js environment](https://nodejs.org/api/embedding.html): a second instance of Node.js in the same process, with its own global object, module cache, `process` object, and timers. When the file ends, the pool frees the environment and resets the working directory, the environment variables, and the umask. The next file starts in a new environment.

A new environment is faster to create than a new process, and the process keeps the compiled code of Vitest and of your dependencies.

## Requirements

- Node.js `^26.11.0` (v26.11.0 or later, but less than v27). Earlier versions cannot run more than one environment in a process ([nodejs/node#65977](https://github.com/nodejs/node/pull/65977), [nodejs/node#66239](https://github.com/nodejs/node/pull/66239)). The prebuilt addons are only for Node.js 26.
- Vitest 4.0.10 or later, before 6.0.
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
  inspector: false,
})
```

| Option        | Default                                                                                                                                                        | Description                                                                                                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fallback`    | `'forks'`                                                                                                                                                      | What to do when this pool cannot run (see [Requirements](#requirements)). `'forks'` prints a warning and uses the `forks` pool. `'error'` throws an error.                                                                                                                                          |
| `snapshot`    | `true`                                                                                                                                                         | Start the child processes from a [startup snapshot](https://nodejs.org/api/v8.html#startup-snapshot-api) that has the Node.js built-in modules that Vitest uses. The pool builds the snapshot on the first run (about 0.4 seconds) and keeps it in the temporary directory of the operating system. |
| `memoryLimit` | The memory of the system (half of it in watch mode) divided by the number of workers, like Vitest's [`vmMemoryLimit`](https://vitest.dev/config/vmmemorylimit) | When a child process uses more memory (RSS) than this after a test file, the pool stops it and starts a new one. Bytes, or a percentage of the memory of the system, such as `'10%'`.                                                                                                               |
| `inspector`   | `false`                                                                                                                                                        | Create each test file's environment with a V8 inspector, so that tests can use [`node:inspector`](https://nodejs.org/api/inspector.html). Like coverage with the `v8` provider, which always turns it on, this turns off the V8 compilation cache, so the run is slower.                            |

To use the `forks` pool without changing the config, set the environment variable `VITEST_POOL_FASTFORKS=0`.

## Results

Seven open source projects and one synthetic suite, run with the `forks` pool and with this pool. Both pools gave the same test results. The only differences were tests that fail at random, and two tests in Vitest's own suite that run only when the pool is named `forks`.

<!-- results:start -->

- Machine: a virtual machine with 16 vCPUs (AMD EPYC 9965 192-Core Processor, no SMT) and 31 GiB of memory, Linux.
- Software: vitest-pool-fastforks 0.1.3, Node.js v26.13.0, and Vitest 5.1.0 (MUI X: 5.0.5).
- Method: the median wall time of 3 runs, in seconds, measured on 2026-11-21.
- Conditions: "16 vCPUs" uses all CPUs. "4 vCPUs" limits the run to 4 CPUs (`taskset -c 0-3`), like a common CI runner. Both use Vitest's default number of workers (15 and 3), except readest, whose config sets `maxWorkers: 4`.

| Project                                                                                                        | Test files | 16 vCPUs: forks → this pool | Speed-up | 4 vCPUs: forks → this pool | Speed-up |
| -------------------------------------------------------------------------------------------------------------- | ---------: | --------------------------: | -------: | -------------------------: | -------: |
| [readest](https://github.com/readest/readest)                                                                  |      1,265 |                219.2 → 96.4 |    2.27× |              285.9 → 148.7 |    1.92× |
| [Vuetify](https://github.com/vuetifyjs/vuetify)                                                                |         81 |                   5.9 → 4.5 |    1.30× |                20.8 → 10.7 |    1.95× |
| [Material UI](https://github.com/mui/material-ui)                                                              |        467 |                 38.8 → 27.0 |    1.44× |               146.3 → 78.7 |    1.86× |
| [Base UI](https://github.com/mui/base-ui)                                                                      |        394 |                 55.1 → 43.2 |    1.27× |              224.8 → 157.3 |    1.43× |
| [MUI X](https://github.com/mui/mui-x)                                                                          |        996 |               233.7 → 173.3 |    1.35× |              812.2 → 519.4 |    1.56× |
| [Vitest](https://github.com/vitest-dev/vitest) (`test/unit`)                                                   |        217 |                   4.7 → 3.8 |    1.25× |                16.7 → 10.6 |    1.57× |
| [Instructure UI](https://github.com/instructure/instructure-ui) (Node tests)                                   |         20 |                   3.0 → 3.2 |    0.93× |                  3.0 → 3.0 |    1.02× |
| [js-test-runner-competition](https://github.com/ubugeeei-reproductions/js-test-runner-competition) (synthetic) |        500 |                  19.0 → 8.3 |    2.28× |                74.8 → 27.4 |    2.73× |

<!-- results:end -->

The speed-up is largest when a project has many small test files, because then the start of each file takes most of the time. The synthetic suite is an example: [js-test-runner-competition](https://github.com/ubugeeei-reproductions/js-test-runner-competition) (commit `fb868f3`) generates 500 test files with 10 tests each in `fixture/tests/nomock/`, and they run with [happy-dom](https://github.com/capricorn86/happy-dom).

## What stays the same as `forks`

- Each test file gets new globals, a new module graph, and a new `process` object.
- Changes to `process.env`, the working directory, and the umask do not leak into the next test file.
- `process.exit()` in a test, a crash of the process, and unhandled errors during a test file are reported the same way.
- `process.argv`, `process.execArgv`, `process.send`, and `worker_threads.isMainThread` and `threadId` have the same values.
- [`execArgv`](https://vitest.dev/config/execargv) (including `--require` and `--import`), `env`, and the other per-project options.
- Watch mode, and [coverage](https://vitest.dev/guide/coverage) with the `v8` and `istanbul` providers (the same coverage data).

## Differences from `forks`

- Test files that run in the same child process see the same `process.pid`.
- Modules that you load with `--require` or `--import` in `execArgv` also run once when a child process starts, before its first test file.
- `--cpu-prof` and `--heap-prof` write one profile per child process, not one per test file.
- The test files in a child process share its memory, its garbage collection, `process.uptime()`, and the V8 flags that a test sets with `v8.setFlagsFromString()`.
- Timing can differ from `forks`. A garbage collection can come at another point in a test file. A child process keeps the compiled code of earlier test files, so it can hold more than 16 MiB of executable memory. V8 can then compile new regular expressions with fewer optimizations, and a long match can take several times longer. A test that waits a fixed time or compares two timings can fail with this pool. Make such a test wait for the result, or run it in a separate [project](https://vitest.dev/guide/projects) with `pool: 'forks'`.
- The `exit` and `beforeExit` listeners of a test file do not run. With `forks`, they run only if the process ends before Vitest stops it. So an error in such a listener can fail some runs with `forks`, but no run with this pool. For cleanup, use `afterAll`.
- A timer that a test file leaves behind can throw an error after the file ends. Vitest reports the error only until it stops listening to the file. Both pools can miss these errors, and this pool can miss more of them than `forks`. To find these timers, run Vitest 4.1 or later with `--detectAsyncLeaks`.
- The pool caches the modules in `node_modules` for all test files in a child process, so later test files do not read them again. It caches only files that did not change after Vitest started, and it clears the cache at each run. A test file can still get an old version of a file in these cases:
  - The file changes during a run, and a later test file in the same child process loads it.
  - The file system's clock is more than 2 seconds behind the system clock.
  - Test files see different file systems at one path, for example with a virtual file system.

## Limitations

- **Coverage with the `v8` provider is not faster than `forks`.** The environments share compiled code, and coverage counts would be wrong, so the pool turns off the V8 compilation cache when the `v8` provider is on. The `istanbul` provider is not affected.
- **Debugging** (`--inspect`, `--inspect-brk`) uses a new process for each test file, like `forks`, because an environment has no debugger connection.
- **Few, long test files** gain little, or run slightly slower. In Instructure UI above (20 files), the run time is mostly the tests themselves.
- **Native addons** can fail when a child process runs more than one test file. The `forks` pool starts a new process for each file, so it does not have these problems.
  - An addon that does not support more than one context in a process (an addon that uses `NODE_MODULE()` instead of [`NODE_MODULE_INIT()`](https://nodejs.org/api/addons.html#context-aware-addons)) may fail to load in the second test file of a child process.
  - An addon that does not clean up when its Node.js environment ends, as the [Node.js documentation](https://nodejs.org/api/addons.html#worker-support) describes, can cause a memory leak or a crash. The child process can keep the memory of each earlier test file (`re2` 1.27.0), or crash in a later test file (`isolated-vm` 7.0.1).
  - If an addon causes one of these problems, run the test files that use it in a separate [project](https://vitest.dev/guide/projects) with `pool: 'forks'`. For a memory leak, a lower `memoryLimit` also helps.
- The [`threads`](https://vitest.dev/config/pool#threads), [`vmThreads`](https://vitest.dev/config/pool#vmthreads), and [`vmForks`](https://vitest.dev/config/pool#vmforks) pools are not changed. This pool replaces only `forks`.

## Choosing a pool

`vmForks` and [`isolate: false`](https://vitest.dev/config/isolate) can be faster than this pool. They run the test files in a way that differs from `forks`, and in the projects above, some tests that pass with `forks` failed with them (for example, 83 and 537 test files in readest). Use this pool if you want the results of `forks` in less time.

## Troubleshooting

- **The pool prints `Using the "forks" pool instead`.** The message tells you which requirement is missing. Use `fallback: 'error'` to make it an error, for example in CI.
- **A test that uses `node:inspector` fails.** The error is `This Environment was initialized without a V8::Inspector`, or a library catches that error and returns an empty result. Set `inspector: true`. The inspector then also reports the scripts of the earlier test files in the child process.
- **A test fails only with this pool.** Run it with the `forks` pool (`VITEST_POOL_FASTFORKS=0`) to confirm, and report it with the test and the error.
- **`A child process exited ... Starting the file in a new child process.`** A child process stopped before a test file started (for example, it crashed because of an earlier file). The pool runs the file in a new child process, so the result is not lost.
- **A test file fails with `Worker exited unexpectedly`, but passes with `forks`.** An earlier test file in the same child process may have caused the crash, for example through a native addon. See the native addons item in [Limitations](#limitations).

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
node test/close.mjs   # Check that closing Vitest stops the child processes.
node test/addon.mjs   # Check the native addon without Vitest.
```

### Benchmark

The numbers in [Results](#results) come from `bench/`. It needs a Debian machine with 16 CPUs, 32 GiB of memory, and 100 GB of disk, with nothing else running. Everything goes to `/data/fastforks` (set `BENCH` to change it).

1. Clone this repository on the machine, and check out the commit to measure.
2. Run `bash bench/setup.sh`. It installs Node.js, builds this package, and sets up each project at a fixed commit.
3. Run `bash bench/bench.sh`. It takes about 6 hours, and writes `/data/fastforks/raw/<time>/results.json`. It prints a warning if a file fails with only one pool. Check each warning before you use the numbers.
4. On your computer, copy `results.json` to `docs/results.json` in a checkout of this repository. Then run `npm ci`, `npx vp fmt docs/results.json`, and `node scripts/results-chart.ts`. The script writes the chart and the numbers in the Results section.

### Releases

1. Open a pull request that sets the version in `package.json` and `package-lock.json`. The body of the pull request becomes the release note, so write it for users.
2. Merge the pull request. `release.yml` creates the tag, and `prebuild.yml` builds and tests the package on each platform and stages the version on npm.
3. Approve the `publish` job on GitHub, and then approve the staged version on npmjs.com with 2FA.
4. Publish the draft GitHub Release that the `release` job created.

A `v*` tag cannot be deleted. If the release run fails because of a bug, fix the bug and release the next version. If the tag exists but no `prebuild.yml` run started, run `gh workflow run prebuild.yml --ref v<version> -f platforms=all`.

## License

MIT
