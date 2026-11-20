// Gives every test project the same options, for example the pool from
// BENCH_POOL. A project that has its own config file does not get the `test`
// options of the root config, so each config file in `projects` becomes an
// inline project that extends the file. An inline project does not take
// `name` and `root` from the file that it extends, so they are read from the
// file and set again (with the same rules as Vitest).
import { existsSync, readFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

// Vitest's names for project config files.
const CONFIG_FILE = /^vite(?:st)?(?:\.[\w-]+)?\.config\./

/**
 * @param {unknown[]} projects `test.projects` of the project's config.
 * @param {object} o
 * @param {string} o.root The directory of the project's config.
 * @param {(file: string) => Promise<any>} o.importConfig `(file) => import(file)`,
 *   called in the bench config so that Vite loads the file.
 * @param {object} o.test `test` options for every project.
 * @param {object} [o.top] Top-level options for every project (`cacheDir`).
 * @param {string[]} [o.exclude] Test files to exclude, relative to `root`.
 */
export async function withOptions(projects, { root, importConfig, test, top = {}, exclude = [] }) {
  const result = []
  for (const project of projects) {
    // An inline project extends the bench config, which has the options.
    if (typeof project !== 'string') {
      result.push(project)
      continue
    }
    for (const file of await configFiles(project, root)) {
      const own = await loadConfig(importConfig, file)
      const dir = dirname(file)
      const projectRoot = resolve(dir, own.test?.root ?? own.root ?? '.')
      const testDir = own.test?.dir ? resolve(projectRoot, own.test.dir) : projectRoot
      const excluded = exclude
        .map((f) => relative(testDir, resolve(root, f)))
        .filter((f) => !f.startsWith('..') && !isAbsolute(f))
      result.push({
        ...top,
        extends: file,
        root: projectRoot,
        test: {
          ...test,
          name: own.test?.name ?? packageName(dir),
          ...(excluded.length ? { exclude: excluded } : {}),
        },
      })
    }
  }
  return result
}

async function configFiles(pattern, root) {
  const files = []
  for await (const f of glob(pattern.replace('<rootDir>', root), {
    cwd: root,
    exclude: (p) => p.split(/[\\/]/).includes('node_modules'),
  })) {
    files.push(resolve(root, f))
  }
  for (const f of files) {
    if (!CONFIG_FILE.test(basename(f))) throw new Error(`${f} is not a config file; directories are not supported`)
  }
  if (!files.length) throw new Error(`No config file for the project "${pattern}"`)
  return files.sort()
}

async function loadConfig(importConfig, file) {
  let config = await (await importConfig(file)).default
  if (typeof config === 'function') {
    config = await config({ command: 'serve', mode: 'test', isPreview: false, isSsrBuild: false })
  }
  return config ?? {}
}

function packageName(dir) {
  const pkg = resolve(dir, 'package.json')
  const name = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).name : undefined
  return typeof name === 'string' && name ? name : basename(dir)
}
