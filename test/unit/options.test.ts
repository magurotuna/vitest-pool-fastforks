import { totalmem } from 'node:os'
import { describe, expect, test } from 'vite-plus/test'
import { importFlags } from '../../src/import-flags.ts'
import { availableMemory, overMemoryLimit, parseMemoryLimit } from '../../src/memory-limit.ts'
import { splitNodeOptions } from '../../src/node-options.ts'

describe('parseMemoryLimit', () => {
  test('returns bytes as they are', () => {
    expect(parseMemoryLimit(undefined)).toBe(undefined)
    expect(parseMemoryLimit(1024)).toBe(1024)
  })

  test('converts a percentage of the system memory to bytes', () => {
    expect(parseMemoryLimit('10%')).toBe(totalmem() / 10)
    expect(parseMemoryLimit('12.5%')).toBe(totalmem() / 8)
  })

  test.each(['10', '10 %', '1GB', ''])('rejects %j', (value) => {
    expect(() => parseMemoryLimit(value)).toThrow('memoryLimit must be a number of bytes or a percentage')
  })
})

describe('availableMemory', () => {
  const total = 8 * 2 ** 30

  test('uses the memory of the system if the process has no limit', () => {
    expect(availableMemory(undefined, total)).toBe(total)
    expect(availableMemory(0, total)).toBe(total)
  })

  test('uses the limit of the process if it is lower', () => {
    expect(availableMemory(2 * 2 ** 30, total)).toBe(2 * 2 ** 30)
  })

  test('ignores a limit above the memory of the system', () => {
    // process.constrainedMemory() on Linux, if the cgroup sets no limit.
    expect(availableMemory(2 ** 64, total)).toBe(total)
  })

  test('uses the limit of the process if the memory of the system is not known', () => {
    expect(availableMemory(2 * 2 ** 30, 0)).toBe(2 * 2 ** 30)
  })
})

describe('overMemoryLimit', () => {
  const heap = { used: 100, limit: 1000 }

  test('compares the RSS with the limit', () => {
    expect(overMemoryLimit({ rss: 500, heap }, 400)).toBe(true)
    expect(overMemoryLimit({ rss: 500, heap }, 500)).toBe(false)
    expect(overMemoryLimit({ heap }, 0)).toBe(false)
  })

  test('is true if more than half of the JavaScript heap is in use', () => {
    expect(overMemoryLimit({ rss: 0, heap: { used: 501, limit: 1000 } }, Infinity)).toBe(true)
    expect(overMemoryLimit({ rss: 0, heap: { used: 500, limit: 1000 } }, Infinity)).toBe(false)
    expect(overMemoryLimit({ rss: 0 }, Infinity)).toBe(false)
  })
})

describe('splitNodeOptions', () => {
  test('splits at spaces', () => {
    expect(splitNodeOptions('')).toEqual([])
    expect(splitNodeOptions('  --expose-gc   --conditions=dev ')).toEqual(['--expose-gc', '--conditions=dev'])
  })

  test('keeps spaces and escaped characters in double quotes', () => {
    expect(splitNodeOptions('--require "./a b.cjs" "a\\"b" "c\\\\d"')).toEqual([
      '--require',
      './a b.cjs',
      'a"b',
      'c\\d',
    ])
  })

  test('removes double quotes inside an option, like Node.js', () => {
    expect(splitNodeOptions('--import="./preload.mjs" --require="./a b.cjs"')).toEqual([
      '--import=./preload.mjs',
      '--require=./a b.cjs',
    ])
    expect(splitNodeOptions('--conditions=a""b ""')).toEqual(['--conditions=ab'])
  })

  test('keeps backslashes outside double quotes', () => {
    expect(splitNodeOptions('--import=C:\\dir\\a.mjs')).toEqual(['--import=C:\\dir\\a.mjs'])
  })
})

describe('importFlags', () => {
  test('returns the --import values, NODE_OPTIONS first', () => {
    expect(importFlags('--import a.mjs --expose-gc', ['--import=b.mjs', '--import', 'c.mjs'])).toEqual([
      'a.mjs',
      'b.mjs',
      'c.mjs',
    ])
  })

  test('ignores --import without a value and other flags', () => {
    expect(importFlags('', ['--require', 'r.cjs', '--import'])).toEqual([])
  })
})
