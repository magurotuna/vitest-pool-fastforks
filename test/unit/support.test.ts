import { describe, expect, test, vi } from 'vite-plus/test'
import { canUseSnapshotBlob } from '../../src/snapshot.ts'
import { detect, isAtLeast, platformTag } from '../../src/support.ts'

describe('isAtLeast', () => {
  test.each([
    ['26.11.0', true],
    ['26.13.0', true],
    ['27.0.0', true],
    ['26.11', true],
    ['26.10.9', false],
    ['25.99.0', false],
  ])('%s is v26.11.0 or later: %s', (version, expected) => {
    expect(isAtLeast(version, [26, 11, 0])).toBe(expected)
  })
})

test('platformTag starts with the platform and the architecture', () => {
  const tag = platformTag()
  expect(tag.startsWith(`${process.platform}-${process.arch}`)).toBe(true)
  if (process.platform === 'linux') expect(tag).toMatch(/-(glibc|musl)$/)
})

test('detect returns a reason when VITEST_POOL_FASTFORKS=0 is set', () => {
  vi.stubEnv('VITEST_POOL_FASTFORKS', '0')
  expect(detect()).toEqual({ reason: 'VITEST_POOL_FASTFORKS=0 is set' })
})

describe('canUseSnapshotBlob', () => {
  test('allows no flags and the flags that behave the same with the blob', () => {
    expect(canUseSnapshotBlob([])).toBe(true)
    expect(canUseSnapshotBlob(['--conditions', 'development', '--expose-gc'])).toBe(true)
    expect(canUseSnapshotBlob(['--import=./setup.mjs'], '--max-old-space-size=4096 --enable-source-maps')).toBe(true)
  })

  test('does not read the value of a flag as a flag', () => {
    expect(canUseSnapshotBlob(['-C', '--experimental-eventsource'])).toBe(true)
  })

  test('rejects other flags in execArgv and in NODE_OPTIONS', () => {
    expect(canUseSnapshotBlob(['--experimental-eventsource'])).toBe(false)
    expect(canUseSnapshotBlob([], '--no-experimental-global-navigator')).toBe(false)
  })
})
