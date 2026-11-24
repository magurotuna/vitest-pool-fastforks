import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { prepareCacheDir } from '../../src/snapshot.ts'

// Windows has no user IDs or POSIX modes for these checks.
describe.skipIf(process.platform === 'win32')('prepareCacheDir', () => {
  let root: string
  let dir: string
  const mode = (path: string): number => statSync(path).mode & 0o777

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fastforks-cache-test-'))
    dir = join(root, 'cache')
  })
  afterEach(() => {
    // A test can leave a directory that the user cannot write to.
    if (existsSync(dir)) chmodSync(dir, 0o700)
    rmSync(root, { recursive: true, force: true })
  })

  test('makes a new directory that only the user can use', () => {
    expect(prepareCacheDir(dir)).toBe(true)
    expect(mode(dir)).toBe(0o700)
  })

  test('does not make a temporary directory that does not exist', () => {
    const missing = join(root, 'missing')
    expect(() => prepareCacheDir(join(missing, 'cache'))).toThrow(/ENOENT/)
    expect(existsSync(missing)).toBe(false)
  })

  test('keeps the files of a directory with mode 0700', () => {
    mkdirSync(dir, { mode: 0o700 })
    writeFileSync(join(dir, 'a.blob'), '')
    expect(prepareCacheDir(dir)).toBe(true)
    expect(existsSync(join(dir, 'a.blob'))).toBe(true)
  })

  test.each(['755', '775', '777', '500'])('rejects a directory with mode %s and does not change it', (octal) => {
    const other = parseInt(octal, 8)
    mkdirSync(dir)
    writeFileSync(join(dir, 'a.blob'), '')
    chmodSync(dir, other)
    expect(prepareCacheDir(dir)).toBe(false)
    expect(mode(dir)).toBe(other)
    expect(existsSync(join(dir, 'a.blob'))).toBe(true)
  })

  test('rejects a directory of another user', () => {
    mkdirSync(dir, { mode: 0o700 })
    expect(prepareCacheDir(dir, statSync(dir).uid + 1)).toBe(false)
  })

  test('rejects a symbolic link to a directory', () => {
    const target = join(root, 'target')
    mkdirSync(target, { mode: 0o700 })
    symlinkSync(target, dir)
    expect(prepareCacheDir(dir)).toBe(false)
  })

  test('rejects a file', () => {
    writeFileSync(dir, '', { mode: 0o700 })
    expect(prepareCacheDir(dir)).toBe(false)
  })

  test('getSnapshotBlob warns and returns no blob for a rejected directory', async () => {
    const target = join(root, 'target')
    mkdirSync(target, { mode: 0o700 })
    symlinkSync(target, join(root, `vitest-pool-fastforks-snapshot-${process.geteuid!()}`))
    vi.stubEnv('TMPDIR', root)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      vi.resetModules()
      const { getSnapshotBlob } = await import('../../src/snapshot.ts')
      expect(await getSnapshotBlob()).toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('is not a directory that you own with mode 0700'))
    } finally {
      warn.mockRestore()
    }
  })
})
