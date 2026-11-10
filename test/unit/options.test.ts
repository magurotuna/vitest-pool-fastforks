import { totalmem } from 'node:os'
import { describe, expect, test } from 'vite-plus/test'
import { importFlags } from '../../src/import-flags.ts'
import { parseMemoryLimit } from '../../src/memory-limit.ts'
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
