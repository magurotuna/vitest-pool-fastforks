import { defineConfig } from 'vite-plus'

const ignorePatterns = ['dist/**', 'build/**', 'prebuilds/**', 'test/fixtures/**', 'test/.results/**']

export default defineConfig({
  pack: [
    // Loaded by the main process, and import-flags by each test file's
    // Environment.
    {
      entry: ['src/index.ts', 'src/import-flags.ts'],
      format: 'esm',
      platform: 'node',
      dts: true,
    },
    // Loaded by the child process and by `node --build-snapshot`, as
    // CommonJS scripts.
    {
      entry: ['src/host.cts', 'src/entry.cts', 'src/snapshot-entry.cts'],
      format: 'cjs',
      platform: 'node',
      dts: false,
      clean: false,
    },
  ],
  lint: {
    ignorePatterns,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns,
    semi: false,
    singleQuote: true,
    printWidth: 120,
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    unstubEnvs: true,
  },
})
